/**
 * Deliverables Routes
 *
 * Endpoints:
 *   GET    /api/deliverables              — list all deliverables (filterable)
 *   POST   /api/deliverables              — create a deliverable
 *   GET    /api/deliverables/pending      — count of deliverables in "review" status (widget)
 *   GET    /api/deliverables/:id          — get single deliverable
 *   PATCH  /api/deliverables/:id          — update status/feedback/content
 *   DELETE /api/deliverables/:id          — delete deliverable
 *
 *   GET    /api/tasks/:taskId/deliverables   — list deliverables for a task
 *   POST   /api/tasks/:taskId/deliverables   — create deliverable for a task
 */

import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import {
  getDeliverables,
  getDeliverable,
  getDeliverablesByTask,
  createDeliverable,
  updateDeliverable,
  deleteDeliverable,
  countPendingReview,
  type DeliverableStatus,
  type DeliverableType,
} from '../deliverable-store.js';
import { findTaskById, updateTask } from '../task-store.js';
import { logAudit } from '../audit-store.js';
import { spawnTaskSession } from '../auto-spawn.js';

/** Map file extension → Content-Type */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pdf':  return 'application/pdf';
    case '.md':
    case '.txt':  return 'text/plain';
    case '.csv':  return 'text/csv';
    case '.png':  return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default:      return 'application/octet-stream';
  }
}

/**
 * Top-level deliverable routes (/api/deliverables/*)
 */
