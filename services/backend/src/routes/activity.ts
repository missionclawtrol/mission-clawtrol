import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

// Extended event types for richer activity tracking
type EventType = 
  | 'message'       // Agent communication
  | 'status'        // Status changes
  | 'file'          // File operations
  | 'approval'      // Approval events (requested/resolved)
  | 'task'          // Task events
  | 'spawn'         // Agent spawned
  | 'complete'      // Agent completed task
  | 'error'         // Error occurred
  | 'project'       // Project events (created/deleted)
  | 'system';       // System events

interface ActivityEvent {
  id: string;
  timestamp: string;
  type: EventType;
  agent?: string;
  from?: string;
  to?: string;
  message?: string;
  details?: Record<string, unknown>;
  // Extended fields for richer events
  project?: string;
  model?: string;
  sessionKey?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

// In-memory activity log (will be replaced with persistent storage)
const activityLog: ActivityEvent[] = [];

// Broadcast function - will be set by index.ts
let broadcastFn: ((type: string, payload: unknown) => void) | null = null;

export function setBroadcastFunction(fn: (type: string, payload: unknown) => void): void {
  broadcastFn = fn;
}

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
export function addActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): ActivityEvent {
  const newEvent: ActivityEvent = {
    ...event,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  activityLog.unshift(newEvent);
  
  // Keep only last 1000 events
  if (activityLog.length > 1000) {
    activityLog.pop();
  }
  
  // Broadcast to connected dashboard clients in real-time
  if (broadcastFn) {
    broadcastFn('activity', newEvent);
  }
  
  return newEvent;
}

// Convenience helpers for common event types
export function logSpawnEvent(params: {
  agent: string;
  task: string;
  project?: string;
  model?: string;
  sessionKey?: string;
}): ActivityEvent {
  return addActivity({
    type: 'spawn',
    agent: params.agent,
    message: `Spawned to work on: ${params.task.slice(0, 100)}${params.task.length > 100 ? '...' : ''}`,
    project: params.project,
    model: params.model,
    sessionKey: params.sessionKey,
    severity: 'info',
  });
}

export function logErrorEvent(params: {
  agent?: string;
  message: string;
  details?: Record<string, unknown>;
}): ActivityEvent {
  return addActivity({
    type: 'error',
    agent: params.agent,
    message: params.message,
    details: params.details,
    severity: 'error',
  });
}

export function logApprovalEvent(params: {
  action: 'requested' | 'approved' | 'denied';
  command: string;
  agent?: string;
  sessionKey?: string;
  resolvedBy?: string;
}): ActivityEvent {
  const messages = {
    requested: `Approval requested: ${params.command}`,
    approved: `Approval granted: ${params.command}`,
    denied: `Approval denied: ${params.command}`,
  };
  
  return addActivity({
    type: 'approval',
    agent: params.agent,
    message: messages[params.action],
    sessionKey: params.sessionKey,
    severity: params.action === 'denied' ? 'warning' : 'info',
    details: params.resolvedBy ? { resolvedBy: params.resolvedBy } : undefined,
  });
}

export function logProjectEvent(params: {
  action: 'created' | 'deleted';
  projectName: string;
}): ActivityEvent {
  return addActivity({
    type: 'project',
    message: `Project ${params.action}: ${params.projectName}`,
    project: params.projectName,
    severity: params.action === 'deleted' ? 'warning' : 'success',
  });
}

// Export the type for use in other files
export type { ActivityEvent };
