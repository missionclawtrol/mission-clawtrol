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
import { requireRole, canModifyTask } from '../middleware/auth.js';
import { onTaskStatusChange } from '../stage-agents/index.js';
import { enrichDoneTransition } from '../enrichment.js';
import { dispatchWebhookEvent } from '../webhook-dispatcher.js';
import { autoSpawnIfNeeded, spawnTaskSession } from '../auto-spawn.js';

// Broadcast function will be injected from index.ts
let broadcastFn: ((type: string, payload: unknown) => void) | null = null;

// Eager session registration — called when a task is assigned a new sessionKey via PATCH
let sessionRegistrationFn: ((sessionKey: string, taskId: string, agentId: string, title: string) => void) | null = null;
export function setSessionRegistrationFn(fn: (sessionKey: string, taskId: string, agentId: string, title: string) => void) {
  sessionRegistrationFn = fn;
}

export function setBroadcastFn(fn: (type: string, payload: unknown) => void) {
  broadcastFn = fn;
}

// Session cleanup function — called when a task's sessionKey changes (re-assignment)
let sessionCleanupFn: ((oldSessionKey: string) => void) | null = null;

export function setSessionCleanupFn(fn: (oldSessionKey: string) => void) {
  sessionCleanupFn = fn;
}

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
    Querystring: { projectId?: string; agentId?: string; status?: string; milestoneId?: string; type?: string };
  }>('/', async (request, reply) => {
    try {
      const { projectId, agentId, status, milestoneId, type } = request.query;
      let tasks: Task[];

      if (milestoneId) {
        // Filter by milestoneId — custom query via db
        const rows = await db.query<any>('SELECT * FROM tasks WHERE milestoneId = ? ORDER BY createdAt DESC', [milestoneId]);
        tasks = rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          projectId: row.projectId,
          agentId: row.agentId,
          sessionKey: row.sessionKey,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          completedAt: row.completedAt,
          handoffNotes: row.handoffNotes,
          cost: row.cost,
          model: row.model,
          runtime: row.runtime,
          commitHash: row.commitHash,
          estimatedHumanMinutes: row.estimatedHumanMinutes,
          humanCost: row.humanCost,
          createdBy: row.createdBy || null,
          assignedTo: row.assignedTo || null,
          dueDate: row.dueDate || null,
          milestoneId: row.milestoneId || null,
          type: row.type || null,
        }));
      } else if (projectId) {
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

      // Filter by type if provided
      if (type) {
        const validTypes = ['feature', 'bug', 'chore', 'spike', 'docs'];
        if (!validTypes.includes(type)) {
          return reply.status(400).send({ error: 'Invalid type' });
        }
        tasks = tasks.filter(t => t.type === type);
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

  // POST /tasks - create a new task (admin + member only)
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
      dueDate?: string | null;
      milestoneId?: string | null;
      type?: Task['type'];
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
        dueDate = null,
        milestoneId = null,
        type = null,
      } = request.body;

      // Viewers cannot create tasks
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot create tasks' });
      }

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
        dueDate: dueDate || null,
        createdBy,
        assignedTo,
        milestoneId: milestoneId || null,
        type: type || null,
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

      // Dispatch webhook event for task creation
      dispatchWebhookEvent('task.created', { task }).catch(err => {
        fastify.log.error(err, 'Webhook dispatch error for task.created');
      });

      // Broadcast task creation to connected clients
      if (broadcastFn) {
        broadcastFn('task.created', {
          task,
          actor: user?.username || user?.name || 'Unknown',
        });
      }

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

      // Viewers cannot update tasks
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot update tasks' });
      }

      // Members can only update tasks they created or are assigned to
      if (user && user.role === 'member') {
        const existingForAuth = await findTaskById(id);
        if (existingForAuth && !canModifyTask(user, existingForAuth)) {
          return reply.status(403).send({ error: 'You can only edit tasks you created or are assigned to' });
        }
      }

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
        await enrichDoneTransition(task, updates);
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

      // Clean up old session tracking when task is reassigned to a new agent
      if (oldTask && updates.sessionKey && oldTask.sessionKey && updates.sessionKey !== oldTask.sessionKey) {
        console.log(`[Tasks] Session reassignment: cleaning up old session ${oldTask.sessionKey}`);
        if (sessionCleanupFn) {
          sessionCleanupFn(oldTask.sessionKey);
        }
      }

      const task = await updateTask(id, updates);

      // Eagerly register the new sessionKey so events are captured from the very first message
      if (task && updates.sessionKey && updates.sessionKey !== oldTask?.sessionKey && sessionRegistrationFn) {
        const agentId = (updates as any).agentId ?? oldTask?.agentId ?? 'unknown';
        console.log(`[Tasks] Eagerly registering session: ${updates.sessionKey} for task: ${task.id}`);
        sessionRegistrationFn(updates.sessionKey, task.id, agentId, task.title);
      }

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Auto-spawn: if task moved to in-progress with an agentId and no sessionKey, spawn a session
      // Run asynchronously so the PATCH response is not blocked
      if (!updates.sessionKey) {
        const oldStatus = oldTask?.status;
        const newStatus = updates.status ?? task.status;
        const oldAgentId = oldTask?.agentId;
        const newAgentId = updates.agentId !== undefined ? updates.agentId : task.agentId;

        autoSpawnIfNeeded(task.id, oldStatus, newStatus, oldAgentId, newAgentId)
          .then(async (spawnResult) => {
            if (spawnResult?.success && spawnResult.sessionKey) {
              console.log(`[AutoSpawn] Registered session ${spawnResult.sessionKey} for task ${task.id}`);
              // Register the session for live event tracking
              if (sessionRegistrationFn) {
                const agentId = newAgentId ?? 'unknown';
                sessionRegistrationFn(spawnResult.sessionKey, task.id, agentId, task.title);
              }
              // Broadcast session key update to dashboard
              if (broadcastFn) {
                const updatedTask = await findTaskById(task.id);
                if (updatedTask) {
                  broadcastFn('task.updated', {
                    task: updatedTask,
                    updates: { sessionKey: spawnResult.sessionKey },
                    oldTask: task,
                    actor: 'auto-spawn',
                  });
                }
              }
            } else if (spawnResult && !spawnResult.success) {
              console.warn(`[AutoSpawn] Failed for task ${task.id}: ${spawnResult.error}`);
            }
          })
          .catch((err) => {
            fastify.log.error(err, 'Auto-spawn error for task %s', task.id);
          });
      }

      // Log status change and trigger stage agents
      if (oldTask && updates.status && oldTask.status !== updates.status) {
        await logAudit({
          userId: request.user?.id,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: task.id,
          details: { oldStatus: oldTask.status, newStatus: updates.status },
        });

        // Dispatch webhook event for status change
        dispatchWebhookEvent('task.status_changed', {
          task,
          oldStatus: oldTask.status,
          newStatus: updates.status,
        }).catch(err => {
          fastify.log.error(err, 'Webhook dispatch error for task.status_changed');
        });

        // Fire stage agent asynchronously (don't block the response)
        onTaskStatusChange(task.id, oldTask.status, updates.status).catch(err => {
          fastify.log.error(err, 'Stage agent error for task %s', task.id);
        });
      }

      // Log assignment change
      if (oldTask && updates.assignedTo !== undefined && oldTask.assignedTo !== updates.assignedTo) {
        await logAudit({
          userId: request.user?.id,
          action: 'task.assigned',
          entityType: 'task',
          entityId: task.id,
          details: { assignedTo: updates.assignedTo },
        });

        // Dispatch webhook event for assignment
        dispatchWebhookEvent('task.assigned', {
          task,
          assignedTo: updates.assignedTo,
        }).catch(err => {
          fastify.log.error(err, 'Webhook dispatch error for task.assigned');
        });
      }

      // Broadcast task update to connected clients
      if (broadcastFn) {
        broadcastFn('task.updated', {
          task,
          updates,
          oldTask,
          actor: user?.username || user?.name || 'Unknown',
        });
      }

      return task;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update task' });
    }
  });

  // POST /tasks/:id/spawn - explicitly spawn a session for a task ("Assign & Run")
  fastify.post<{
    Params: { id: string };
    Body: { agentId?: string; force?: boolean };
  }>('/:id/spawn', async (request, reply) => {
    try {
      const { id } = request.params;
      const { agentId: bodyAgentId, force = false } = request.body || {};

      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot spawn sessions' });
      }

      const task = await findTaskById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      const agentId = bodyAgentId || task.agentId;
      if (!agentId) {
        return reply.status(400).send({
          error: 'agentId required (pass in body or assign one to the task first)',
          code: 'MISSING_AGENT_ID',
        });
      }

      // Update task: set agentId (if new), set status to in-progress
      const taskUpdates: Partial<typeof task> = {};
      if (bodyAgentId && bodyAgentId !== task.agentId) {
        taskUpdates.agentId = bodyAgentId;
      }
      if (task.status === 'backlog' || task.status === 'todo') {
        taskUpdates.status = 'in-progress';
      }
      if (Object.keys(taskUpdates).length > 0) {
        await updateTask(id, taskUpdates);
      }

      // Reload after potential updates
      const freshTask = (await findTaskById(id))!;

      // Spawn the session
      const spawnResult = await spawnTaskSession(freshTask, agentId, { force });

      if (!spawnResult.success) {
        return reply.status(422).send({
          error: spawnResult.error || 'Spawn failed',
          code: 'SPAWN_FAILED',
        });
      }

      // Persist sessionKey to the task
      if (spawnResult.sessionKey) {
        await updateTask(id, { sessionKey: spawnResult.sessionKey });
      }

      // Register the session for live event tracking
      if (sessionRegistrationFn && spawnResult.sessionKey) {
        sessionRegistrationFn(spawnResult.sessionKey, id, agentId, freshTask.title);
      }

      // Broadcast update
      if (broadcastFn) {
        const updatedTask = await findTaskById(id);
        if (updatedTask) {
          broadcastFn('task.updated', {
            task: updatedTask,
            updates: { sessionKey: spawnResult.sessionKey, status: updatedTask.status },
            oldTask: task,
            actor: user?.username || user?.name || 'assign-and-run',
          });
        }
      }

      await logAudit({
        userId: user?.id,
        action: 'task.spawn_requested',
        entityType: 'task',
        entityId: id,
        details: { agentId, sessionKey: spawnResult.sessionKey, force },
      });

      return {
        success: true,
        sessionKey: spawnResult.sessionKey,
        agentId,
        taskId: id,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to spawn session' });
    }
  });

  // DELETE /tasks/:id - delete a task
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      // Only admins and task creators can delete
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot delete tasks' });
      }
      
      // Get task before deletion for audit logging
      const task = await findTaskById(id);

      if (user && user.role === 'member' && task && !canModifyTask(user, task)) {
        return reply.status(403).send({ error: 'You can only delete tasks you created' });
      }
      
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

        // Broadcast task deletion to connected clients
        if (broadcastFn) {
          broadcastFn('task.deleted', {
            taskId: id,
            task,
            actor: user?.username || user?.name || 'Unknown',
          });
        }
      }

      return { success: true, id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete task' });
    }
  });
}
