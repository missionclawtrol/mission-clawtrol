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
  {
    id: 'builtin-qa-on-review',
    name: 'QA Review on Status → review',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'review',
    },
    actions: [
      {
        type: 'spawn_agent',
        agentId: 'qa',
        template: 'qa-review',
      },
    ],
    enabled: true,
    priority: 10,
    isBuiltIn: true,
  },
  {
    id: 'builtin-docs-on-done',
    name: 'Docs Update on Status → done',
    trigger: 'task.status.changed',
    conditions: {
      'task.status.to': 'done',
    },
    actions: [
      {
        type: 'spawn_agent',
        agentId: 'editor',
        template: 'docs-update',
      },
    ],
    enabled: true,
    priority: 20,
    isBuiltIn: true,
  },
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
];

/**
 * Seed built-in rules on first run (idempotent — uses INSERT OR IGNORE).
 */
export async function seedBuiltInRules(): Promise<void> {
  for (const rule of BUILT_IN_RULES) {
    await createRule(rule);
  }
  console.log('[RuleStore] Built-in rules seeded');
}
