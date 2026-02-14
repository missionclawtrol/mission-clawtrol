import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

const DB_PATH = join(process.env.HOME || '', '.openclaw', 'mission-clawtrol.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
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
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('humanHourlyRate', '100');

export function initializeDatabase(): void {
  // Database is already initialized when module is imported
  console.log(`Database initialized at ${DB_PATH}`);
}

export function closeDatabase(): void {
  db.close();
  console.log('Database connection closed');
}
