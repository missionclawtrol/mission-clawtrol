/**
 * Rule Store - CRUD operations for rules engine rules
 */

import { db } from './database.js';
import { randomUUID } from 'crypto';

// Raw database row
interface RuleRow {
  id: string;
  name: string;
  trigger: string;
  conditions: string;
  actions: string;
  enabled: number;
  priority: number;
  projectId: string | null;
  isBuiltIn: number;
  createdAt: string;
  updatedAt: string;
}

// Public-facing interface with parsed JSON
export interface Rule {
  id: string;
  name: string;
  trigger: string;
  conditions: Record<string, any>;
  actions: Array<Record<string, any>>;
  enabled: boolean;
  priority: number;
  projectId: string | null;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    conditions: (() => {
      try { return JSON.parse(row.conditions || '{}'); } catch { return {}; }
    })(),
    actions: (() => {
      try { return JSON.parse(row.actions || '[]'); } catch { return []; }
    })(),
    enabled: row.enabled !== 0,
    priority: row.priority,
    projectId: row.projectId,
    isBuiltIn: row.isBuiltIn !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAllRules(): Promise<Rule[]> {
  const rows = await db.query<RuleRow>(
    'SELECT * FROM rules ORDER BY priority ASC, createdAt ASC'
  );
  return rows.map(rowToRule);
}

export async function getRule(id: string): Promise<Rule | null> {
  const row = await db.queryOne<RuleRow>('SELECT * FROM rules WHERE id = ?', [id]);
  return row ? rowToRule(row) : null;
}

/**
 * Get all enabled rules matching a trigger, optionally scoped to a project.
 * Global rules (projectId=null) always apply; project-scoped rules only apply when projectId matches.
 */
export async function getRulesByTrigger(
  trigger: string,
  projectId?: string | null
): Promise<Rule[]> {
  const rows = await db.query<RuleRow>(
    `SELECT * FROM rules 
     WHERE trigger = ? AND enabled = 1
       AND (projectId IS NULL OR projectId = ?)
     ORDER BY priority ASC, createdAt ASC`,
    [trigger, projectId || null]
  );
  return rows.map(rowToRule);
}

export interface CreateRuleInput {
  id?: string;
  name: string;
  trigger: string;
  conditions?: Record<string, any>;
  actions?: Array<Record<string, any>>;
  enabled?: boolean;
  priority?: number;
  projectId?: string | null;
  isBuiltIn?: boolean;
}

export async function createRule(data: CreateRuleInput): Promise<Rule> {
  const id = data.id || randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT OR IGNORE INTO rules 
      (id, name, trigger, conditions, actions, enabled, priority, projectId, isBuiltIn, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name,
      data.trigger,
      JSON.stringify(data.conditions ?? {}),
      JSON.stringify(data.actions ?? []),
      data.enabled !== false ? 1 : 0,
      data.priority ?? 100,
      data.projectId ?? null,
      data.isBuiltIn ? 1 : 0,
      now,
      now,
    ]
  );

  return (await getRule(id))!;
}

export interface UpdateRuleInput {
  name?: string;
  trigger?: string;
  conditions?: Record<string, any>;
  actions?: Array<Record<string, any>>;
  enabled?: boolean;
  priority?: number;
  projectId?: string | null;
}

export async function updateRule(id: string, updates: UpdateRuleInput): Promise<Rule | null> {
  const existing = await getRule(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.trigger !== undefined) {
    fields.push('trigger = ?');
    values.push(updates.trigger);
  }
  if (updates.conditions !== undefined) {
    fields.push('conditions = ?');
    values.push(JSON.stringify(updates.conditions));
  }
  if (updates.actions !== undefined) {
    fields.push('actions = ?');
    values.push(JSON.stringify(updates.actions));
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.priority !== undefined) {
    fields.push('priority = ?');
    values.push(updates.priority);
  }
  if (updates.projectId !== undefined) {
    fields.push('projectId = ?');
    values.push(updates.projectId);
  }

  if (fields.length === 0) return existing;

  fields.push('updatedAt = ?');
  values.push(now);
  values.push(id);

  await db.execute(`UPDATE rules SET ${fields.join(', ')} WHERE id = ?`, values);
  return getRule(id);
}

