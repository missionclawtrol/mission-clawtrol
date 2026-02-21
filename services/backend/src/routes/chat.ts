/**
 * Chat relay routes — proxies messages to OpenClaw agents via gateway /tools/invoke API
 * Uses sessions_send for reliable, non-hanging message delivery.
 */
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { join } from 'path';

const GATEWAY_PORT = (() => {
  const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
  try {
    return new URL(url.replace('ws://', 'http://').replace('wss://', 'https://')).port || '18789';
  } catch {
    return '18789';
  }
})();

const GATEWAY_HTTP_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// Map of agentId -> spawned chat session key
const chatSessions = new Map<string, string>();

// In-memory chat history per agent (cleared on restart)
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const chatHistories = new Map<string, ChatMessage[]>();

function addToHistory(agentId: string, role: 'user' | 'assistant', content: string) {
  if (!chatHistories.has(agentId)) {
    chatHistories.set(agentId, []);
  }
  const history = chatHistories.get(agentId)!;
  history.push({ role, content, timestamp: Date.now() });
  if (history.length > 100) {
    chatHistories.set(agentId, history.slice(-100));
  }
}

function getHistory(agentId: string, limit = 50): ChatMessage[] {
  const history = chatHistories.get(agentId) || [];
  return history.slice(-limit);
}

/**
 * Build message content with MC dashboard context prefix
 */
