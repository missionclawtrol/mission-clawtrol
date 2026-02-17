import { FastifyInstance } from 'fastify';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  Task,
  loadTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  findTaskById,
  getTasksByProject,
  getTasksByAgent,
  getTasksByStatus,
} from '../task-store.js';
import { db, getRawDb } from '../database.js';
import { logAudit } from '../audit-store.js';

const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');
const WORK_ORDER_TEMPLATE_PATH = join(WORKSPACE_PATH, 'workflow', 'WORK_ORDER_TEMPLATE.md');
const execAsync = promisify(exec);

function getHumanHourlyRate(): number {
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

function extractCommitHash(text?: string | null): string | undefined {
  if (!text || typeof text !== 'string') return undefined;
  if (text.includes('NO_COMMIT')) return undefined;
  const commitMatch = text.match(/[Cc]ommit[:\s]+([a-f0-9]{7,40})/);
  if (commitMatch) return commitMatch[1];
  const hashMatch = text.match(/([a-f0-9]{7,40})/);
  return hashMatch ? hashMatch[1] : undefined;
}

async function getMostRecentCommitHash(
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

async function getLinesChanged(
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

async function getWorkingTreeLinesChanged(
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80);
}

async function createWorkOrderFile(task: Task): Promise<string | null> {
  try {
    const projectDir = join(WORKSPACE_PATH, task.projectId ?? 'default');
    const workOrdersDir = join(projectDir, 'work-orders');
    await mkdir(workOrdersDir, { recursive: true });

    const slug = slugify(task.title ?? 'task');
    const fileName = `WO-${task.id}-${slug}.md`;
    const filePath = join(workOrdersDir, fileName);

    let template = '';
    try {
      template = await readFile(WORK_ORDER_TEMPLATE_PATH, 'utf-8');
    } catch {
      template = '# Work Order\n\n## Goal\n\n## Definition of Done\n- [ ] \n\n## Files / Paths\n- \n\n## Out of Scope\n- \n\n## Test / Verify\n- \n\n## Notes\n- \n';
    }

    const filled = template
      .replace('**Task ID:**', `**Task ID:** ${task.id}`)
      .replace('**Project:**', `**Project:** ${task.projectId}`);

    await writeFile(filePath, filled, 'utf-8');
    return `work-orders/${fileName}`;
  } catch {
    return null;
  }
}

function hasReviewChecklist(handoffNotes?: string | null): boolean {
  if (!handoffNotes) return false;
  const required = ['Files changed', 'How tested', 'Edge cases', 'Rollback', 'Commit hash'];
  return required.every((item) => handoffNotes.includes(item));
}

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

      // Stamp createdBy from authenticated user (or 'dev-user' when auth disabled)
      const createdBy = (request as any).user?.id || (process.env.DISABLE_AUTH === 'true' ? 'dev-user' : null);
      const assignedTo = (request.body as any).assignedTo || null;

      const task = await createTask({
        title,
        description,
        status: status as Task['status'],
        priority: priority as Task['priority'],
        projectId,
        agentId: agentId || null,
        sessionKey: sessionKey || null,
        handoffNotes: handoffNotes || null,
        createdBy,
        assignedTo,
      });

      const workOrderPath = await createWorkOrderFile(task);
      if (workOrderPath) {
        const updatedDescription = task.description?.includes('Work Order:')
          ? task.description
          : `${task.description}\nWork Order: ${workOrderPath}`;
        await updateTask(task.id, { description: updatedDescription });
        task.description = updatedDescription;
      }

      // Log task creation
      await logAudit({
        userId: request.user?.id,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        details: { title: task.title, priority: task.priority, projectId: task.projectId },
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
      if ('id' in updates || 'createdAt' in updates || 'createdBy' in updates) {
        return reply.status(400).send({
          error: 'Cannot update id, createdAt, or createdBy',
        });
      }

      let existingTask: Task | null = null;

      // Validate status if provided
      if (updates.status) {
        const validStatuses = ['backlog', 'todo', 'in-progress', 'review', 'done'];
        if (!validStatuses.includes(updates.status)) {
          return reply.status(400).send({ error: 'Invalid status' });
        }

        if (updates.status === 'review' || updates.status === 'done') {
          existingTask = await findTaskById(id);
          if (!existingTask) {
            return reply.status(404).send({ error: 'Task not found' });
          }
        }

        if (updates.status === 'review') {
          const notesToCheck = updates.handoffNotes ?? existingTask?.handoffNotes ?? null;
          if (!hasReviewChecklist(notesToCheck)) {
            return reply.status(400).send({
              error: 'Review checklist missing in handoffNotes',
              code: 'MISSING_REVIEW_CHECKLIST',
            });
          }

          const commitHashFromNotes = extractCommitHash(notesToCheck);
          const commitHash = updates.commitHash ?? existingTask?.commitHash ?? commitHashFromNotes;
          const noCommitDeclared = typeof notesToCheck === 'string' && notesToCheck.includes('NO_COMMIT');

          if (!commitHash && !noCommitDeclared) {
            return reply.status(400).send({
              error: 'Commit hash required to enter review',
              code: 'MISSING_COMMIT_HASH',
            });
          }

          if (!updates.commitHash && commitHashFromNotes) {
            updates.commitHash = commitHashFromNotes;
          }
        }
      }

      // LOC-based capture when moving to done
      if (updates.status === 'done') {
        const task = existingTask ?? (await findTaskById(id));
        if (!task) {
          return reply.status(404).send({ error: 'Task not found' });
        }

        const hourlyRate = getHumanHourlyRate();
        const MINUTES_PER_LINE = 3;

        const existingLines = updates.linesChanged ?? task.linesChanged;
        let commitHash = updates.commitHash ?? task.commitHash;

        if (!commitHash) {
          const hashFromNotes = extractCommitHash(updates.handoffNotes ?? task.handoffNotes ?? updates.description ?? task.description);
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
          // If no commit hash or zero diff, fall back to working tree diff
          if ((!commitHash || (diff.added === 0 && diff.removed === 0))) {
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
          const estimatedHumanMinutes = Math.ceil(runtimeSeconds * 10 / 60);
          updates.estimatedHumanMinutes = estimatedHumanMinutes;
          updates.humanCost = (estimatedHumanMinutes / 60) * hourlyRate;
        }
      }

      // Validate priority if provided
      if (updates.priority) {
        const validPriorities = ['P0', 'P1', 'P2', 'P3'];
        if (!validPriorities.includes(updates.priority)) {
          return reply.status(400).send({ error: 'Invalid priority' });
        }
      }

      // Capture old task for audit logging before update
      const oldTask = await findTaskById(id);

      const task = await updateTask(id, updates);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Log status change
      if (oldTask && updates.status && oldTask.status !== updates.status) {
        await logAudit({
          userId: request.user?.id,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: task.id,
          details: { oldStatus: oldTask.status, newStatus: updates.status },
        });
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
      
      // Get task before deletion for audit logging
      const task = await findTaskById(id);
      
      const success = await deleteTask(id);

      if (!success) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Log task deletion
      if (task) {
        await logAudit({
          userId: request.user?.id,
          action: 'task.deleted',
          entityType: 'task',
          entityId: id,
          details: { title: task.title },
        });
      }

      return { success: true, id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete task' });
    }
  });
}