export async function deleteRule(id: string): Promise<boolean> {
  const existing = await getRule(id);
  if (!existing) return false;
  if (existing.isBuiltIn) {
    throw new Error('Built-in rules cannot be deleted');
  }
  const result = await db.execute('DELETE FROM rules WHERE id = ?', [id]);
  return result.changes > 0;
}

// ─────────────────────────────────────────────────────────────
// Built-in rule seeds (replaces hardcoded stage agent behavior)
// ─────────────────────────────────────────────────────────────

export const BUILT_IN_RULES: CreateRuleInput[] = [
  // ── Stage: in-progress ───────────────────────────────────────
  {
    id: 'builtin-dev-brief-inprogress',
    name: 'Inject Dev Brief for Development/Bug Tasks',
    trigger: 'agent.session.started',
    conditions: {
      // Only inject dev brief for development and bug tasks
      'task.type': ['development', 'bug'],
    },
    actions: [
      {
        type: 'inject_context',
        content: `## 📋 Development Task Brief

This is a **development or bug task**. Your output is working code committed to git.

### Done Criteria (ALL required in handoffNotes)
1. **Files changed** — list every file you modified
2. **How tested** — describe tests run (unit, manual, smoke)
3. **Edge cases / risks** — known limitations or things to watch
4. **Rollback plan** — how to revert this change if needed
5. **Commit hash** — the git commit hash for your changes (or \`NO_COMMIT\` if no code changes)

### Commit Requirements
- Make a git commit with a clear message explaining the **why**, not just the what
- Format: \`feat|fix|refactor|chore|docs: short description\`
- Example: \`fix(rules): handle null task.type in condition evaluation\`

### Before Moving to Review
\`\`\`bash
# Verify your commit
git -C ~/.openclaw/workspace/<projectId> log --oneline -3

# Include the hash in your handoffNotes like:
# Commit hash: abc1234
\`\`\`

> Missing any of the 5 done criteria will cause QA to send the task back to in-progress.`,
      },
    ],
    enabled: true,
    priority: 12,
    isBuiltIn: true,
  },

  // ── Stage: review ─────────────────────────────────────────────
  {
    id: 'builtin-qa-on-review',
    name: 'QA Review on Status → review (dev/bug only)',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'review',
      // Only spawn QA for development and bug tasks; other types require human approval
      'task.type': ['development', 'bug'],
    },
    actions: [
      {
        type: 'spawn_agent',
        agentId: 'henry',
        template: 'qa-review',
      },
    ],
    enabled: true,
    priority: 10,
    isBuiltIn: true,
  },
  {
    id: 'builtin-review-awaiting-human',
    name: 'Awaiting Human Approval on Status → review (non-dev tasks)',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'review',
      // Non-dev tasks require human approval — no QA auto-complete
      'task.type': { $nin: ['development', 'bug'] },
    },
    actions: [
      {
        type: 'post_comment',
        userId: 'system',
        userName: '📋 Mission Clawtrol',
        content:
          '👀 **Awaiting Human Approval** — This task type requires a human reviewer before moving to done. ' +
          'An AI agent will **not** auto-complete it.\n\n' +
          'Please review the deliverables and handoff notes, then either:\n' +
          '- ✅ Move to **Done** if everything looks good\n' +
          '- 🔁 Move back to **In Progress** with feedback if changes are needed',
      },
    ],
    enabled: true,
    priority: 11,
    isBuiltIn: true,
  },

  // ── Stage: done ───────────────────────────────────────────────
  {
    id: 'builtin-docs-on-done',
    name: 'Docs Update on Status → done (dev/docs only)',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'done',
      // Only update docs for development and docs tasks
      'task.type': ['development', 'docs'],
    },
    actions: [
      {
        type: 'spawn_agent',
        agentId: 'ernest',
        template: 'docs-update',
      },
    ],
    enabled: true,
    priority: 20,
    isBuiltIn: true,
  },
  {
    id: 'builtin-word-count-cost-done',
    name: 'Word-Count Cost on Status → done (non-dev tasks)',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'done',
      // Calculate word-count cost for non-dev, non-bug tasks
      'task.type': { $nin: ['development', 'bug'] },
    },
    actions: [
      {
        type: 'word_count_cost',
      },
    ],
    enabled: true,
    priority: 21,
    isBuiltIn: true,
  },

  // ── Cross-cutting ─────────────────────────────────────────────
  {
    id: 'builtin-conflict-warning',
    name: 'Conflict Warning on Parallel Work',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'in-progress',
    },
    actions: [
      {
        type: 'conflict_check',
        message: '⚠️ Another task is already in-progress for this project',
      },
    ],
    enabled: true,
    priority: 5,
    isBuiltIn: true,
  },
  {
    id: 'builtin-deliverable-inject-inprogress',
    name: 'Inject Deliverable Requirements for Non-Dev Tasks',
    trigger: 'agent.session.started',
    conditions: {
      // Apply to all non-development, non-bug task types
      // (research, docs, chore, spike, feature, design, writing, etc.)
      'task.type': { $nin: ['development', 'bug'] },
    },
    actions: [
      {
        type: 'inject_context',
        content: `## ⚠️ Deliverable Required

This is a **non-development task**. Your primary output is a **concrete deliverable file** (document, report, spreadsheet, design, plan, etc.), not code changes.

### Before Marking This Task Done

1. **Produce your deliverable** — create the document, report, or artifact appropriate for this task type
2. **Save it** to the workspace at an appropriate path (e.g. \`~/.openclaw/workspace/<projectId>/deliverables/\`)
3. **Register it with Mission Clawtrol** — this is mandatory:
   \`\`\`bash
   curl -s -X POST http://localhost:3001/api/tasks/<task-id>/deliverables \\
     -H "Content-Type: application/json" \\
     -d '{"title":"<descriptive title>","description":"<what it contains>","fileType":"<md|docx|pdf|csv|png|etc>","filePath":"<absolute path>","agentId":"<your agent id>","status":"pending_review"}'
   \`\`\`
4. **Include the file path** in your handoff notes when marking the task done

> A task without a registered deliverable will be sent back to in-progress during review.`,
      },
    ],
    enabled: true,
    priority: 15,
    isBuiltIn: true,
  },
];

/**
 * Seed built-in rules — idempotent upsert.
 * Inserts new rules and updates conditions/actions/name for existing ones
 * so changes to BUILT_IN_RULES are applied on every server start.
 */
export async function seedBuiltInRules(): Promise<void> {
  const now = new Date().toISOString();

  for (const rule of BUILT_IN_RULES) {
    const id = rule.id!;
    const existing = await getRule(id);

    if (!existing) {
      // First run — insert the rule
      await createRule(rule);
      console.log(`[RuleStore] Built-in rule inserted: ${id}`);
    } else {
      // Already exists — update mutable fields so definition changes take effect
      await db.execute(
        `UPDATE rules
         SET name = ?, conditions = ?, actions = ?, priority = ?, updatedAt = ?
         WHERE id = ? AND isBuiltIn = 1`,
        [
          rule.name,
          JSON.stringify(rule.conditions ?? {}),
          JSON.stringify(rule.actions ?? []),
          rule.priority ?? 100,
          now,
          id,
        ]
      );
      console.log(`[RuleStore] Built-in rule updated: ${id}`);
    }
  }

  console.log('[RuleStore] Built-in rules seeded/updated');
}
