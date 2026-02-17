/**
 * Generic Database Interface
 * Provides a standardized API that works with both SQLite and PostgreSQL
 */

export interface Database {
  /**
   * Query for multiple rows
   */
  query<T>(sql: string, params?: any[]): Promise<T[]>;

  /**
   * Query for a single row
   * Returns null if not found
   */
  queryOne<T>(sql: string, params?: any[]): Promise<T | null>;

  /**
   * Execute a non-query (INSERT, UPDATE, DELETE, etc.)
   * Returns the number of rows changed
   */
  execute(sql: string, params?: any[]): Promise<{ changes: number }>;

  /**
   * Run a transaction - all db operations in fn are within a transaction
   */
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;

  /**
   * Close the database connection
   */
  close(): void;
}
