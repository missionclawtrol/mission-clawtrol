import { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getRawDb } from '../database.js';
import { extractReportChannel } from './projects.js';

const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

function getHumanHourlyRate(): number {
  try {
    const row = getRawDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('humanHourlyRate') as { value: string } | undefined;
    if (row) {
      const parsed = parseFloat(row.value);
      return isNaN(parsed) ? 100 : parsed;
    }
    return 100;
  } catch {
    return 100;
  }
}

async function getProjectReportChannel(projectId: string): Promise<string | null> {
  try {
    const content = await readFile(join(WORKSPACE_PATH, projectId, 'PROJECT.md'), 'utf-8');
    return extractReportChannel(content);
  } catch {
    return null;
  }
}

/** Convert a folder-name id like "mission-clawtrol" → "Mission Clawtrol" */
function formatProjectName(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatROI(humanCost: number, aiCost: number): string {
  if (!aiCost || aiCost === 0) return 'N/A';
  const roi = humanCost / aiCost;
  if (roi >= 1000) {
    return `${(roi / 1000).toFixed(1)}k x`;
  }
  return `${Math.round(roi).toLocaleString()}x`;
}

function buildWeeklyReport(days: number, projectId?: string) {
  const db = getRawDb();
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const fromISO = from.toISOString();

  // ── Shipped ──────────────────────────────────────────────────────────────
  type TaskRow = Record<string, any>;

  const shippedBase = `
    SELECT *
    FROM tasks
    WHERE status = 'done' AND completedAt >= ?
  `;
  const shippedRows = (
    projectId
      ? db.prepare(shippedBase + ' AND projectId = ? ORDER BY completedAt DESC').all(fromISO, projectId)
      : db.prepare(shippedBase + ' ORDER BY completedAt DESC').all(fromISO)
  ) as TaskRow[];

  // Group by project
  const projectMap = new Map<string, { projectId: string; projectName: string; tasks: TaskRow[] }>();
  for (const task of shippedRows) {
    const pid = task.projectId || '__none__';
    if (!projectMap.has(pid)) {
      projectMap.set(pid, {
        projectId: pid,
        projectName: pid === '__none__' ? 'Unassigned' : formatProjectName(pid),
        tasks: [],
      });
    }
    projectMap.get(pid)!.tasks.push(task);
  }
  const shipped = Array.from(projectMap.values()).map(g => ({
    projectId: g.projectId,
    projectName: g.projectName,
    taskCount: g.tasks.length,
    tasks: g.tasks,
  }));

  // ── In Progress ───────────────────────────────────────────────────────────
  const inProgressBase = `SELECT * FROM tasks WHERE status = 'in-progress'`;
  const inProgress = (
    projectId
      ? db.prepare(inProgressBase + ' AND projectId = ? ORDER BY updatedAt DESC').all(projectId)
      : db.prepare(inProgressBase + ' ORDER BY updatedAt DESC').all()
  ) as TaskRow[];

  // ── In Review ─────────────────────────────────────────────────────────────
  const inReviewBase = `SELECT * FROM tasks WHERE status = 'review'`;
  const inReview = (
    projectId
      ? db.prepare(inReviewBase + ' AND projectId = ? ORDER BY updatedAt DESC').all(projectId)
      : db.prepare(inReviewBase + ' ORDER BY updatedAt DESC').all()
  ) as TaskRow[];

  // ── Upcoming ──────────────────────────────────────────────────────────────
  const upcomingBase = `SELECT * FROM tasks WHERE status IN ('todo', 'backlog')`;
  const upcoming = (
    projectId
      ? db
          .prepare(upcomingBase + ' AND projectId = ? ORDER BY priority ASC, createdAt ASC LIMIT 5')
          .all(projectId)
      : db.prepare(upcomingBase + ' ORDER BY priority ASC, createdAt ASC LIMIT 5').all()
  ) as TaskRow[];

  // Annotate with projectName
  const annotate = (rows: TaskRow[]) =>
    rows.map(t => ({
      ...t,
      projectName: t.projectId ? formatProjectName(t.projectId) : 'Unassigned',
    }));

  // ── Costs ─────────────────────────────────────────────────────────────────
  const costBase = `
    SELECT
      COALESCE(SUM(cost), 0)                  as totalAiCost,
      COALESCE(SUM(humanCost), 0)             as totalHumanCost,
      COALESCE(SUM(estimatedHumanMinutes), 0) as totalHumanMinutes,
      COUNT(*)                                as tasksCompleted
    FROM tasks
    WHERE status = 'done' AND completedAt >= ?
  `;
  const costRow = (
    projectId
      ? (db.prepare(costBase + ' AND projectId = ?').get(fromISO, projectId) as any)
      : (db.prepare(costBase).get(fromISO) as any)
  );

  const aiCost = costRow?.totalAiCost || 0;
  const humanCost = costRow?.totalHumanCost || 0;
  const savings = humanCost - aiCost;
  const tasksCompleted = costRow?.tasksCompleted || 0;
  const hoursSaved = Math.max(0, (costRow?.totalHumanMinutes || 0) / 60);
  const roi = formatROI(humanCost, aiCost);

  // ── Milestones ────────────────────────────────────────────────────────────
  const milestoneBase = `
    SELECT m.*,
      COUNT(t.id)                                          as totalTasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)  as doneTasks
    FROM milestones m
    LEFT JOIN tasks t ON t.milestoneId = m.id
    WHERE m.status = 'open'
  `;
  const milestoneRows = (
    projectId
      ? db
          .prepare(milestoneBase + ' AND m.projectId = ? GROUP BY m.id ORDER BY m.targetDate ASC, m.createdAt ASC')
          .all(projectId)
      : db.prepare(milestoneBase + ' GROUP BY m.id ORDER BY m.targetDate ASC, m.createdAt ASC').all()
  ) as any[];

  const milestones = milestoneRows.map((m: any) => ({
    ...m,
    totalTasks: m.totalTasks || 0,
    doneTasks: m.doneTasks || 0,
    progress: m.totalTasks > 0 ? Math.round((m.doneTasks / m.totalTasks) * 100) : 0,
  }));

  // ── Flags ─────────────────────────────────────────────────────────────────
  const flags: string[] = [];
  const todayStr = now.toISOString().split('T')[0];

  for (const m of milestones) {
    if (m.targetDate && m.targetDate < todayStr) {
      flags.push(`Milestone '${m.name}' is overdue (target: ${m.targetDate})`);
    }
  }

  const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  for (const task of inReview) {
    if (task.updatedAt && task.updatedAt < staleCutoff) {
      const staleDays = Math.floor(
        (now.getTime() - new Date(task.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
      );
      flags.push(
        `Task '${task.title}' stale in review for ${staleDays} day${staleDays !== 1 ? 's' : ''}`
      );
    }
  }

  return {
    period: { from: fromISO, to: now.toISOString(), days },
    projectId: projectId || null,
    shipped,
    inProgress: annotate(inProgress),
    inReview: annotate(inReview),
    upcoming: annotate(upcoming),
    costs: { aiCost, humanCost, savings, roi, hoursSaved, tasksCompleted },
    milestones,
    flags,
  };
}

function buildSlackBlocks(
  report: ReturnType<typeof buildWeeklyReport>,
  projectName?: string
): any[] {
  const { period, shipped, inProgress, inReview, upcoming, costs, milestones, flags } = report;

  const fromLabel = new Date(period.from).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const toLabel = new Date(period.to).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const totalShipped = shipped.reduce((s, g) => s + g.taskCount, 0);
  const headerTitle = projectName
    ? `📊 ${projectName} — Weekly Report: ${fromLabel}–${toLabel}`
    : `📊 Weekly Report — ${fromLabel}–${toLabel}`;

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: headerTitle, emoji: true } },
    { type: 'divider' },
  ];

  // Shipped
  const shippedLines =
    shipped
      .map(g => `• *${g.projectName}* — ${g.taskCount} task${g.taskCount !== 1 ? 's' : ''}`)
      .join('\n') || '_None shipped in this period_';
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `✅ *Shipped* (${totalShipped} task${totalShipped !== 1 ? 's' : ''})\n${shippedLines}`,
    },
  });

  // In Progress
  if (inProgress.length > 0) {
    const ipLines = inProgress
      .slice(0, 10)
      .map((t: any) => `• ${t.title}${t.agentId ? ` — ${t.agentId}` : ''}`)
      .join('\n');
    const more = inProgress.length > 10 ? `\n_…and ${inProgress.length - 10} more_` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔄 *In Progress* (${inProgress.length})\n${ipLines}${more}`,
      },
    });
  }

  // In Review
  if (inReview.length > 0) {
    const rvLines = inReview
      .slice(0, 5)
      .map((t: any) => `• ${t.title}${t.agentId ? ` — ${t.agentId}` : ''}`)
      .join('\n');
    const more = inReview.length > 5 ? `\n_…and ${inReview.length - 5} more_` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👀 *In Review* (${inReview.length})\n${rvLines}${more}`,
      },
    });
  }

  // Numbers
  const costLine = [
    `AI cost: $${costs.aiCost.toFixed(2)}`,
    `Human savings: $${costs.humanCost.toFixed(0)}`,
    `ROI: ${costs.roi}`,
    `Hours saved: ${Math.round(costs.hoursSaved)}`,
  ].join('  |  ');
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `💰 *Numbers*\n• ${costLine}` },
  });

  // Milestones
  if (milestones.length > 0) {
    const mLines = milestones
      .slice(0, 5)
      .map((m: any) => {
        const target = m.targetDate ? ` — target ${m.targetDate}` : '';
        return `• ${m.name} — ${m.doneTasks}/${m.totalTasks} tasks (${m.progress}%)${target}`;
      })
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🎯 *Milestones*\n${mLines}` },
    });
  }

  // Up next
  if (upcoming.length > 0) {
    const upLines = upcoming
      .map(
        (t: any) =>
          `• [P${t.priority ?? '?'}] ${t.title}${t.projectName ? ` — ${t.projectName}` : ''}`
      )
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `📋 *Up next*\n${upLines}` },
    });
  }

  // Flags
  if (flags.length > 0) {
    const flagLines = flags.map(f => `⚠️ ${f}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🚩 *Flags*\n${flagLines}` },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Generated by Mission Clawtrol • ${new Date().toLocaleString()}` },
    ],
  });

  return blocks;
}

