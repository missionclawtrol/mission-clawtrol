/**
 * SQLite to PostgreSQL Migration Script
 * 
 * Reads all data from SQLite and migrates to PostgreSQL.
 * Idempotent - safe to run multiple times (ON CONFLICT DO NOTHING).
 * 
 * Usage:
 *   npm run migrate:postgres
 * 
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   (SQLite uses DB_PATH from sqlite.ts)
 */

import { SqliteDatabase } from './db/sqlite.js';
import { PostgresDatabase } from './db/postgres.js';

const BATCH_SIZE = 100;

interface MigrationResult {
  table: string;
  rowsMigrated: number;
  errors: string[];
}

async function tableExists(db: PostgresDatabase, tableName: string): Promise<boolean> {
  const result = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM information_schema.tables 
     WHERE table_schema = 'public' AND table_name = ?`,
    [tableName]
  );
  return (result?.count ?? 0) > 0;
}

async function createUsersTable(db: PostgresDatabase): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      githubId INTEGER UNIQUE NOT NULL,
      githubLogin TEXT NOT NULL,
      name TEXT,
      email TEXT,
      avatarUrl TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL,
      lastLoginAt TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_githubId ON users(githubId)`);
}

async function createAuditLogTable(db: PostgresDatabase): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      userId TEXT,
      action TEXT NOT NULL,
      entityType TEXT,
      entityId TEXT,
      details TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_log_userId ON audit_log(userId)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_log_createdAt ON audit_log(createdAt)`);
}

async function migrateTable(
  sqlite: SqliteDatabase,
  postgres: PostgresDatabase,
  tableName: string,
  idColumn: string = 'id'
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: tableName,
    rowsMigrated: 0,
    errors: []
  };

  try {
    // Get all rows from SQLite
    const rows = await sqlite.query<Record<string, any>>(`SELECT * FROM ${tableName}`);
    
    if (rows.length === 0) {
      console.log(`  ${tableName}: 0 rows (empty table)`);
      return result;
    }

    // Get column names from first row
    const columns = Object.keys(rows[0]);
    if (!columns.includes(idColumn)) {
      result.errors.push(`ID column '${idColumn}' not found`);
      console.log(`  ${tableName}: ERROR - ${result.errors[0]}`);
      return result;
    }

    // Build batch insert query with ON CONFLICT DO NOTHING
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.join(', ');
    
    // For conflict resolution, use the id column
    const onConflict = columns.includes(idColumn) 
      ? `ON CONFLICT (${idColumn}) DO NOTHING` 
      : '';

    const insertSql = `
      INSERT INTO ${tableName} (${columnList}) 
      VALUES (${placeholders}) 
      ${onConflict}
    `;

    // Batch insert
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      
      for (const row of batch) {
        const values = columns.map(col => {
          const val = row[col];
          // Handle special types
          if (val === undefined || val === null) return null;
          return val;
        });

        try {
          await postgres.execute(insertSql, values);
          result.rowsMigrated++;
        } catch (err: any) {
          // Ignore conflict errors (idempotent)
          if (!err.message?.includes('duplicate key') && 
              !err.message?.includes('violates unique constraint')) {
            result.errors.push(`${err.message}`);
          }
        }
      }
    }

    console.log(`  ${tableName}: ${result.rowsMigrated} rows migrated${rows.length > result.rowsMigrated ? ` (${rows.length - result.rowsMigrated} duplicates skipped)` : ''}`);
    
  } catch (err: any) {
    if (err.message?.includes('no such table')) {
      console.log(`  ${tableName}: table does not exist in SQLite, skipping`);
    } else {
      result.errors.push(err.message);
      console.log(`  ${tableName}: ERROR - ${err.message}`);
    }
  }

  return result;
}

async function verifyPostgresConnection(postgres: PostgresDatabase): Promise<boolean> {
  try {
    await postgres.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('SQLite to PostgreSQL Migration');
  console.log('='.repeat(60));

  // Check DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Please set it before running: export DATABASE_URL="postgresql://user:pass@host:5432/db"');
    process.exit(1);
  }

  // Initialize databases
  console.log('\n[1] Connecting to databases...');
  
  const sqlite = new SqliteDatabase();
  console.log(`  SQLite: ${sqlite.getRawDb().name}`);

  const postgres = new PostgresDatabase(databaseUrl);
  console.log(`  PostgreSQL: connected`);

  // Verify PostgreSQL connection
  console.log('\n[2] Verifying PostgreSQL connection...');
  const connected = await verifyPostgresConnection(postgres);
  if (!connected) {
    console.error('ERROR: Could not connect to PostgreSQL');
    process.exit(1);
  }
  console.log('  Connection verified');

  // Initialize schema
  console.log('\n[3] Running schema initialization...');
  await postgres.initializeSchema();
  console.log('  Base schema created (tasks, settings)');

  // Create additional tables if needed
  console.log('  Ensuring users and audit_log tables exist...');
  await createUsersTable(postgres);
  await createAuditLogTable(postgres);
  console.log('  Schema ready');

  // Migrate data
  console.log('\n[4] Migrating data...');
  console.log('  Migration order: settings, users, tasks, audit_log');
  
  const results: MigrationResult[] = [];

  // Migrate settings first (smallest, no dependencies)
  results.push(await migrateTable(sqlite, postgres, 'settings'));

  // Migrate users (no dependencies)
  results.push(await migrateTable(sqlite, postgres, 'users'));

  // Migrate tasks (may reference users)
  results.push(await migrateTable(sqlite, postgres, 'tasks'));

  // Migrate audit_log (may reference users)
  results.push(await migrateTable(sqlite, postgres, 'audit_log'));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));

  const totalMigrated = results.reduce((sum, r) => sum + r.rowsMigrated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  for (const result of results) {
    const status = result.errors.length > 0 ? '⚠️' : '✅';
    console.log(`  ${status} ${result.table}: ${result.rowsMigrated} rows`);
  }

  console.log(`\n  Total: ${totalMigrated} rows migrated`);
  if (totalErrors > 0) {
    console.log(`  Warnings: ${totalErrors} errors encountered`);
  }
  console.log('='.repeat(60));

  // Cleanup
  sqlite.close();
  postgres.close();

  console.log('\nMigration complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
