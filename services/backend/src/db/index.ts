/**
 * Database Factory
 * Returns the appropriate database implementation based on environment
 */

import type { Database } from './interface.js';
import { SqliteDatabase } from './sqlite.js';

let dbInstance: Database | null = null;

/**
 * Create and return a database instance
 * Uses DATABASE_URL env var to determine which implementation
 */
export function getDatabase(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // PostgreSQL mode - not yet implemented
    throw new Error('Postgres not yet implemented');
  }

  // Default to SQLite
  dbInstance = new SqliteDatabase();
  return dbInstance;
}

/**
 * Get the singleton instance (for internal use within the db module)
 */
export const db = getDatabase();

/**
 * Re-export types
 */
export type { Database } from './interface.js';