export async function reportRoutes(fastify: FastifyInstance) {
  // GET /api/reports/weekly?days=7&projectId=mission-clawtrol
  fastify.get<{ Querystring: { days?: string; projectId?: string } }>(
    '/weekly',
    async (request, reply) => {
      try {
        const days = Math.min(
          Math.max(parseInt(request.query.days || '7', 10) || 7, 1),
          90
        );
        const { projectId } = request.query;
        const report = buildWeeklyReport(days, projectId || undefined);
        return report;
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate weekly report' });
      }
    }
  );

  // POST /api/reports/weekly/send
  // Body: { channelId?, projectId?, days? }
  // Channel resolution: body.channelId → PROJECT.md **Report Channel:** → error
  fastify.post<{ Body: { channelId?: string; projectId?: string; days?: number } }>(
    '/weekly/send',
    async (request, reply) => {
      try {
        const { channelId: bodyChannel, projectId, days = 7 } = request.body || {};

        // Resolve channel ID
        let channelId = bodyChannel;
        if (!channelId && projectId) {
          channelId = (await getProjectReportChannel(projectId)) || undefined;
        }

        if (!channelId) {
          const hint = projectId
            ? `No Report Channel configured for project '${projectId}'. Add \`**Report Channel:** C0XXXXXXX\` to ${projectId}/PROJECT.md.`
            : 'No channelId provided and no projectId given. Provide a channelId directly, or a projectId that has **Report Channel:** set in its PROJECT.md.';
          return reply.status(400).send({ error: hint });
        }

        const slackToken = process.env.SLACK_BOT_TOKEN;
        if (!slackToken) {
          return reply
            .status(500)
            .send({ error: 'SLACK_BOT_TOKEN environment variable is not set' });
        }

        const report = buildWeeklyReport(days, projectId || undefined);
        const projectName = projectId ? formatProjectName(projectId) : undefined;
        const blocks = buildSlackBlocks(report, projectName);

        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${slackToken}`,
          },
          body: JSON.stringify({
            channel: channelId,
            blocks,
            text: `📊 Weekly Report${projectName ? ` — ${projectName}` : ''} • ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          }),
        });

        const data = (await res.json()) as any;
        if (!data.ok) {
          fastify.log.error('Slack API error:', data.error);
          return reply.status(502).send({ error: `Slack API error: ${data.error}` });
        }

        return { ok: true, ts: data.ts };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to send report to Slack' });
      }
    }
  );
}
