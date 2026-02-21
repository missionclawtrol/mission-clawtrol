/**
 * Chat relay routes — proxies messages to OpenClaw agents via gateway HTTP API
 * Supports both WebSocket (streaming) and REST (blocking) modes.
 */
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createInterface } from 'readline';

const GATEWAY_HTTP_URL = process.env.GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const OPENCLAW_HOME = join(process.env.HOME || '', '.openclaw/agents');

// In-memory chat history per session key (cleared on restart)
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const chatHistories = new Map<string, ChatMessage[]>();

function getSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

function addToHistory(agentId: string, role: 'user' | 'assistant', content: string) {
  const key = agentId;
  if (!chatHistories.has(key)) {
    chatHistories.set(key, []);
  }
  const history = chatHistories.get(key)!;
  history.push({ role, content, timestamp: Date.now() });
  // Keep last 100 messages
  if (history.length > 100) {
    chatHistories.set(key, history.slice(-100));
  }
}

function getHistory(agentId: string, limit = 50): ChatMessage[] {
  const history = chatHistories.get(agentId) || [];
  return history.slice(-limit);
}

/**
 * Build message content with context injection
 */
function buildMessageWithContext(
  userMessage: string,
  context?: {
    route?: string;
    projectId?: string;
    taskId?: string;
    taskTitle?: string;
  }
): string {
  if (!context || (!context.route && !context.projectId && !context.taskId)) {
    return userMessage;
  }

  const parts: string[] = ['[MC Context:'];
  if (context.route) parts.push(`page=${context.route}`);
  if (context.projectId) parts.push(`project=${context.projectId}`);
  if (context.taskId) parts.push(`task=${context.taskId}`);
  if (context.taskTitle) parts.push(`taskTitle="${context.taskTitle}"`);
  parts.push(']');

  return `${parts.join(' ')}\n\n${userMessage}`;
}

/**
 * Send a message to the agent via the gateway OpenAI-compatible HTTP API.
 * Returns an async generator that yields text chunks.
 */
