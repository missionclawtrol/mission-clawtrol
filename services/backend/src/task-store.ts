import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  projectId: string | null;
  agentId: string | null;
  sessionKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  handoffNotes: string | null;
  tokens?: { input: number; output: number; total: number };
  cost?: number; // estimated USD
  model?: string; // which model was used
  runtime?: number; // milliseconds
  commitHash?: string; // Git commit hash for this task
  linesChanged?: { added: number; removed: number; total: number };
  estimatedHumanMinutes?: number; // Auto-calculated from lines changed
  humanCost?: number; // Auto-calculated cost (humanMinutes * hourlyRate / 60)
  createdBy?: string | null; // User ID who created this task
  assignedTo?: string | null; // User ID this task is assigned to
  dueDate?: string | null; // ISO timestamp for when task is due
  milestoneId?: string | null; // Milestone this task belongs to
  type?: 'feature' | 'bug' | 'chore' | 'spike' | 'docs' | null; // Task type for bug tracking
  blocked?: boolean | null; // Whether this task is currently blocked
  blockerNote?: string | null; // Description of what is blocking this task
}

/**
 * Convert database row to Task object
 */
function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
    agentId: row.agentId,
    sessionKey: row.sessionKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    handoffNotes: row.handoffNotes,
    cost: row.cost,
    model: row.model,
    runtime: row.runtime,
    commitHash: row.commitHash,
    estimatedHumanMinutes: row.estimatedHumanMinutes,
    humanCost: row.humanCost,
    createdBy: row.createdBy || null,
    assignedTo: row.assignedTo || null,
    dueDate: row.dueDate || null,
    milestoneId: row.milestoneId || null,
    type: row.type || null,
    linesChanged:
      row.linesAdded !== null || row.linesRemoved !== null || row.linesTotal !== null
        ? {
            added: row.linesAdded ?? 0,
            removed: row.linesRemoved ?? 0,
            total: row.linesTotal ?? 0,
          }
        : undefined,
    blocked: row.blocked != null ? Boolean(row.blocked) : null,
    blockerNote: row.blockerNote || null,
  };
}

/**
 * Load all tasks from the SQLite database
 */
export async function loadTasks(): Promise<Task[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM tasks ORDER BY createdAt DESC');
    return rows.map(rowToTask);
  } catch (error) {
    console.error('Failed to load tasks:', error);
    throw error;
  }
}

/**
 * Get a single task by ID
 */
export async function getTask(id: string): Promise<Task | null> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? rowToTask(row) : null;
  } catch (error) {
    console.error('Failed to get task:', error);
    throw error;
  }
}

/**
 * Alias for getTask (used by some modules)
 */
export async function findTaskById(id: string): Promise<Task | null> {
  return getTask(id);
}

/**
 * Find a task by session key
 */
export async function findTaskBySessionKey(sessionKey: string): Promise<Task | null> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM tasks WHERE sessionKey = ?', [sessionKey]);
    return row ? rowToTask(row) : null;
  } catch (error) {
    console.error('Failed to get task by session key:', error);
    throw error;
  }
}

/**
 * Create a new task
 */
export async function createTask(
  data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>
): Promise<Task> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO tasks (
        id, title, description, status, priority, projectId, agentId, sessionKey, 
        handoffNotes, commitHash, linesAdded, linesRemoved, linesTotal, 
        estimatedHumanMinutes, humanCost, cost, runtime, model, 
        createdBy, assignedTo, dueDate, milestoneId, type, blocked, blockerNote,
        createdAt, updatedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.title,
        data.description || null,
        data.status || 'backlog',
        data.priority || 'P2',
        data.projectId || null,
        data.agentId || null,
        data.sessionKey || null,
        data.handoffNotes || null,
        data.commitHash || null,
        data.linesChanged?.added || null,
        data.linesChanged?.removed || null,
        data.linesChanged?.total || null,
        data.estimatedHumanMinutes || null,
        data.humanCost || null,
        data.cost || null,
        data.runtime || null,
        data.model || null,
        data.createdBy || null,
        data.assignedTo || null,
        data.dueDate || null,
        data.milestoneId || null,
        data.type || null,
        data.blocked ? 1 : 0,
        data.blockerNote || null,
        now,
        now,
        null,
      ]
    );

    const task = await getTask(id);
    if (!task) {
      throw new Error('Failed to retrieve created task');
    }
    return task;
  } catch (error) {
    console.error('Failed to create task:', error);
    throw error;
  }
}

/**
 * Update a task (partial update)
 */
