/**
 * Stage Agent Dispatcher
 * 
 * Triggers automated agents when tasks transition between stages.
 * Currently supports:
 *   - "review" → Spawns a dedicated QA agent via OpenClaw gateway to review the task
 * 
 * The QA agent reviews handoff notes, validates done criteria, checks the git diff,
 * posts findings as a comment, and moves the task to done or back to in-progress.
 */

import { Task, updateTask, findTaskById } from '../task-store.js';
import { createComment } from '../comment-store.js';
import { logAudit } from '../audit-store.js';
import { enrichDoneTransition } from '../enrichment.js';

// Track tasks currently being processed to prevent infinite loops
const processingTasks = new Set<string>();

// How long to wait for the QA agent to complete (ms)
const QA_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Handle a task status change — triggers stage agents if configured
 */
export async function onTaskStatusChange(
  taskId: string,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  console.log(`[StageAgent] onTaskStatusChange called: ${taskId} ${oldStatus} → ${newStatus}`);
  // Prevent re-entry (stage agent moving task would trigger this again)
  if (processingTasks.has(taskId)) {
    console.log(`[StageAgent] Skipping ${taskId}: already processing`);
    return;
  }

  // Only act on transitions we handle
  if (newStatus !== 'review') return;

  try {
    processingTasks.add(taskId);
    await handleReviewStage(taskId);
  } finally {
    // Keep the task in processingTasks for a bit to prevent re-entry
    // from the QA agent's own status updates
    setTimeout(() => processingTasks.delete(taskId), 30_000);
  }
}

/**
 * Review stage handler — spawns QA agent via OpenClaw gateway
 */
async function handleReviewStage(taskId: string): Promise<void> {
  const task = await findTaskById(taskId);
  if (!task) return;

  // Skip if no handoff notes (nothing to review)
  if (!task.handoffNotes || task.handoffNotes.length < 20) {
    console.log(`[StageAgent] Skipping QA for task ${taskId}: no handoff notes`);
    return;
  }

  console.log(`[StageAgent] Spawning QA agent via HTTP API for task ${taskId}: ${task.title}`);

  // Extract port from GATEWAY_URL (ws://127.0.0.1:18789)
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
  const GATEWAY_PORT = new URL(gatewayUrl.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

  try {
    // Build the QA prompt
    const qaPrompt = buildQAPrompt(task);

    // Spawn via HTTP tools/invoke API
    const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          agentId: 'qa',
          task: qaPrompt,
          model: 'anthropic/claude-sonnet-4-5',
          cleanup: 'delete',
          runTimeoutSeconds: Math.floor(QA_TIMEOUT_MS / 1000),
        },
      }),
    });

    const result = await response.json() as any;

    if (!response.ok || !result.ok) {
      console.error('[StageAgent] Failed to spawn QA agent:', JSON.stringify(result));
      await createComment({
        taskId,
        userId: 'qa-agent',
        userName: '🔍 QA Agent',
        userAvatar: null,
        content: `⚠️ **QA Review Unavailable** — ${result.error?.message || 'Could not spawn QA agent'}. Manual review required.`,
      });
      return;
    }

    const spawnResult = result.result?.details || result.result || result;
    console.log(`[StageAgent] QA agent spawned: ${spawnResult.childSessionKey || spawnResult.sessionKey}`);

    await logAudit({
      userId: 'qa-agent',
      action: 'task.qa_started',
      entityType: 'task',
      entityId: taskId,
      details: { 
        sessionKey: spawnResult.childSessionKey || spawnResult.sessionKey, 
        runId: spawnResult.runId,
      },
    });

  } catch (err: any) {
    console.error(`[StageAgent] Error spawning QA agent for task ${taskId}:`, err.message);
    await createComment({
      taskId,
      userId: 'qa-agent',
      userName: '🔍 QA Agent',
      userAvatar: null,
      content: `⚠️ **QA Review Error** — ${err.message}. Manual review required.`,
    });
  }
}

/**
 * Build the prompt for the QA agent
 */
function buildQAPrompt(task: Task): string {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
  
  return `## QA Review Task

You are a QA reviewer. Review this task and determine if it meets the Done Criteria.

### Task Details
- **ID:** ${task.id}
- **Title:** ${task.title}
- **Project:** ${task.projectId || 'unknown'}
- **Description:** ${task.description || 'N/A'}
- **Commit Hash:** ${task.commitHash || 'not provided'}

### Handoff Notes
${task.handoffNotes || 'None provided'}

### Done Criteria (ALL required)
1. **Files changed** — list of files modified
2. **How tested** — what testing was done
3. **Edge cases / risks** — known limitations or risks
4. **Rollback plan** — how to undo the change
5. **Commit hash** — git commit hash (or NO_COMMIT for non-git work)

### Your Job
1. Check if ALL 5 done criteria sections are present and substantive in the handoff notes
2. If a commit hash is provided and the project has a git repo, verify the commit exists:
   \`\`\`bash
   git -C ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'} cat-file -t ${task.commitHash || 'HEAD'} 2>/dev/null
   \`\`\`
3. If the commit exists, review the diff for obvious issues:
   \`\`\`bash
   git -C ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'} diff --stat ${task.commitHash || 'HEAD'}^..${task.commitHash || 'HEAD'}
   \`\`\`

### Actions Required
After your review, you MUST call the Mission Clawtrol API to post your findings:

**1. Post your review as a comment:**
\`\`\`bash
curl -s -X POST ${BACKEND_URL}/api/tasks/${task.id}/comments \\
  -H 'Content-Type: application/json' \\
  -d '{"userId": "qa-agent", "userName": "🔍 QA Agent", "content": "<your review markdown here>"}'
\`\`\`

**2a. If ALL criteria pass — move to done:**
\`\`\`bash
curl -s -X PATCH ${BACKEND_URL}/api/tasks/${task.id} \\
  -H 'Content-Type: application/json' \\
  -d '{"status": "done"}'
\`\`\`

**2b. If any criteria FAIL — move back to in-progress:**
\`\`\`bash
curl -s -X PATCH ${BACKEND_URL}/api/tasks/${task.id} \\
  -H 'Content-Type: application/json' \\
  -d '{"status": "in-progress"}'
\`\`\`

### Review Comment Format
Use this format for your comment:
\`\`\`
🤖 **QA Review**

✅/❌ **Files changed**: [found/missing]
✅/❌ **How tested**: [found/missing]  
✅/❌ **Edge cases / risks**: [found/missing]
✅/❌ **Rollback plan**: [found/missing]
✅/❌ **Commit hash**: [found/missing/verified/not found in repo]

**Diff Summary**: [X files changed, Y insertions, Z deletions]

**Verdict**: ✅ PASSED — All criteria met / ❌ FAILED — [list what's missing]
\`\`\`

IMPORTANT: You MUST make the API calls. Do not just analyze — take action.`;
}
