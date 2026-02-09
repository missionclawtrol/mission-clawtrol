import { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Path to OpenClaw sessions file
const SESSIONS_PATH = join(process.env.HOME || '', '.openclaw/agents/main/sessions/sessions.json');

interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'error' | 'offline';
  role?: string;
  task?: string;
  lastActive?: string;
}

export async function agentRoutes(fastify: FastifyInstance) {
  // Get all agents
  fastify.get('/', async (request, reply) => {
    try {
      const sessionsData = await readFile(SESSIONS_PATH, 'utf-8');
      const sessions = JSON.parse(sessionsData);
      
      const agents: Agent[] = [];
      
      for (const [key, session] of Object.entries(sessions)) {
        // Parse session key to get agent info
        const parts = key.split(':');
        const agentName = parts[1] || 'unknown';
        
        agents.push({
          id: key,
          name: agentName.charAt(0).toUpperCase() + agentName.slice(1),
          status: 'idle', // TODO: Determine from session data
          role: 'Agent',
          lastActive: new Date((session as any).updatedAt).toISOString(),
        });
      }
      
      return { agents };
    } catch (error) {
      fastify.log.error(error);
      return { agents: [] };
    }
  });
  
  // Get single agent
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const sessionsData = await readFile(SESSIONS_PATH, 'utf-8');
      const sessions = JSON.parse(sessionsData);
      
      const session = sessions[id];
      if (!session) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      
      return {
        id,
        name: id.split(':')[1] || 'unknown',
        status: 'idle',
        session,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch agent' });
    }
  });
  
  // Send message to agent
  fastify.post('/:id/message', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    
    // TODO: Integrate with OpenClaw sessions_send
    fastify.log.info(`Message to ${id}: ${message}`);
    
    return { success: true, message: 'Message queued' };
  });
}
