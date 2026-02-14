import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { agentRoutes } from './routes/agents.js';
import { projectRoutes } from './routes/projects.js';
import { activityRoutes, logApprovalEvent, setBroadcastFunction } from './routes/activity.js';
import { approvalRoutes } from './routes/approvals.js';
import { taskRoutes } from './routes/tasks.js';
import { sessionRoutes } from './routes/sessions.js';
import { gatewayClient, ApprovalRequest, ApprovalResolved } from './gateway-client.js';
import { loadAssociations } from './project-agents.js';
import { createTask, updateTask, findTaskBySessionKey } from './task-store.js';

const fastify = Fastify({
  logger: true,
});

// Track connected dashboard clients
const dashboardClients = new Set<WebSocket>();

// Track known subagent sessions to detect when they start/complete
const knownSubagentSessions = new Map<string, { agentId: string; title: string; startedAt: number }>();
const subagentTaskIds = new Map<string, string>(); // sessionKey -> taskId

// Plugins
await fastify.register(cors, {
  origin: true,
});

await fastify.register(websocket);

// Routes
await fastify.register(agentRoutes, { prefix: '/api/agents' });
await fastify.register(projectRoutes, { prefix: '/api/projects' });
await fastify.register(activityRoutes, { prefix: '/api/activity' });
await fastify.register(approvalRoutes, { prefix: '/api/approvals' });
await fastify.register(taskRoutes, { prefix: '/api/tasks' });
await fastify.register(sessionRoutes, { prefix: '/api/sessions' });

// Health check
fastify.get('/api/health', async () => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    gateway: {
      connected: gatewayClient.isConnected(),
    },
  };
});

// Broadcast to all dashboard clients
function broadcast(type: string, payload: unknown) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Wire up broadcast function for activity module
setBroadcastFunction(broadcast);

// WebSocket for real-time updates
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    console.log('Dashboard client connected');
    dashboardClients.add(socket);
    
    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received:', data);
        
        // Handle subscriptions
        if (data.type === 'subscribe') {
          socket.send(JSON.stringify({ 
            type: 'subscribed', 
            channels: data.channels,
            gatewayConnected: gatewayClient.isConnected(),
          }));
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });
    
    socket.on('close', () => {
      console.log('Dashboard client disconnected');
      dashboardClients.delete(socket);
    });
    
    // Send initial connection message
    socket.send(JSON.stringify({ 
      type: 'connected', 
      timestamp: new Date().toISOString(),
      gatewayConnected: gatewayClient.isConnected(),
    }));
  });
});

// Wire gateway events to dashboard broadcasts
gatewayClient.on('approval-requested', (request: ApprovalRequest) => {
  // Log to activity feed
  logApprovalEvent({
    action: 'requested',
    command: request.request.command || 'unknown command',
    agent: request.request.agentId,
    sessionKey: request.request.sessionKey,
  });
  
  broadcast('approval-requested', {
    id: request.id,
    command: request.request.command,
    cwd: request.request.cwd,
    host: request.request.host,
    agentId: request.request.agentId,
    expiresAtMs: request.expiresAtMs,
  });
});

gatewayClient.on('approval-resolved', (resolved: ApprovalResolved) => {
  // Log to activity feed
  const action = resolved.decision === 'deny' ? 'denied' : 'approved';
  logApprovalEvent({
    action,
    command: 'command',  // We don't have the command here, would need to track it
    resolvedBy: resolved.resolvedBy,
  });
  
  broadcast('approval-resolved', {
    id: resolved.id,
    decision: resolved.decision,
    resolvedBy: resolved.resolvedBy,
  });
});

