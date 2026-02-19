/**
 * Stage Agent Dispatcher
 * 
 * Triggers automated agents when tasks transition between stages.
 * Currently supports:
 *   - "review" → Spawns a dedicated QA agent to review the task
 *   - "done"   → Spawns a docs agent to update PROJECT.md if needed
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
  if (newStatus !== 'review' && newStatus !== 'done') return;

  try {
    processingTasks.add(taskId);
    if (newStatus === 'review') {
      await handleReviewStage(taskId);
    } else if (newStatus === 'done') {
      await handleDoneStage(taskId);
    }
  } finally {
    // Keep the task in processingTasks for a bit to prevent re-entry
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

/**
 * Done stage handler — spawns docs agent to update PROJECT.md if needed
 */
async function handleDoneStage(taskId: string): Promise<void> {
  const task = await findTaskById(taskId);
  if (!task) return;

  // Skip if no commit (nothing changed in the codebase)
  if (!task.commitHash) {
    console.log(`[StageAgent] Skipping docs update for task ${taskId}: no commit hash`);
    return;
  }

  console.log(`[StageAgent] Spawning docs agent for task ${taskId}: ${task.title}`);

  const gatewayUrl = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
  const GATEWAY_PORT = new URL(gatewayUrl.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

  try {
    const docsPrompt = buildDocsPrompt(task);

    const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          agentId: 'editor',
          task: docsPrompt,
          cleanup: 'delete',
          runTimeoutSeconds: 120,
        },
      }),
    });

    const result = await response.json() as any;

    if (!response.ok || !result.ok) {
      console.error('[StageAgent] Failed to spawn docs agent:', JSON.stringify(result));
      return;
    }

    const spawnResult = result.result?.details || result.result || result;
    console.log(`[StageAgent] Docs agent spawned: ${spawnResult.childSessionKey || spawnResult.sessionKey}`);

    await logAudit({
      userId: 'docs-agent',
      action: 'task.docs_update_started',
      entityType: 'task',
      entityId: taskId,
      details: {
        sessionKey: spawnResult.childSessionKey || spawnResult.sessionKey,
        runId: spawnResult.runId,
      },
    });

  } catch (err: any) {
    console.error(`[StageAgent] Error spawning docs agent for task ${taskId}:`, err.message);
  }
}

/**
 * Build the prompt for the docs agent
 */
function buildDocsPrompt(task: Task): string {
  return `## Documentation Update Check

You are a docs agent. A task just completed in Mission Clawtrol. Your job is to check if PROJECT.md needs updating.

### Completed Task
- **Title:** ${task.title}
- **Description:** ${task.description || 'N/A'}
- **Commit Hash:** ${task.commitHash}

### Instructions

1. Read the current PROJECT.md:
\`\`\`bash
cat ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'}/PROJECT.md
\`\`\`

2. Check what changed in this commit:
\`\`\`bash
git -C ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'} diff --stat ${task.commitHash}^..${task.commitHash}
git -C ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'} log --oneline -1 ${task.commitHash}
\`\`\`

3. Determine if PROJECT.md needs updating. It needs an update if the task:
   - Added a new user-facing feature (new page, new API endpoint, new capability)
   - Changed the tech stack or architecture
   - Added new configuration or environment variables
   - Changed the project structure significantly

   It does NOT need an update for:
   - Bug fixes
   - Internal refactors
   - Style/CSS changes
   - Test additions
   - Minor tweaks

4. If PROJECT.md needs updating:
   - Edit the file to reflect the new feature/change
   - Keep the existing structure and style
   - Be concise — one or two lines per feature
   - Commit the change:
   \`\`\`bash
   cd ~/.openclaw/workspace/${task.projectId || 'mission-clawtrol'}
   git add PROJECT.md
   git commit -m "docs: update PROJECT.md for ${task.title}"
   \`\`\`

5. If no update is needed, do nothing. Just say "No docs update needed."

IMPORTANT: Only update PROJECT.md. Do not modify any other files.`;
}