async function* streamChatCompletion(
  agentId: string,
  message: string,
  context?: { route?: string; projectId?: string; taskId?: string; taskTitle?: string }
): AsyncGenerator<string> {
  const fullMessage = buildMessageWithContext(message, context);
  const sessionKey = getSessionKey(agentId);

  // Build messages array (include recent in-memory history for session continuity)
  const recentHistory = getHistory(agentId, 10);
  const messages: { role: string; content: string }[] = [
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: fullMessage },
  ];

  const response = await fetch(`${GATEWAY_HTTP_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': agentId,
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: true,
      messages,
      user: `mc-dashboard-${agentId}`,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gateway HTTP ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('No response body from gateway');
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ':') continue;
        if (!trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Read historical messages from the agent's JSONL transcript
 */
async function readTranscriptHistory(agentId: string, limit = 50): Promise<ChatMessage[]> {
  try {
    const sessionsIndexPath = join(OPENCLAW_HOME, agentId, 'sessions', 'sessions.json');
    const indexData = await readFile(sessionsIndexPath, 'utf-8');
    const sessionsIndex = JSON.parse(indexData);

    // Find the main session
    const sessionKey = `agent:${agentId}:main`;
    const sessionData = sessionsIndex[sessionKey];

    let sessionFile: string | null = null;
    if (sessionData?.sessionFile) {
      sessionFile = sessionData.sessionFile;
    } else if (sessionData?.sessionId) {
      sessionFile = join(OPENCLAW_HOME, agentId, 'sessions', `${sessionData.sessionId}.jsonl`);
    }

    if (!sessionFile) return [];

    // Parse JSONL
    const rawLines: any[] = await new Promise((resolve, reject) => {
      const lines: any[] = [];
      const fileStream = createReadStream(sessionFile!);
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          if (line.trim()) lines.push(JSON.parse(line));
        } catch {}
      });
      rl.on('close', () => resolve(lines));
      rl.on('error', reject);
    });

    // Convert to simple format
    const result: ChatMessage[] = [];
    for (const raw of rawLines) {
      try {
        if (raw.type === 'message' && raw.message) {
          const msg = raw.message;
          const role = msg.role;
          if (role === 'user' || role === 'assistant') {
            let content = '';
            if (typeof msg.content === 'string') {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              content = msg.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text || '')
                .join('\n')
                .trim();
            }
            if (content) {
              result.push({ role, content, timestamp: msg.timestamp || raw.timestamp || 0 });
            }
          }
        }
      } catch {}
    }

    return result.slice(-limit);
  } catch {
    return [];
  }
}

export async function chatRoutes(fastify: FastifyInstance) {
  // POST /api/chat/send — blocking send (REST fallback)
  fastify.post<{
    Body: {
      message: string;
      agentId?: string;
      context?: {
        route?: string;
        projectId?: string;
        taskId?: string;
        taskTitle?: string;
      };
    };
  }>('/send', async (request, reply) => {
    const { message, agentId = 'cso', context } = request.body;

    if (!message?.trim()) {
      return reply.status(400).send({ error: 'message is required' });
    }

    // Record user message
    addToHistory(agentId, 'user', message);

    try {
      let fullResponse = '';
      for await (const chunk of streamChatCompletion(agentId, message, context)) {
        fullResponse += chunk;
      }

      // Record assistant response
      addToHistory(agentId, 'assistant', fullResponse);

      return {
        success: true,
        agentId,
        message: fullResponse,
        timestamp: Date.now(),
      };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(`[Chat] Send failed: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/chat/history — fetch recent chat history
  fastify.get<{
    Querystring: { agentId?: string; limit?: string; source?: string };
  }>('/history', async (request, reply) => {
    const { agentId = 'cso', limit = '50', source = 'memory' } = request.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);

    try {
      let messages: ChatMessage[];
      if (source === 'transcript') {
        messages = await readTranscriptHistory(agentId, limitNum);
      } else {
        messages = getHistory(agentId, limitNum);
      }

      return { agentId, messages, total: messages.length };
    } catch (error) {
      fastify.log.error({ err: error }, '[Chat] History failed');
      return reply.status(500).send({ error: 'Failed to fetch history' });
    }
  });

  // GET /api/chat/agents — list available agents for chat
  fastify.get('/agents', async (_request, _reply) => {
    try {
      // Read agents from openclaw config
      const configPath = join(process.env.HOME || '', '.openclaw', 'openclaw.json');
      const data = await readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      const agents = config?.agents?.list || [];

      return {
        agents: agents.map((a: any) => ({
          id: a.id,
          name: a.name || a.id,
          emoji: a.identity?.emoji || '🤖',
          model: a.model || 'unknown',
        })),
      };
    } catch (error) {
      fastify.log.error({ err: error }, '[Chat] Agents list failed');
      return { agents: [{ id: 'cso', name: 'Chief Strategy Officer', emoji: '🎯', model: 'unknown' }] };
    }
  });

  // WebSocket /api/chat/ws — streaming chat
  fastify.register(async function (wsPlugin) {
    wsPlugin.get('/ws', { websocket: true }, (socket, _req) => {
      console.log('[ChatWS] Client connected');

      let currentAgentId = 'cso';
      let isStreaming = false;

      function send(data: object) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      }

      // Send welcome
      send({
        type: 'connected',
        timestamp: new Date().toISOString(),
        agentId: currentAgentId,
        history: getHistory(currentAgentId, 30),
      });

      socket.on('message', async (raw) => {
        let data: any;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return send({ type: 'error', error: 'Invalid JSON' });
        }

        // Handle agent switch
        if (data.type === 'switch-agent') {
          currentAgentId = data.agentId || 'cso';
          return send({
            type: 'agent-switched',
            agentId: currentAgentId,
            history: getHistory(currentAgentId, 30),
          });
        }

        // Handle message send
        if (data.type === 'message') {
          if (isStreaming) {
            return send({ type: 'error', error: 'Already processing a message' });
          }

          const message = data.content?.trim();
          if (!message) {
            return send({ type: 'error', error: 'Empty message' });
          }

          const agentId = data.agentId || currentAgentId;
          currentAgentId = agentId;
          const context = data.context;

          // Echo user message back (so UI can confirm it was received)
          send({
            type: 'user-message',
            content: message,
            agentId,
            timestamp: Date.now(),
          });

          // Record in history
          addToHistory(agentId, 'user', message);

          // Stream response
          isStreaming = true;
          send({ type: 'stream-start', agentId, timestamp: Date.now() });

          let fullResponse = '';
          try {
            for await (const chunk of streamChatCompletion(agentId, message, context)) {
              fullResponse += chunk;
              send({ type: 'stream-chunk', content: chunk });

              // Check if socket is still open
              if (socket.readyState !== WebSocket.OPEN) break;
            }

            // Record assistant response
            addToHistory(agentId, 'assistant', fullResponse);

            send({
              type: 'stream-end',
              agentId,
              fullContent: fullResponse,
              timestamp: Date.now(),
            });
          } catch (error) {
            const err = error as Error;
            console.error('[ChatWS] Stream error:', err.message);
            send({ type: 'error', error: err.message });
          } finally {
            isStreaming = false;
          }

          return;
        }

        // Handle history request
        if (data.type === 'get-history') {
          const agentId = data.agentId || currentAgentId;
          return send({
            type: 'history',
            agentId,
            messages: getHistory(agentId, data.limit || 50),
          });
        }

        // Handle clear history
        if (data.type === 'clear-history') {
          const agentId = data.agentId || currentAgentId;
          chatHistories.delete(agentId);
          return send({ type: 'history-cleared', agentId });
        }
      });

      socket.on('close', () => {
        console.log('[ChatWS] Client disconnected');
      });

      socket.on('error', (err) => {
        console.error('[ChatWS] Socket error:', err.message);
      });
    });
  });
}