// Handle agent stream events to detect subagents
gatewayClient.on('agent', async (payload: any) => {
  try {
    const sessionKey = payload.sessionKey;
    const stream = payload.stream;
    const data = payload.data || {};

    // Check if this is a subagent session (contains :subagent:)
    if (!sessionKey || !sessionKey.includes(':subagent:')) {
      return;
    }

    // Check if this is a NEW subagent session
    if (!knownSubagentSessions.has(sessionKey)) {
      // Extract agentId from sessionKey (format: "agent:senior-dev:subagent:...")
      const parts = sessionKey.split(':');
      const agentId = parts.length >= 2 ? parts[1] : 'unknown';

      // Generate a title from the first part of the text, or use a generic one
      let title = 'Subagent task';
      if (data.text && typeof data.text === 'string') {
        const firstLine = data.text.split('\n')[0].trim();
        if (firstLine) {
          title = firstLine.substring(0, 100);
        }
      }

      console.log('[SubagentHandler] Detected new subagent session:', {
        sessionKey,
        agentId,
        title,
      });

      // Register this session
      knownSubagentSessions.set(sessionKey, {
        agentId,
        title,
        startedAt: Date.now(),
      });

      // Create a task for this subagent
      try {
        const task = await createTask({
          title,
          description: `Subagent task spawned by ${agentId}`,
          status: 'in-progress',
          priority: 'P2',
          projectId: 'mission-clawtrol',
          agentId,
          sessionKey,
          handoffNotes: null,
        });

        subagentTaskIds.set(sessionKey, task.id);

        console.log('[SubagentHandler] Created task:', task.id, 'for session:', sessionKey);

        // Broadcast the new task
        broadcast('task-created', {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          agentId: task.agentId,
          sessionKey: task.sessionKey,
        });
      } catch (err) {
        console.error('[SubagentHandler] Error creating task:', err);
      }
    }

    // Check for completion indicators
    if (stream === 'complete' || stream === 'done') {
      console.log('[SubagentHandler] Detected subagent completion:', {
        sessionKey,
        stream,
      });

      const taskId = subagentTaskIds.get(sessionKey);
      if (taskId) {
        try {
          const summary = data.summary || data.text || 'Completed';
          const updatedTask = await updateTask(taskId, {
            status: 'done',
            handoffNotes: typeof summary === 'string' ? summary.substring(0, 500) : 'Completed',
          });

          console.log('[SubagentHandler] Updated task to done:', taskId);

          // Broadcast the task update
          if (updatedTask) {
            broadcast('task-updated', {
              id: updatedTask.id,
              title: updatedTask.title,
              status: updatedTask.status,
              priority: updatedTask.priority,
              completedAt: updatedTask.completedAt,
              handoffNotes: updatedTask.handoffNotes,
            });
          }

          // Clean up
          subagentTaskIds.delete(sessionKey);
          knownSubagentSessions.delete(sessionKey);
        } catch (err) {
          console.error('[SubagentHandler] Error updating task:', err);
        }
      }
    }
  } catch (err) {
    console.error('[SubagentHandler] Error handling agent event:', err);
  }
});

// Handle subagent spawn events (kept for backward compatibility)
gatewayClient.on('subagent-started', async (payload: any) => {
  try {
    console.log('[SubagentHandler] Subagent started:', JSON.stringify(payload));
    
    // Extract relevant fields from the payload
    const sessionKey = payload.sessionKey || payload.session || payload.id;
    const agentId = payload.agentId || payload.agent || 'unknown';
    const description = payload.description || payload.message || 'Subagent task';
    
    if (!sessionKey) {
      console.warn('[SubagentHandler] No sessionKey in subagent-started event');
      return;
    }

    // Extract title from description (first line or first 60 chars)
    const titleLines = description.split('\n');
    const title = titleLines[0].substring(0, 100) || 'Subagent task';

    // Create a task for this subagent
    const task = await createTask({
      title,
      description,
      status: 'in-progress',
      priority: 'P2',
      projectId: 'mission-clawtrol',
      agentId,
      sessionKey,
      handoffNotes: null,
    });

    console.log('[SubagentHandler] Created task:', task.id, 'for session:', sessionKey);

    // Broadcast the new task
    broadcast('task-created', {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      agentId: task.agentId,
      sessionKey: task.sessionKey,
    });
  } catch (err) {
    console.error('[SubagentHandler] Error handling subagent-started:', err);
  }
});

// Helper function to calculate cost based on model and token usage
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Price per 1M tokens
  const priceMap: Record<string, { input: number; output: number }> = {
    'minimax/MiniMax-M2.5': { input: 0.30, output: 1.20 },
    'MiniMax-M2.5': { input: 0.30, output: 1.20 },
    'm2.5': { input: 0.30, output: 1.20 },
    'anthropic/claude-opus': { input: 5.00, output: 25.00 },
    'claude-opus': { input: 5.00, output: 25.00 },
    'opus': { input: 5.00, output: 25.00 },
    'anthropic/claude-sonnet': { input: 3.00, output: 15.00 },
    'claude-sonnet': { input: 3.00, output: 15.00 },
    'sonnet': { input: 3.00, output: 15.00 },
  };
  
  const normalizedModel = model.toLowerCase();
  let prices = { input: 0, output: 0 };
  
  // Try exact match first
  for (const [key, price] of Object.entries(priceMap)) {
    if (normalizedModel === key.toLowerCase()) {
      prices = price;
      break;
    }
  }
  
  // Fall back to partial match if no exact match
  if (prices.input === 0) {
    for (const [key, price] of Object.entries(priceMap)) {
      if (normalizedModel.includes(key.toLowerCase())) {
        prices = price;
        break;
      }
    }
  }
  
  // If still no match, default to MiniMax M2.5
  if (prices.input === 0) {
    prices = { input: 0.30, output: 1.20 };
  }
  
  // Calculate cost in USD
  const inputCost = (inputTokens / 1_000_000) * prices.input;
  const outputCost = (outputTokens / 1_000_000) * prices.output;
  
  return inputCost + outputCost;
}

