/**
 * QA Reviewer - Automated quality checks when tasks enter "review" stage
 * 
 * Validates against the Done Criteria:
 * 1. Files changed — list of files modified
 * 2. How tested — what testing was done
 * 3. Edge cases / risks — known limitations
 * 4. Rollback plan — how to undo
 * 5. Commit hash — git commit hash (or NO_COMMIT)
 * 
 * Also validates:
 * - Commit hash is a real git hash format
 * - Commit exists in the repo (if projectId maps to a workspace)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { Task } from '../task-store.js';

const execAsync = promisify(exec);
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

export interface QAResult {
  passed: boolean;
  score: number; // 0-100
  checks: QACheck[];
  summary: string;
}

export interface QACheck {
  name: string;
  passed: boolean;
  detail: string;
  required: boolean;
}

/**
 * Run QA review on a task
 */
export async function runQAReview(task: Task): Promise<QAResult> {
  const checks: QACheck[] = [];
  const handoff = task.handoffNotes || '';

  // 1. Files changed
  checks.push({
    name: 'Files changed',
    passed: /files?\s*changed/i.test(handoff) && handoff.length > 30,
    detail: /files?\s*changed/i.test(handoff) 
      ? 'Files changed section found' 
      : 'Missing "Files changed" section in handoff notes',
    required: true,
  });

  // 2. How tested
  checks.push({
    name: 'How tested',
    passed: /how\s*tested|testing|tested\s*by|test\s*plan/i.test(handoff),
    detail: /how\s*tested/i.test(handoff) 
      ? 'Testing section found' 
      : 'Missing "How tested" section in handoff notes',
    required: true,
  });

  // 3. Edge cases / risks
  checks.push({
    name: 'Edge cases / risks',
    passed: /edge\s*cases?|risks?|limitations?|caveats?/i.test(handoff),
    detail: /edge\s*cases/i.test(handoff)
      ? 'Edge cases section found'
      : 'Missing "Edge cases / risks" section in handoff notes',
    required: true,
  });

  // 4. Rollback plan
  checks.push({
    name: 'Rollback plan',
    passed: /rollback|revert|undo/i.test(handoff),
    detail: /rollback/i.test(handoff)
      ? 'Rollback plan found'
      : 'Missing "Rollback plan" section in handoff notes',
    required: true,
  });

  // 5. Commit hash
  const commitHash = task.commitHash || extractCommitHash(handoff);
  const noCommitDeclared = handoff.includes('NO_COMMIT');
  const hasCommit = !!commitHash || noCommitDeclared;

  checks.push({
    name: 'Commit hash',
    passed: hasCommit,
    detail: commitHash 
      ? `Commit: ${commitHash}` 
      : noCommitDeclared 
        ? 'NO_COMMIT declared (non-git work)' 
        : 'Missing commit hash in handoff notes',
    required: true,
  });

  // 6. Verify commit exists in repo (bonus check)
  if (commitHash && task.projectId) {
    const commitExists = await verifyCommitExists(commitHash, task.projectId);
    checks.push({
      name: 'Commit verification',
      passed: commitExists,
      detail: commitExists
        ? `Commit ${commitHash.slice(0, 7)} verified in ${task.projectId} repo`
        : `Commit ${commitHash.slice(0, 7)} not found in ${task.projectId} repo`,
      required: false, // warning, not blocking
    });
  }

  // 7. Handoff notes not empty / substantial
  checks.push({
    name: 'Handoff notes quality',
    passed: handoff.length >= 100,
    detail: handoff.length >= 100
      ? `Handoff notes: ${handoff.length} chars`
      : `Handoff notes too short (${handoff.length} chars, need 100+)`,
    required: false,
  });

  // Calculate results
  const requiredChecks = checks.filter(c => c.required);
  const requiredPassed = requiredChecks.filter(c => c.passed);
  const allPassed = requiredChecks.every(c => c.passed);
  const score = Math.round((requiredPassed.length / requiredChecks.length) * 100);

  // Build summary
  const failedRequired = requiredChecks.filter(c => !c.passed);
  const warnings = checks.filter(c => !c.required && !c.passed);
  
  let summary: string;
  if (allPassed && warnings.length === 0) {
    summary = `✅ QA PASSED — All ${requiredChecks.length} required checks passed. Task is ready for done.`;
  } else if (allPassed) {
    summary = `✅ QA PASSED with ${warnings.length} warning(s) — All required checks passed. Task moved to done.`;
  } else {
    summary = `❌ QA FAILED — ${failedRequired.length} required check(s) failed:\n` +
      failedRequired.map(c => `  • ${c.name}: ${c.detail}`).join('\n') +
      (warnings.length > 0 ? `\n\n⚠️ Warnings:\n` + warnings.map(c => `  • ${c.name}: ${c.detail}`).join('\n') : '');
  }

  return { passed: allPassed, score, checks, summary };
}

function extractCommitHash(text: string): string | undefined {
  if (!text) return undefined;
  const commitMatch = text.match(/[Cc]ommit[:\s]+([a-f0-9]{7,40})/);
  if (commitMatch) return commitMatch[1];
  // Look for standalone hash-like strings near "commit" or "hash"
  const hashMatch = text.match(/(?:hash|commit)[:\s]*([a-f0-9]{7,40})/i);
  return hashMatch ? hashMatch[1] : undefined;
}

async function verifyCommitExists(hash: string, projectId: string): Promise<boolean> {
  try {
    const repoPath = join(WORKSPACE_PATH, projectId);
    const primaryHash = hash.split(',')[0].trim();
    const { stdout } = await execAsync(
      `git -C ${repoPath} cat-file -t ${primaryHash} 2>/dev/null`,
      { timeout: 5000 }
    );
    return stdout.trim() === 'commit';
  } catch {
    return false;
  }
}
