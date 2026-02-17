/**
 * Stage Agent Dispatcher
 * 
 * Triggers automated agents when tasks transition between stages.
 * Currently supports:
 *   - "review" → QA Reviewer (validates done criteria, auto-promotes or rejects)
 * 
 * Stage agents post their findings as comments on the task.
 */

import { Task, updateTask, findTaskById } from '../task-store.js';
import { createComment } from '../comment-store.js';
import { logAudit } from '../audit-store.js';
import { runQAReview } from './qa-reviewer.js';

// Track tasks currently being processed to prevent infinite loops
const processingTasks = new Set<string>();

/**
 * Handle a task status change — triggers stage agents if configured
 */
export async function onTaskStatusChange(
  taskId: string,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  // Prevent re-entry (stage agent moving task would trigger this again)
  if (processingTasks.has(taskId)) return;

  try {
    processingTasks.add(taskId);

    if (newStatus === 'review') {
      await handleReviewStage(taskId);
    }
    // Future: add more stage handlers here
    // if (newStatus === 'done') await handleDoneStage(taskId);

  } finally {
    processingTasks.delete(taskId);
  }
}

/**
 * Review stage handler — runs QA checks
 */
async function handleReviewStage(taskId: string): Promise<void> {
  const task = await findTaskById(taskId);
  if (!task) return;

  // Run QA review
  const result = await runQAReview(task);

  // Format the comment
  const checklist = result.checks
    .map(c => `${c.passed ? '✅' : c.required ? '❌' : '⚠️'} **${c.name}**: ${c.detail}`)
    .join('\n');

  const commentContent = `🤖 **QA Review** (Score: ${result.score}/100)\n\n${checklist}\n\n${result.summary}`;

  // Post findings as a comment
  await createComment({
    taskId,
    userId: 'qa-agent',
    userName: '🔍 QA Agent',
    userAvatar: null,
    content: commentContent,
  });

  if (result.passed) {
    // Move to done
    await updateTask(taskId, { status: 'done' });

    await logAudit({
      userId: 'qa-agent',
      action: 'task.qa_passed',
      entityType: 'task',
      entityId: taskId,
      details: { score: result.score, checksRun: result.checks.length },
    });
  } else {
    // Move back to in-progress
    await updateTask(taskId, { status: 'in-progress' });

    await logAudit({
      userId: 'qa-agent',
      action: 'task.qa_failed',
      entityType: 'task',
      entityId: taskId,
      details: { 
        score: result.score, 
        failedChecks: result.checks.filter(c => !c.passed && c.required).map(c => c.name),
      },
    });
  }
}