export async function deliverableRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/deliverables/pending — widget count of deliverables in review
   * Must be registered BEFORE /:id to avoid route conflict
   */
  fastify.get('/pending', async (_request, _reply) => {
    const count = await countPendingReview();
    return { count };
  });

  /**
   * GET /api/deliverables — list all deliverables with optional filters
   * Query params: taskId, agentId, projectId, status (single or comma-separated for multiple)
   */
  fastify.get<{
    Querystring: {
      taskId?: string;
      agentId?: string;
      projectId?: string;
      status?: string;
    };
  }>('/', async (request, _reply) => {
    const { taskId, agentId, projectId, status } = request.query;
    // Support comma-separated status values (e.g. "review,pending_review")
    const statusFilter = status
      ? (status.includes(',')
          ? (status.split(',').map(s => s.trim()) as DeliverableStatus[])
          : status as DeliverableStatus)
      : undefined;
    const deliverables = await getDeliverables({ taskId, agentId, projectId, status: statusFilter });
    return { deliverables, count: deliverables.length };
  });

  /**
   * POST /api/deliverables — create a deliverable (agent API)
   * Body: { taskId, title, type?, content?, filePath?, agentId?, projectId?, status? }
   */
  fastify.post<{
    Body: {
      taskId: string;
      title: string;
      type?: DeliverableType;
      content?: string;
      filePath?: string;
      agentId?: string;
      projectId?: string;
      status?: DeliverableStatus;
    };
  }>('/', async (request, reply) => {
    const { taskId, title, type, content, filePath, agentId, projectId, status } = request.body;

    if (!taskId || !title) {
      return reply.status(400).send({ error: 'taskId and title are required' });
    }

    const task = await findTaskById(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const deliverable = await createDeliverable({
      taskId,
      agentId: agentId || task.agentId || null,
      projectId: projectId || task.projectId || null,
      title,
      type,
      content,
      filePath,
      status,
    });

    const user = (request as any).user;
    await logAudit({
      userId: user?.id,
      action: 'deliverable.created',
      entityType: 'task',
      entityId: taskId,
      details: { deliverableId: deliverable.id, title, type },
    });

    return reply.status(201).send(deliverable);
  });

  /**
   * GET /api/deliverables/:id/download — stream the file to the browser
   * Uses the filePath stored on the deliverable record.
   * Returns 404 if deliverable not found or file does not exist on disk.
   */
  fastify.get<{ Params: { id: string } }>('/:id/download', async (request, reply) => {
    const deliverable = await getDeliverable(request.params.id);
    if (!deliverable) return reply.status(404).send({ error: 'Deliverable not found' });

    if (!deliverable.filePath) {
      return reply.status(404).send({ error: 'No file path associated with this deliverable' });
    }

    const absPath = path.resolve(deliverable.filePath);

    if (!fs.existsSync(absPath)) {
      return reply.status(404).send({ error: `File not found on disk: ${deliverable.filePath}` });
    }

    const contentType = getContentType(absPath);
    const filename = path.basename(absPath);

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(absPath);
    return reply.send(stream);
  });

  /**
   * GET /api/deliverables/:id/serve — stream the file inline (for iframe/browser preview)
   * Like /download but uses Content-Disposition: inline so PDF renders in-browser.
   * Must be registered BEFORE /:id to avoid route conflict.
   */
  fastify.get<{ Params: { id: string } }>('/:id/serve', async (request, reply) => {
    const deliverable = await getDeliverable(request.params.id);
    if (!deliverable) return reply.status(404).send({ error: 'Deliverable not found' });

    if (!deliverable.filePath) {
      return reply.status(404).send({ error: 'No file path associated with this deliverable' });
    }

    const absPath = path.resolve(deliverable.filePath);

    if (!fs.existsSync(absPath)) {
      return reply.status(404).send({ error: `File not found on disk: ${deliverable.filePath}` });
    }

    const contentType = getContentType(absPath);
    const filename = path.basename(absPath);

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `inline; filename="${filename}"`);
    reply.header('Access-Control-Allow-Origin', '*');

    const stream = fs.createReadStream(absPath);
    return reply.send(stream);
  });

  /**
   * GET /api/deliverables/:id — get single deliverable
   */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const deliverable = await getDeliverable(request.params.id);
    if (!deliverable) return reply.status(404).send({ error: 'Deliverable not found' });
    return deliverable;
  });

  /**
   * PATCH /api/deliverables/:id — review workflow: approve, reject, request changes
   * Body: { status?, feedback?, title?, content?, type?, filePath? }
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      status?: DeliverableStatus;
      feedback?: string;
      title?: string;
      content?: string;
      type?: DeliverableType;
      filePath?: string;
      projectId?: string;
    };
  }>('/:id', async (request, reply) => {
    const existing = await getDeliverable(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Deliverable not found' });

    const { status, feedback, title, content, type, filePath, projectId } = request.body;

    const updated = await updateDeliverable(request.params.id, {
      status,
      feedback,
      title,
      content,
      type,
      filePath,
      projectId,
    });

    const user = (request as any).user;
    if (status && status !== existing.status) {
      await logAudit({
        userId: user?.id,
        action: `deliverable.${status}`,
        entityType: 'task',
        entityId: existing.taskId,
        details: { deliverableId: existing.id, title: existing.title, oldStatus: existing.status, newStatus: status, feedback },
      });

      // ── Deliverable send-back: re-spawn agent for revision ──────────────
      // When a deliverable is sent back with changes requested, move the parent
      // task back to in-progress and re-spawn the assigned agent with the
      // reviewer's feedback injected into the agent brief.
      if (status === 'changes_requested') {
        try {
          const parentTask = await findTaskById(existing.taskId);
          if (parentTask && parentTask.agentId) {
            // Move task back to in-progress and clear the stale session key
            // so auto-spawn is not blocked by the old session.
            await updateTask(parentTask.id, { status: 'in-progress', sessionKey: null });

            await logAudit({
              userId: user?.id,
              action: 'task.reverted_to_in_progress',
              entityType: 'task',
              entityId: parentTask.id,
              details: { reason: 'deliverable_changes_requested', deliverableId: existing.id },
            });

            // Build the feedback context to inject into the re-spawned agent brief
            const feedbackBlock = [
              '## Deliverable Review Feedback — Action Required',
              '',
              `A deliverable you submitted for task **${parentTask.title}** has been sent back for revisions.`,
              '',
              `**Deliverable:** ${existing.title}`,
              feedback
                ? `**Reviewer comments:**\n\n${feedback}`
                : '**No specific comments were provided — please re-examine your deliverable and address any quality issues.**',
              '',
              'Please address the feedback above, update or replace the deliverable, and mark the task done again.',
            ].join('\n');

            // Re-fetch the updated task (with in-progress status, no sessionKey)
            const updatedTask = await findTaskById(parentTask.id);
            if (updatedTask) {
              const spawnResult = await spawnTaskSession(updatedTask, parentTask.agentId, {
                force: true,
                extraContext: feedbackBlock,
              });

              if (spawnResult.success && spawnResult.sessionKey) {
                await updateTask(parentTask.id, { sessionKey: spawnResult.sessionKey });

                await logAudit({
                  userId: 'auto-spawn',
                  action: 'task.session_spawned',
                  entityType: 'task',
                  entityId: parentTask.id,
                  details: {
                    sessionKey: spawnResult.sessionKey,
                    agentId: parentTask.agentId,
                    reason: 'deliverable_changes_requested',
                    deliverableId: existing.id,
                  },
                });

                console.log(`[Deliverables] Re-spawned ${parentTask.agentId} for task ${parentTask.id} after changes requested on deliverable ${existing.id}`);
              } else {
                console.error(`[Deliverables] Failed to re-spawn agent for task ${parentTask.id}:`, spawnResult.error);
              }
            }
          }
        } catch (spawnErr: any) {
          // Non-fatal: deliverable update already succeeded; log the error but don't fail the request
          console.error('[Deliverables] Error triggering re-spawn after changes requested:', spawnErr.message);
        }
      }
    }

    return updated;
  });

  /**
   * DELETE /api/deliverables/:id
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const existing = await getDeliverable(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Deliverable not found' });

    const user = (request as any).user;
    const isAdmin = user?.role === 'admin' || process.env.DISABLE_AUTH === 'true';
    if (!isAdmin) {
      return reply.status(403).send({ error: 'Admin only' });
    }

    await deleteDeliverable(request.params.id);

    await logAudit({
      userId: user?.id,
      action: 'deliverable.deleted',
      entityType: 'task',
      entityId: existing.taskId,
      details: { deliverableId: existing.id, title: existing.title },
    });

    return { success: true };
  });
}

/**
 * Task-scoped deliverable routes (/api/tasks/:taskId/deliverables)
 * Registered under the /api/tasks prefix
 */
