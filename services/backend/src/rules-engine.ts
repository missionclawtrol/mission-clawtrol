/**
 * Rules Engine — evaluates rules and executes actions on task status changes.
 *
 * Phase 1 supports:
 *   - trigger: task.status.changed
 *   - conditions: key-value matching (task.status.to, task.status.from, task.type, etc.)
 *   - actions: spawn_agent, inject_context, conflict_check
 */

import { getRulesByTrigger, type Rule } from './rule-store.js';
import type { Task } from './task-store.js';
import { updateTask } from './task-store.js';
import { createComment } from './comment-store.js';
import { logAudit } from './audit-store.js';
import { countDeliverableWords, enrichNonDevDoneTransition } from './enrichment.js';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_PORT = (() => {
  try {
    return new URL(GATEWAY_URL.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  } catch {
    return '18789';
  }
})();
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// QA review timeout (2 minutes)
const QA_TIMEOUT_SECONDS = 120;

export interface RuleContext {
  task: Task;
  trigger: string;
  oldStatus?: string;
  newStatus?: string;
}

// ─────────────────────────────────────────────────────────────────
// Condition evaluation
// ─────────────────────────────────────────────────────────────────

/**
 * Check if a condition value matches an actual value.
 * Supports:
 *   - string/number: exact match
 *   - array: any-of (OR)
 *   - object with operators: { $eq, $ne, $in, $nin }
 *     e.g. { "$nin": ["development", "bug"] }  → actual must NOT be in the list
 *          { "$ne": "development" }             → actual must not equal "development"
 */
function matchesConditionValue(expected: any, actual: any): boolean {
  // Operator object: { $eq | $ne | $in | $nin }
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const ops = expected as Record<string, any>;
    for (const [op, operand] of Object.entries(ops)) {
      switch (op) {
        case '$eq':
          if (String(operand) !== String(actual ?? '')) return false;
          break;
        case '$ne':
          if (String(operand) === String(actual ?? '')) return false;
          break;
        case '$in': {
          const list = (Array.isArray(operand) ? operand : [operand]).map(String);
          if (!list.includes(String(actual ?? ''))) return false;
          break;
        }
        case '$nin': {
          const list = (Array.isArray(operand) ? operand : [operand]).map(String);
          if (list.includes(String(actual ?? ''))) return false;
          break;
        }
        default:
          console.warn(`[RulesEngine] Unknown condition operator: ${op}`);
      }
    }
    return true;
  }

  // Array = any-of (OR match)
  if (Array.isArray(expected)) {
    return expected.map(String).includes(String(actual ?? ''));
  }
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }
  return String(expected) === String(actual ?? '');
}

/**
 * Resolve a condition key to its actual value from context.
 */
function resolveConditionKey(key: string, context: RuleContext): any {
  switch (key) {
    case 'task.status.to':
      return context.newStatus;
    case 'task.status.from':
      return context.oldStatus;
    case 'task.type':
      return context.task.type;
    case 'task.projectId':
      return context.task.projectId;
    case 'task.agentId':
      return context.task.agentId;
    case 'task.priority':
      return context.task.priority;
    default:
      return undefined; // Unknown key — treated as "don't care" (fail-open)
  }
}

/**
 * Evaluate a rule's conditions against the context.
 * All conditions must match (AND logic). Fail-open: unknown keys pass.
 */
function evaluateConditions(conditions: Record<string, any>, context: RuleContext): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = resolveConditionKey(key, context);
    if (!matchesConditionValue(expected, actual)) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Action execution
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a spawn_agent action — spawns an agent session via the gateway.
 */
