import { FastifyInstance } from 'fastify';
import { readFile, readdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: string;
  toolCalls?: { name: string; arguments: any }[];
}

interface TranscriptResponse {
  sessionId: string;
  agentId: string;
  messages: TranscriptMessage[];
  totalMessages: number;
}

interface SessionEntry {
  sessionId: string;
  updatedAt: number;
  [key: string]: any;
}

interface SessionsIndex {
  [key: string]: SessionEntry;
}

// Helper to read JSONL file line by line
async function parseJsonlFile(filePath: string, limit?: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const lines: any[] = [];
    const fileStream = createReadStream(filePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    rl.on('line', (line) => {
      if (limit && lineCount >= limit) {
        rl.close();
        fileStream.destroy();
        return;
      }

      try {
        if (line.trim()) {
          const parsed = JSON.parse(line);
          lines.push(parsed);
          lineCount++;
        }
      } catch (err) {
        console.error(`Error parsing JSONL line: ${err}`);
        // Skip malformed lines
      }
    });

    rl.on('close', () => {
      resolve(lines);
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

// Extract text content from assistant message content array
function extractTextContent(content: any[]): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || block.content || '')
    .join('\n')
    .trim();
}

// Extract tool calls from assistant message content array
function extractToolCalls(content: any[]): { name: string; arguments: any }[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const toolCalls = content
    .filter((block) => block.type === 'toolCall')
    .map((block) => ({
      name: block.name,
      arguments: block.arguments || {},
    }));

  return toolCalls.length > 0 ? toolCalls : undefined;
}

// Convert raw JSONL message to transcript format
function convertMessageToTranscript(rawMessage: any): TranscriptMessage | null {
  try {
    // Handle different message formats
    if (rawMessage.type === 'message' && rawMessage.message) {
      const msg = rawMessage.message;
      const timestamp = msg.timestamp || rawMessage.timestamp;
      const role = msg.role;

      if (role === 'user' || role === 'system') {
        // Extract text content from user/system messages
        let textContent = '';
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (Array.isArray(msg.content)) {
          textContent = msg.content
            .filter((block: any) => typeof block === 'string' || block.type === 'text')
            .map((block: any) => (typeof block === 'string' ? block : block.text || block.content || ''))
            .join('\n')
            .trim();
        }

        return {
          role,
          timestamp,
          content: textContent,
        };
      } else if (role === 'assistant') {
        // Extract text and tool calls from assistant messages
        const textContent = extractTextContent(msg.content || []);
        const toolCalls = extractToolCalls(msg.content || []);

        return {
          role: 'assistant',
          timestamp,
          content: textContent,
          ...(toolCalls && { toolCalls }),
        };
      } else if (role === 'toolResult') {
        // Convert tool results to a readable format
        let content = '';
        if (msg.content) {
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content
              .map((block: any) => (typeof block === 'string' ? block : block.text || block.content || ''))
              .join('\n')
              .trim();
          }
        }

        return {
          role: 'system',
          timestamp,
          content: `[Tool Result: ${msg.toolName || 'unknown'}]\n${content}`,
        };
      }
    }
  } catch (err) {
    console.error('Error converting message:', err);
  }

  return null;
}

export async function sessionRoutes(fastify: FastifyInstance) {
  const OPENCLAW_HOME = join(process.env.HOME || '', '.openclaw/agents');

  // GET /api/sessions/:agentId - List all sessions for an agent
  fastify.get<{
    Params: { agentId: string };
  }>('/:agentId', async (request, reply) => {
    const { agentId } = request.params;

    try {
      // Read sessions.json for the agent
      const sessionsPath = join(OPENCLAW_HOME, agentId, 'sessions', 'sessions.json');
      const data = await readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(data) as SessionsIndex;

      // Convert to array format with basic info
      const sessionList = Object.entries(sessions).map(([sessionKey, session]) => ({
        sessionKey,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        model: session.model,
        totalTokens: session.totalTokens,
        lastChannel: session.lastChannel,
      }));

      // Sort by updatedAt descending
      sessionList.sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        agentId,
        sessions: sessionList,
        totalSessions: sessionList.length,
      };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);

      if (err.message.includes('ENOENT')) {
        return reply.status(404).send({ error: `Agent ${agentId} not found` });
      }

      return reply.status(500).send({ error: `Failed to list sessions: ${err.message}` });
    }
  });

  // GET /api/sessions/:agentId/:sessionId/transcript - Get parsed transcript
  fastify.get<{
    Params: { agentId: string; sessionId: string };
    Querystring: { limit?: string };
  }>('/:agentId/:sessionId/transcript', async (request, reply) => {
    const { agentId, sessionId } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit) : undefined;

    try {
      // First, find the session in sessions.json to get the JSONL file path
      const sessionsIndexPath = join(OPENCLAW_HOME, agentId, 'sessions', 'sessions.json');
      const indexData = await readFile(sessionsIndexPath, 'utf-8');
      const sessionsIndex = JSON.parse(indexData) as SessionsIndex;

      // Find the session by sessionId or sessionKey
      let sessionFile: string | null = null;
      let foundSessionKey: string | null = null;

      // Try to find by sessionKey first (sessionId parameter might actually be a key)
      if (sessionsIndex[sessionId]) {
        sessionFile = sessionsIndex[sessionId].sessionFile;
        foundSessionKey = sessionId;
      } else {
        // Find by sessionId
        for (const [key, session] of Object.entries(sessionsIndex)) {
          if (session.sessionId === sessionId) {
            sessionFile = session.sessionFile;
            foundSessionKey = key;
            break;
          }
        }
      }

      if (!sessionFile) {
        return reply.status(404).send({ error: `Session ${sessionId} not found for agent ${agentId}` });
      }

      // Parse the JSONL file
      const rawMessages = await parseJsonlFile(sessionFile, limit);

      // Convert to transcript format
      const messages: TranscriptMessage[] = rawMessages
        .map((msg) => convertMessageToTranscript(msg))
        .filter((msg): msg is TranscriptMessage => msg !== null);

      return {
        sessionId: sessionId,
        agentId,
        sessionKey: foundSessionKey,
        messages,
        totalMessages: messages.length,
      } as TranscriptResponse & { sessionKey: string };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);

      if (err.message.includes('ENOENT')) {
        return reply.status(404).send({ error: `Session file not found for agent ${agentId} / session ${sessionId}` });
      }

      if (err.message.includes('JSON')) {
        return reply.status(400).send({ error: 'Malformed session data' });
      }

      return reply.status(500).send({ error: `Failed to fetch transcript: ${err.message}` });
    }
  });

  // GET /api/sessions/:agentId/:sessionId - Get session metadata
  fastify.get<{
    Params: { agentId: string; sessionId: string };
  }>('/:agentId/:sessionId', async (request, reply) => {
    const { agentId, sessionId } = request.params;

    try {
      const sessionsPath = join(OPENCLAW_HOME, agentId, 'sessions', 'sessions.json');
      const data = await readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(data) as SessionsIndex;

      let session: SessionEntry | null = null;
      let sessionKey: string | null = null;

      // Try sessionId as key first
      if (sessions[sessionId]) {
        session = sessions[sessionId];
        sessionKey = sessionId;
      } else {
        // Find by sessionId
        for (const [key, value] of Object.entries(sessions)) {
          if (value.sessionId === sessionId) {
            session = value;
            sessionKey = key;
            break;
          }
        }
      }

      if (!session) {
        return reply.status(404).send({ error: `Session ${sessionId} not found` });
      }

      return {
        sessionKey,
        sessionId: session.sessionId,
        agentId,
        model: session.model,
        totalTokens: session.totalTokens,
        updatedAt: session.updatedAt,
        lastChannel: session.lastChannel,
        chatType: session.chatType,
        sessionFile: session.sessionFile,
      };
    } catch (error) {
      const err = error as Error;
      fastify.log.error(error);

      if (err.message.includes('ENOENT')) {
        return reply.status(404).send({ error: `Agent ${agentId} not found` });
      }

      return reply.status(500).send({ error: `Failed to fetch session: ${err.message}` });
    }
  });
}
