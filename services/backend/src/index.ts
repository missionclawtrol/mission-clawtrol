import 'dotenv/config';
import { join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import { agentRoutes } from './routes/agents.js';
import { projectRoutes } from './routes/projects.js';
import { activityRoutes, logApprovalEvent, setBroadcastFunction } from './routes/activity.js';
import { approvalRoutes } from './routes/approvals.js';
import { taskRoutes, setBroadcastFn, setSessionCleanupFn, setSessionRegistrationFn } from './routes/tasks.js';
import { auditRoutes } from './routes/audit.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { costRoutes } from './routes/costs.js';
import { messageRoutes } from './routes/message.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { commentRoutes } from './routes/comments.js';
import { webhookRoutes } from './routes/webhooks.js';
import { workflowRoutes } from './routes/workflow.js';
import { milestoneRoutes } from './routes/milestones.js';
import { contextRoutes } from './routes/context.js';
import { reportRoutes } from './routes/reports.js';
import { setupRoutes } from './routes/setup.js';
import { agentsConfigRoutes } from './routes/agents-config.js';
import { chatProxyRoutes } from './routes/chat-proxy.js';
import { ptyRoutes } from './routes/pty.js';
import { voiceProxyRoutes } from './routes/voice-proxy.js';
import { voiceRestRoutes } from './routes/voice-rest.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { rulesRoutes } from './routes/rules.js';
import { agentMemoryRoutes } from './routes/agent-memory.js';
import { deliverableRoutes, taskDeliverableRoutes } from './routes/deliverables.js';
import { seedBuiltInRules } from './rule-store.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { gatewayClient, ApprovalRequest, ApprovalResolved } from './gateway-client.js';
import { loadAssociations } from './project-agents.js';
// onTaskStatusChange is called from routes/tasks.ts — not needed in index.ts
import { createTask, updateTask, findTaskBySessionKey, findTaskById } from './task-store.js';
import { initializeDatabase } from './database.js';
import { migrateFromJSON } from './migrate.js';
import { db } from './db/index.js';
import { getHumanHourlyRate } from './enrichment.js';

const execAsync = promisify(exec);

const fastify = Fastify({
  logger: true,
  ignoreTrailingSlash: true,
});

// Track connected dashboard clients
const dashboardClients = new Set<WebSocket>();

// Track clients watching specific task activity streams
const taskWatchers = new Map<string, Set<WebSocket>>(); // taskId -> Set<WebSocket>

// Ring buffer of recent activity events per task (last 100 entries) for replay on watcher connect
const ACTIVITY_BUFFER_MAX = 100;
interface ActivityBufferEntry {
  stream: string;
  data: { delta?: any; phase?: any };
  timestamp: string;
}
const taskActivityBuffer = new Map<string, ActivityBufferEntry[]>(); // taskId -> recent events

// Track known subagent sessions to detect when they start/complete
const knownSubagentSessions = new Map<string, { agentId: string; title: string; startedAt: number }>();
const subagentTaskIds = new Map<string, string>(); // sessionKey -> taskId

// Track accumulated text and title extraction state for subagents
const subagentTextBuffers = new Map<string, string>(); // sessionKey -> accumulated text
const subagentTitleExtracted = new Map<string, boolean>(); // sessionKey -> title extracted
const subagentTitleTimers = new Map<string, NodeJS.Timeout>(); // sessionKey -> extraction timer

// Track last activity timestamp for each session (for timeout detection)
const sessionLastActivity = new Map<string, number>(); // sessionKey -> timestamp

// Completion markers that indicate a subagent has finished
const completionMarkers = ['✅', 'Task Complete', '## Summary', 'Commit:', 'Done:', 'completed', 'finished'];

/**
 * Extract a meaningful title from accumulated text
 */
function extractMeaningfulTitle(text: string): string {
  if (!text || typeof text !== 'string') {
    return 'Task in progress...';
  }

  // Try to find "## Task:" pattern (common in briefs)
  const taskHeaderMatch = text.match(/##\s*Task[:\s]+([^\n]+)/i);
  if (taskHeaderMatch) {
    const extracted = taskHeaderMatch[1].trim().slice(0, 100);
    if (extracted.length > 5) return extracted;
  }

  // Try to find "YOUR TASK:" pattern
  const taskMatch = text.match(/YOUR TASK[:\s]+([^\n]+)/i);
  if (taskMatch) {
    const extracted = taskMatch[1].trim().slice(0, 100);
    if (extracted.length > 10) return extracted;
  }

  // Try "Quick test:" pattern
  const quickTestMatch = text.match(/Quick test[:\s]+([^\n]+)/i);
  if (quickTestMatch) {
    const extracted = quickTestMatch[1].trim().slice(0, 100);
    if (extracted.length > 5) return extracted;
  }

  // Try to find bolded text (**...**)
  const boldMatch = text.match(/\*\*([^*]+)\*\*/);
  if (boldMatch) {
    const extracted = boldMatch[1].trim().slice(0, 100);
    if (extracted.length > 10) return extracted;
  }

  // Find first substantial line (> 20 chars and < 100 chars)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 20 && l.length < 100);
  if (lines.length > 0) {
    // Skip common prefixes/headers
    const line = lines[0];
    if (!line.match(/^#+\s/) && !line.startsWith('[') && !line.startsWith('{')) {
      return line;
    }
  }

  // Fallback: use any substantial first line
  const firstNonEmptyLine = text.split('\n').find(l => l.trim().length > 0);
  if (firstNonEmptyLine && firstNonEmptyLine.trim().length > 10) {
    return firstNonEmptyLine.trim().slice(0, 100);
  }

  // Final fallback
  return 'Task in progress...';
}

/**
 * Check if an event text contains any completion markers
 */
function hasCompletionMarker(text: string | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  return completionMarkers.some(marker => text.includes(marker));
}

/**
 * Schedule title extraction for a subagent session
 * Waits for accumulated text to reach 500 chars or 5 seconds, then extracts and updates title
 */
async function scheduleTitleExtraction(sessionKey: string, taskId: string) {
  // Skip if already extracted
  if (subagentTitleExtracted.get(sessionKey)) {
    return;
  }

  // Clear any existing timer
  const existingTimer = subagentTitleTimers.get(sessionKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer for 5 seconds
  const timer = setTimeout(async () => {
    try {
      const accumulatedText = subagentTextBuffers.get(sessionKey) || '';
      
      // Only extract if we have enough text
      if (accumulatedText.length >= 50) {
        const betterTitle = extractMeaningfulTitle(accumulatedText);
        
        if (betterTitle !== 'Task in progress...') {
          const updatedTask = await updateTask(taskId, {
            title: betterTitle,
            updatedAt: new Date().toISOString(),
          });

          if (updatedTask) {
            console.log('[TitleExtraction] Updated task title:', {
              taskId,
              sessionKey,
              oldTitle: 'Task in progress...',
              newTitle: betterTitle,
              textLength: accumulatedText.length,
            });

            // Broadcast the update
            broadcast('task.updated', {
              id: updatedTask.id,
              title: updatedTask.title,
              status: updatedTask.status,
              priority: updatedTask.priority,
              updatedAt: updatedTask.updatedAt,
            });

            subagentTitleExtracted.set(sessionKey, true);
          } else {
            console.warn('[TitleExtraction] updateTask returned null (timer) for taskId:', taskId);
          }
        }
      }
    } catch (err) {
      console.error('[TitleExtraction] Error extracting title:', err);
    } finally {
      subagentTitleTimers.delete(sessionKey);
    }
  }, 5000); // 5 second delay

  subagentTitleTimers.set(sessionKey, timer);
}

/**
 * Check if we should extract title (500 chars accumulated or title hasn't been extracted yet)
 */
async function checkAndExtractTitle(sessionKey: string, taskId: string) {
  if (subagentTitleExtracted.get(sessionKey)) {
    return; // Already extracted
  }

  const accumulatedText = subagentTextBuffers.get(sessionKey) || '';
  
  // Extract if we have 500+ chars of accumulated text
  if (accumulatedText.length >= 500) {
    try {
      const betterTitle = extractMeaningfulTitle(accumulatedText);
      
      if (betterTitle !== 'Task in progress...') {
        const updatedTask = await updateTask(taskId, {
          title: betterTitle,
          updatedAt: new Date().toISOString(),
        });

        if (updatedTask) {
          console.log('[TitleExtraction] Updated task title (500 chars threshold):', {
            taskId,
            sessionKey,
            newTitle: betterTitle,
            textLength: accumulatedText.length,
          });

          // Broadcast the update
          broadcast('task.updated', {
            id: updatedTask.id,
            title: updatedTask.title,
            status: updatedTask.status,
            priority: updatedTask.priority,
            updatedAt: updatedTask.updatedAt,
          });

          subagentTitleExtracted.set(sessionKey, true);
        } else {
          console.warn('[TitleExtraction] updateTask returned null for taskId:', taskId);
        }

        // Clear the timer since we're done
        const timer = subagentTitleTimers.get(sessionKey);
        if (timer) {
          clearTimeout(timer);
          subagentTitleTimers.delete(sessionKey);
        }
      }
    } catch (err) {
      console.error('[TitleExtraction] Error extracting title:', err);
    }
  }
}

/**
 * Extract commit hash from streaming text using regex patterns
 */
function extractCommitHash(text: string): string | undefined {
  if (!text || typeof text !== 'string') {
    console.log('[ExtractCommitHash] No text provided');
    return undefined;
  }
  
  // Try to find "Commit:" or "commit" pattern first
  const commitMatch = text.match(/[Cc]ommit[:\s]+([a-f0-9]{7,40})/);
  if (commitMatch) {
    console.log('[ExtractCommitHash] Found commit via pattern match:', commitMatch[1]);
    return commitMatch[1];
  }
  
  // Fallback to raw hash pattern (7-40 hex chars)
  const hashMatch = text.match(/([a-f0-9]{7,40})/);
  if (hashMatch) {
    console.log('[ExtractCommitHash] Found hash via raw pattern:', hashMatch[1]);
    return hashMatch[1];
  }
  
  console.log('[ExtractCommitHash] No commit hash found in text, text length:', text.length);
  return undefined;
}

/**
 * Get the most recent commit hash from git log since a certain date
 * Converts UTC timestamps to local time for git log (which uses local time)
 */
async function getMostRecentCommitHash(
  repoPath: string,
  sinceDate?: Date
): Promise<string | undefined> {
  try {
    console.log('[GetRecentCommit] Querying git log', sinceDate ? `since ${sinceDate.toISOString()}` : '');
    
    let command = `git -C ${repoPath} log --pretty=format:%H -n 1`;
    if (sinceDate) {
      // git log --since uses local time, not UTC
      // Convert UTC timestamp to local time by accounting for timezone offset
      const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
      const localDate = new Date(sinceDate.getTime() - tzOffsetMs);
      
      // Format: "YYYY-MM-DD HH:MM:SS"
      const year = localDate.getUTCFullYear();
      const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(localDate.getUTCDate()).padStart(2, '0');
      const hours = String(localDate.getUTCHours()).padStart(2, '0');
      const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
      const seconds = String(localDate.getUTCSeconds()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      
      console.log('[GetRecentCommit] Date filter (local time):', dateStr);
      command += ` --since="${dateStr}"`;
    }
    
    const { stdout } = await execAsync(command, { timeout: 5000 });
    const hash = stdout.trim();
    
    if (hash && hash.match(/^[a-f0-9]{7,40}$/)) {
      console.log('[GetRecentCommit] ✅ Found recent commit:', hash);
      return hash;
    }
    
    console.log('[GetRecentCommit] No valid commit hash found in git log');
    return undefined;
  } catch (err) {
    console.error('[GetRecentCommit] Error querying git log:', err);
    return undefined;
  }
}

/**
 * Calculate lines changed from a git commit
 */
async function getLinesChanged(
  commitHash: string,
  repoPath: string
): Promise<{ added: number; removed: number }> {
  try {
    // Handle comma-separated commit hashes (e.g., "abc123,def456" from squash merges)
    // Use only the first/most recent commit
    const primaryHash = commitHash.split(',')[0].trim();
    
    console.log('[LinesChanged] Getting diff for commit:', primaryHash);
    const command = `git -C ${repoPath} diff --shortstat ${primaryHash}^..${primaryHash}`;
    console.log('[LinesChanged] Running command:', command);
    
    const { stdout } = await execAsync(command, { timeout: 5000 });
    console.log('[LinesChanged] Git diff output:', stdout);
    
    // Parse: " 3 files changed, 47 insertions(+), 12 deletions(-)"
    const added = parseInt(stdout.match(/(\d+) insertion/)?.[1] || '0');
    const removed = parseInt(stdout.match(/(\d+) deletion/)?.[1] || '0');
    
    console.log('[LinesChanged] Parsed result:', { added, removed });
    return { added, removed };
  } catch (err) {
    console.error('[LinesChanged] Error getting diff for commit:', commitHash, err);
    return { added: 0, removed: 0 };
  }
}

/**
 * Get session cost data from transcript file
 */
async function getSessionCostFromTranscript(sessionKey: string): Promise<{
  model: string | null;
  tokens: { input: number; output: number; total: number };
  cost: number;
  runtime: number;
} | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // Parse sessionKey to find transcript path
    // Format: agent:<agentId>:subagent:<uuid> or agent:<agentId>:main
    const parts = sessionKey.split(':');
    if (parts.length < 2) return null;
    
    const agentId = parts[1];
    const sessionsDir = path.join(process.env.HOME || '', '.openclaw', 'agents', agentId, 'sessions');
    
    // Find the transcript file - look for .jsonl files that aren't deleted
    let transcriptPath: string | null = null;
    try {
      const files = await fs.readdir(sessionsDir);
      // Find most recent non-deleted jsonl file
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'));
      if (jsonlFiles.length > 0) {
        // Get the most recent one
        const stats = await Promise.all(jsonlFiles.map(async f => ({
          file: f,
          mtime: (await fs.stat(path.join(sessionsDir, f))).mtime.getTime()
        })));
        stats.sort((a, b) => b.mtime - a.mtime);
        transcriptPath = path.join(sessionsDir, stats[0].file);
      }
    } catch {
      // Sessions dir might not exist
      return null;
    }
    
    if (!transcriptPath) return null;
    
    // Read and parse the transcript
    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let model: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || entry;
        
        // Track timestamps for runtime
        if (entry.timestamp) {
          const ts = new Date(entry.timestamp).getTime();
          if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
          if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
        }
        
        // Extract model
        if (msg.model && !model) {
          model = msg.model;
        }
        
        // Extract usage
        if (msg.usage) {
          totalInput += msg.usage.input || msg.usage.prompt_tokens || 0;
          totalOutput += msg.usage.output || msg.usage.completion_tokens || 0;
          if (msg.usage.cost?.total) {
            totalCost += msg.usage.cost.total;
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
    
    const runtime = firstTimestamp && lastTimestamp ? lastTimestamp - firstTimestamp : 0;
    
    console.log('[SessionCost] Extracted from transcript:', {
      sessionKey,
      model,
      tokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
      cost: totalCost,
      runtime,
    });
    
    return {
      model,
      tokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
      cost: totalCost,
      runtime,
    };
  } catch (err) {
    console.error('[SessionCost] Error reading transcript:', err);
    return null;
  }
}

/**
 * Complete a task and move it to review status
 * (CSO will review and mark as done)
 */
// completeTask removed — agents move their own tasks to review via API.
// Stuck in-progress tasks are visible on the kanban board for manual triage.

// Plugins
await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(cookie);
await fastify.register(session, {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production!',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
  saveUninitialized: false,
});

await fastify.register(websocket);

// Auth middleware - protect all /api/* routes except health and auth
// Set DISABLE_AUTH=true for local development (skips all auth checks)
if (process.env.DISABLE_AUTH === 'true') {
  fastify.log.warn('⚠️  Auth disabled (DISABLE_AUTH=true) — do not use in production');
} else {
  const authMiddleware = createAuthMiddleware([
    /^\/api\/health$/,           // Health check
    /^\/api\/auth\//,             // Auth routes (login, callback, me, logout)
    /^\/api\/context$/,           // Context endpoint (used by agents locally)
    /^\/api\/workflow/,           // Workflow endpoints (used by agents locally)
    /^\/api\/agent\/[^/]+\/memory$/, // Agent memory endpoint (used by agents locally)
    /^\/api\/deliverables/,           // Deliverables API (agents create deliverables)
    /^\/api\/tasks\/[^/]+\/deliverables$/, // Task deliverables (nested)
    /^\/ws$/,                     // WebSocket endpoint (used by dashboard before login)
    /^\/api\/chat\/ws$/,          // Chat WebSocket endpoint
    /^\/ws\/gateway$/,            // Chat gateway proxy WebSocket
    /^\/ws\/pty$/,                // Terminal PTY WebSocket
    /^\/ws\/voice$/,              // Voice interface WebSocket
    /^\/api\/voice\//,            // Voice sidecar REST proxy
  ]);

  fastify.addHook('preHandler', authMiddleware);
}

// Routes
await fastify.register(agentRoutes, { prefix: '/api/agents' });
await fastify.register(projectRoutes, { prefix: '/api/projects' });
await fastify.register(activityRoutes, { prefix: '/api/activity' });
await fastify.register(approvalRoutes, { prefix: '/api/approvals' });
await fastify.register(taskRoutes, { prefix: '/api/tasks' });
await fastify.register(auditRoutes, { prefix: '/api/audit' });
await fastify.register(sessionRoutes, { prefix: '/api/sessions' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
await fastify.register(costRoutes, { prefix: '/api/costs' });
await fastify.register(messageRoutes, { prefix: '/api/message' });
await fastify.register(voiceRestRoutes, { prefix: '/api/voice' });
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(commentRoutes, { prefix: '/api/tasks' });
await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
await fastify.register(workflowRoutes, { prefix: '/api/workflow' });
await fastify.register(milestoneRoutes, { prefix: '/api/milestones' });
await fastify.register(reportRoutes, { prefix: '/api/reports' });
await fastify.register(setupRoutes, { prefix: '/api/setup' });
await fastify.register(agentsConfigRoutes, { prefix: '/api/agents-config' });
await fastify.register(contextRoutes, { prefix: '/api/context' });
await fastify.register(chatProxyRoutes, { prefix: '/ws' });
await fastify.register(ptyRoutes, { prefix: '/ws' });
await fastify.register(voiceProxyRoutes, { prefix: '/ws' });
await fastify.register(onboardingRoutes, { prefix: '/api/onboarding' });
await fastify.register(rulesRoutes, { prefix: '/api/rules' });
await fastify.register(agentMemoryRoutes, { prefix: '/api/agent' });
await fastify.register(deliverableRoutes, { prefix: '/api/deliverables' });
await fastify.register(taskDeliverableRoutes, { prefix: '/api/tasks' });

// Health check with comprehensive system status
fastify.get('/api/health', async () => {
  // 1. System uptime
  const uptime = process.uptime();
  
  // 2. Gateway WebSocket connection status
  const gatewayConnected = gatewayClient.isConnected();
  
  // 3. DB connectivity check with response time + task counts (single query)
  let dbConnected = false;
  let dbResponseMs = 0;
  let taskCounts = { backlog: 0, todo: 0, 'in-progress': 0, review: 0, done: 0 };
  
  try {
    const dbStart = Date.now();
    const rows = await db.query<any>('SELECT status, COUNT(*) as count FROM tasks GROUP BY status');
    dbResponseMs = Date.now() - dbStart;
    dbConnected = true;
    
    // Parse task counts from query result
    for (const row of rows) {
      if (row.status in taskCounts) {
        taskCounts[row.status as keyof typeof taskCounts] = parseInt(row.count);
      }
    }
  } catch (err) {
    dbResponseMs = 0;
    dbConnected = false;
  }
  
  // 4. Active agent sessions count
  const activeAgents = knownSubagentSessions.size;
  
  // 5. Overall status calculation
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (!dbConnected) {
    overallStatus = 'unhealthy';
  } else if (dbResponseMs > 200 || !gatewayConnected) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }
  
  return {
    status: overallStatus,
    uptime,
    db: {
      connected: dbConnected,
      responseMs: dbResponseMs,
    },
    gateway: {
      connected: gatewayConnected,
    },
    tasks: taskCounts,
    activeAgents,
    timestamp: new Date().toISOString(),
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

// Wire up broadcast function for task routes
setBroadcastFn(broadcast);

// Wire up session cleanup for task reassignment
setSessionCleanupFn((oldSessionKey: string) => {
  console.log(`[SessionCleanup] Removing stale session: ${oldSessionKey}`);
  sessionLastActivity.delete(oldSessionKey);
  knownSubagentSessions.delete(oldSessionKey);
  subagentTextBuffers.delete(oldSessionKey);
});

// Wire up eager session registration — called when a task is PATCH'd with a new sessionKey
// so we start capturing events immediately, before the first agent event arrives
setSessionRegistrationFn((sessionKey: string, taskId: string, agentId: string, title: string) => {
  console.log(`[EagerRegistration] Pre-registering session: ${sessionKey} for task: ${taskId}`);
  knownSubagentSessions.set(sessionKey, { agentId, title, startedAt: Date.now() });
  subagentTaskIds.set(sessionKey, taskId);
  subagentTextBuffers.set(sessionKey, '');
  subagentTitleExtracted.set(sessionKey, true); // Don't overwrite the user-provided title
});

// Note: completeTask poller removed — agents are responsible for moving their own
// tasks to review. Stuck in-progress tasks are visible on the board for manual triage.

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
        
        // Handle task activity watching
        else if (data.type === 'watch-task') {
          const taskId = data.taskId;
          if (taskId) {
            if (!taskWatchers.has(taskId)) taskWatchers.set(taskId, new Set());
            taskWatchers.get(taskId)!.add(socket);
            console.log('[ActivityStream] Client watching task:', taskId);
            socket.send(JSON.stringify({ 
              type: 'watching-task', 
              taskId,
              timestamp: new Date().toISOString(),
            }));

            // Replay buffered events so the watcher doesn't miss anything that happened before connecting
            const buffer = taskActivityBuffer.get(taskId) || [];
            if (buffer.length > 0) {
              console.log(`[ActivityStream] Replaying ${buffer.length} buffered events for task:`, taskId);
              for (const evt of buffer) {
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({
                    type: 'task-activity',
                    taskId,
                    replayed: true,
                    stream: evt.stream,
                    data: evt.data,
                    timestamp: evt.timestamp,
                  }));
                }
              }
            }
          }
        }
        
        else if (data.type === 'unwatch-task') {
          const taskId = data.taskId;
          if (taskId && taskWatchers.has(taskId)) {
            taskWatchers.get(taskId)!.delete(socket);
            console.log('[ActivityStream] Client unwatching task:', taskId);
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });
    
    socket.on('close', () => {
      console.log('Dashboard client disconnected');
      dashboardClients.delete(socket);
      // Remove from all task watchers
      for (const [, watchers] of taskWatchers) {
        watchers.delete(socket);
      }
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

// Handle agent stream events — track activity and detect completion for EXISTING tasks only.
// Tasks are NEVER auto-created here. They must be created via the UI or API first.
gatewayClient.on('agent', async (payload: any) => {
  try {
    const sessionKey = payload.sessionKey;
    const stream = payload.stream;
    const data = payload.data || {};

    // Only track subagent sessions
    if (!sessionKey || !sessionKey.includes(':subagent:')) {
      return;
    }

    // Update activity timestamp for this session
    sessionLastActivity.set(sessionKey, Date.now());

    // If we haven't loaded this session into memory yet, look it up in the DB
    if (!knownSubagentSessions.has(sessionKey)) {
      const existingTask = await findTaskBySessionKey(sessionKey);
      if (!existingTask) {
        // No task exists for this session — ignore it. Tasks must be created first.
        return;
      }

      // Track this existing task in memory for activity/completion detection
      const parts = sessionKey.split(':');
      const agentId = parts.length >= 2 ? parts[1] : 'unknown';
      
      knownSubagentSessions.set(sessionKey, {
        agentId,
        title: existingTask.title,
        startedAt: Date.now(),
      });
      subagentTaskIds.set(sessionKey, existingTask.id);
      subagentTextBuffers.set(sessionKey, '');
      subagentTitleExtracted.set(sessionKey, true); // Don't overwrite user-set titles

      console.log('[SubagentHandler] Tracking existing task for session:', {
        sessionKey,
        taskId: existingTask.id,
        title: existingTask.title,
      });
    }

    // Relay activity events to dashboard watchers and buffer for replay
    const watchTaskId = subagentTaskIds.get(sessionKey);
    if (watchTaskId) {
      const eventTimestamp = new Date().toISOString();
      const eventData = { delta: data.delta, phase: data.phase };

      // Push to ring buffer (cap at ACTIVITY_BUFFER_MAX)
      if (!taskActivityBuffer.has(watchTaskId)) taskActivityBuffer.set(watchTaskId, []);
      const buf = taskActivityBuffer.get(watchTaskId)!;
      buf.push({ stream, data: eventData, timestamp: eventTimestamp });
      if (buf.length > ACTIVITY_BUFFER_MAX) buf.shift();

      // Relay to live watchers
      const watchers = taskWatchers.get(watchTaskId);
      if (watchers && watchers.size > 0) {
        const activityMsg = JSON.stringify({
          type: 'task-activity',
          taskId: watchTaskId,
          stream,
          data: eventData,
          timestamp: eventTimestamp,
        });
        for (const watcher of watchers) {
          if (watcher.readyState === WebSocket.OPEN) {
            watcher.send(activityMsg);
          }
        }
      }
    }

    // Accumulate text for completion detection
    if (data.text && typeof data.text === 'string') {
      const currentBuffer = subagentTextBuffers.get(sessionKey) || '';
      subagentTextBuffers.set(sessionKey, currentBuffer + data.text);
    }

    // Clean up session tracking on completion signals
    if (hasCompletionMarker(data.text) || stream === 'complete' || stream === 'done' || (stream === 'lifecycle' && data.phase === 'end')) {
      console.log('[SubagentHandler] Session completed, cleaning up tracking:', sessionKey);
      
      // Schedule buffer cleanup after 5 minutes so late-connecting watchers can still replay
      const bufferTaskId = subagentTaskIds.get(sessionKey);
      if (bufferTaskId) {
        setTimeout(() => {
          taskActivityBuffer.delete(bufferTaskId);
          console.log('[ActivityBuffer] Cleaned up buffer for task:', bufferTaskId);
        }, 5 * 60 * 1000);
      }

      // Extract cost from transcript and update the task
      const taskId = subagentTaskIds.get(sessionKey);
      if (taskId) {
        try {
          const costData = await getSessionCostFromTranscript(sessionKey);
          if (costData && (costData.cost > 0 || costData.tokens.total > 0)) {
            const task = await findTaskBySessionKey(sessionKey);
            if (task && !task.cost) {
              await updateTask(task.id, {
                cost: costData.cost || undefined,
                tokens: costData.tokens.total > 0 ? costData.tokens : undefined,
                model: costData.model || undefined,
                runtime: costData.runtime || undefined,
              });
              console.log('[SubagentHandler] Updated task cost from transcript:', {
                taskId: task.id,
                cost: costData.cost,
                tokens: costData.tokens,
                model: costData.model,
              });
            }
          }
        } catch (err) {
          console.error('[SubagentHandler] Failed to extract cost from transcript:', err);
        }
      }

      sessionLastActivity.delete(sessionKey);
      knownSubagentSessions.delete(sessionKey);
      subagentTaskIds.delete(sessionKey);
      subagentTextBuffers.delete(sessionKey);
    }
  } catch (err) {
    console.error('[SubagentHandler] Error handling agent event:', err);
  }
});

// Handle subagent spawn events — log only, no auto-task-creation.
// Tasks must be created via UI or API before spawning agents.
gatewayClient.on('subagent-started', async (payload: any) => {
  const sessionKey = payload.sessionKey || payload.session || payload.id;
  console.log('[SubagentHandler] Subagent started (no auto-task-creation):', { sessionKey });
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

    // Try to extract commit hash from completion summary text
    let commitHash: string | undefined;
    let linesChanged: { added: number; removed: number; total: number } | undefined;
    
    // First try to extract from the completion summary
    if (completionSummary && typeof completionSummary === 'string') {
      commitHash = extractCommitHash(completionSummary);
    }
    
    // Fallback: if no explicit hash found, query git log for recent commits since task started
    const repoPath = join(process.env.HOME || '', '.openclaw', 'workspace', task.projectId || 'mission-clawtrol');
    if (!commitHash && task.createdAt) {
      const taskStartTime = new Date(task.createdAt);
      taskStartTime.setSeconds(taskStartTime.getSeconds() - 5);
      commitHash = await getMostRecentCommitHash(repoPath, taskStartTime);
    }
    
    // Get lines changed if we have a commit hash
    if (commitHash) {
      const diff = await getLinesChanged(commitHash, repoPath);
      if (diff.added > 0 || diff.removed > 0) {
        const MINUTES_PER_LINE = 3;
        const totalLines = diff.added + diff.removed;
        const estimatedHumanMinutes = totalLines * MINUTES_PER_LINE;
        const hourlyRate = getHumanHourlyRate();
        const humanCost = (estimatedHumanMinutes / 60) * hourlyRate;
        
        linesChanged = {
          added: diff.added,
          removed: diff.removed,
          total: totalLines,
        };
        
        console.log('[SubagentCompleted] Calculated lines changed:', {
          commitHash,
          linesChanged,
          estimatedHumanMinutes,
          humanCost,
        });
      }
    }

    // Update the task to review status (CSO will review and mark as done)
    const humanRate = getHumanHourlyRate();
    const updatedTask = await updateTask(task.id, {
      status: 'review',
      handoffNotes: completionSummary,
      tokens,
      cost,
      model,
      runtime,
      commitHash,
      linesChanged,
      // Estimate: AI is 10x faster than human. If AI took X seconds, human would take 10X seconds
      estimatedHumanMinutes: linesChanged 
        ? linesChanged.total * 3 
        : runtime ? Math.ceil((runtime / 1000) * 10 / 60) : undefined, // fallback: runtime-based estimate
      humanCost: linesChanged 
        ? (linesChanged.total * 3 / 60) * humanRate 
        : runtime ? ((runtime / 1000) * 10 / 60) * humanRate : undefined, // fallback: runtime-based estimate
    });

    console.log('[SubagentHandler] Updated task:', task.id, 'to review', {
      tokens,
      cost,
      model,
      runtime,
      commitHash,
      linesChanged,
    });

    // Broadcast the task update
    broadcast('task.updated', {
      id: updatedTask!.id,
      title: updatedTask!.title,
      status: updatedTask!.status,
      priority: updatedTask!.priority,
      updatedAt: updatedTask!.updatedAt,
      handoffNotes: updatedTask!.handoffNotes,
      tokens: updatedTask!.tokens,
      cost: updatedTask!.cost,
      model: updatedTask!.model,
      runtime: updatedTask!.runtime,
      commitHash: updatedTask!.commitHash,
      linesChanged: updatedTask!.linesChanged,
    });

    // Clean up
    sessionLastActivity.delete(sessionKey);
    knownSubagentSessions.delete(sessionKey);
    subagentTaskIds.delete(sessionKey);
    subagentTextBuffers.delete(sessionKey);
    subagentTitleExtracted.delete(sessionKey);
    
    // Clear any pending title extraction timer
    const timer = subagentTitleTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      subagentTitleTimers.delete(sessionKey);
    }

    // Schedule buffer cleanup after 5 minutes (keep for late-connecting watchers)
    if (task) {
      setTimeout(() => {
        taskActivityBuffer.delete(task.id);
        console.log('[ActivityBuffer] Cleaned up buffer for completed task:', task.id);
      }, 5 * 60 * 1000);
    }
  } catch (err) {
    console.error('[SubagentHandler] Error handling subagent-completed:', err);
  }
});

// Start server
const start = async () => {
  try {
    // Initialize SQLite database
    console.log('🗄️  Initializing SQLite database...');
    initializeDatabase();

    // Run one-time migration from JSON to SQLite
    console.log('📦 Running migration from JSON to SQLite...');
    await migrateFromJSON();

    // Seed built-in rules (idempotent — safe to run on every startup)
    console.log('📋 Seeding built-in rules...');
    await seedBuiltInRules();

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
