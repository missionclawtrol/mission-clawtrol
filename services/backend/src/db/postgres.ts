/**
 * PostgreSQL Implementation of the Database Interface
 * Uses node-postgres (pg) for connection pooling
 */

import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from 'pg';
import type { Database } from './interface.js';

// Type alias for flexible row types
type AnyRow = Record<string, any>;

export class PostgresDatabase implements Database {
  private pool: Pool;
  private initialized: boolean = false;

  constructor(databaseUrl: string) {
    const config: PoolConfig = {
      connectionString: databaseUrl,
      // Default pool settings for reasonable concurrency
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    this.pool = new Pool(config);
    
    // Handle pool errors gracefully
    this.pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
   * Also extracts the params in order
   */
  private convertPlaceholders(sql: string, params?: any[]): { text: string; values: any[] } {
    if (!params || params.length === 0) {
      return { text: sql, values: [] };
    }

    let paramIndex = 1;
    const text = sql.replace(/\?/g, () => `$${paramIndex++}`);
    return { text, values: params };
  }

  /**
   * Initialize the database schema (tables and indexes)
   */
  async initializeSchema(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create tables
    await this.pool.query(`
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
    `);

    // Create indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_sessionKey ON tasks(sessionKey);
      CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
      CREATE INDEX IF NOT EXISTS idx_tasks_agentId ON tasks(agentId);
    `);

    // Insert default settings if not exist
    await this.pool.query(`
      INSERT INTO settings (key, value) VALUES ('humanHourlyRate', '100')
      ON CONFLICT (key) DO NOTHING
    `);

    this.initialized = true;
  }

  /**
   * Query for multiple rows
   */
  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    // Auto-initialize schema on first query
    await this.initializeSchema();
    
    const { text, values } = this.convertPlaceholders(sql, params);
    const result = await this.pool.query<QueryResultRow>(text, values);
    return result.rows as T[];
  }

  /**
   * Query for a single row
   * Returns null if not found
   */
  async queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
    await this.initializeSchema();
    
    const { text, values } = this.convertPlaceholders(sql, params);
    const result = await this.pool.query<QueryResultRow>(text, values);
    return (result.rows[0] as T) || null;
  }

  /**
   * Execute a non-query (INSERT, UPDATE, DELETE, etc.)
   * Returns the number of rows changed
   */
  async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
    await this.initializeSchema();
    
    const { text, values } = this.convertPlaceholders(sql, params);
    const result = await this.pool.query(text, values);
    return { changes: result.rowCount || 0 };
  }

  /**
   * Run a transaction - all db operations in fn are within a transaction
   */
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create a transaction-aware database wrapper
      const txDb: Database = {
        query: async <U>(sql: string, params?: any[]): Promise<U[]> => {
          const { text, values } = this.convertPlaceholders(sql, params);
          const result = await client.query<QueryResultRow>(text, values);
          return result.rows as U[];
        },
        queryOne: async <U>(sql: string, params?: any[]): Promise<U | null> => {
          const { text, values } = this.convertPlaceholders(sql, params);
          const result = await client.query<QueryResultRow>(text, values);
          return (result.rows[0] as U) || null;
        },
        execute: async (sql: string, params?: any[]): Promise<{ changes: number }> => {
          const { text, values } = this.convertPlaceholders(sql, params);
          const result = await client.query(text, values);
          return { changes: result.rowCount || 0 };
        },
        transaction: async <U>(fn: (db: Database) => Promise<U>): Promise<U> => {
          // Nested transactions not supported, just run the function
          return fn(txDb);
        },
        close: () => {
          // Don't close in a transaction
        },
      };

      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.pool.end();
  }
}
