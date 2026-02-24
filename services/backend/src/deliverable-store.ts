/**
 * Deliverable Store - Data access layer for task deliverables
 *
 * Deliverables are tangible outputs produced by agents: reports, documents,
 * email drafts, CSVs, etc. They are attached to tasks and go through a
 * review workflow (draft → review → approved/rejected).
 */

import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export type DeliverableStatus = 'draft' | 'pending_review' | 'review' | 'approved' | 'rejected' | 'changes_requested';
export type DeliverableType = 'markdown' | 'text' | 'csv' | 'html' | 'pdf' | 'other';

export interface Deliverable {
  id: string;
  taskId: string;
  agentId: string | null;
  projectId: string | null;
  title: string;
  type: DeliverableType;
  content: string | null;
  filePath: string | null;
  status: DeliverableStatus;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDeliverable(row: any): Deliverable {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    projectId: row.projectId,
    title: row.title,
    type: row.type as DeliverableType,
    content: row.content,
    filePath: row.filePath,
    status: row.status as DeliverableStatus,
    feedback: row.feedback,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get all deliverables with optional filters
 */
export async function getDeliverables(filters?: {
  taskId?: string;
  agentId?: string;
  projectId?: string;
  status?: DeliverableStatus | DeliverableStatus[];
}): Promise<Deliverable[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.taskId) {
    conditions.push('taskId = ?');
    params.push(filters.taskId);
  }
  if (filters?.agentId) {
    conditions.push('agentId = ?');
    params.push(filters.agentId);
  }
  if (filters?.projectId) {
    conditions.push('projectId = ?');
    params.push(filters.projectId);
  }
  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (statuses.length === 1) {
      conditions.push('status = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      const placeholders = statuses.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.query<any>(
    `SELECT * FROM deliverables ${where} ORDER BY createdAt DESC`,
    params
  );
  return rows.map(rowToDeliverable);
}

/**
 * Get a single deliverable by ID
 */
export async function getDeliverable(id: string): Promise<Deliverable | null> {
  const row = await db.queryOne<any>('SELECT * FROM deliverables WHERE id = ?', [id]);
  return row ? rowToDeliverable(row) : null;
}

/**
 * Get all deliverables for a task
 */
export async function getDeliverablesByTask(taskId: string): Promise<Deliverable[]> {
  const rows = await db.query<any>(
    'SELECT * FROM deliverables WHERE taskId = ? ORDER BY createdAt DESC',
    [taskId]
  );
  return rows.map(rowToDeliverable);
}

/**
 * Count deliverables awaiting review
 */
export async function countPendingReview(): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM deliverables WHERE status IN ('review', 'pending_review')",
    []
  );
  return row?.count ?? 0;
}

/**
 * Create a new deliverable
 */
export async function createDeliverable(data: {
  taskId: string;
  agentId?: string | null;
  projectId?: string | null;
  title: string;
  type?: DeliverableType;
  content?: string | null;
  filePath?: string | null;
  status?: DeliverableStatus;
}): Promise<Deliverable> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const type = data.type || 'markdown';
  const status = data.status || 'draft';

  await db.execute(
    `INSERT INTO deliverables
      (id, taskId, agentId, projectId, title, type, content, filePath, status, feedback, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      data.taskId,
      data.agentId || null,
      data.projectId || null,
      data.title,
      type,
      data.content || null,
      data.filePath || null,
      status,
      now,
      now,
    ]
  );

  const created = await getDeliverable(id);
  if (!created) throw new Error('Failed to retrieve created deliverable');
  return created;
}

/**
 * Update a deliverable (status, feedback, content, title)
 */
export async function updateDeliverable(
  id: string,
  updates: {
    title?: string;
    type?: DeliverableType;
    content?: string | null;
    filePath?: string | null;
    status?: DeliverableStatus;
    feedback?: string | null;
    projectId?: string | null;
  }
): Promise<Deliverable | null> {
  const now = new Date().toISOString();
  const fields: string[] = ['updatedAt = ?'];
  const params: any[] = [now];

  if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
  if (updates.type !== undefined) { fields.push('type = ?'); params.push(updates.type); }
  if (updates.content !== undefined) { fields.push('content = ?'); params.push(updates.content); }
  if (updates.filePath !== undefined) { fields.push('filePath = ?'); params.push(updates.filePath); }
  if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.feedback !== undefined) { fields.push('feedback = ?'); params.push(updates.feedback); }
  if (updates.projectId !== undefined) { fields.push('projectId = ?'); params.push(updates.projectId); }

  params.push(id);
  const result = await db.execute(
    `UPDATE deliverables SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  if (result.changes === 0) return null;
  return getDeliverable(id);
}

/**
 * Delete a deliverable
 */
export async function deleteDeliverable(id: string): Promise<boolean> {
  const result = await db.execute('DELETE FROM deliverables WHERE id = ?', [id]);
  return result.changes > 0;
}
