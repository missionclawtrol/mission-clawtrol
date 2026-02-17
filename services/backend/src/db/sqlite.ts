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

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_sessionKey ON tasks(sessionKey);
      CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
      CREATE INDEX IF NOT EXISTS idx_tasks_agentId ON tasks(agentId);
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
