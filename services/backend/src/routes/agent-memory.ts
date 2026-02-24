/**
 * Agent Memory API — GET /api/agent/:id/memory
 *
 * Assembles procedural, semantic, episodic, and prospective memory
 * for agent spawn injection. Part of Phase 2 of the Agent Memory Architecture.
 *
 * Query params:
 *   taskId    — (optional) the task being worked on, scopes episodic/prospective
 *   projectId — (optional) the project context; used for project-scoped memory
 *
 * See docs/AGENT-MEMORY-ARCHITECTURE.md for full specification.
 */

import { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getAgentDefinition } from '../config-reader.js';
import { getAllRules } from '../rule-store.js';
import { db } from '../database.js';

const HOME = process.env.HOME || '/root';
const BUSINESS_DIR = join(HOME, '.openclaw', 'business');
const WORKSPACE_PATH = join(HOME, '.openclaw', 'workspace');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Procedural Memory ────────────────────────────────────────────────────────

interface ProceduralMemory {
  role: string | null;         // SOUL.md content
  rules: string;               // AGENTS.md content
  activeRules: Array<{         // DB rules for this agent/project
    id: string;
    name: string;
    trigger: string;
    enabled: boolean;
    isBuiltIn: boolean;
  }>;
  workflows: {
    sessionStart: {
      fetchContext: string;
      instruction: string;
    };
    taskCreationWorkflow: {
      description: string;
      steps: string[];
      warnings: string[];
    };
    doneCriteria: Record<string, any>;
    heartbeatChecklist: Record<string, any>;
    agentGuidelines: Record<string, any>;
  };
}

async function buildProceduralMemory(
  agentWorkspace: string,
  projectId?: string
): Promise<ProceduralMemory> {
  // Read SOUL.md (agent identity and standards)
  const soulMd = await readFileSafe(join(agentWorkspace, 'SOUL.md'));

  // Read AGENTS.md (operating rules)
  const agentsMd = await readFileSafe(join(agentWorkspace, 'AGENTS.md'));

  // Get enabled rules from DB, scoped to this project (global rules always included)
  const allRules = await getAllRules();
  const relevantRules = allRules
    .filter(r => r.enabled && (r.projectId === null || r.projectId === (projectId || null)))
    .map(r => ({
      id: r.id,
      name: r.name,
      trigger: r.trigger,
      enabled: r.enabled,
      isBuiltIn: r.isBuiltIn,
    }));

  // Inline workflow rules (same as /api/workflow)
  const workflows = {
    sessionStart: {
      fetchContext: 'GET http://localhost:3001/api/context',
      instruction: 'On every session start, fetch /api/context to orient yourself on active projects, recent work, and blockers before doing anything else.',
    },
    taskCreationWorkflow: {
      description: 'MANDATORY steps when creating any task',
      steps: [
        'Create task in DB with status: todo',
        'Spawn the agent session',
        'Immediately update task with agentId, sessionKey, status: in-progress, and model',
        'Let the agent work',
        'Agent moves task to review when done',
      ],
      warnings: [
        'NEVER spawn an agent without linking the session to the task immediately',
        'ALWAYS include model in the in-progress PATCH',
      ],
    },
    doneCriteria: {
      description: 'Done criteria depend on task type',
      byType: {
        development: {
          description: 'Code tasks — full dev workflow',
          required: [
            'Files changed — list of files modified',
            'How tested — what testing was done',
            'Edge cases / risks — known limitations',
            'Rollback plan — how to undo the change',
            'Commit hash — git commit hash',
          ],
        },
        bug: {
          description: 'Bug fixes — full dev workflow',
          required: [
            'Root cause — what caused the bug',
            'Files changed — list of files modified',
            'How tested — how the fix was verified',
            'Commit hash — git commit hash',
          ],
        },
        default: {
          description: 'All other tasks (research, writing, design, analysis, general)',
          required: [
            'What was delivered — the actual output',
            'Where to find it — file location or link',
            'Summary — plain English explanation of what was done',
            'Next steps — what the user should do with this',
          ],
        },
      },
    },
    heartbeatChecklist: {
      description: 'Checks to perform on each heartbeat',
      steps: [
        'GET /api/tasks?status=review — check each against done criteria, move to done if met, back to in-progress if not',
        'GET /api/tasks?status=in-progress — ping assigned agents for status, note blockers',
        'Enforce WIP limit: flag any agent with more than 2 in-progress tasks',
      ],
      periodicChecks: ['email inbox', 'calendar upcoming events'],
    },
    agentGuidelines: {
      wipLimit: 2,
      delegation: {
        'builder (Elon)': 'Websites, apps, automations, integrations, technical solutions',
        'researcher (Marie)': 'Market research, competitor analysis, data gathering, evaluations',
        'writer (Ernest)': 'Blog posts, emails, proposals, marketing copy, documentation',
        'analyst (Warren)': 'Spreadsheets, financial analysis, data interpretation, reports',
        'designer (Steve)': 'Logos, branding, presentations, visual assets',
      },
    },
  };

  return {
    role: soulMd,
    rules: agentsMd || '',
    activeRules: relevantRules,
    workflows,
  };
}

