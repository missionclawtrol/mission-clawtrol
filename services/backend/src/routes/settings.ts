import { FastifyInstance } from 'fastify';
import { db, getRawDb } from '../database.js';
import { spawn } from 'child_process';
import { join } from 'path';

export interface Settings {
  humanHourlyRate: number;
  [key: string]: any;
}

/**
 * Load settings from the SQLite database
 */
function loadSettings(): Settings {
  try {
    const rows = getRawDb().prepare('SELECT key, value FROM settings').all();
    const settings: Settings = {
      humanHourlyRate: 100, // Default
    };

    for (const row of rows as any[]) {
      // Try to parse as JSON first, then fall back to string
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        // If JSON parsing fails, treat as string or try to convert to number
        const numValue = parseFloat(row.value);
        settings[row.key] = isNaN(numValue) ? row.value : numValue;
      }
    }

    return settings;
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Return defaults if there's an error
    return {
      humanHourlyRate: 100,
    };
  }
}

/**
 * Save a setting to the SQLite database
 */
function saveSetting(key: string, value: any): void {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    getRawDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stringValue);
  } catch (error) {
    console.error('Failed to save setting:', error);
    throw error;
  }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /settings - get all settings
  fastify.get<{}>('/', async (request, reply) => {
    try {
      const settings = loadSettings();
      return settings;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load settings' });
    }
  });

  // PUT /settings - update settings
  fastify.put<{ Body: Partial<Settings> }>('/', async (request, reply) => {
    try {
      const updates = request.body;

      for (const [key, value] of Object.entries(updates)) {
        saveSetting(key, value);
      }

      const settings = loadSettings();
      return settings;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update settings' });
    }
  });

  // POST /settings/update - self-update: git pull, build dashboard, restart services
  // Streams progress via Server-Sent Events (SSE)
  fastify.post('/update', async (request, reply) => {
    // Determine repo root — walk up from __dirname until we find update.sh
    const repoRoot = join(new URL(import.meta.url).pathname, '..', '..', '..', '..', '..').replace(/\/+$/, '');

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (type: string, message: string) => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type, message, ts: new Date().toISOString() })}\n\n`);
      } catch {
        // Client disconnected
      }
    };

    const runCommand = (cmd: string, args: string[], cwd: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

        proc.stdout.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(l => l.trim());
          for (const line of lines) send('output', line);
        });

        proc.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(l => l.trim());
          for (const line of lines) send('output', line);
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Command exited with code ${code}`));
          }
        });

        proc.on('error', reject);
      });
    };

    try {
      // Step 1: git pull
      send('step', '📥 Pulling latest from origin...');
      try {
        await runCommand('git', ['pull', '--ff-only', 'origin', 'main'], repoRoot);
        send('step', '✅ Git pull complete');
      } catch (err: any) {
        send('error', `❌ Git pull failed: ${err.message}`);
        reply.raw.end();
        return;
      }

      // Step 2: build dashboard
      send('step', '🔨 Building dashboard...');
      try {
        // Clean install to avoid lockfile/dep corruption
        const dashDir = join(repoRoot, 'apps', 'dashboard');
        await runCommand('rm', ['-rf', 'node_modules', 'package-lock.json'], dashDir);
        await runCommand('npm', ['install', '--no-audit', '--no-fund'], dashDir);
        await runCommand('npm', ['run', 'build'], dashDir);
        send('step', '✅ Dashboard build complete');
      } catch (err: any) {
        send('error', `❌ Build failed: ${err.message}`);
        reply.raw.end();
        return;
      }

      // Step 3: restart services — fire and forget (the dashboard will restart mid-response)
      send('step', '🔄 Restarting services...');
      send('restarting', '⏳ Dashboard is restarting — page will reload automatically...');

      // Small delay so the SSE message makes it to the client before the server goes down
      await new Promise(r => setTimeout(r, 500));
      reply.raw.end();

      // Restart after SSE connection closed
      setTimeout(() => {
        spawn('systemctl', ['restart', 'mission-clawtrol-backend', 'mission-clawtrol-dashboard'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }, 200);

    } catch (err: any) {
      send('error', `❌ Update failed: ${err.message}`);
      reply.raw.end();
    }
  });
}
