import { FastifyInstance } from 'fastify';
import {
  Task,
  loadTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getTasksByProject,
  getTasksByAgent,
  getTasksByStatus,
} from '../task-store.js';

export async function taskRoutes(fastify: FastifyInstance) {
  // GET /tasks - list all tasks with optional filters
  fastify.get<{
    Querystring: { projectId?: string; agentId?: string; status?: string };
  }>('/', async (request, reply) => {
    try {
      const { projectId, agentId, status } = request.query;
      let tasks: Task[];

      if (projectId) {
        tasks = await getTasksByProject(projectId);
      } else if (agentId) {
        tasks = await getTasksByAgent(agentId);
      } else if (status) {
        // Validate status is one of the allowed values
        const validStatuses = ['backlog', 'todo', 'in-progress', 'review', 'done'];
        if (!validStatuses.includes(status)) {
          return reply.status(400).send({ error: 'Invalid status' });
        }
        tasks = await getTasksByStatus(status as Task['status']);
      } else {
        tasks = await loadTasks();
      }

      return { tasks, count: tasks.length };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load tasks' });
    }
  });

  // GET /tasks/:id - get a single task
  fastify.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const task = await getTask(id);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      return task;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load task' });
    }
  });

  // POST /tasks - create a new task
  fastify.post<{
    Body: {
      title: string;
      description: string;
      status?: Task['status'];
      priority: Task['priority'];
      projectId: string;
      agentId?: string | null;
      sessionKey?: string | null;
      handoffNotes?: string | null;
    };
  }>('/', async (request, reply) => {
    try {
      const {
        title,
        description,
        status = 'backlog',
        priority,
        projectId,
        agentId = null,
        sessionKey = null,
        handoffNotes = null,
      } = request.body;

      // Validate required fields
      if (!title || !description || !priority || !projectId) {
        return reply.status(400).send({
          error: 'Missing required fields: title, description, priority, projectId',
        });
      }

      // Validate status and priority
      const validStatuses = ['backlog', 'todo', 'in-progress', 'review', 'done'];
      const validPriorities = ['P0', 'P1', 'P2', 'P3'];

      if (!validStatuses.includes(status)) {
        return reply.status(400).send({ error: 'Invalid status' });
      }
      if (!validPriorities.includes(priority)) {
        return reply.status(400).send({ error: 'Invalid priority' });
      }

      const task = await createTask({
        title,
        description,
        status: status as Task['status'],
        priority: priority as Task['priority'],
        projectId,
        agentId: agentId || null,
        sessionKey: sessionKey || null,
        handoffNotes: handoffNotes || null,
      });

      return reply.status(201).send(task);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to create task' });
    }
  });

  // PATCH /tasks/:id - update a task (partial update)
  fastify.patch<{
    Params: { id: string };
    Body: Partial<Task>;
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const updates = request.body;

      // Validate that we're not trying to update protected fields
      if ('id' in updates || 'createdAt' in updates) {
        return reply.status(400).send({
          error: 'Cannot update id or createdAt',
        });
      }

      // Validate status if provided
      if (updates.status) {
        const validStatuses = ['backlog', 'todo', 'in-progress', 'review', 'done'];
        if (!validStatuses.includes(updates.status)) {
          return reply.status(400).send({ error: 'Invalid status' });
        }
      }

      // Validate priority if provided
      if (updates.priority) {
        const validPriorities = ['P0', 'P1', 'P2', 'P3'];
        if (!validPriorities.includes(updates.priority)) {
          return reply.status(400).send({ error: 'Invalid priority' });
        }
      }

      const task = await updateTask(id, updates);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      return task;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update task' });
    }
  });

  // DELETE /tasks/:id - delete a task
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const success = await deleteTask(id);

      if (!success) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      return { success: true, id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete task' });
    }
  });
}
