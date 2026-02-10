import { FastifyInstance } from 'fastify';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { gatewayClient } from '../gateway-client.js';
import { addAssociation, getProjectAgents, getAllAssociations, updateAssociation, type AgentAssociation } from '../project-agents.js';

// Path to OpenClaw sessions file
const OPENCLAW_DIR = join(process.env.HOME || '', '.openclaw');
const SESSIONS_PATH = join(OPENCLAW_DIR, 'agents/main/sessions/sessions.json');

interface SessionData {
  sessionId: string;
  updatedAt: number;
  model?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  lastChannel?: string;
  chatType?: string;
}

interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'error' | 'offline';
  role?: string;
  task?: string;
  lastActive?: string;
  model?: string;
  provider?: string;
  tokens?: number;
  channel?: string;
}

function parseAgentName(sessionKey: string): { name: string; role: string } {
  // Parse session keys like "agent:main:main", "voice:123", etc.
  const parts = sessionKey.split(':');
  
  if (parts[0] === 'agent' && parts[1] === 'main') {
    const agentName = parts[2] || 'main';
    return {
      name: agentName.charAt(0).toUpperCase() + agentName.slice(1),
      role: agentName === 'main' ? 'Primary Assistant' : 'Agent',
    };
  }
  
  if (parts[0] === 'voice') {
    return {
      name: `Voice (${parts[1]})`,
      role: 'Voice Call Agent',
    };
  }
  
  return {
    name: sessionKey,
    role: 'Agent',
  };
}

function determineStatus(session: SessionData): 'idle' | 'working' | 'error' | 'offline' {
  const now = Date.now();
  const lastUpdate = session.updatedAt;
  const diffMinutes = (now - lastUpdate) / 60000;
  
  // If updated within last 2 minutes, likely working
  if (diffMinutes < 2) return 'working';
  // If updated within last hour, idle
  if (diffMinutes < 60) return 'idle';
  // Otherwise, consider offline
  return 'offline';
}

export async function agentRoutes(fastify: FastifyInstance) {
  // Get all agents from OpenClaw sessions
  fastify.get('/', async (request, reply) => {
    try {
      const sessionsData = await readFile(SESSIONS_PATH, 'utf-8');
      const sessions = JSON.parse(sessionsData) as Record<string, SessionData>;
      
      const agents: Agent[] = [];
      
      for (const [key, session] of Object.entries(sessions)) {
        const { name, role } = parseAgentName(key);
        
        agents.push({
          id: key,
          name,
          role,
          status: determineStatus(session),
          lastActive: new Date(session.updatedAt).toISOString(),
          model: session.model,
          provider: session.modelProvider,
          tokens: session.totalTokens,
          channel: session.lastChannel,
        });
      }
      
      // Sort by last active
      agents.sort((a, b) => {
        const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
        const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
        return bTime - aTime;
      });
      
      return { agents };
    } catch (error) {
      fastify.log.error(error);
      return { agents: [], error: 'Failed to read sessions' };
    }
  });
  
  // Get single agent details
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const sessionsData = await readFile(SESSIONS_PATH, 'utf-8');
      const sessions = JSON.parse(sessionsData) as Record<string, SessionData>;
      
      const session = sessions[id];
      if (!session) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      
      const { name, role } = parseAgentName(id);
      
      return {
        id,
        name,
        role,
        status: determineStatus(session),
        lastActive: new Date(session.updatedAt).toISOString(),
        model: session.model,
        provider: session.modelProvider,
        tokens: session.totalTokens,
        channel: session.lastChannel,
        sessionId: session.sessionId,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch agent' });
    }
  });
  
  // Send message to agent
  fastify.post<{
    Params: { id: string };
    Body: { message: string };
  }>('/:id/message', async (request, reply) => {
    const { id } = request.params;
    const { message } = request.body;

    if (!message) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    try {
      const result = await gatewayClient.request('sessions.send', {
        sessionKey: id,
        message,
      });
      return { success: true, result };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to send message: ${(error as Error).message}` });
    }
  });

  // Spawn a new agent
  fastify.post<{
    Body: {
      task: string;
      label?: string;
      model?: string;
      projectId?: string;
      timeoutSeconds?: number;
    };
  }>('/spawn', async (request, reply) => {
    const { task, label, model, projectId, timeoutSeconds = 300 } = request.body;

    if (!task) {
      return reply.status(400).send({ error: 'Task description is required' });
    }

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    // Build the task with project context if provided
    let fullTask = task;
    if (projectId) {
      fullTask = `You are working on the project "${projectId}". ` +
        `Read the project files in ~/.openclaw/workspace/${projectId}/ for context. ` +
        `Update STATUS.md as you make progress.\n\n` +
        `Task: ${task}`;
    }

    const agentLabel = label || (projectId ? `${projectId}-agent` : undefined);

    try {
      const result = await gatewayClient.request('sessions.spawn', {
        task: fullTask,
        label: agentLabel,
        model,
        runTimeoutSeconds: timeoutSeconds,
        cleanup: 'keep',
      }) as { childSessionKey?: string };

      // Track the association if this is a project agent
      if (projectId && result.childSessionKey) {
        await addAssociation({
          sessionKey: result.childSessionKey,
          projectId,
          task,
          label: agentLabel,
          model,
        });
      }

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to spawn agent: ${(error as Error).message}` });
    }
  });

  // Get agents associated with a project
  fastify.get<{
    Params: { projectId: string };
  }>('/project/:projectId', async (request, reply) => {
    const { projectId } = request.params;
    const agents = getProjectAgents(projectId);
    return { agents };
  });

  // Get all project-agent associations
  fastify.get('/associations', async (request, reply) => {
    const associations = getAllAssociations();
    return { associations };
  });

  // List active subagent sessions
  fastify.get('/subagents', async (request, reply) => {
    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    try {
      const result = await gatewayClient.request('sessions.list', {
        kinds: ['subagent'],
        limit: 50,
        messageLimit: 1,
      });

      return result;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to list subagents: ${(error as Error).message}` });
    }
  });

  // Get agent history
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/:id/history', async (request, reply) => {
    const { id } = request.params;
    const limit = parseInt(request.query.limit || '20');

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    try {
      const result = await gatewayClient.request('sessions.history', {
        sessionKey: id,
        limit,
        includeTools: false,
      });

      return result;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to get history: ${(error as Error).message}` });
    }
  });
}
