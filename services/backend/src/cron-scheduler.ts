/**
 * Cron Scheduler — registers node-cron jobs for rules with trigger='cron'.
 *
 * Lifecycle:
 *   - initCronScheduler(): called on server start; loads all enabled cron rules
 *   - registerCronRule(rule): called when a cron rule is enabled or created
 *   - unregisterCronRule(ruleId): called when a cron rule is disabled or deleted
 */

import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { getCronRules, updateRule, type Rule } from './rule-store.js';

// Map of ruleId → scheduled task
const scheduledTasks = new Map<string, ScheduledTask>();

const GATEWAY_PORT = (() => {
  const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
  try {
    return new URL(url.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  } catch {
    return '18789';
  }
})();
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

/**
 * Validate a cron expression using node-cron.
 * Returns true if valid, false otherwise.
 */
export function isValidCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * Build a synthetic Task-like object for cron context.
 * Cron rules have no task context — we provide a minimal placeholder.
 */
function buildCronTask(rule: Rule) {
  return {
    id: `cron:${rule.id}`,
    title: rule.name,
    description: `Cron rule: ${rule.name}`,
    status: 'cron' as const,
    priority: 'P2' as const,
    projectId: rule.projectId ?? null,
    agentId: null,
    userId: null,
    createdBy: 'cron',
    assignedTo: null,
    sessionKey: null,
    handoffNotes: null,
    commitHash: null,
    linesAdded: null,
    linesRemoved: null,
    linesTotal: null,
    estimatedHumanMinutes: null,
    humanCost: null,
    cost: null,
    runtime: null,
    model: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    dueDate: null,
    milestoneId: null,
    type: null,
    blocked: false,
    blockerNote: null,
    tokens: null,
    linesChanged: null,
  };
}

/**
 * Execute cron actions directly (spawn_agent with a prompt from the action).
 * For cron rules, spawn_agent actions may include an inline `prompt` field.
 */
async function executeCronActions(rule: Rule): Promise<void> {
  for (const action of rule.actions) {
    if (action.type !== 'spawn_agent') {
      console.warn(`[CronScheduler] Unsupported action type for cron rule ${rule.id}: ${action.type}`);
      continue;
    }

    const agentId: string = action.agentId;
    const template: string = action.template || '';
    const prompt: string = action.prompt || `You are spawned by a scheduled cron rule: ${rule.name}. Task: ${template}`;

    if (!agentId) {
      console.warn(`[CronScheduler] spawn_agent action missing agentId in cron rule ${rule.id}`);
      continue;
    }

    console.log(`[CronScheduler] Spawning agent: agentId=${agentId}, template=${template}, rule=${rule.id}`);

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
            runTimeoutSeconds: 300,
            label: `cron-${rule.id.slice(0, 8)}`,
          },
        }),
      });

      const result = (await response.json()) as any;

      if (!response.ok || !result.ok) {
        const errMsg = result.error?.message || result.error || `HTTP ${response.status}`;
        console.error(`[CronScheduler] spawn_agent failed for cron rule ${rule.id}:`, errMsg);
      } else {
        const spawnResult = result.result?.details || result.result || result;
        const sessionKey = spawnResult.childSessionKey || spawnResult.sessionKey;
        console.log(`[CronScheduler] Agent spawned: sessionKey=${sessionKey} for cron rule ${rule.id}`);
      }
    } catch (err: any) {
      console.error(`[CronScheduler] Error spawning agent for cron rule ${rule.id}:`, err.message);
    }
  }
}

/**
 * Register a single cron rule with node-cron.
 * Safe to call multiple times — will unregister the old job first.
 */
export function registerCronRule(rule: Rule): void {
  if (rule.trigger !== 'cron') {
    console.warn(`[CronScheduler] registerCronRule called with non-cron rule: ${rule.id}`);
    return;
  }

  if (!rule.schedule) {
    console.warn(`[CronScheduler] Cron rule ${rule.id} has no schedule — skipping`);
    return;
  }

  if (!isValidCronExpression(rule.schedule)) {
    console.warn(`[CronScheduler] Invalid cron expression for rule ${rule.id}: "${rule.schedule}" — skipping`);
    return;
  }

  // Unregister any existing job for this rule
  unregisterCronRule(rule.id);

  console.log(`[CronScheduler] Registering cron rule: ${rule.id} → "${rule.schedule}" (${rule.name})`);

  const task = cron.schedule(rule.schedule, async () => {
    console.log(`[CronScheduler] Firing cron rule: ${rule.id} (${rule.name}) at ${new Date().toISOString()}`);

    try {
      // Execute the cron actions directly (spawn_agent with inline prompt)
      await executeCronActions(rule);

      // Update lastRunAt
      await updateRule(rule.id, { lastRunAt: new Date().toISOString() });
      console.log(`[CronScheduler] Cron rule ${rule.id} completed. lastRunAt updated.`);
    } catch (err: any) {
      console.error(`[CronScheduler] Error executing cron rule ${rule.id}:`, err.message);
    }
  });

  scheduledTasks.set(rule.id, task);
  console.log(`[CronScheduler] Registered cron rule: ${rule.id} → "${rule.schedule}"`);
}

/**
 * Unregister and stop a cron job by rule ID.
 */
export function unregisterCronRule(ruleId: string): void {
  const existing = scheduledTasks.get(ruleId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(ruleId);
    console.log(`[CronScheduler] Unregistered cron rule: ${ruleId}`);
  }
}

/**
 * Initialize the cron scheduler on server start.
 * Loads all enabled cron rules and registers them.
 */
export async function initCronScheduler(): Promise<void> {
  console.log('[CronScheduler] Initializing...');

  try {
    const rules = await getCronRules();
    console.log(`[CronScheduler] Found ${rules.length} enabled cron rule(s)`);

    for (const rule of rules) {
      registerCronRule(rule);
    }

    console.log('[CronScheduler] Initialized');
  } catch (err: any) {
    console.error('[CronScheduler] Failed to initialize:', err.message);
  }
}

/**
 * Get the IDs of all currently scheduled cron jobs (for diagnostics).
 */
export function getScheduledRuleIds(): string[] {
  return Array.from(scheduledTasks.keys());
}
