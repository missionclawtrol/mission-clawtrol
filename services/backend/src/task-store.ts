import { randomUUID } from 'crypto';
import { db } from './database';

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
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number; // estimated USD
  model?: string; // which model was used
  runtime?: number; // milliseconds
  commitHash?: string; // Git commit hash for this task
  linesChanged?: {
    added: number;
    removed: number;
    total: number;
  };
  estimatedHumanMinutes?: number; // Auto-calculated from lines changed
  humanCost?: number; // Auto-calculated cost (humanMinutes * hourlyRate / 60)
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
    linesChanged: row.linesAdded || row.linesRemoved || row.linesTotal 
      ? {
          added: row.linesAdded || 0,
          removed: row.linesRemoved || 0,
          total: row.linesTotal || 0,
        }
      : undefined,
  };
}

/**
 * Load all tasks from the SQLite database
 */
export async function loadTasks(): Promise<Task[]> {
  try {
    const rows = db.prepare('SELECT * FROM tasks').all();
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
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? rowToTask(row) : null;
  } catch (error) {
    console.error('Failed to get task:', error);
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

    const insert = db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, projectId, agentId,
        sessionKey, handoffNotes, commitHash, linesAdded, linesRemoved,
        linesTotal, estimatedHumanMinutes, humanCost, cost, runtime, model,
        createdAt, updatedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
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
      now,
      now,
      null
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

    const update = db.prepare(`
      UPDATE tasks SET
        title = ?,
        description = ?,
        status = ?,
        priority = ?,
        projectId = ?,
        agentId = ?,
        sessionKey = ?,
        handoffNotes = ?,
        commitHash = ?,
        linesAdded = ?,
        linesRemoved = ?,
        linesTotal = ?,
        estimatedHumanMinutes = ?,
        humanCost = ?,
        cost = ?,
        runtime = ?,
        model = ?,
        updatedAt = ?,
        completedAt = ?
      WHERE id = ?
    `);

    update.run(
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
      now,
      completedAt,
      id
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
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return (result.changes || 0) > 0;
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
    const rows = db.prepare('SELECT * FROM tasks WHERE projectId = ?').all(projectId);
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
    const rows = db.prepare('SELECT * FROM tasks WHERE agentId = ?').all(agentId);
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
    const rows = db.prepare('SELECT * FROM tasks WHERE status = ?').all(status);
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
    const completedCount = tasks.filter(t => t.status === 'done').length;
    const completionPercent = total === 0 ? 0 : Math.round((completedCount / total) * 100);
    
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

/**
 * Find task by session key (used to link subagent tasks)
 */
export async function findTaskBySessionKey(sessionKey: string): Promise<Task | null> {
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE sessionKey = ?').get(sessionKey);
    return row ? rowToTask(row) : null;
  } catch (error) {
    console.error('Failed to find task by session key:', error);
    throw error;
  }
}
