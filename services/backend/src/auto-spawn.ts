/**
 * Auto-Spawn: Automatically spawn agent sessions when tasks are assigned.
 *
 * Triggered when a task is moved to in-progress with an agentId set,
 * or when an in-progress task has a new agentId assigned.
 *
 * Uses the OpenClaw gateway tools/invoke HTTP API with sessions_spawn.
 */

import { findTaskById, updateTask } from './task-store.js';
import { logAudit } from './audit-store.js';
import { Task } from './task-store.js';

const GATEWAY_PORT = (() => {
  const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
  try {
    return new URL(url.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  } catch {
    return '18789';
  }
})();

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WORKSPACE_PATH = `${process.env.HOME || '/home/chris'}/.openclaw/workspace`;

// Agents that are valid for auto-spawning (must exist in openclaw.json agents.list)
const KNOWN_AGENT_IDS = new Set([
  'senior-dev',
  'junior-dev',
  'senior-researcher',
  'junior-researcher',
  'editor',
  'qa',
  'security',
  'product-manager',
  'cso',
]);

// Default timeout for spawned sessions (30 minutes)
const DEFAULT_TIMEOUT_SECONDS = 1800;

export interface AutoSpawnResult {
  success: boolean;
  sessionKey?: string;
  error?: string;
}

/**
 * Build the task prompt for the spawned agent
 */
export function buildTaskPrompt(task: Task, projectRepoPath: string): string {
  const apiUrl = BACKEND_URL;
  const taskDesc = task.description
    ? task.description.length > 2000
      ? task.description.slice(0, 2000) + '\n...(truncated, fetch full details below)'
      : task.description
    : '(no description — fetch full task details below)';

  return `You are working on ${task.projectId || 'a project'} at ${projectRepoPath}.

TASK: ${task.title}

Fetch full task details:
curl -s ${apiUrl}/api/tasks/${task.id} | python3 -m json.tool

${taskDesc}

When done, update the task:
curl -s -X PATCH ${apiUrl}/api/tasks/${task.id} -H "Content-Type: application/json" -d '{"status":"review","handoffNotes":"..."}'

Commit and push.`;
}

/**
 * Spawn a session for the given task using the OpenClaw gateway sessions_spawn API.
 * Returns the new session key on success.
 */
export async function spawnTaskSession(
  task: Task,
  agentId: string,
  opts?: { force?: boolean }
): Promise<AutoSpawnResult> {
  // Safety: only spawn for known agents
  if (!KNOWN_AGENT_IDS.has(agentId)) {
    return {
      success: false,
      error: `Unknown agent ID: ${agentId}. Must be one of: ${[...KNOWN_AGENT_IDS].join(', ')}`,
    };
  }

  // Safety: require projectId
  if (!task.projectId) {
    return { success: false, error: 'Task has no projectId — cannot determine repo path' };
  }

  // Safety: don't re-spawn if sessionKey already set (unless forced)
  if (task.sessionKey && !opts?.force) {
    return { success: false, error: `Task already has a session: ${task.sessionKey}` };
  }

  // Build the repo path
  const projectRepoPath = `${WORKSPACE_PATH}/${task.projectId}`;

  // Build the prompt
  const prompt = buildTaskPrompt(task, projectRepoPath);

  console.log(`[AutoSpawn] Spawning ${agentId} for task ${task.id}: ${task.title}`);

  try {
    const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          agentId,
          task: prompt,
          label: `mc-${task.id.slice(0, 8)}`,
          cleanup: 'delete',
          runTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        },
      }),
    });

    const result = (await response.json()) as any;

    if (!response.ok || !result.ok) {
      const errMsg = result.error?.message || result.error || `HTTP ${response.status}`;
      console.error(`[AutoSpawn] Failed to spawn session for task ${task.id}:`, errMsg);
      return { success: false, error: `Gateway spawn failed: ${errMsg}` };
    }

    const spawnResult = result.result?.details || result.result || result;
    const sessionKey = spawnResult.childSessionKey || spawnResult.sessionKey;

    if (!sessionKey) {
      console.error(`[AutoSpawn] Spawn succeeded but no sessionKey returned:`, JSON.stringify(spawnResult));
      return { success: false, error: 'Spawn succeeded but no sessionKey returned' };
    }

    console.log(`[AutoSpawn] Session spawned: ${sessionKey} for task ${task.id}`);
    return { success: true, sessionKey };
  } catch (err: any) {
    console.error(`[AutoSpawn] Error calling gateway for task ${task.id}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Check if a task should be auto-spawned, and if so, spawn it.
 * Call this from the PATCH handler after the task is updated.
 *
 * Conditions for auto-spawn:
 *   - Task moved to 'in-progress' AND has agentId
 *   - OR task already 'in-progress' AND agentId was just set/changed
 *   - AND no sessionKey already set
 *   - AND agentId is a known agent
 */
export async function autoSpawnIfNeeded(
  taskId: string,
  oldStatus: string | undefined,
  newStatus: string | undefined,
  oldAgentId: string | undefined | null,
  newAgentId: string | undefined | null
): Promise<AutoSpawnResult | null> {
  const effectiveStatus = newStatus || oldStatus;
  const effectiveAgentId = newAgentId || oldAgentId;

  // Must be in-progress
  if (effectiveStatus !== 'in-progress') return null;

  // Must have an agentId
  if (!effectiveAgentId) return null;

  // Must be a known agent
  if (!KNOWN_AGENT_IDS.has(effectiveAgentId)) return null;

  // Trigger if: status changed to in-progress, OR agentId was newly assigned/changed
  const statusChangedToInProgress = newStatus === 'in-progress' && oldStatus !== 'in-progress';
  const agentIdChanged = newAgentId && newAgentId !== oldAgentId;

  if (!statusChangedToInProgress && !agentIdChanged) return null;

  // Reload the task to get the full current state
  const task = await findTaskById(taskId);
  if (!task) return null;

  // Don't re-spawn if already has a session
  if (task.sessionKey) {
    console.log(`[AutoSpawn] Skipping task ${taskId}: already has session ${task.sessionKey}`);
    return null;
  }

  // Spawn
  const spawnResult = await spawnTaskSession(task, effectiveAgentId);

  if (spawnResult.success && spawnResult.sessionKey) {
    // Update task with the new sessionKey
    await updateTask(taskId, { sessionKey: spawnResult.sessionKey });

    // Audit log
    await logAudit({
      userId: 'auto-spawn',
      action: 'task.session_spawned',
      entityType: 'task',
      entityId: taskId,
      details: { sessionKey: spawnResult.sessionKey, agentId: effectiveAgentId },
    });
  }

  return spawnResult;
}