// ── Semantic Memory ──────────────────────────────────────────────────────────

interface CompanyProfile {
  companyName?: string;
  industry?: string;
  whatYouDo?: string;
  targetCustomers?: string;
  missionValues?: string;
  websiteUrl?: string;
  teamSize?: string;
  goalsAndChallenges?: string;
  tools?: Array<{ name: string; url: string; purpose: string }>;
}

interface SemanticMemory {
  company: {
    profile: CompanyProfile | null;
    profileMd: string | null;    // PROFILE.md (human-readable version)
  };
  project: {
    context: string | null;      // PROJECT.md content
  };
  learned: string | null;        // LEARNED.md — agent's cheat sheet
  agentTraining: string | null;  // /business/agents/:agentId/TRAINING.md
}

async function buildSemanticMemory(
  agentId: string,
  agentWorkspace: string,
  projectId?: string
): Promise<SemanticMemory> {
  // Company profile (structured JSON + markdown)
  const companyProfile = await readJsonSafe<CompanyProfile>(join(BUSINESS_DIR, 'PROFILE.json'));
  const companyProfileMd = await readFileSafe(join(BUSINESS_DIR, 'PROFILE.md'));

  // Project context (PROJECT.md from project workspace)
  let projectContext: string | null = null;
  if (projectId) {
    projectContext = await readFileSafe(join(WORKSPACE_PATH, projectId, 'PROJECT.md'));
  }

  // Agent's cheat sheet (LEARNED.md from agent workspace)
  const learnedMd = await readFileSafe(join(agentWorkspace, 'LEARNED.md'));

  // Agent-specific business training
  const agentTrainingMd = await readFileSafe(
    join(BUSINESS_DIR, 'agents', agentId, 'TRAINING.md')
  );

  return {
    company: {
      profile: companyProfile,
      profileMd: companyProfileMd,
    },
    project: {
      context: projectContext,
    },
    learned: learnedMd,
    agentTraining: agentTrainingMd,
  };
}

// ── Episodic Memory ──────────────────────────────────────────────────────────

interface EpisodicTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string | null;
  completedAt: string | null;
  updatedAt: string;
  handoffNotes: string | null;
}

interface EpisodicMemory {
  myRecentTasks: EpisodicTask[];          // Last 10 tasks done by this agent
  projectRecentTasks: EpisodicTask[];     // Last 5 tasks done on this project
  failures: EpisodicTask[];               // Failed/cancelled tasks on this project
}

async function buildEpisodicMemory(
  agentId: string,
  projectId?: string,
  limit = 10
): Promise<EpisodicMemory> {
  // Last N tasks completed by this agent
  const myRecentTasks = await db.query<EpisodicTask>(
    `SELECT id, title, status, priority, projectId, completedAt, updatedAt, handoffNotes
     FROM tasks
     WHERE agentId = ? AND status = 'done'
     ORDER BY completedAt DESC, updatedAt DESC
     LIMIT ?`,
    [agentId, limit]
  );

  // Last 5 tasks completed on this project by anyone
  let projectRecentTasks: EpisodicTask[] = [];
  if (projectId) {
    projectRecentTasks = await db.query<EpisodicTask>(
      `SELECT id, title, status, priority, projectId, completedAt, updatedAt, handoffNotes
       FROM tasks
       WHERE projectId = ? AND status = 'done'
       ORDER BY completedAt DESC, updatedAt DESC
       LIMIT 5`,
      [projectId]
    );
  }

  // Failed/cancelled tasks on this project (lessons learned)
  let failures: EpisodicTask[] = [];
  if (projectId) {
    failures = await db.query<EpisodicTask>(
      `SELECT id, title, status, priority, projectId, completedAt, updatedAt, handoffNotes
       FROM tasks
       WHERE projectId = ? AND status IN ('cancelled')
       ORDER BY updatedAt DESC
       LIMIT 5`,
      [projectId]
    );
  }

  return {
    myRecentTasks,
    projectRecentTasks,
    failures,
  };
}

// ── Prospective Memory ───────────────────────────────────────────────────────

interface ProspectiveTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string | null;
}

interface ProspectiveMemory {
  pendingDependencies: ProspectiveTask[];  // Tasks blocked / waiting for something
  upcoming: ProspectiveTask[];             // Next todo tasks for this project
}