async function executeSpawnAgent(
  action: Record<string, any>,
  context: RuleContext,
  rule: Rule
): Promise<void> {
  const { task } = context;
  const agentId: string = action.agentId;
  const template: string = action.template || '';

  if (!agentId) {
    console.warn(`[RulesEngine] spawn_agent action missing agentId in rule ${rule.id}`);
    return;
  }

  console.log(
    `[RulesEngine] Executing spawn_agent: agentId=${agentId}, template=${template}, task=${task.id}`
  );

  let prompt = '';
  if (template === 'qa-review') {
    prompt = buildQAPrompt(task);
  } else if (template === 'docs-update') {
    prompt = buildDocsPrompt(task);
  } else {
    // Generic spawn
    prompt = `You are spawned by Mission Clawtrol for task: ${task.title}\nTask ID: ${task.id}`;
  }

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
          cleanup: 'delete',
          runTimeoutSeconds: QA_TIMEOUT_SECONDS,
          label: `rule-${rule.id.slice(0, 8)}-${task.id.slice(0, 8)}`,
        },
      }),
    });

    const result = (await response.json()) as any;

    if (!response.ok || !result.ok) {
      const errMsg = result.error?.message || result.error || `HTTP ${response.status}`;
      console.error(`[RulesEngine] spawn_agent failed for rule ${rule.id}:`, errMsg);

      // Post failure comment for QA
      if (template === 'qa-review') {
        await createComment({
          taskId: task.id,
          userId: 'qa-agent',
          userName: '🔍 QA Agent',
          userAvatar: null,
          content: `⚠️ **QA Review Unavailable** — ${errMsg}. Manual review required.`,
        });
      }
      return;
    }

    const spawnResult = result.result?.details || result.result || result;
    const sessionKey = spawnResult.childSessionKey || spawnResult.sessionKey;
    console.log(`[RulesEngine] Agent spawned: sessionKey=${sessionKey} for task ${task.id}`);

    await logAudit({
      userId: `rule:${rule.id}`,
      action: `rule.spawn_agent`,
      entityType: 'task',
      entityId: task.id,
      details: { ruleId: rule.id, agentId, sessionKey, template },
    });
  } catch (err: any) {
    console.error(`[RulesEngine] Error executing spawn_agent for rule ${rule.id}:`, err.message);
    if (template === 'qa-review') {
      await createComment({
        taskId: task.id,
        userId: 'qa-agent',
        userName: '🔍 QA Agent',
        userAvatar: null,
        content: `⚠️ **QA Review Error** — ${err.message}. Manual review required.`,
      }).catch(() => {});
    }
  }
}

/**
 * Execute a post_comment action — posts a comment on the task.
 */
async function executePostComment(
  action: Record<string, any>,
  context: RuleContext,
  rule: Rule
): Promise<void> {
  const { task } = context;
  const content: string = action.content;

  if (!content) {
    console.warn(`[RulesEngine] post_comment action missing content in rule ${rule.id}`);
    return;
  }

  console.log(
    `[RulesEngine] Executing post_comment for task ${task.id} (rule ${rule.id})`
  );

  try {
    await createComment({
      taskId: task.id,
      userId: action.userId || 'system',
      userName: action.userName || '🦞 Mission Clawtrol',
      userAvatar: null,
      content,
    });

    await logAudit({
      userId: `rule:${rule.id}`,
      action: 'rule.post_comment',
      entityType: 'task',
      entityId: task.id,
      details: { ruleId: rule.id },
    });
  } catch (err: any) {
    console.error(
      `[RulesEngine] Error executing post_comment for rule ${rule.id}:`,
      err.message
    );
  }
}

/**
 * Execute a word_count_cost action — counts words in deliverables, calculates
 * human cost, patches the task, and warns if no deliverables are found.
 */
