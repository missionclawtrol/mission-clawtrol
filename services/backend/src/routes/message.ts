import { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { gatewayClient } from '../gateway-client.js';

// Path to OpenClaw workspace for project context
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');
const OPENCLAW_HOME = join(process.env.HOME || '', '.openclaw/agents');

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: string;
}

interface SessionsIndex {
  [key: string]: {
    sessionId: string;
    sessionFile?: string;
    [key: string]: any;
  };
}

// Helper to read JSONL file line by line
async function parseJsonlFile(filePath: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const lines: any[] = [];
    const fileStream = createReadStream(filePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        if (line.trim()) {
          const parsed = JSON.parse(line);
          lines.push(parsed);
        }
      } catch (err) {
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

// Convert raw JSONL message to simple format
function convertMessageToSimple(rawMessage: any): TranscriptMessage | null {
  try {
    if (rawMessage.type === 'message' && rawMessage.message) {
      const msg = rawMessage.message;
      const timestamp = msg.timestamp || rawMessage.timestamp;
      const role = msg.role;

      if (role === 'user' || role === 'system') {
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
        return { role, timestamp, content: textContent };
      } else if (role === 'assistant') {
        let textContent = '';
        if (Array.isArray(msg.content)) {
          textContent = msg.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text || block.content || '')
            .join('\n')
            .trim();
        }
        return { role: 'assistant', timestamp, content: textContent };
      }
    }
  } catch (err) {
    // Skip malformed messages
  }
  return null;
}

export async function messageRoutes(fastify: FastifyInstance) {
  // Send a message to the main agent (CSO) with project context
  // This allows the AI to know which project the user is referring to
  fastify.post<{
    Body: {
      message: string;
      projectId?: string;
    };
  }>('/', async (request, reply) => {
    const { message, projectId } = request.body;

    if (!message) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    if (!gatewayClient.isConnected()) {
      return reply.status(503).send({ error: 'Not connected to gateway' });
    }

    try {
      // Build the message with project context
      let fullMessage = message;
      
      if (projectId) {
        // Try to read project context files
        let projectContext = '';
        
        try {
          // Read PROJECT.md if exists
          const projectMdPath = join(WORKSPACE_PATH, projectId, 'PROJECT.md');
          const projectMd = await readFile(projectMdPath, 'utf-8');
          // Include first 500 chars as context
          projectContext += `\n\n## Project: ${projectId}\n\n${projectMd.slice(0, 500)}`;
        } catch {
          // PROJECT.md doesn't exist, that's okay
        }
        
        try {
          // Read STATUS.md if exists
          const statusMdPath = join(WORKSPACE_PATH, projectId, 'STATUS.md');
          const statusMd = await readFile(statusMdPath, 'utf-8');
          projectContext += `\n\n## Current Status:\n\n${statusMd.slice(0, 500)}`;
        } catch {
          // STATUS.md doesn't exist
        }
        
        // Prepend project context to the message
        if (projectContext) {
          fullMessage = `[Project Context for "${projectId}":${projectContext}]\n\nUser request: ${message}`;
        } else {
          fullMessage = `[Project: ${projectId}]\n\n${message}`;
        }
      }

      // Send to the main agent (cso)
      const sessionKey = 'agent:cso:main';
      
      const result = await gatewayClient.request('chat.send', {
        sessionKey,
        message: fullMessage,
        idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      
      return { 
        success: true, 
        result,
        sessionKey,
        projectId: projectId || null,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: `Failed to send message: ${(error as Error).message}` });
    }
  });

  // Get conversation history with the main agent
  fastify.get<{
    Querystring: { limit?: string };
  }>('/history', async (request, reply) => {
    const limit = parseInt(request.query.limit || '20');

    try {
      const agentId = 'cso';
      const sessionKey = 'agent:cso:main';
      
      // Read sessions index to find the session file
      const sessionsIndexPath = join(OPENCLAW_HOME, agentId, 'sessions', 'sessions.json');
      const indexData = await readFile(sessionsIndexPath, 'utf-8');
      const sessionsIndex = JSON.parse(indexData) as SessionsIndex;

      // Find the session file - either from sessionFile field or construct from sessionId
      let sessionFile: string | null = null;
      const sessionData = sessionsIndex[sessionKey];
      
      if (sessionData?.sessionFile) {
        // Use sessionFile if available (newer sessions)
        sessionFile = sessionData.sessionFile;
      } else if (sessionData?.sessionId) {
        // Construct from sessionId (older sessions don't have sessionFile)
        sessionFile = join(OPENCLAW_HOME, agentId, 'sessions', `${sessionData.sessionId}.jsonl`);
      } else {
        // Find by iterating - get the most recent session with a sessionId
        for (const [key, session] of Object.entries(sessionsIndex)) {
          if (key.startsWith('agent:cso:') && session.sessionId) {
            sessionFile = join(OPENCLAW_HOME, agentId, 'sessions', `${session.sessionId}.jsonl`);
            break;
          }
        }
      }

      if (!sessionFile) {
        return { messages: [] };
      }

      // Parse the JSONL file (sessionFile is absolute path)
      const rawMessages = await parseJsonlFile(sessionFile);
      
      // Convert to simple format and apply limit
      const messages: TranscriptMessage[] = rawMessages
        .map((msg) => convertMessageToSimple(msg))
        .filter((msg): msg is TranscriptMessage => msg !== null && msg.content.length > 0)
        .slice(-limit);

      return { messages };
    } catch (error) {
      fastify.log.error(error);
      // Return empty messages instead of error if history not available
      return { messages: [] };
    }
  });
}
