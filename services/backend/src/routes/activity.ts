import { FastifyInstance } from 'fastify';

interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'message' | 'status' | 'file' | 'approval' | 'task';
  agent?: string;
  from?: string;
  to?: string;
  message?: string;
  details?: Record<string, any>;
}

// In-memory activity log (will be replaced with persistent storage)
const activityLog: ActivityEvent[] = [
  {
    id: '1',
    timestamp: new Date().toISOString(),
    type: 'status',
    agent: 'Jarvis',
    message: 'Started building agent dashboard',
  },
];

export async function activityRoutes(fastify: FastifyInstance) {
  // Get recent activity
  fastify.get('/', async (request, reply) => {
    const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };
    
    const events = activityLog
      .slice(offset, offset + limit)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return {
      events,
      total: activityLog.length,
      limit,
      offset,
    };
  });
  
  // Add activity event (internal use)
  fastify.post('/', async (request, reply) => {
    const event = request.body as Omit<ActivityEvent, 'id' | 'timestamp'>;
    
    const newEvent: ActivityEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    
    activityLog.unshift(newEvent);
    
    // Keep only last 1000 events in memory
    if (activityLog.length > 1000) {
      activityLog.pop();
    }
    
    return newEvent;
  });
}

// Helper to add activity from other parts of the app
export function addActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>) {
  const newEvent: ActivityEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  activityLog.unshift(newEvent);
  return newEvent;
}
