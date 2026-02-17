/**
 * Task enrichment utilities — LOC counting, cost estimation, commit hash extraction.
 * Shared between route handlers and stage agents to ensure consistent enrichment.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { Task } from './task-store.js';
import { getRawDb } from './database.js';

const execAsync = promisify(exec);
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

export function getHumanHourlyRate(): number {
  try {
    const row = getRawDb().prepare('SELECT value FROM settings WHERE key = ?').get('humanHourlyRate') as { value: string } | undefined;
    if (row) {
      const parsed = parseFloat(row.value);
      return isNaN(parsed) ? 100 : parsed;
    }
    return 100;
  } catch {
    return 100;
  }
}

export function extractCommitHash(text?: string | null): string | undefined {
  if (!text || typeof text !== 'string') return undefined;
  if (text.includes('NO_COMMIT')) return undefined;
  const commitMatch = text.match(/[Cc]ommit[:\s]+([a-f0-9]{7,40})/);
  if (commitMatch) return commitMatch[1];
  const hashMatch = text.match(/([a-f0-9]{7,40})/);
  return hashMatch ? hashMatch[1] : undefined;
}

export async function getMostRecentCommitHash(
  repoPath: string,
  sinceDate?: Date
): Promise<string | undefined> {
  try {
    let command = `git -C ${repoPath} log --pretty=format:%H -n 1`;
    if (sinceDate) {
      const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
      const localDate = new Date(sinceDate.getTime() - tzOffsetMs);
      const year = localDate.getUTCFullYear();
      const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(localDate.getUTCDate()).padStart(2, '0');
      const hours = String(localDate.getUTCHours()).padStart(2, '0');
      const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
      const seconds = String(localDate.getUTCSeconds()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      command += ` --since="${dateStr}"`;
    }
    const { stdout } = await execAsync(command, { timeout: 5000 });
    const hash = stdout.trim();
    return hash && hash.match(/^[a-f0-9]{7,40}$/) ? hash : undefined;
  } catch {
    return undefined;
  }
}

export async function getLinesChanged(
  commitHash: string,
  repoPath: string
): Promise<{ added: number; removed: number }> {
  try {
    const primaryHash = commitHash.split(',')[0].trim();
    const command = `git -C ${repoPath} diff --shortstat ${primaryHash}^..${primaryHash}`;
    const { stdout } = await execAsync(command, { timeout: 5000 });
    const added = parseInt(stdout.match(/(\d+) insertion/)?.[1] || '0');
    const removed = parseInt(stdout.match(/(\d+) deletion/)?.[1] || '0');
    return { added, removed };
  } catch {
    return { added: 0, removed: 0 };
  }
}

export async function getWorkingTreeLinesChanged(
  repoPath: string
): Promise<{ added: number; removed: number }> {
  try {
    const command = `git -C ${repoPath} diff --shortstat HEAD`;
    const { stdout } = await execAsync(command, { timeout: 5000 });
    const added = parseInt(stdout.match(/(\d+) insertion/)?.[1] || '0');
    const removed = parseInt(stdout.match(/(\d+) deletion/)?.[1] || '0');
    return { added, removed };
  } catch {
    return { added: 0, removed: 0 };
  }
}

/**
 * Enrich a task update with LOC, commit hash, and human cost estimates.
 * Call this whenever a task transitions to "done".
 * Mutates and returns the updates object.
 */
export async function enrichDoneTransition(
  task: Task,
  updates: Record<string, any>
): Promise<Record<string, any>> {
  const hourlyRate = getHumanHourlyRate();
  const MINUTES_PER_LINE = 3;

  const existingLines = updates.linesChanged ?? task.linesChanged;
  let commitHash = updates.commitHash ?? task.commitHash;

  if (!commitHash) {
    const hashFromNotes = extractCommitHash(
      updates.handoffNotes ?? task.handoffNotes ?? updates.description ?? task.description
    );
    if (hashFromNotes) {
      commitHash = hashFromNotes;
    }
  }

  const repoPath = task.projectId ? join(WORKSPACE_PATH, task.projectId) : null;

  if (!commitHash && repoPath && task.createdAt) {
    const taskStartTime = new Date(task.createdAt);
    taskStartTime.setSeconds(taskStartTime.getSeconds() - 5);
    commitHash = await getMostRecentCommitHash(repoPath, taskStartTime);
  }

  if (!existingLines && repoPath) {
    let diff = { added: 0, removed: 0 };
    if (commitHash) {
      diff = await getLinesChanged(commitHash, repoPath);
    }
    if (!commitHash || (diff.added === 0 && diff.removed === 0)) {
      diff = await getWorkingTreeLinesChanged(repoPath);
    }
    const totalLines = diff.added + diff.removed;
    updates.linesChanged = { added: diff.added, removed: diff.removed, total: totalLines };
  }

  if (!updates.commitHash && commitHash) {
    updates.commitHash = commitHash;
  }

  const linesForEstimate = updates.linesChanged ?? task.linesChanged;
  if (linesForEstimate && linesForEstimate.total > 0 && !updates.humanCost && !task.humanCost) {
    const estimatedHumanMinutes = linesForEstimate.total * MINUTES_PER_LINE;
    updates.estimatedHumanMinutes = estimatedHumanMinutes;
    updates.humanCost = (estimatedHumanMinutes / 60) * hourlyRate;
  }

  // Fallback to runtime-based estimate if LOC is unavailable
  if (!updates.humanCost && !task.humanCost && task.runtime) {
    const runtimeSeconds = task.runtime / 1000;
    const estimatedHumanMinutes = Math.ceil((runtimeSeconds * 10) / 60);
    updates.estimatedHumanMinutes = estimatedHumanMinutes;
    updates.humanCost = (estimatedHumanMinutes / 60) * hourlyRate;
  }

  return updates;
}
