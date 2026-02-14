import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import { agentRoutes } from './routes/agents.js';
import { projectRoutes } from './routes/projects.js';
import { activityRoutes, logApprovalEvent, setBroadcastFunction } from './routes/activity.js';
import { approvalRoutes } from './routes/approvals.js';
import { taskRoutes } from './routes/tasks.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { gatewayClient, ApprovalRequest, ApprovalResolved } from './gateway-client.js';
import { loadAssociations } from './project-agents.js';
import { createTask, updateTask, findTaskBySessionKey } from './task-store.js';

const execAsync = promisify(exec);

const fastify = Fastify({
  logger: true,
});

// Track connected dashboard clients
const dashboardClients = new Set<WebSocket>();

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

  // Try to find "YOUR TASK:" pattern
  const taskMatch = text.match(/YOUR TASK[:\s]+([^\n]+)/i);
  if (taskMatch) {
    const extracted = taskMatch[1].trim().slice(0, 100);
    if (extracted.length > 10) return extracted;
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

          console.log('[TitleExtraction] Updated task title:', {
            taskId,
            sessionKey,
            oldTitle: 'Task in progress...',
            newTitle: betterTitle,
            textLength: accumulatedText.length,
          });

          // Broadcast the update
          broadcast('task-updated', {
            id: updatedTask!.id,
            title: updatedTask!.title,
            status: updatedTask!.status,
            priority: updatedTask!.priority,
            updatedAt: updatedTask!.updatedAt,
          });

          subagentTitleExtracted.set(sessionKey, true);
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

        console.log('[TitleExtraction] Updated task title (500 chars threshold):', {
          taskId,
          sessionKey,
          newTitle: betterTitle,
          textLength: accumulatedText.length,
        });

        // Broadcast the update
        broadcast('task-updated', {
          id: updatedTask!.id,
          title: updatedTask!.title,
          status: updatedTask!.status,
          priority: updatedTask!.priority,
          updatedAt: updatedTask!.updatedAt,
        });

        subagentTitleExtracted.set(sessionKey, true);

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
 * Calculate lines changed from a git commit
 */
async function getLinesChanged(
  commitHash: string,
  repoPath: string
): Promise<{ added: number; removed: number }> {
  try {
    console.log('[LinesChanged] Getting diff for commit:', commitHash);
    const command = `git -C ${repoPath} diff --shortstat ${commitHash}^..${commitHash}`;
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
 * Complete a task and move it to review status
 * (CSO will review and mark as done)
 */
async function completeTask(sessionKey: string) {
  try {
    console.log('[CompleteTask] Starting completion for session:', sessionKey);
    
    const task = await findTaskBySessionKey(sessionKey);
    if (!task) {
      console.log('[CompleteTask] Task not found for session:', sessionKey);
      return;
    }

    console.log('[CompleteTask] Found task:', {
      taskId: task.id,
      title: task.title,
      status: task.status,
      sessionKey,
    });

    if (task.status === 'in-progress') {
      const accumulatedText = subagentTextBuffers.get(sessionKey) || '';
      console.log('[CompleteTask] Accumulated text length:', accumulatedText.length);
      console.log('[CompleteTask] First 500 chars of accumulated text:', accumulatedText.substring(0, 500));
      
      // Extract commit hash from accumulated text
      const commitHash = extractCommitHash(accumulatedText);
      
      // Calculate lines changed if we have a commit hash
      let linesChanged: { added: number; removed: number; total: number } | undefined;
      let estimatedHumanMinutes: number | undefined;
      let humanCost: number | undefined;
      
      if (commitHash) {
        console.log('[CompleteTask] Found commit hash:', commitHash);
        const repoPath = '/home/chris/.openclaw/workspace/mission-clawtrol';
        const diff = await getLinesChanged(commitHash, repoPath);
        
        if (diff.added > 0 || diff.removed > 0) {
          const MINUTES_PER_LINE = 3; // Industry average for careful coding
          const totalLines = diff.added + diff.removed;
          estimatedHumanMinutes = totalLines * MINUTES_PER_LINE;
          
          // Get hourly rate from settings (default $100)
          // TODO: fetch from settings endpoint if needed, for now using hardcoded default
          const hourlyRate = 100;
          humanCost = (estimatedHumanMinutes / 60) * hourlyRate;
          
          linesChanged = {
            added: diff.added,
            removed: diff.removed,
            total: totalLines,
          };
          
          console.log('[CompleteTask] Calculated metrics:', {
            commitHash,
            linesChanged,
            estimatedHumanMinutes,
            humanCost,
          });
        } else {
          console.log('[CompleteTask] No lines changed for commit:', commitHash);
        }
      } else {
        console.log('[CompleteTask] No commit hash found in accumulated text');
      }
      
      const updatedTask = await updateTask(task.id, {
        status: 'review', // Move to review, not done - CSO will review and mark done
        updatedAt: new Date().toISOString(),
        commitHash,
        linesChanged,
        estimatedHumanMinutes,
        humanCost,
      });

      console.log('[CompleteTask] Successfully updated task:', {
        taskId: updatedTask!.id,
        status: updatedTask!.status,
        commitHash: updatedTask!.commitHash,
        linesChanged: updatedTask!.linesChanged,
      });

      // Broadcast the update
      broadcast('task-updated', {
        id: updatedTask!.id,
        title: updatedTask!.title,
        status: updatedTask!.status,
        priority: updatedTask!.priority,
        updatedAt: updatedTask!.updatedAt,
        handoffNotes: updatedTask!.handoffNotes,
        commitHash: updatedTask!.commitHash,
        linesChanged: updatedTask!.linesChanged,
        estimatedHumanMinutes: updatedTask!.estimatedHumanMinutes,
        humanCost: updatedTask!.humanCost,
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
    } else {
      console.log('[CompleteTask] Task not in in-progress status, skipping completion:', {
        currentStatus: task.status,
      });
    }
  } catch (err) {
    console.error('[CompleteTask] Error completing task:', err);
  }
}

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
await fastify.register(settingsRoutes, { prefix: '/api/settings' });

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

// Start a timer to check for stale sessions (30 seconds of inactivity = completion)
const completionCheckInterval = setInterval(() => {
  const now = Date.now();
  
  // Log all tracked sessions for debugging
  if (sessionLastActivity.size > 0) {
    console.log('[CompletionCheck] Currently tracking', sessionLastActivity.size, 'sessions');
  }
  
  for (const [sessionKey, lastActivity] of sessionLastActivity.entries()) {
    const inactivityTime = now - lastActivity;
    console.log('[CompletionCheck] Checking session:', {
      sessionKey,
      inactivityMs: inactivityTime,
      isSubagent: sessionKey.includes(':subagent:'),
    });
    
    if (inactivityTime > 30000) { // 30 seconds of inactivity
      console.log('[CompletionCheck] ✅ Session inactive for 30s, triggering completion:', {
        sessionKey,
        inactivityMs: inactivityTime,
      });
      completeTask(sessionKey);
    }
  }
}, 15000); // Check every 15 seconds

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

    console.log('[SubagentHandler] Received agent event for subagent:', {
      sessionKey,
      stream,
      dataKeys: Object.keys(data),
      hasText: !!data.text,
      textLength: data.text?.length || 0,
    });

    // Update activity timestamp for this session
    sessionLastActivity.set(sessionKey, Date.now());

    // Check if this is a NEW subagent session
    // IMPORTANT: Check both the in-memory set AND the database to prevent duplicates
    if (!knownSubagentSessions.has(sessionKey)) {
      // First check if task already exists in database
      const existingTask = await findTaskBySessionKey(sessionKey);
      if (existingTask) {
        // Task already exists - just track it in memory and return
        console.log('[SubagentHandler] ✅ Task already exists for session:', sessionKey, 'Task ID:', existingTask.id);
        
        // Register this session in memory
        const parts = sessionKey.split(':');
        const agentId = parts.length >= 2 ? parts[1] : 'unknown';
        knownSubagentSessions.set(sessionKey, {
          agentId,
          title: existingTask.title,
          startedAt: Date.now(),
        });
        
        subagentTaskIds.set(sessionKey, existingTask.id);
        subagentTextBuffers.set(sessionKey, '');
        subagentTitleExtracted.set(sessionKey, existingTask.title !== 'Task in progress...');
        
        // CRITICAL: Make sure we're tracking activity for existing task!
        console.log('[SubagentHandler] 🔔 Activity timestamp updated for existing task:', {
          sessionKey,
          timestamp: Date.now(),
        });
        
        return; // Don't create duplicate
      }

      // Extract agentId from sessionKey (format: "agent:senior-dev:subagent:...")
      const parts = sessionKey.split(':');
      const agentId = parts.length >= 2 ? parts[1] : 'unknown';

      // Start with a placeholder title - we'll extract a better one later
      const title = 'Task in progress...';

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

      // Initialize text buffer for this session
      subagentTextBuffers.set(sessionKey, '');
      subagentTitleExtracted.set(sessionKey, false);

      // Create a task for this subagent with placeholder title
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

        // Schedule title extraction (will extract after 5 seconds or when 500+ chars accumulate)
        await scheduleTitleExtraction(sessionKey, task.id);
      } catch (err) {
        console.error('[SubagentHandler] Error creating task:', err);
      }
    }

    // Accumulate text for title extraction
    if (data.text && typeof data.text === 'string') {
      const currentBuffer = subagentTextBuffers.get(sessionKey) || '';
      const newBuffer = currentBuffer + data.text;
      subagentTextBuffers.set(sessionKey, newBuffer);

      console.log('[SubagentHandler] Accumulated text:', {
        sessionKey,
        addedLength: data.text.length,
        totalBufferLength: newBuffer.length,
        firstCharOfNew: data.text.substring(0, 30),
      });

      // Check if we should extract title now (500+ chars accumulated)
      const taskId = subagentTaskIds.get(sessionKey);
      if (taskId) {
        await checkAndExtractTitle(sessionKey, taskId);
      }
    }

    // Check for completion markers in the event text
    const hasMarker = hasCompletionMarker(data.text);
    console.log('[SubagentHandler] Checking for completion markers:', {
      sessionKey,
      textLength: data.text?.length || 0,
      hasMarker,
      markers: hasMarker ? [completionMarkers.find(m => data.text?.includes(m))] : [],
    });
    
    if (hasMarker) {
      console.log('[SubagentHandler] ✅ Detected completion marker in agent event:', {
        sessionKey,
        marker: completionMarkers.find(m => data.text.includes(m)),
      });
      await completeTask(sessionKey);
      return;
    }

    // Check for stream completion indicators
    if (stream === 'complete' || stream === 'done') {
      console.log('[SubagentHandler] ✅ Detected subagent completion (stream event):', {
        sessionKey,
        stream,
      });
      await completeTask(sessionKey);
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

    // CRITICAL: Check if task already exists for this sessionKey to prevent duplicates
    const existingTask = await findTaskBySessionKey(sessionKey);
    if (existingTask) {
      console.log('[SubagentHandler] Task already exists for session:', sessionKey, 'Task ID:', existingTask.id);
      return; // Don't create duplicate
    }

    // Also check the in-memory set
    if (knownSubagentSessions.has(sessionKey)) {
      console.log('[SubagentHandler] Session already being tracked:', sessionKey);
      return; // Already tracking this session
    }

    // Extract title from description (first line or first 60 chars)
    const titleLines = description.split('\n');
    const title = titleLines[0].substring(0, 100) || 'Subagent task';

    // Mark session as known before creating task
    knownSubagentSessions.set(sessionKey, {
      agentId,
      title,
      startedAt: Date.now(),
    });

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

    subagentTaskIds.set(sessionKey, task.id);
    subagentTextBuffers.set(sessionKey, '');
    subagentTitleExtracted.set(sessionKey, false);

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

    // Update the task to review status (CSO will review and mark as done)
    const updatedTask = await updateTask(task.id, {
      status: 'review',
      handoffNotes: completionSummary,
      tokens,
      cost,
      model,
      runtime,
    });

    console.log('[SubagentHandler] Updated task:', task.id, 'to review', {
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
      updatedAt: updatedTask!.updatedAt,
      handoffNotes: updatedTask!.handoffNotes,
      tokens: updatedTask!.tokens,
      cost: updatedTask!.cost,
      model: updatedTask!.model,
      runtime: updatedTask!.runtime,
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