async function buildProspectiveMemory(
  agentId: string,
  projectId?: string
): Promise<ProspectiveMemory> {
  // Tasks explicitly blocked (waiting on something)
  let pendingDependencies: ProspectiveTask[] = [];
  if (projectId) {
    pendingDependencies = await db.query<ProspectiveTask>(
      `SELECT id, title, status, priority, projectId
       FROM tasks
       WHERE projectId = ? AND (status = 'blocked' OR blocked = 1)
       ORDER BY priority ASC, updatedAt DESC
       LIMIT 5`,
      [projectId]
    );
  }

  // Upcoming todo/backlog tasks for this project (next up)
  let upcoming: ProspectiveTask[] = [];
  if (projectId) {
    upcoming = await db.query<ProspectiveTask>(
      `SELECT id, title, status, priority, projectId
       FROM tasks
       WHERE projectId = ? AND status IN ('todo', 'backlog') AND agentId = ?
       ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 99 END ASC,
                createdAt ASC
       LIMIT 5`,
      [projectId, agentId]
    );

    // If no agent-assigned tasks, get any unassigned tasks
    if (upcoming.length === 0) {
      upcoming = await db.query<ProspectiveTask>(
        `SELECT id, title, status, priority, projectId
         FROM tasks
         WHERE projectId = ? AND status IN ('todo', 'backlog')
         ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 99 END ASC,
                  createdAt ASC
         LIMIT 5`,
        [projectId]
      );
    }
  }

  return {
    pendingDependencies,
    upcoming,
  };
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function agentMemoryRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/agent/:id/memory
   *
   * Assembles all non-ephemeral memory types for an agent, scoped to an optional
   * task and project. Designed for spawn injection — call this when building
   * the initial task prompt.
   *
   * Query params:
   *   taskId    — optional task ID being worked on
   *   projectId — optional project scope (falls back to task's projectId if taskId given)
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { taskId?: string; projectId?: string };
  }>('/:id/memory', async (request, reply) => {
    const { id: agentId } = request.params;
    let { taskId, projectId } = request.query;

    // Resolve agent definition (workspace path etc.)
    const agentDef = await getAgentDefinition(agentId);
    if (!agentDef) {
      return reply.status(404).send({
        error: `Agent '${agentId}' not found. Check your openclaw.json agent list.`,
      });
    }

    const agentWorkspace = agentDef.workspace;

    // If taskId given but no projectId, try to resolve projectId from task
    if (taskId && !projectId) {
      try {
        const taskRow = await db.queryOne<{ projectId: string | null }>(
          'SELECT projectId FROM tasks WHERE id = ?',
          [taskId]
        );
        if (taskRow?.projectId) {
          projectId = taskRow.projectId;
        }
      } catch (err) {
        fastify.log.warn({ taskId, err }, 'Failed to resolve projectId from task');
      }
    }

    try {
      // Assemble all memory types in parallel
      const [procedural, semantic, episodic, prospective] = await Promise.all([
        buildProceduralMemory(agentWorkspace, projectId),
        buildSemanticMemory(agentId, agentWorkspace, projectId),
        buildEpisodicMemory(agentId, projectId),
        buildProspectiveMemory(agentId, projectId),
      ]);

      return reply.send({
        agentId,
        taskId: taskId || null,
        projectId: projectId || null,
        assembledAt: new Date().toISOString(),
        procedural,
        semantic,
        episodic,
        prospective,
      });
    } catch (err) {
      fastify.log.error({ agentId, taskId, projectId, err }, 'Failed to assemble agent memory');
      return reply.status(500).send({ error: 'Failed to assemble agent memory' });
    }
  });

  /**
   * GET /api/agent/overview
   *
   * Returns memory health summary for ALL agents — used by the HICMS Memory Dashboard.
   * Aggregates procedural, semantic, episodic, short-term, and prospective stats per agent.
   *
   * Returns:
   *   agents: Array of per-agent memory health snapshots
   *   assembledAt: ISO timestamp
   */
  fastify.get('/overview', async (request, reply) => {
    // Import readConfig here to avoid circular deps at module top
    const { readConfig } = await import('../config-reader.js');
    const config = await readConfig();
    const agentList = config.agents?.list ?? [];

    // Load company profile to check if it exists
    const companyProfile = await readJsonSafe<Record<string, any>>(
      join(HOME, '.openclaw', 'business', 'PROFILE.json')
    );
    const companyLoaded = !!companyProfile && !!companyProfile.companyName;

    // Build per-agent health in parallel
    const agentHealthItems = await Promise.all(
      agentList.map(async (agentDef) => {
        const agentId = agentDef.id;
        const workspace = agentDef.workspace;

        // ── Procedural ────────────────────────────────────────────
        const soulExists = !!(await readFileSafe(join(workspace, 'SOUL.md')));
        const agentsMdExists = !!(await readFileSafe(join(workspace, 'AGENTS.md')));

        const allRules = await getAllRules();
        const activeRulesCount = allRules.filter(
          (r) => r.enabled && (r.projectId === null || r.projectId === undefined)
        ).length;

        // ── Semantic ──────────────────────────────────────────────
        const learnedContent = await readFileSafe(join(workspace, 'LEARNED.md'));
        let learnedEntries = 0;
        let learnedLastUpdated: string | null = null;

        if (learnedContent) {
          // Count ## heading entries as "entries" in LEARNED.md
          learnedEntries = (learnedContent.match(/^##\s+/gm) || []).length;
          // If no ## entries, count non-empty lines as rough proxy
          if (learnedEntries === 0) {
            learnedEntries = learnedContent.split('\n').filter(l => l.trim().length > 0).length;
          }
        }

        // Get LEARNED.md last modified time
        try {
          const stat = await fs.stat(join(workspace, 'LEARNED.md'));
          learnedLastUpdated = stat.mtime.toISOString();
        } catch {
          learnedLastUpdated = null;
        }

        // ── Episodic ──────────────────────────────────────────────
        const completedTasks = await db.query<{ id: string; completedAt: string | null }>(
          `SELECT id, completedAt FROM tasks WHERE agentId = ? AND status = 'done' ORDER BY completedAt DESC`,
          [agentId]
        );
        const failedTasks = await db.query<{ id: string }>(
          `SELECT id FROM tasks WHERE agentId = ? AND status IN ('cancelled', 'failed')`,
          [agentId]
        );

        const completedCount = completedTasks.length;
        const failedCount = failedTasks.length;

        // ── Short-term ────────────────────────────────────────────
        // Check agent sessions directory for active sessions
        let sessionStatus: 'active' | 'idle' | 'offline' = 'offline';
        let tokenEstimate: number | null = null;

        try {
          const sessionsDir = join(HOME, '.openclaw', 'agents', agentId, 'sessions');
          const sessionDirs = await fs.readdir(sessionsDir).catch(() => []);

          if (sessionDirs.length > 0) {
            // Check the most recent session
            const sessionMetas = await Promise.all(
              sessionDirs.slice(-3).map(async (dir) => {
                const metaPath = join(sessionsDir, dir, 'metadata.json');
                return readJsonSafe<{ status?: string; tokens?: number }>(metaPath);
              })
            );
            const activeMeta = sessionMetas.find((m) => m?.status === 'active');
            if (activeMeta) {
              sessionStatus = 'active';
              tokenEstimate = activeMeta.tokens ?? null;
            } else {
              sessionStatus = 'idle';
            }
          }
        } catch {
          sessionStatus = 'offline';
        }

        // Also cross-check with active sessions from the DB / live sessions
        // We'll rely on the workspace sessions for now

        // ── Prospective ───────────────────────────────────────────
        const pendingDeps = await db.query<{ id: string }>(
          `SELECT id FROM tasks WHERE agentId = ? AND (status = 'blocked' OR blocked = 1)`,
          [agentId]
        );
        const scheduledItems = await db.query<{ id: string }>(
          `SELECT id FROM tasks WHERE agentId = ? AND status IN ('todo', 'backlog')`,
          [agentId]
        );

        const pendingCount = pendingDeps.length;
        const scheduledCount = scheduledItems.length;

        // ── Learning Rate ─────────────────────────────────────────
        // = (tasks that preceded a LEARNED.md update) / total done × 100
        // Simplified v1: learnedEntries / completedCount × 100, capped at 100
        let learningRate = 0;
        if (completedCount > 0 && learnedEntries > 0) {
          learningRate = Math.min(100, Math.round((learnedEntries / completedCount) * 100));
        }

        return {
          agentId,
          name: agentDef.name,
          emoji: agentDef.identity?.emoji ?? '🤖',
          procedural: {
            soulExists,
            agentsMdExists,
            activeRulesCount,
            healthy: soulExists && agentsMdExists,
          },
          semantic: {
            learnedEntries,
            learnedLastUpdated,
            companyLoaded,
            healthy: learnedEntries > 0 && companyLoaded,
          },
          episodic: {
            completedCount,
            failedCount,
            healthy: completedCount > 0,
          },
          shortTerm: {
            sessionStatus,
            tokenEstimate,
            healthy: sessionStatus === 'active',
          },
          prospective: {
            pendingCount,
            scheduledCount,
            healthy: pendingCount === 0,
          },
          learningRate,
        };
      })
    );

    return reply.send({
      agents: agentHealthItems,
      assembledAt: new Date().toISOString(),
    });
  });
}
