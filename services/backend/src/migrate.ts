/**
 * One-time migration from JSON files to SQLite database
 * Reads existing tasks.json and settings.json and imports into SQLite
 */

import { readFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { db } from './database.js';

export async function migrateFromJSON(): Promise<void> {
  const homeDir = process.env.HOME || '';
  const tasksJsonPath = join(homeDir, '.openclaw', 'tasks.json');
  const settingsJsonPath = join(homeDir, '.openclaw', 'settings.json');

  console.log('Starting migration from JSON to SQLite...');

  // Check if migration has already been done
  const migrationCheckResult = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM tasks'
  );

  if (migrationCheckResult && migrationCheckResult.count > 0) {
    console.log('Database already has tasks. Skipping migration.');
    return;
  }

  // Migrate tasks.json
  if (existsSync(tasksJsonPath)) {
    try {
      const data = await readFile(tasksJsonPath, 'utf-8');
      const tasks = JSON.parse(data);

      console.log(`Found ${tasks.length} tasks to migrate`);

      // Use transaction for bulk insert
      await db.transaction(async (txDb) => {
        for (const task of tasks) {
          try {
            await txDb.execute(
              `INSERT INTO tasks (
                id, title, description, status, priority, projectId, agentId,
                sessionKey, handoffNotes, commitHash, linesAdded, linesRemoved,
                linesTotal, estimatedHumanMinutes, humanCost, cost, runtime, model,
                createdAt, updatedAt, completedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                task.id || '',
                task.title || '',
                task.description || null,
                task.status || 'backlog',
                task.priority || 'P2',
                task.projectId || null,
                task.agentId || null,
                task.sessionKey || null,
                task.handoffNotes || null,
                task.commitHash || null,
                task.linesChanged?.added || null,
                task.linesChanged?.removed || null,
                task.linesChanged?.total || null,
                task.estimatedHumanMinutes || null,
                task.humanCost || null,
                task.cost || null,
                task.runtime || null,
                task.model || null,
                task.createdAt || new Date().toISOString(),
                task.updatedAt || new Date().toISOString(),
                task.completedAt || null,
              ]
            );
          } catch (error) {
            console.warn(`Failed to migrate task ${task.id}:`, error);
            // Continue with next task
          }
        }
      });

      console.log(`Successfully migrated ${tasks.length} tasks`);

      // Backup old file
      const backupPath = `${tasksJsonPath}.bak`;
      await rename(tasksJsonPath, backupPath);
      console.log(`Backed up tasks.json to ${backupPath}`);
    } catch (error) {
      console.error('Failed to migrate tasks.json:', error);
      throw error;
    }
  } else {
    console.log('No tasks.json found, skipping task migration');
  }

  // Migrate settings.json
  if (existsSync(settingsJsonPath)) {
    try {
      const data = await readFile(settingsJsonPath, 'utf-8');
      const settings = JSON.parse(data);

      console.log('Migrating settings...');

      for (const [key, value] of Object.entries(settings)) {
        await db.execute(
          'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
          [key, String(value)]
        );
      }

      console.log('Successfully migrated settings');

      // Backup old file
      const backupPath = `${settingsJsonPath}.bak`;
      await rename(settingsJsonPath, backupPath);
      console.log(`Backed up settings.json to ${backupPath}`);
    } catch (error) {
      console.error('Failed to migrate settings.json:', error);
      throw error;
    }
  } else {
    console.log('No settings.json found, skipping settings migration');
  }

  console.log('Migration complete!');
}
