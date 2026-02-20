import { FastifyInstance } from 'fastify';
import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { db } from '../database.js';

const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');
const EXCLUDED_FOLDERS = ['.git', 'node_modules', '.svelte-kit', 'dist', 'build', '.trash'];

// How many hours a task must be in-progress before it's considered stuck/blocked
const STUCK_THRESHOLD_HOURS = 48;

interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string | null;
  totalTasks: number;
  doneTasks: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  completedAt: string | null;
  updatedAt: string;
  createdAt: string;
  commitHash: string | null;
  blocked: number | null;
  blockerNote: string | null;
  type: string | null;
}

interface ProjectContext {
  id: string;
  name: string;
  repoUrl: string | null;
  activeMilestone: {
    id: string;
    name: string;
    progress: string;
    targetDate: string | null;
  } | null;
  blockers: string[];
  recentCompleted: Array<{
    id: string;
    title: string;
    completedAt: string;
    commitHash: string | null;
  }>;
  inProgress: Array<{ id: string; title: string; priority: string }>;
  inReview: Array<{ id: string; title: string; priority: string }>;
  nextUp: Array<{ id: string; title: string; priority: string }>;
}

function formatProjectName(folderName: string): string {
  return folderName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractRepoUrl(content: string): string | null {
  const match = content.match(/\*\*(?:repo|github|repository):?\*\*:?\s*(https?:\/\/[^\s\n]+)/i);
  return match ? match[1] : null;
}

async function getProjectIds(): Promise<string[]> {
  try {
    const entries = await readdir(WORKSPACE_PATH, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (EXCLUDED_FOLDERS.includes(entry.name)) continue;
      try {
        await stat(join(WORKSPACE_PATH, entry.name, 'PROJECT.md'));
        ids.push(entry.name);
      } catch {
        // No PROJECT.md — not a managed project
      }
    }
    return ids;
  } catch {
    return [];
  }
}

async function buildProjectContext(projectId: string): Promise<ProjectContext | null> {
  // Get repoUrl from PROJECT.md
  let repoUrl: string | null = null;
  try {
    const content = await readFile(join(WORKSPACE_PATH, projectId, 'PROJECT.md'), 'utf-8');
    repoUrl = extractRepoUrl(content);
  } catch {
    // No PROJECT.md readable
  }

  // Get all tasks for this project
  const tasks = await db.query<TaskRow>(
    `SELECT id, title, status, priority, completedAt, updatedAt, createdAt,
            commitHash, blocked, blockerNote, type
     FROM tasks WHERE projectId = ? ORDER BY priority ASC, createdAt DESC`,
    [projectId]
  );

  if (tasks.length === 0) {
    // Still return context for projects with no tasks
    return {
      id: projectId,
      name: formatProjectName(projectId),
      repoUrl,
      activeMilestone: null,
      blockers: [],
      recentCompleted: [],
      inProgress: [],
      inReview: [],
      nextUp: [],
    };
  }

  // Get active milestone (open milestone with most task progress)
  const milestoneRows = await db.query<MilestoneRow>(
    `SELECT m.id, m.name, m.targetDate,
            COUNT(t.id) as totalTasks,
            SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneTasks
     FROM milestones m
     LEFT JOIN tasks t ON t.milestoneId = m.id
     WHERE m.projectId = ? AND m.status = 'open'
     GROUP BY m.id
     ORDER BY (CAST(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(t.id), 1)) DESC
     LIMIT 1`,
    [projectId]
  );

  let activeMilestone: ProjectContext['activeMilestone'] = null;
  if (milestoneRows.length > 0) {
    const m = milestoneRows[0];
    activeMilestone = {
      id: m.id,
      name: m.name,
      progress: `${m.doneTasks}/${m.totalTasks}`,
      targetDate: m.targetDate,
    };
  }

  // Calculate blockers:
  // 1. Tasks explicitly marked blocked
  // 2. Tasks of type=bug with status=todo/in-progress
  // 3. Tasks stuck in-progress for >48h
  const now = Date.now();
  const stuckThresholdMs = STUCK_THRESHOLD_HOURS * 60 * 60 * 1000;
  const blockerMessages: string[] = [];

  for (const task of tasks) {
    if (task.blocked) {
      const note = task.blockerNote ? `: ${task.blockerNote}` : '';
      blockerMessages.push(`[${task.id.slice(0, 8)}] ${task.title}${note}`);
    } else if (task.type === 'bug' && (task.status === 'todo' || task.status === 'in-progress')) {
      blockerMessages.push(`[bug] ${task.title}`);
    } else if (task.status === 'in-progress') {
      const updatedAt = new Date(task.updatedAt).getTime();
      if (now - updatedAt > stuckThresholdMs) {
        blockerMessages.push(`[stuck ${Math.floor((now - updatedAt) / 3600000)}h] ${task.title}`);
      }
    }
  }

  // Recent completed (last 48h)
  const cutoff48h = new Date(now - stuckThresholdMs).toISOString();
  const recentCompleted = tasks
    .filter(t => t.status === 'done' && t.completedAt && t.completedAt >= cutoff48h)
    .map(t => ({
      id: t.id,
      title: t.title,
      completedAt: t.completedAt!,
      commitHash: t.commitHash,
    }));

  // In-progress
  const inProgress = tasks
    .filter(t => t.status === 'in-progress')
    .map(t => ({ id: t.id, title: t.title, priority: t.priority }));

  // In-review
  const inReview = tasks
    .filter(t => t.status === 'review')
    .map(t => ({ id: t.id, title: t.title, priority: t.priority }));

  // Next up (top 3 by priority from todo/backlog)
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const nextUp = tasks
    .filter(t => t.status === 'todo' || t.status === 'backlog')
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99))
    .slice(0, 3)
    .map(t => ({ id: t.id, title: t.title, priority: t.priority }));

  return {
    id: projectId,
    name: formatProjectName(projectId),
    repoUrl,
    activeMilestone,
    blockers: blockerMessages,
    recentCompleted,
    inProgress,
    inReview,
    nextUp,
  };
}

export async function contextRoutes(fastify: FastifyInstance) {
  // GET /api/context — full context for all projects
  fastify.get('/', async (_request, reply) => {
    try {
      const projectIds = await getProjectIds();

      const projectContexts = await Promise.all(
        projectIds.map(id => buildProjectContext(id))
      );

      const projects = projectContexts.filter((p): p is ProjectContext => p !== null);

      // Build summary
      const summary = {
        totalProjects: projects.length,
        tasksInProgress: projects.reduce((sum, p) => sum + p.inProgress.length, 0),
        tasksInReview: projects.reduce((sum, p) => sum + p.inReview.length, 0),
        recentlyCompleted: projects.reduce((sum, p) => sum + p.recentCompleted.length, 0),
        blockers: projects.reduce((sum, p) => sum + p.blockers.length, 0),
      };

      return reply.send({ projects, summary });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build context' });
    }
  });

  // GET /api/context/:projectId — scoped context for a single project
  fastify.get<{ Params: { projectId: string } }>('/:projectId', async (request, reply) => {
    try {
      const { projectId } = request.params;

      // Verify project exists
      try {
        await stat(join(WORKSPACE_PATH, projectId, 'PROJECT.md'));
      } catch {
        return reply.status(404).send({ error: 'Project not found' });
      }

      const context = await buildProjectContext(projectId);
      if (!context) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      return reply.send(context);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build project context' });
    }
  });
}
