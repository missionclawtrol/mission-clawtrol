import { FastifyInstance } from 'fastify';
import { db } from '../database.js';
import { randomUUID } from 'crypto';

export async function milestoneRoutes(fastify: FastifyInstance) {
  // GET /api/milestones?projectId=X — list milestones with task counts
  fastify.get<{ Querystring: { projectId?: string } }>('/', async (request, reply) => {
    const { projectId } = request.query;
    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    const milestones = await db.query<any>(
      `SELECT m.*,
        COUNT(t.id) as totalTasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneTasks
      FROM milestones m
      LEFT JOIN tasks t ON t.milestoneId = m.id
      WHERE m.projectId = ?
      GROUP BY m.id
      ORDER BY m.targetDate ASC, m.createdAt ASC`,
      [projectId]
    );

    return { milestones };
  });

  // GET /api/milestones/:id/tasks — must be registered before /:id
  fastify.get<{ Params: { id: string } }>('/:id/tasks', async (request, reply) => {
    const { id } = request.params;

    const milestone = await db.queryOne<any>('SELECT id FROM milestones WHERE id = ?', [id]);
    if (!milestone) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    const tasks = await db.query<any>('SELECT * FROM tasks WHERE milestoneId = ? ORDER BY createdAt DESC', [id]);
    return { tasks };
  });

  // GET /api/milestones/:id — get a single milestone
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const milestone = await db.queryOne<any>(
      `SELECT m.*,
        COUNT(t.id) as totalTasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneTasks
      FROM milestones m
      LEFT JOIN tasks t ON t.milestoneId = m.id
      WHERE m.id = ?
      GROUP BY m.id`,
      [id]
    );

    if (!milestone) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    return milestone;
  });

  // POST /api/milestones — create a milestone
  fastify.post<{
    Body: { projectId: string; name: string; description?: string; targetDate?: string };
  }>('/', async (request, reply) => {
    const { projectId, name, description, targetDate } = request.body;

    if (!projectId || !name) {
      return reply.status(400).send({ error: 'projectId and name are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO milestones (id, projectId, name, description, targetDate, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      [id, projectId, name, description || null, targetDate || null, now, now]
    );

    const milestone = await db.queryOne<any>(
      `SELECT m.*,
        COUNT(t.id) as totalTasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneTasks
      FROM milestones m
      LEFT JOIN tasks t ON t.milestoneId = m.id
      WHERE m.id = ?
      GROUP BY m.id`,
      [id]
    );

    return reply.status(201).send(milestone);
  });

  // PATCH /api/milestones/:id — update a milestone
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; description?: string; targetDate?: string; status?: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, description, targetDate, status } = request.body;

    const existing = await db.queryOne<any>('SELECT id FROM milestones WHERE id = ?', [id]);
    if (!existing) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    const now = new Date().toISOString();
    const sets: string[] = ['updatedAt = ?'];
    const params: any[] = [now];

    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (targetDate !== undefined) { sets.push('targetDate = ?'); params.push(targetDate); }
    if (status !== undefined) { sets.push('status = ?'); params.push(status); }

    params.push(id);
    await db.execute(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`, params);

    const milestone = await db.queryOne<any>(
      `SELECT m.*,
        COUNT(t.id) as totalTasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneTasks
      FROM milestones m
      LEFT JOIN tasks t ON t.milestoneId = m.id
      WHERE m.id = ?
      GROUP BY m.id`,
      [id]
    );

    return milestone;
  });

  // DELETE /api/milestones/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await db.queryOne<any>('SELECT id FROM milestones WHERE id = ?', [id]);
    if (!existing) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    const taskCount = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM tasks WHERE milestoneId = ?',
      [id]
    );

    if (taskCount && taskCount.count > 0) {
      return reply.status(409).send({ error: 'Cannot delete milestone with assigned tasks' });
    }

    await db.execute('DELETE FROM milestones WHERE id = ?', [id]);
    return { success: true };
  });
}
