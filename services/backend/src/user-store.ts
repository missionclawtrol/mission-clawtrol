/**
 * User Store - Data access layer for users
 */

import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export type UserRole = 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  githubId: number;
  githubLogin: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Convert database row to User object
 */
function rowToUser(row: any): User {
  return {
    id: row.id,
    githubId: row.githubId,
    githubLogin: row.githubLogin,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    role: row.role as UserRole,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * Create a new user
 */
export async function createUser(data: {
  githubId: number;
  githubLogin: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  role?: UserRole;
}): Promise<User> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    // First user gets admin role
    const userCount = await countUsers();
    const role: UserRole = userCount === 0 ? 'admin' : (data.role || 'member');

    await db.execute(
      `INSERT INTO users (
        id, githubId, githubLogin, name, email, avatarUrl, role, createdAt, lastLoginAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.githubId,
        data.githubLogin,
        data.name || null,
        data.email || null,
        data.avatarUrl || null,
        role,
        now,
        now,
      ]
    );

    const user = await getUserById(id);
    if (!user) {
      throw new Error('Failed to retrieve created user');
    }
    return user;
  } catch (error) {
    console.error('Failed to create user:', error);
    throw error;
  }
}

/**
 * Get a user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM users WHERE id = ?', [id]);
    return row ? rowToUser(row) : null;
  } catch (error) {
    console.error('Failed to get user by id:', error);
    throw error;
  }
}

/**
 * Get a user by GitHub ID
 */
export async function getUserByGithubId(githubId: number): Promise<User | null> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM users WHERE githubId = ?', [githubId]);
    return row ? rowToUser(row) : null;
  } catch (error) {
    console.error('Failed to get user by github id:', error);
    throw error;
  }
}

/**
 * Update a user (partial update)
 */
export async function updateUser(
  id: string,
  updates: Partial<{
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: UserRole;
    lastLoginAt: string;
  }>
): Promise<User | null> {
  try {
    const user = await getUserById(id);
    if (!user) {
      return null;
    }

    await db.execute(
      `UPDATE users SET 
        name = ?, email = ?, avatarUrl = ?, role = ?, lastLoginAt = ?
      WHERE id = ?`,
      [
        updates.name ?? user.name,
        updates.email ?? user.email,
        updates.avatarUrl ?? user.avatarUrl,
        updates.role ?? user.role,
        updates.lastLoginAt ?? new Date().toISOString(),
        id,
      ]
    );

    const updated = await getUserById(id);
    return updated;
  } catch (error) {
    console.error('Failed to update user:', error);
    throw error;
  }
}

/**
 * List all users
 */
export async function listUsers(): Promise<User[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM users ORDER BY createdAt ASC');
    return rows.map(rowToUser);
  } catch (error) {
    console.error('Failed to list users:', error);
    throw error;
  }
}

/**
 * Count total users
 */
export async function countUsers(): Promise<number> {
  try {
    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return row?.count ?? 0;
  } catch (error) {
    console.error('Failed to count users:', error);
    throw error;
  }
}

/**
 * Delete a user
 */
export async function deleteUser(id: string): Promise<boolean> {
  try {
    const result = await db.execute('DELETE FROM users WHERE id = ?', [id]);
    return result.changes > 0;
  } catch (error) {
    console.error('Failed to delete user:', error);
    throw error;
  }
}

/**
 * Update last login time for a user
 */
export async function updateLastLogin(githubId: number): Promise<User | null> {
  try {
    const user = await getUserByGithubId(githubId);
    if (!user) {
      return null;
    }

    const now = new Date().toISOString();
    await db.execute('UPDATE users SET lastLoginAt = ? WHERE githubId = ?', [now, githubId]);

    return getUserByGithubId(githubId);
  } catch (error) {
    console.error('Failed to update last login:', error);
    throw error;
  }
}
