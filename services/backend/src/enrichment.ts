/**
 * Task enrichment utilities — LOC counting, cost estimation, commit hash extraction,
 * and word-count-based cost for non-dev tasks.
 * Shared between route handlers and stage agents to ensure consistent enrichment.
 */

import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { join } from 'path';
import { Task } from './task-store.js';
import { getRawDb } from './database.js';
import { getDeliverablesByTask } from './deliverable-store.js';

/**
 * Adjustable constant: human minutes per 1000 words for non-dev deliverables.
 * At 30 min/1000 words, a 5000-word report → 150 min of estimated human time.
 */
export const MINUTES_PER_1000_WORDS = 30;

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

// ─────────────────────────────────────────────────────────────────
// Non-dev enrichment: word-count-based cost estimation
// ─────────────────────────────────────────────────────────────────

/**
 * Count total words across all registered deliverables for a task.
 * Reads file content from disk (filePath) first; falls back to inline content field.
 */
export async function countDeliverableWords(taskId: string): Promise<number> {
  const deliverables = await getDeliverablesByTask(taskId);
  let totalWords = 0;

  for (const d of deliverables) {
    let text = '';

    if (d.filePath) {
      try {
        text = await readFile(d.filePath, 'utf-8');
      } catch {
        // File not accessible — fall through to inline content
        text = d.content ?? '';
      }
    } else {
      text = d.content ?? '';
    }

    if (text) {
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      totalWords += words;
    }
  }

  return totalWords;
}

/**
 * Enrich a non-dev task transition to "done" using word count from deliverables.
 *
 * Priority:
 *   1. Word count from registered deliverables (30 min / 1000 words)
 *   2. Runtime-based estimate as fallback (same as enrichDoneTransition)
 *
 * Mutates and returns the updates object.
 */
export async function enrichNonDevDoneTransition(
  task: Task,
  updates: Record<string, any>
): Promise<Record<string, any>> {
  const hourlyRate = getHumanHourlyRate();

  const totalWords = await countDeliverableWords(task.id);

  if (totalWords > 0) {
    const estimatedHumanMinutes = (totalWords / 1000) * MINUTES_PER_1000_WORDS;
    updates.estimatedHumanMinutes = Math.round(estimatedHumanMinutes);
    updates.humanCost = parseFloat(((estimatedHumanMinutes / 60) * hourlyRate).toFixed(2));
    console.log(
      `[Enrichment] Word-count cost for task ${task.id}: ${totalWords} words → ${updates.estimatedHumanMinutes} min → $${updates.humanCost}`
    );
  } else if (!updates.humanCost && !task.humanCost && task.runtime) {
    // Fallback: runtime-based estimate (no deliverables found)
    const runtimeSeconds = task.runtime / 1000;
    const estimatedHumanMinutes = Math.ceil((runtimeSeconds * 10) / 60);
    updates.estimatedHumanMinutes = estimatedHumanMinutes;
    updates.humanCost = parseFloat(((estimatedHumanMinutes / 60) * hourlyRate).toFixed(2));
    console.log(
      `[Enrichment] Runtime fallback cost for task ${task.id}: ${runtimeSeconds}s → ${estimatedHumanMinutes} min → $${updates.humanCost}`
    );
  }

  return updates;
}
