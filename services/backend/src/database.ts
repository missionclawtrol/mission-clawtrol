// Mission Clawtrol Database - SQLite storage layer
// REFACTORED: Now uses the abstracted db layer from db/index.ts

import { db as dbInstance } from './db/index.js';
import type { SqliteDatabase } from './db/sqlite.js';

export const db = dbInstance;

export function initializeDatabase(): void {
  // Database is already initialized when imported via the factory
  console.log('Database initialized via abstraction layer');
}

export function closeDatabase(): void {
  db.close();
  console.log('Database connection closed');
}

/**
 * Get raw SQLite database for legacy code that uses .prepare()
 * @deprecated Migrate to use the abstracted db methods instead
 */
export function getRawDb(): any {
  if ('getRawDb' in db) {
    return (db as SqliteDatabase).getRawDb();
  }
  throw new Error('getRawDb() only available for SQLite databases');
}
