import { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { join } from 'path';

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
  
  // Send message to agent (placeholder - needs OpenClaw integration)
  fastify.post('/:id/message', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    
    // TODO: Integrate with OpenClaw sessions_send
    fastify.log.info(`Message to ${id}: ${message}`);
    
    return { success: true, message: 'Message queued (integration pending)' };
  });
}
