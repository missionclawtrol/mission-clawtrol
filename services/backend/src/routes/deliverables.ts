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
import { findTaskById } from '../task-store.js';
import { logAudit } from '../audit-store.js';

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
   * Query params: taskId, agentId, projectId, status
   */
  fastify.get<{
    Querystring: {
      taskId?: string;
      agentId?: string;
      projectId?: string;
      status?: DeliverableStatus;
    };
  }>('/', async (request, _reply) => {
    const { taskId, agentId, projectId, status } = request.query;
    const deliverables = await getDeliverables({ taskId, agentId, projectId, status });
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
    };
  }>('/:id', async (request, reply) => {
    const existing = await getDeliverable(request.params.id);
    if (!existing) return reply.status(404).send({ error: 'Deliverable not found' });

    const { status, feedback, title, content, type, filePath } = request.body;

    const updated = await updateDeliverable(request.params.id, {
      status,
      feedback,
      title,
      content,
      type,
      filePath,
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
