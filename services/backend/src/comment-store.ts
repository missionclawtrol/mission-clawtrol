/**
 * Comment Store - Data access layer for task comments
 */

import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export interface Comment {
  id: string;
  taskId: string;
  userId: string | null;
  userName: string | null;
  userAvatar: string | null;
  content: string;
  createdAt: string;
  updatedAt: string | null;
}

function rowToComment(row: any): Comment {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    userName: row.userName,
    userAvatar: row.userAvatar,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get all comments for a task (ordered oldest first)
 */
export async function getCommentsByTask(taskId: string): Promise<Comment[]> {
  const rows = await db.query<any>(
    'SELECT * FROM comments WHERE taskId = ? ORDER BY createdAt ASC',
    [taskId]
  );
  return rows.map(rowToComment);
}

/**
 * Get a single comment by ID
 */
export async function getComment(id: string): Promise<Comment | null> {
  const row = await db.queryOne<any>('SELECT * FROM comments WHERE id = ?', [id]);
  return row ? rowToComment(row) : null;
}

/**
 * Create a new comment
 */
export async function createComment(data: {
  taskId: string;
  userId?: string | null;
  userName?: string | null;
  userAvatar?: string | null;
  content: string;
}): Promise<Comment> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO comments (id, taskId, userId, userName, userAvatar, content, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.taskId, data.userId || null, data.userName || null, data.userAvatar || null, data.content, now]
  );

  const comment = await getComment(id);
  if (!comment) throw new Error('Failed to retrieve created comment');
  return comment;
}

/**
 * Update a comment's content
 */
export async function updateComment(id: string, content: string): Promise<Comment | null> {
  const now = new Date().toISOString();
  const result = await db.execute(
    'UPDATE comments SET content = ?, updatedAt = ? WHERE id = ?',
    [content, now, id]
  );
  if (result.changes === 0) return null;
  return getComment(id);
}

/**
 * Delete a comment
 */
export async function deleteComment(id: string): Promise<boolean> {
  const result = await db.execute('DELETE FROM comments WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Count comments for a task
 */
export async function countComments(taskId: string): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM comments WHERE taskId = ?',
    [taskId]
  );
  return row?.count ?? 0;
}