async function executeWordCountCost(
  action: Record<string, any>,
  context: RuleContext,
  rule: Rule
): Promise<void> {
  const { task } = context;

  console.log(
    `[RulesEngine] Executing word_count_cost for task ${task.id} (rule ${rule.id})`
  );

  try {
    const totalWords = await countDeliverableWords(task.id);

    if (totalWords === 0) {
      // No deliverables found — post a warning comment
      await createComment({
        taskId: task.id,
        userId: 'system',
        userName: '📋 Mission Clawtrol',
        userAvatar: null,
        content:
          '⚠️ **No deliverables found** — this task moved to done but has no registered deliverables. ' +
          'Please register a deliverable file or this task may be sent back to in-progress during review.',
      });
      console.warn(`[RulesEngine] word_count_cost: no deliverables for task ${task.id}`);
      return;
    }

    // Calculate cost from word count
    const costUpdates: Record<string, any> = {};
    await enrichNonDevDoneTransition(task, costUpdates);

    if (costUpdates.estimatedHumanMinutes) {
      await updateTask(task.id, {
        estimatedHumanMinutes: costUpdates.estimatedHumanMinutes,
        humanCost: costUpdates.humanCost,
      });

      await logAudit({
        userId: `rule:${rule.id}`,
        action: 'rule.word_count_cost',
        entityType: 'task',
        entityId: task.id,
        details: {
          ruleId: rule.id,
          totalWords,
          estimatedHumanMinutes: costUpdates.estimatedHumanMinutes,
          humanCost: costUpdates.humanCost,
        },
      });

      console.log(
        `[RulesEngine] word_count_cost: task ${task.id} → ${totalWords} words → ` +
        `${costUpdates.estimatedHumanMinutes} min → $${costUpdates.humanCost}`
      );
    }
  } catch (err: any) {
    console.error(
      `[RulesEngine] Error executing word_count_cost for rule ${rule.id}:`,
      err.message
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluate and execute all matching rules for a trigger+context.
 * Fail-open: errors in rules engine never block the triggering event.
 */
export async function evaluateAndExecuteRules(
  trigger: string,
  context: RuleContext
): Promise<{ rulesMatched: string[] }> {
  const rulesMatched: string[] = [];

  try {
    const rules = await getRulesByTrigger(trigger, context.task.projectId);

    for (const rule of rules) {
      if (!evaluateConditions(rule.conditions, context)) continue;

      rulesMatched.push(rule.id);
      console.log(`[RulesEngine] Rule matched: ${rule.name} (${rule.id})`);

      // Execute actions
      for (const action of rule.actions) {
        try {
          if (action.type === 'spawn_agent') {
            // Fire-and-forget (don't await — keep response fast)
            executeSpawnAgent(action, context, rule).catch((err) => {
              console.error(`[RulesEngine] spawn_agent error in rule ${rule.id}:`, err);
            });
          } else if (action.type === 'post_comment') {
            // post_comment: synchronous — we want the comment before the response returns
            await executePostComment(action, context, rule);
          } else if (action.type === 'word_count_cost') {
            // word_count_cost: fire-and-forget (async enrichment, doesn't block)
            executeWordCountCost(action, context, rule).catch((err) => {
              console.error(`[RulesEngine] word_count_cost error in rule ${rule.id}:`, err);
            });
          } else if (action.type === 'inject_context') {
            // inject_context is handled at spawn time via getInjectContextContent()
            // Nothing to do here at status-change time
          } else if (action.type === 'conflict_check') {
            // conflict_check is handled inline in tasks route
          } else {
            console.warn(`[RulesEngine] Unknown action type: ${action.type} in rule ${rule.id}`);
          }
        } catch (actionErr: any) {
          console.error(
            `[RulesEngine] Error executing action ${action.type} in rule ${rule.id}:`,
            actionErr.message
          );
        }
      }
    }
  } catch (err: any) {
    console.error('[RulesEngine] Evaluation error (fail-open):', err.message);
  }

  return { rulesMatched };
}

/**
 * Get injected context content for agent spawn prompts.
 * Returns an array of strings to append to the prompt.
 */
export async function getInjectContextContent(context: RuleContext): Promise<string[]> {
  const injections: string[] = [];

  try {
    const rules = await getRulesByTrigger(context.trigger, context.task.projectId);

    for (const rule of rules) {
      if (!evaluateConditions(rule.conditions, context)) continue;

      for (const action of rule.actions) {
        if (action.type === 'inject_context' && action.content) {
          injections.push(action.content as string);
        }
      }
    }
  } catch (err: any) {
    console.error('[RulesEngine] getInjectContextContent error:', err.message);
  }

  return injections;
}

// ─────────────────────────────────────────────────────────────────
// Prompt builders (migrated from stage-agents)
// ─────────────────────────────────────────────────────────────────

function buildQAPrompt(task: Task): string {
  // Only development and bug tasks can auto-advance to done.
  // Writing, research, design, and other task types must stay in review for human approval.
  const canAutoComplete = task.type === 'development' || task.type === 'bug';

  const autoCompleteInstructions = canAutoComplete
    ? `**2a. If ALL criteria pass — move to done:**
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
\`\`\``
    : `**2. ⚠️ HUMAN APPROVAL REQUIRED — do NOT auto-complete this task.**
This task is type **${task.type || 'other'}** (not development or bug).
Leave it in **review** — a human must approve before it moves to done.

Only if criteria FAIL — move back to in-progress:
\`\`\`bash
curl -s -X PATCH ${BACKEND_URL}/api/tasks/${task.id} \\
  -H 'Content-Type: application/json' \\
  -d '{"status": "in-progress"}'
\`\`\``;

  const verdictLine = canAutoComplete
    ? `**Verdict**: ✅ PASSED — All criteria met / ❌ FAILED — [list what's missing]`
    : `**Verdict**: ✅ PASSED (awaiting human approval) / ❌ FAILED — [list what's missing]`;

  return `## QA Review Task

You are a QA reviewer. Review this task and determine if it meets the Done Criteria.

### Task Details
- **ID:** ${task.id}
- **Title:** ${task.title}
- **Type:** ${task.type || 'other'}
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

${autoCompleteInstructions}

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

${verdictLine}
\`\`\`

IMPORTANT: You MUST make the API calls. Do not just analyze — take action.`;
}

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
