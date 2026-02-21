/**
 * SQLite Implementation of the Database Interface
 * Wraps better-sqlite3 to provide async-compatible API
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Database as IDatabase } from './interface.js';

// Import better-sqlite3 (CommonJS module)
import BetterSqlite3 from 'better-sqlite3';
const Database = BetterSqlite3;

export const DB_PATH = join(process.env.HOME || '', '.openclaw', 'mission-clawtrol.db');

export class SqliteDatabase implements IDatabase {
  private db: any;

  constructor(dbPath: string = DB_PATH) {
    // Ensure directory exists
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!Database) {
      throw new Error('better-sqlite3 is not installed');
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create tables and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog',
        priority TEXT NOT NULL DEFAULT 'P2',
        projectId TEXT,
        agentId TEXT,
        userId TEXT,
        createdBy TEXT,
        assignedTo TEXT,
        sessionKey TEXT UNIQUE,
        handoffNotes TEXT,
        commitHash TEXT,
        linesAdded INTEGER,
        linesRemoved INTEGER,
        linesTotal INTEGER,
        estimatedHumanMinutes REAL,
        humanCost REAL,
        cost REAL,
        runtime INTEGER,
        model TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        githubId INTEGER UNIQUE,
        githubLogin TEXT,
        username TEXT UNIQUE,
        passwordHash TEXT,
        name TEXT,
        email TEXT,
        avatarUrl TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        createdAt TEXT NOT NULL,
        lastLoginAt TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_sessionKey ON tasks(sessionKey);
      CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
      CREATE INDEX IF NOT EXISTS idx_tasks_agentId ON tasks(agentId);
      CREATE INDEX IF NOT EXISTS idx_tasks_userId ON tasks(userId);
      CREATE INDEX IF NOT EXISTS idx_users_githubId ON users(githubId);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        userId TEXT,
        action TEXT NOT NULL,
        entityType TEXT,
        entityId TEXT,
        details TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entityType, entityId);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(userId);

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        userId TEXT,
        userName TEXT,
        userAvatar TEXT,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_comments_taskId ON comments(taskId);
      CREATE INDEX IF NOT EXISTS idx_comments_userId ON comments(userId);

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);

      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        targetDate TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_milestones_projectId ON milestones(projectId);
    `);

    // Schema migrations (backward compatibility)
    const addColumnIfMissing = (table: string, column: string, type: string) => {
      try {
        this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
      } catch (e: any) {
        if (!e.message.includes('duplicate column name')) throw e;
      }
    };

    addColumnIfMissing('tasks', 'userId', 'TEXT');
    addColumnIfMissing('tasks', 'createdBy', 'TEXT');
    addColumnIfMissing('tasks', 'assignedTo', 'TEXT');
    addColumnIfMissing('tasks', 'dueDate', 'TEXT');
    addColumnIfMissing('tasks', 'milestoneId', 'TEXT');
    addColumnIfMissing('tasks', 'type', 'TEXT');
    addColumnIfMissing('tasks', 'blocked', 'INTEGER DEFAULT 0');
    addColumnIfMissing('tasks', 'blockerNote', 'TEXT');
    addColumnIfMissing('tasks', 'tokensIn', 'INTEGER');
    addColumnIfMissing('tasks', 'tokensOut', 'INTEGER');
    addColumnIfMissing('users', 'username', 'TEXT');
    addColumnIfMissing('users', 'passwordHash', 'TEXT');

    // Ensure sessions table exists (may not exist on older installs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);
    `);

    // Insert default settings if not exist
    this.db
      .prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      .run('humanHourlyRate', '100');
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    // better-sqlite3 is synchronous, wrap in Promise for interface compatibility
    return Promise.resolve(stmt.all(...(params || [])) as T[]);
  }

  async queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...(params || []));
    return Promise.resolve(result || null);
  }

  async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(params || []));
    return Promise.resolve({ changes: result.changes });
  }

  async transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T> {
    // Begin transaction
    this.db.prepare('BEGIN').run();
    try {
      const result = await fn(this);
      this.db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      this.db.prepare('ROLLBACK').run();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /**
   * Get the raw better-sqlite3 database instance
   * @deprecated Use the abstracted methods instead
   */
  getRawDb(): any {
    return this.db;
  }
}