export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
  try {
    const task = await getTask(id);
    if (!task) {
      return null;
    }

    const now = new Date().toISOString();
    let completedAt = task.completedAt;

    // If status changed to 'done', set completedAt
    if (updates.status === 'done' && task.status !== 'done') {
      completedAt = now;
    }

    // sessionKey has a UNIQUE constraint — if the new sessionKey is already held by
    // a different task, clear it there first to avoid a constraint violation.
    // This happens when an agent finishes one task and is assigned to another.
    if (updates.sessionKey && updates.sessionKey !== task.sessionKey) {
      await db.execute(
        'UPDATE tasks SET sessionKey = NULL WHERE sessionKey = ? AND id != ?',
        [updates.sessionKey, id]
      );
    }

    // Determine blocked value
    const blockedValue = updates.blocked !== undefined
      ? (updates.blocked ? 1 : 0)
      : (task.blocked ? 1 : 0);

    await db.execute(
      `UPDATE tasks SET 
        title = ?, description = ?, status = ?, priority = ?, 
        projectId = ?, agentId = ?, sessionKey = ?, handoffNotes = ?, 
        commitHash = ?, linesAdded = ?, linesRemoved = ?, linesTotal = ?, 
        estimatedHumanMinutes = ?, humanCost = ?, cost = ?, runtime = ?, model = ?,
        assignedTo = ?, dueDate = ?, milestoneId = ?, type = ?,
        blocked = ?, blockerNote = ?,
        updatedAt = ?, completedAt = ?
      WHERE id = ?`,
      [
        updates.title ?? task.title,
        updates.description ?? task.description,
        updates.status ?? task.status,
        updates.priority ?? task.priority,
        updates.projectId ?? task.projectId,
        updates.agentId ?? task.agentId,
        updates.sessionKey ?? task.sessionKey,
        updates.handoffNotes ?? task.handoffNotes,
        updates.commitHash ?? task.commitHash,
        updates.linesChanged?.added ?? task.linesChanged?.added ?? null,
        updates.linesChanged?.removed ?? task.linesChanged?.removed ?? null,
        updates.linesChanged?.total ?? task.linesChanged?.total ?? null,
        updates.estimatedHumanMinutes ?? task.estimatedHumanMinutes,
        updates.humanCost ?? task.humanCost,
        updates.cost ?? task.cost,
        updates.runtime ?? task.runtime,
        updates.model ?? task.model,
        updates.assignedTo !== undefined ? updates.assignedTo : task.assignedTo,
        updates.dueDate !== undefined ? updates.dueDate : task.dueDate,
        updates.milestoneId !== undefined ? updates.milestoneId : task.milestoneId,
        updates.type !== undefined ? updates.type : task.type,
        blockedValue,
        updates.blockerNote !== undefined ? updates.blockerNote : task.blockerNote,
        now,
        completedAt,
        id,
      ]
    );

    const updated = await getTask(id);
    return updated;
  } catch (error) {
    console.error('Failed to update task:', error);
    throw error;
  }
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<boolean> {
  try {
    const result = await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
    return result.changes > 0;
  } catch (error) {
    console.error('Failed to delete task:', error);
    throw error;
  }
}

/**
 * Get tasks filtered by project ID
 */
export async function getTasksByProject(projectId: string): Promise<Task[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC', [projectId]);
    return rows.map(rowToTask);
  } catch (error) {
    console.error('Failed to get tasks by project:', error);
    throw error;
  }
}

/**
 * Get tasks assigned to an agent
 */
export async function getTasksByAgent(agentId: string): Promise<Task[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM tasks WHERE agentId = ? ORDER BY createdAt DESC', [agentId]);
    return rows.map(rowToTask);
  } catch (error) {
    console.error('Failed to get tasks by agent:', error);
    throw error;
  }
}

/**
 * Get tasks by status
 */
export async function getTasksByStatus(status: Task['status']): Promise<Task[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC', [status]);
    return rows.map(rowToTask);
  } catch (error) {
    console.error('Failed to get tasks by status:', error);
    throw error;
  }
}

/**
 * Get task statistics for a project
 */
export async function getProjectTaskStats(projectId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  completionPercent: number;
}> {
  try {
    const tasks = await getTasksByProject(projectId);

    // Count total tasks
    const total = tasks.length;

    // Count by status
    const byStatus: Record<string, number> = {};
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    }

    // Calculate completion percentage
    const completedCount = (byStatus['done'] || 0) + (byStatus['archived'] || 0);
    const completionPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    return {
      total,
      byStatus,
      completionPercent,
    };
  } catch (error) {
    console.error('Failed to get project task stats:', error);
    throw error;
  }
}