// Handle subagent completion events
gatewayClient.on('subagent-completed', async (payload: any) => {
  try {
    console.log('[SubagentHandler] Subagent completed:', JSON.stringify(payload));
    
    // Extract relevant fields from the payload
    const sessionKey = payload.sessionKey || payload.session || payload.id;
    const completionSummary = payload.summary || payload.result || payload.message || 'Completed';
    
    // Extract token stats from the payload
    let tokens: { input: number; output: number; total: number } | undefined;
    let cost: number | undefined;
    let model: string | undefined;
    let runtime: number | undefined;
    
    // Look for tokens in various possible locations
    if (payload.tokens) {
      tokens = {
        input: payload.tokens.input || payload.tokens.prompt_tokens || 0,
        output: payload.tokens.output || payload.tokens.completion_tokens || 0,
        total: payload.tokens.total || payload.tokens.input + payload.tokens.output || 0,
      };
    } else if (payload.usage) {
      tokens = {
        input: payload.usage.input_tokens || payload.usage.prompt_tokens || 0,
        output: payload.usage.output_tokens || payload.usage.completion_tokens || 0,
        total: payload.usage.total_tokens || 0,
      };
    } else if (payload.stats) {
      tokens = {
        input: payload.stats.input_tokens || 0,
        output: payload.stats.output_tokens || 0,
        total: payload.stats.total_tokens || 0,
      };
    }
    
    // Ensure total is calculated if we have input/output
    if (tokens && tokens.total === 0) {
      tokens.total = tokens.input + tokens.output;
    }
    
    // Extract model if available
    model = payload.model || payload.aiModel || undefined;
    
    // Calculate cost if we have tokens and model
    if (tokens && model) {
      cost = calculateCost(model, tokens.input, tokens.output);
    }
    
    // Extract runtime if available (convert to milliseconds if necessary)
    if (payload.runtime !== undefined) {
      runtime = typeof payload.runtime === 'number' ? payload.runtime : parseInt(payload.runtime);
    } else if (payload.executionTime !== undefined) {
      runtime = payload.executionTime;
    } else if (payload.duration !== undefined) {
      runtime = payload.duration;
    }

    if (!sessionKey) {
      console.warn('[SubagentHandler] No sessionKey in subagent-completed event');
      return;
    }

    // Find the task by sessionKey
    const task = await findTaskBySessionKey(sessionKey);
    if (!task) {
      console.warn('[SubagentHandler] No task found for session:', sessionKey);
      return;
    }

    // Update the task to done with token/cost info
    const updatedTask = await updateTask(task.id, {
      status: 'done',
      handoffNotes: completionSummary,
      tokens,
      cost,
      model,
      runtime,
    });

    console.log('[SubagentHandler] Updated task:', task.id, 'to done', {
      tokens,
      cost,
      model,
      runtime,
    });

    // Broadcast the task update
    broadcast('task-updated', {
      id: updatedTask!.id,
      title: updatedTask!.title,
      status: updatedTask!.status,
      priority: updatedTask!.priority,
      completedAt: updatedTask!.completedAt,
      handoffNotes: updatedTask!.handoffNotes,
      tokens: updatedTask!.tokens,
      cost: updatedTask!.cost,
      model: updatedTask!.model,
      runtime: updatedTask!.runtime,
    });
  } catch (err) {
    console.error('[SubagentHandler] Error handling subagent-completed:', err);
  }
});

// Start server
const start = async () => {
  try {
    // Load project-agent associations
    await loadAssociations();

    // Connect to gateway first
    console.log('🔌 Connecting to OpenClaw gateway...');
    try {
      await gatewayClient.connect();
      console.log('✅ Gateway connected');
    } catch (err) {
      console.warn(`⚠️ Gateway connection failed: ${(err as Error).message}`);
      console.warn('   Approvals will be unavailable until gateway connects');
      // Don't fail startup - gateway client will auto-reconnect
    }

    const port = parseInt(process.env.PORT || '3001');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Backend running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
