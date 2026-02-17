import { FastifyInstance } from 'fastify';
import { readFile, readdir, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { gatewayClient } from '../gateway-client.js';
import { addAssociation, getProjectAgents, getAllAssociations, updateAssociation, removeAssociation, type AgentAssociation } from '../project-agents.js';
import { db } from '../database.js';
import { getAgentDefinitions, type AgentDefinition } from '../config-reader.js';
import { updateTask, findTaskById } from '../task-store.js';

// Helper to update model in sessions.json
async function updateSessionModel(sessionKey: string, model: string): Promise<boolean> {
  try {
    const sessionsPath = join(process.env.HOME || '', '.openclaw/agents/main/sessions/sessions.json');
    const data = await readFile(sessionsPath, 'utf-8');
    const sessions = JSON.parse(data);
    
    if (sessions[sessionKey]) {
      sessions[sessionKey].model = model;
      await writeFile(sessionsPath, JSON.stringify(sessions, null, 2));
      return true;
    }
    return false;
  } catch (err) {
    console.error('[updateSessionModel] Failed:', err);
    return false;
  }
}

// Helper to delete session from sessions.json
async function deleteSessionFromFile(sessionKey: string): Promise<boolean> {
  try {
    const sessionsPath = join(process.env.HOME || '', '.openclaw/agents/main/sessions/sessions.json');
    const data = await readFile(sessionsPath, 'utf-8');
    const sessions = JSON.parse(data);
    
    if (sessions[sessionKey]) {
      delete sessions[sessionKey];
      await writeFile(sessionsPath, JSON.stringify(sessions, null, 2));
      return true;
    }
    return false;
  } catch (err) {
    console.error('[deleteSessionFromFile] Failed:', err);
    return false;
  }
}

// Helper to create a new session entry in sessions.json
async function createSessionEntry(sessionKey: string, model: string): Promise<boolean> {
  try {
    const sessionsPath = join(process.env.HOME || '', '.openclaw/agents/main/sessions/sessions.json');
    const data = await readFile(sessionsPath, 'utf-8');
    const sessions = JSON.parse(data);
    
    // Create new session entry with the specified model
    sessions[sessionKey] = {
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      updatedAt: Date.now(),
      model: model,
      totalTokens: 0,
      contextTokens: 200000,
    };
    
    await writeFile(sessionsPath, JSON.stringify(sessions, null, 2));
    return true;
  } catch (err) {
    console.error('[createSessionEntry] Failed:', err);
    return false;
  }
}
import { logSpawnEvent, logErrorEvent } from './activity.js';

// Path to OpenClaw sessions file
const OPENCLAW_DIR = join(process.env.HOME || '', '.openclaw');
const SESSIONS_PATH = join(OPENCLAW_DIR, 'agents/main/sessions/sessions.json');

interface SessionData {
  sessionId: string;
  updatedAt: number;
  model?: string;
  modelProvider?: string;
  modelOverride?: string;
  providerOverride?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  lastChannel?: string;
  chatType?: string;
  label?: string;
}

interface Agent {
  id: string;
  name: string;
  label?: string;
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
  // Parse session keys like "agent:main:main", "agent:main:subagent:name:timestamp", "voice:123", etc.
  const parts = sessionKey.split(':');
  
  if (parts[0] === 'agent' && parts[1] === 'main') {
    // Check if it's a subagent: agent:main:subagent:name:timestamp
    if (parts[2] === 'subagent' && parts[3]) {
      const subagentName = parts[3];
      return {
        name: subagentName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        role: 'Subagent',
      };
    }
    
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
  // Get agent roster from config with session status
  fastify.get('/roster', async (request, reply) => {
    try {
      const agentDefs = await getAgentDefinitions();
      const OPENCLAW_DIR = join(process.env.HOME || '', '.openclaw');
      
      const roster = await Promise.all(
        agentDefs.map(async (def) => {
          const sessionsPath = join(OPENCLAW_DIR, 'agents', def.id, 'sessions', 'sessions.json');
          
          let status: 'online' | 'idle' | 'offline' = 'offline';
          let lastActive: string | null = null;
          let activeSession: string | null = null;
          
          try {
            const sessionsData = await readFile(sessionsPath, 'utf-8');
            const sessions = JSON.parse(sessionsData) as Record<string, SessionData>;
            
            // Find the main session for this agent
            const mainSessionKey = `agent:${def.id}:main`;
            const session = sessions[mainSessionKey];
            
            if (session) {
              const sessionStatus = determineStatus(session);
              status = sessionStatus === 'working' ? 'online' : sessionStatus === 'idle' ? 'idle' : 'offline';
              lastActive = new Date(session.updatedAt).toISOString();
              activeSession = mainSessionKey;
            }
          } catch (err) {
            // No sessions file or error reading it - agent is offline
          }
          
          return {
            id: def.id,
            name: def.identity.name,
            emoji: def.identity.emoji,
            fullName: def.name,
            model: def.model,
            workspace: def.workspace,
            agentDir: def.agentDir,
            status,
            lastActive,
            activeSession,
            mentionPatterns: def.groupChat.mentionPatterns,
          };
        })
      );
      
      return { agents: roster };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ agents: [], error: 'Failed to read roster' });
    }
  });
  
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
          name: session.label || name,
          label: session.label,
          role,
          status: determineStatus(session),
          lastActive: new Date(session.updatedAt).toISOString(),
          model: session.model || session.modelOverride,
          provider: session.modelProvider || session.providerOverride,
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
      const result = await gatewayClient.request('chat.send', {
        sessionKey: id,
        message,
        idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      task?: string;
      label?: string;
      model?: string;
      projectId?: string;
      taskId?: string;
    };
  }>('/spawn', async (request, reply) => {
    const { task, label, model, projectId, taskId } = request.body;

    // Project is required
    if (!projectId) {
      return reply.status(400).send({ 
        error: 'Project ID is required',
        code: 'MISSING_PROJECT',
      });
    }

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    const agentLabel = label || `${projectId}-agent`;
    const agentModel = model || 'ollama/qwen3-coder';
    const initialTask = task || 'You are a project agent. Await instructions.';

    // Use the standard session key format that chat.send expects
    const timestamp = Date.now();
    const sessionKey = `agent:main:subagent:${agentLabel}:${timestamp}`;

    try {
      // IMPORTANT: If taskId provided, link the existing task BEFORE calling gateway
      // This prevents the race condition where gateway events create a duplicate task
      if (taskId) {
        const existingTask = await findTaskById(taskId);
        if (existingTask) {
          // Extract agentId from label
          const agentId = label || 'senior-dev';
          await updateTask(taskId, { 
            sessionKey, 
            status: 'in-progress',
            agentId 
          });
          fastify.log.info(`Linked existing task ${taskId} to session ${sessionKey} (before gateway call)`);
        }
      }

      // Send initial message to create the session via chat.send
      // This creates a proper session that subsequent messages will find
      await gatewayClient.request('chat.send', {
        sessionKey,
        message: initialTask,
        idempotencyKey: `spawn-${timestamp}`,
      });
      
      fastify.log.info(`Created session ${sessionKey} via chat.send`);

      // Track the association
      await addAssociation({
        sessionKey,
        projectId,
        task: initialTask,
        label: agentLabel,
        model: agentModel,
      });

      // Log the spawn event to activity feed
      logSpawnEvent({
        agent: agentLabel,
        task: initialTask,
        project: projectId,
        model: agentModel,
        sessionKey,
      });

      return {
        success: true,
        childSessionKey: sessionKey,
        model: agentModel,
        status: 'created',
        message: `Agent created. Use Message to send tasks.`,
      };

    } catch (spawnError) {
      const err = spawnError as Error;
      fastify.log.error(err);
      return reply.status(500).send({ 
        error: err.message || 'Failed to create agent',
        code: 'SPAWN_FAILED',
      });
    }
  });

  // Get agents associated with a project
  fastify.get<{
    Params: { projectId: string };
  }>('/project/:projectId', async (request, reply) => {
    const { projectId } = request.params;
    const agents = getProjectAgents(projectId);

    const statusBySession = new Map<string, { status: string; completedAt?: number }>();
    for (const agent of agents) {
      if (!agent.sessionKey) continue;
      const row = await db.queryOne<{ status?: string; completedAt?: string }>(
        'SELECT status, completedAt FROM tasks WHERE sessionKey = ? ORDER BY updatedAt DESC LIMIT 1',
        [agent.sessionKey]
      );
      if (row?.status === 'done') {
        statusBySession.set(agent.sessionKey, { status: 'completed', completedAt: row.completedAt ? Date.parse(row.completedAt) : undefined });
      }
    }

    const enriched = agents.map((agent) => {
      const override = statusBySession.get(agent.sessionKey);
      if (override) {
        return { ...agent, status: override.status as any, completedAt: override.completedAt };
      }
      // If no task found or task not done, check if session is stale
      // Sessions older than 1 hour with no active task are considered completed
      if (agent.spawnedAt) {
        const ageMs = Date.now() - agent.spawnedAt;
        if (ageMs > 3600_000) {
          return { ...agent, status: 'completed' as any };
        }
      }
      return agent;
    });

    return { agents: enriched };
  });

  // Get all project-agent associations
  fastify.get('/associations', async (request, reply) => {
    const associations = getAllAssociations();
    return { associations };
  });

  // Register an agent association (for agents spawned externally, e.g., by main agent)
  fastify.post<{
    Body: {
      sessionKey: string;
      projectId: string;
      task: string;
      label?: string;
      model?: string;
    };
  }>('/associations', async (request, reply) => {
    const { sessionKey, projectId, task, label, model } = request.body;

    if (!sessionKey || !projectId || !task) {
      return reply.status(400).send({ 
        error: 'sessionKey, projectId, and task are required' 
      });
    }

    try {
      await addAssociation({
        sessionKey,
        projectId,
        task,
        label,
        model,
      });

      fastify.log.info(`Registered association: ${sessionKey} -> ${projectId}`);
      return { success: true, sessionKey, projectId };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to register association: ${err.message}` });
    }
  });

  // List active subagent sessions
  // Note: Fetches from local sessions.json since gateway sessions.list has limited params
  fastify.get('/subagents', async (request, reply) => {
    try {
      const sessionsData = await readFile(SESSIONS_PATH, 'utf-8');
      const sessions = JSON.parse(sessionsData) as Record<string, SessionData>;
      
      // Filter to only subagent sessions
      const subagents = Object.entries(sessions)
        .filter(([key]) => key.startsWith('subagent:'))
        .map(([key, session]) => ({
          id: key,
          status: determineStatus(session),
          lastActive: new Date(session.updatedAt).toISOString(),
          model: session.model,
          tokens: session.totalTokens,
        }))
        .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())
        .slice(0, 50);
      
      return { subagents };
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

  // Delete an agent session
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    try {
      // Delete the session from OpenClaw gateway
      try {
        await gatewayClient.request('sessions.delete', {
          key: id,
        });
      } catch (gwErr) {
        // Gateway delete may fail, continue with file cleanup
        fastify.log.warn(`Gateway delete failed: ${(gwErr as Error).message}`);
      }

      // Also delete directly from sessions.json (backup method)
      await deleteSessionFromFile(id);

      // Remove from our local associations tracking
      await removeAssociation(id);

      fastify.log.info(`Deleted agent session: ${id}`);
      return { success: true, deleted: id };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);
      
      // If session doesn't exist in gateway, still try to clean up local tracking
      if (err.message.includes('not found') || err.message.includes('Unknown')) {
        await deleteSessionFromFile(id);
        await removeAssociation(id);
        return { success: true, deleted: id, note: 'Session was already gone from gateway' };
      }
      
      return reply.status(500).send({ error: `Failed to delete agent: ${err.message}` });
    }
  });

  // Change agent model
  fastify.patch<{
    Params: { id: string };
    Body: { model: string };
  }>('/:id/model', async (request, reply) => {
    const { id } = request.params;
    const { model } = request.body;

    if (!model) {
      return reply.status(400).send({ error: 'Model is required' });
    }

    try {
      // Update sessions.json directly
      const updated = await updateSessionModel(id, model);
      if (!updated) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Also update our local tracking
      await updateAssociation(id, { model } as any);

      fastify.log.info(`Changed model for ${id} to ${model}`);
      return { success: true, model };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to change model: ${err.message}` });
    }
  });
}