export async function taskDeliverableRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/tasks/:taskId/deliverables
   */
  fastify.get<{ Params: { taskId: string } }>(
    '/:taskId/deliverables',
    async (request, reply) => {
      const { taskId } = request.params;
      const task = await findTaskById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const deliverables = await getDeliverablesByTask(taskId);
      return { deliverables, count: deliverables.length };
    }
  );

  /**
   * POST /api/tasks/:taskId/deliverables
   */
  fastify.post<{
    Params: { taskId: string };
    Body: {
      title: string;
      type?: DeliverableType;
      content?: string;
      filePath?: string;
      agentId?: string;
      status?: DeliverableStatus;
    };
  }>(
    '/:taskId/deliverables',
    async (request, reply) => {
      const { taskId } = request.params;
      const { title, type, content, filePath, agentId, status } = request.body;

      if (!title) {
        return reply.status(400).send({ error: 'title is required' });
      }

      const task = await findTaskById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const deliverable = await createDeliverable({
        taskId,
        agentId: agentId || task.agentId || null,
        projectId: task.projectId || null,
        title,
        type,
        content,
        filePath,
        status,
      });

      const user = (request as any).user;
      await logAudit({
        userId: user?.id,
        action: 'deliverable.created',
        entityType: 'task',
        entityId: taskId,
        details: { deliverableId: deliverable.id, title, type },
      });

      return reply.status(201).send(deliverable);
    }
  );
}
