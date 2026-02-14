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
import { gatewayClient, ApprovalRequest, ApprovalResolved } from './gateway-client.js';
import { loadAssociations } from './project-agents.js';

const fastify = Fastify({
  logger: true,
});

// Track connected dashboard clients
const dashboardClients = new Set<WebSocket>();

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