function buildMessageWithContext(
  userMessage: string,
  context?: { route?: string; projectId?: string; taskId?: string; taskTitle?: string }
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
 * Spawn a dedicated chat session for an agent (if not already spawned).
 * Returns the session key for the chat session.
 */
async function getOrSpawnChatSession(agentId: string): Promise<string> {
  const existing = chatSessions.get(agentId);
  if (existing) return existing;

  console.log(`[Chat] Spawning dedicated chat session for ${agentId}...`);

  const response = await fetch(`${GATEWAY_HTTP_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      tool: 'sessions_spawn',
      args: {
        agentId,
        task: `You are responding to the user via the Mission Clawtrol dashboard chat panel. Keep responses concise and helpful. You can use tools when explicitly asked, but prefer quick text answers. This is a lightweight chat session — not the main agent session.`,
        label: `mc-chat-${agentId}`,
        cleanup: 'keep',
        runTimeoutSeconds: 0, // no timeout — keep alive
      },
    }),
  });

  const result = (await response.json()) as any;

  if (!response.ok || !result.ok) {
    const errMsg = result.error?.message || result.error || `HTTP ${response.status}`;
    throw new Error(`Failed to spawn chat session: ${errMsg}`);
  }

  const sessionKey =
    result.result?.details?.childSessionKey ||
    result.result?.childSessionKey ||
    result.result?.sessionKey;

  if (!sessionKey) {
    throw new Error('No session key returned from spawn');
  }

  chatSessions.set(agentId, sessionKey);
  console.log(`[Chat] Chat session for ${agentId}: ${sessionKey}`);
  return sessionKey;
}

/**
 * Send a message to an agent's dedicated chat session via sessions_send.
 * Returns the agent's reply text. Non-streaming, reliable.
 */
async function sendToAgent(
  agentId: string,
  message: string,
  context?: { route?: string; projectId?: string; taskId?: string; taskTitle?: string }
): Promise<string> {
  const fullMessage = buildMessageWithContext(message, context);

  let sessionKey: string;
  try {
    sessionKey = await getOrSpawnChatSession(agentId);
  } catch (err) {
    console.error(`[Chat] Failed to get chat session for ${agentId}:`, (err as Error).message);
    throw new Error(`Could not connect to ${agentId}. Try again in a moment.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${GATEWAY_HTTP_URL}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: {
          sessionKey,
          message: fullMessage,
          timeoutSeconds: 120,
        },
      }),
      signal: controller.signal,
    });

    const result = (await response.json()) as any;

    if (!response.ok || !result.ok) {
      const errMsg = result.error?.message || result.error || `HTTP ${response.status}`;
      // If session expired or not found, clear cache and retry once
      if (errMsg.includes('not found') || errMsg.includes('expired') || errMsg.includes('no session')) {
        chatSessions.delete(agentId);
        throw new Error(`Session expired for ${agentId}. Please send your message again.`);
      }
      throw new Error(`Gateway error: ${errMsg}`);
    }

    // Extract the agent's reply text from the result
    const details = result.result?.details || result.result || {};
    const contentArr = result.result?.content || [];
    const textContent = contentArr.find?.((c: any) => c.type === 'text');

    // sessions_send returns the reply in content[].text or details.text
    let replyText = '';
    if (textContent?.text) {
      // The text might be JSON with the actual reply
      try {
        const parsed = JSON.parse(textContent.text);
        replyText = parsed.reply || parsed.text || parsed.content || textContent.text;
      } catch {
        replyText = textContent.text;
      }
    } else if (details.text) {
      replyText = details.text;
    } else if (details.reply) {
      replyText = details.reply;
    } else if (typeof result.result === 'string') {
      replyText = result.result;
    }

    return replyText || 'Agent responded but returned no text.';
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatRoutes(fastify: FastifyInstance) {
  // POST /api/chat/send — blocking send (REST)
  fastify.post<{
    Body: {
      message: string;
      agentId?: string;
      context?: { route?: string; projectId?: string; taskId?: string; taskTitle?: string };
    };
  }>('/send', async (request, reply) => {
    const { message, agentId = 'cso', context } = request.body;

    if (!message?.trim()) {
      return reply.status(400).send({ error: 'message is required' });
    }

    addToHistory(agentId, 'user', message);

    try {
      const responseText = await sendToAgent(agentId, message, context);
      addToHistory(agentId, 'assistant', responseText);

      return {
        success: true,
        agentId,
        message: responseText,
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
    Querystring: { agentId?: string; limit?: string };
  }>('/history', async (request) => {
    const { agentId = 'cso', limit = '50' } = request.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const messages = getHistory(agentId, limitNum);
    return { agentId, messages, total: messages.length };
  });

  // GET /api/chat/agents — list available agents for chat
  fastify.get('/agents', async () => {
    try {
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
    } catch {
      return { agents: [{ id: 'cso', name: 'Chief Strategy Officer', emoji: '🎯', model: 'unknown' }] };
    }
  });

  // WebSocket route — registered separately at root level (see index.ts)
  // because @fastify/websocket decorations don't propagate into prefixed plugins.
}

/**
 * Chat WebSocket handler — register at root level with full path.
 */
export async function chatWsRoute(fastify: FastifyInstance) {
  fastify.get('/api/chat/ws', { websocket: true }, (socket, _req) => {
      console.log('[ChatWS] Client connected');

      let currentAgentId = 'cso';
      let isProcessing = false;

      function send(data: object) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      }

      // Send welcome with history
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
          if (isProcessing) {
            return send({ type: 'error', error: 'Already processing a message — please wait' });
          }

          const message = data.content?.trim();
          if (!message) {
            return send({ type: 'error', error: 'Empty message' });
          }

          const agentId = data.agentId || currentAgentId;
          currentAgentId = agentId;
          const context = data.context;

          // Echo user message
          send({ type: 'user-message', content: message, agentId, timestamp: Date.now() });

          addToHistory(agentId, 'user', message);

          // Send to agent (non-streaming, reliable)
          isProcessing = true;
          send({ type: 'stream-start', agentId, timestamp: Date.now() });

          try {
            const responseText = await sendToAgent(agentId, message, context);

            addToHistory(agentId, 'assistant', responseText);

            // Send as one chunk then end — keeps frontend protocol compatible
            send({ type: 'stream-chunk', content: responseText });
            send({ type: 'stream-end', agentId, fullContent: responseText, timestamp: Date.now() });
          } catch (error) {
            const err = error as Error;
            console.error('[ChatWS] Error:', err.message);
            send({ type: 'stream-end', agentId, fullContent: '', timestamp: Date.now() });
            send({ type: 'error', error: err.message });
          } finally {
            isProcessing = false;
          }

          return;
        }

        // Handle history request
        if (data.type === 'get-history') {
          const agentId = data.agentId || currentAgentId;
          return send({ type: 'history', agentId, messages: getHistory(agentId, data.limit || 50) });
        }

        // Handle clear history
        if (data.type === 'clear-history') {
          const agentId = data.agentId || currentAgentId;
          chatHistories.delete(agentId);
          return send({ type: 'history-cleared', agentId });
        }
      });

      socket.on('close', () => console.log('[ChatWS] Client disconnected'));
      socket.on('error', (err) => console.error('[ChatWS] Socket error:', err.message));
    });
}
