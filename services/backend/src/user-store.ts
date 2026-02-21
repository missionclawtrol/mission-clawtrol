/**
 * User Store - Data access layer for users
 * Supports both username/password and (legacy) GitHub OAuth users
 */

import { randomUUID, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';

export type UserRole = 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  username: string;
  // Legacy GitHub fields (nullable)
  githubId?: number | null;
  githubLogin?: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

const BCRYPT_ROUNDS = 12;

/**
 * Convert database row to User object
 */
function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username || row.githubLogin || 'unknown',
    githubId: row.githubId ?? null,
    githubLogin: row.githubLogin ?? null,
    name: row.name ?? null,
    email: row.email ?? null,
    avatarUrl: row.avatarUrl ?? null,
    role: (row.role || 'member') as UserRole,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Username/password auth functions
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if at least one local (password) user exists
 */
export async function hasAnyUsers(): Promise<boolean> {
  const row = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM users WHERE passwordHash IS NOT NULL'
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Create a new username/password user
 * First user automatically gets admin role
 */
export async function createLocalUser(username: string, password: string): Promise<User> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const isFirst = !(await hasAnyUsers());
  const role: UserRole = isFirst ? 'admin' : 'member';

  await db.execute(
    `INSERT INTO users (id, username, passwordHash, role, createdAt, lastLoginAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, username, passwordHash, role, now, now]
  );

  const user = await getUserById(id);
  if (!user) throw new Error('Failed to retrieve created user');
  return user;
}

/**
 * Validate username/password credentials.
 * Returns the User on success, null on failure.
 */
export async function validateUser(username: string, password: string): Promise<User | null> {
  const row = await db.queryOne<any>(
    'SELECT * FROM users WHERE username = ? AND passwordHash IS NOT NULL',
    [username]
  );
  if (!row) return null;

  const valid = await bcrypt.compare(password, row.passwordHash);
  return valid ? rowToUser(row) : null;
}

/**
 * Update a user's password
 */
export async function updatePassword(userId: string, newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.execute('UPDATE users SET passwordHash = ? WHERE id = ?', [hash, userId]);
}

// ─────────────────────────────────────────────────────────────
// Session token management
// ─────────────────────────────────────────────────────────────

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create a new session for a user. Returns the 64-char hex token.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex'); // 64 hex chars
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.execute(
    'INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    [token, userId, now.toISOString(), expiresAt.toISOString()]
  );

  return token;
}

/**
 * Validate a session token. Returns the associated User or null if expired/invalid.
 */
export async function validateSession(token: string): Promise<User | null> {
  if (!token) return null;

  const row = await db.queryOne<Session>(
    'SELECT * FROM sessions WHERE token = ?',
    [token]
  );

  if (!row) return null;

  // Check expiry
  if (new Date(row.expiresAt) < new Date()) {
    // Expired — clean up
    await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }

  return getUserById(row.userId);
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(token: string): Promise<void> {
  await db.execute('DELETE FROM sessions WHERE token = ?', [token]);
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  await db.execute('DELETE FROM sessions WHERE userId = ?', [userId]);
}

// ─────────────────────────────────────────────────────────────
// Generic user lookups (used by both auth paths)
// ─────────────────────────────────────────────────────────────

/**
 * Get a user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const row = await db.queryOne<any>('SELECT * FROM users WHERE id = ?', [id]);
  return row ? rowToUser(row) : null;
}

/**
 * Get a user by username (local auth)
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  const row = await db.queryOne<any>('SELECT * FROM users WHERE username = ?', [username]);
  return row ? rowToUser(row) : null;
}

/**
 * Get a user by GitHub ID (legacy OAuth)
 */
export async function getUserByGithubId(githubId: number): Promise<User | null> {
  const row = await db.queryOne<any>('SELECT * FROM users WHERE githubId = ?', [githubId]);
  return row ? rowToUser(row) : null;
}

/**
 * List all users
 */
export async function listUsers(): Promise<User[]> {
  const rows = await db.query<any>('SELECT * FROM users ORDER BY createdAt ASC');
  return rows.map(rowToUser);
}

/**
 * Count total users
 */
export async function countUsers(): Promise<number> {
  const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  return row?.count ?? 0;
}

/**
 * Delete a user
 */
export async function deleteUser(id: string): Promise<boolean> {
  const result = await db.execute('DELETE FROM users WHERE id = ?', [id]);
  return result.changes > 0;
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
  const user = await getUserById(id);
  if (!user) return null;

  await db.execute(
    `UPDATE users SET name = ?, email = ?, avatarUrl = ?, role = ?, lastLoginAt = ? WHERE id = ?`,
    [
      updates.name ?? user.name,
      updates.email ?? user.email,
      updates.avatarUrl ?? user.avatarUrl,
      updates.role ?? user.role,
      updates.lastLoginAt ?? new Date().toISOString(),
      id,
    ]
  );

  return getUserById(id);
}

// ─────────────────────────────────────────────────────────────
// Legacy GitHub OAuth helpers (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────

/**
 * Create a GitHub OAuth user (legacy)
 */
export async function createUser(data: {
  githubId: number;
  githubLogin: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  role?: UserRole;
}): Promise<User> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const userCount = await countUsers();
  const role: UserRole = userCount === 0 ? 'admin' : (data.role || 'member');

  await db.execute(
    `INSERT INTO users (id, githubId, githubLogin, username, name, email, avatarUrl, role, createdAt, lastLoginAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.githubId,
      data.githubLogin,
      data.githubLogin, // use githubLogin as username fallback
      data.name || null,
      data.email || null,
      data.avatarUrl || null,
      role,
      now,
      now,
    ]
  );

  const user = await getUserById(id);
  if (!user) throw new Error('Failed to retrieve created user');
  return user;
}

/**
 * Update last login time for a GitHub user (legacy)
 */
export async function updateLastLogin(githubId: number): Promise<User | null> {
  const user = await getUserByGithubId(githubId);
  if (!user) return null;

  const now = new Date().toISOString();
  await db.execute('UPDATE users SET lastLoginAt = ? WHERE githubId = ?', [now, githubId]);

  return getUserByGithubId(githubId);
}
