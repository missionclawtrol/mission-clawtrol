import { FastifyInstance } from 'fastify';
import { db } from '../database';

interface CostSummary {
  totalTasks: number;
  totalLines: number;
  totalAiCost: number;
  totalHumanCost: number;
  totalAiSeconds: number;
  totalHumanMinutes: number;
  netSavings: number;
  hoursSaved: number;
}

interface AgentCost {
  agentId: string;
  tasks: number;
  lines: number;
  aiCost: number;
  humanCost: number;
  savings: number;
}

interface ProjectCost {
  projectId: string;
  tasks: number;
  lines: number;
  aiCost: number;
  humanCost: number;
  savings: number;
}

interface TimeSeriesPoint {
  date: string;
  tasks: number;
  lines: number;
  aiCost: number;
  humanCost: number;
  savings: number;
}

/**
 * Get the human hourly rate from settings
 */
function getHumanHourlyRate(): number {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('humanHourlyRate') as { value: string } | undefined;
    if (row) {
      const parsed = parseFloat(row.value);
      return isNaN(parsed) ? 100 : parsed;
    }
    return 100;
  } catch {
    return 100;
  }
}

export async function costRoutes(fastify: FastifyInstance) {
  // GET /api/costs/summary - Overall statistics
  fastify.get<{}>('/summary', async (request, reply) => {
    try {
      const humanHourlyRate = getHumanHourlyRate();
      
      // Get completed tasks with cost data
      const rows = db.prepare(`
        SELECT 
          COUNT(*) as totalTasks,
          COALESCE(SUM(linesAdded), 0) + COALESCE(SUM(linesRemoved), 0) as totalLines,
          COALESCE(SUM(cost), 0) as totalAiCost,
          COALESCE(SUM(estimatedHumanMinutes), 0) as totalHumanMinutes,
          COALESCE(SUM(humanCost), 0) as totalHumanCost,
          COALESCE(SUM(runtime), 0) as totalAiSeconds
        FROM tasks 
        WHERE status = 'done' AND cost IS NOT NULL
      `).get() as any;

      const totalAiSeconds = rows?.totalAiSeconds || 0;
      const totalHumanMinutes = rows?.totalHumanMinutes || 0;
      const totalAiCost = rows?.totalAiCost || 0;
      const totalHumanCost = rows?.totalHumanCost || 0;
      
      // Calculate time saved in minutes - AI time vs human estimate
      const aiMinutes = totalAiSeconds / 60;
      const timeSavedMinutes = totalHumanMinutes - aiMinutes;
      const hoursSaved = timeSavedMinutes / 60;
      
      // Net savings = human cost - AI cost
      const netSavings = totalHumanCost - totalAiCost;

      const summary: CostSummary = {
        totalTasks: rows?.totalTasks || 0,
        totalLines: rows?.totalLines || 0,
        totalAiCost,
        totalHumanCost,
        totalAiSeconds,
        totalHumanMinutes,
        netSavings,
        hoursSaved: Math.max(0, hoursSaved),
      };

      return summary;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load cost summary' });
    }
  });

  // GET /api/costs/by-agent - Breakdown by agent
  fastify.get<{}>('/by-agent', async (request, reply) => {
    try {
      const rows = db.prepare(`
        SELECT 
          agentId,
          COUNT(*) as tasks,
          COALESCE(SUM(linesAdded), 0) + COALESCE(SUM(linesRemoved), 0) as lines,
          COALESCE(SUM(cost), 0) as aiCost,
          COALESCE(SUM(humanCost), 0) as humanCost
        FROM tasks 
        WHERE status = 'done' AND cost IS NOT NULL AND agentId IS NOT NULL
        GROUP BY agentId
      `).all() as any[];

      const agents: AgentCost[] = rows.map(row => ({
        agentId: row.agentId,
        tasks: row.tasks || 0,
        lines: row.lines || 0,
        aiCost: row.aiCost || 0,
        humanCost: row.humanCost || 0,
        savings: (row.humanCost || 0) - (row.aiCost || 0),
      }));

      return { agents };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load costs by agent' });
    }
  });

  // GET /api/costs/by-project - Breakdown by project
  fastify.get<{}>('/by-project', async (request, reply) => {
    try {
      const rows = db.prepare(`
        SELECT 
          projectId,
          COUNT(*) as tasks,
          COALESCE(SUM(linesAdded), 0) + COALESCE(SUM(linesRemoved), 0) as lines,
          COALESCE(SUM(cost), 0) as aiCost,
          COALESCE(SUM(humanCost), 0) as humanCost
        FROM tasks 
        WHERE status = 'done' AND cost IS NOT NULL AND projectId IS NOT NULL
        GROUP BY projectId
      `).all() as any[];

      const projects: ProjectCost[] = rows.map(row => ({
        projectId: row.projectId,
        tasks: row.tasks || 0,
        lines: row.lines || 0,
        aiCost: row.aiCost || 0,
        humanCost: row.humanCost || 0,
        savings: (row.humanCost || 0) - (row.aiCost || 0),
      }));

      return { projects };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load costs by project' });
    }
  });

  // GET /api/costs/over-time - Time series data
  fastify.get<{
    Querystring: { period?: string };
  }>('/over-time', async (request, reply) => {
    try {
      const { period = 'day' } = request.query;
      
      let dateFormat: string;
      let dateRange: string;
      
      switch (period) {
        case 'week':
          dateFormat = '%Y-%W';
          dateRange = "strftime('%Y-%m-%d', completedAt, '-7 days')";
          break;
        case 'month':
          dateFormat = '%Y-%m';
          dateRange = "strftime('%Y-%m-%d', completedAt, '-30 days')";
          break;
        case 'day':
        default:
          dateFormat = '%Y-%m-%d';
          dateRange = "strftime('%Y-%m-%d', completedAt, '-7 days')";
          break;
      }

      // For daily view, get last 7 days
      const rows = db.prepare(`
        SELECT 
          strftime('${dateFormat}', completedAt) as date,
          COUNT(*) as tasks,
          COALESCE(SUM(linesAdded), 0) + COALESCE(SUM(linesRemoved), 0) as lines,
          COALESCE(SUM(cost), 0) as aiCost,
          COALESCE(SUM(humanCost), 0) as humanCost
        FROM tasks 
        WHERE status = 'done' 
          AND cost IS NOT NULL 
          AND completedAt IS NOT NULL
          AND completedAt >= date('now', '-7 days')
        GROUP BY strftime('${dateFormat}', completedAt)
        ORDER BY date ASC
      `).all() as any[];

      const timeSeries: TimeSeriesPoint[] = rows.map(row => ({
        date: row.date,
        tasks: row.tasks || 0,
        lines: row.lines || 0,
        aiCost: row.aiCost || 0,
        humanCost: row.humanCost || 0,
        savings: (row.humanCost || 0) - (row.aiCost || 0),
      }));

      return { timeSeries, period };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load time series data' });
    }
  });

  // GET /api/costs/recent - Recent completed tasks
  fastify.get<{
    Querystring: { limit?: string };
  }>('/recent', async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit || '10', 10);
      
      const rows = db.prepare(`
        SELECT 
          id,
          title,
          agentId,
          projectId,
          model,
          cost,
          runtime,
          humanCost,
          estimatedHumanMinutes,
          linesAdded,
          linesRemoved,
          linesTotal,
          completedAt
        FROM tasks 
        WHERE status = 'done' AND cost IS NOT NULL
        ORDER BY completedAt DESC
        LIMIT ?
      `).all(limit) as any[];

      const tasks = rows.map(row => ({
        id: row.id,
        title: row.title,
        agentId: row.agentId,
        projectId: row.projectId,
        model: row.model,
        cost: row.cost,
        runtime: row.runtime,
        humanCost: row.humanCost,
        estimatedHumanMinutes: row.estimatedHumanMinutes,
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        linesTotal: row.linesTotal,
        completedAt: row.completedAt,
        savings: (row.humanCost || 0) - (row.cost || 0),
      }));

      return { tasks };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load recent tasks' });
    }
  });
}
