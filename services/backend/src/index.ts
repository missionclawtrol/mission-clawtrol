import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { agentRoutes } from './routes/agents.js';
import { projectRoutes } from './routes/projects.js';
import { activityRoutes } from './routes/activity.js';

const fastify = Fastify({
  logger: true,
});

// Plugins
await fastify.register(cors, {
  origin: true,
});

await fastify.register(websocket);

// Routes
await fastify.register(agentRoutes, { prefix: '/api/agents' });
await fastify.register(projectRoutes, { prefix: '/api/projects' });
await fastify.register(activityRoutes, { prefix: '/api/activity' });

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// WebSocket for real-time updates
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    console.log('WebSocket client connected');
    
    socket.on('message', (message) => {
      const data = JSON.parse(message.toString());
      console.log('Received:', data);
      
      // Handle subscriptions
      if (data.type === 'subscribe') {
        socket.send(JSON.stringify({ type: 'subscribed', channels: data.channels }));
      }
    });
    
    socket.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    // Send initial connection message
    socket.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Backend running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
