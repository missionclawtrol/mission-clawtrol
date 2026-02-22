/**
 * pty.ts
 * WebSocket endpoint that spawns a PTY (pseudo-terminal) and streams I/O
 * to/from the browser. Used by the terminal panel in the MC dashboard.
 */
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import os from 'os';

// Dynamic import of node-pty to avoid hard crash if native module not built
let pty: typeof import('node-pty') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore dynamic import
  pty = await import('node-pty');
} catch (err) {
  console.error('[PTY] node-pty not available:', err);
}

export async function ptyRoutes(fastify: FastifyInstance) {
  fastify.register(async function wsPlugin(f) {
    // GET /ws/pty
    f.get('/pty', { websocket: true }, (socket, req) => {
      if (!pty) {
        socket.send(JSON.stringify({ type: 'error', message: 'node-pty not available on this server' }));
        socket.close();
        return;
      }

      console.log('[PTY] Client connected');

      const shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash');
      const cwd = process.env.HOME || '/tmp';

      let ptyProcess: import('node-pty').IPty | null = null;

      try {
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd,
          env: { ...process.env } as Record<string, string>,
        });

        console.log(`[PTY] Spawned PID ${ptyProcess.pid}`);

        // PTY output → browser
        ptyProcess.onData((data: string) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'output', data }));
          }
        });

        // PTY exit → browser
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`[PTY] Process exited (code=${exitCode}, signal=${signal})`);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'exit', exitCode, signal }));
            socket.close();
          }
        });

      } catch (err) {
        console.error('[PTY] Failed to spawn shell:', err);
        socket.send(JSON.stringify({ type: 'error', message: `Failed to spawn shell: ${err}` }));
        socket.close();
        return;
      }

      // Browser → PTY
      socket.on('message', (rawData: Buffer | string) => {
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.type === 'input' && ptyProcess) {
            ptyProcess.write(msg.data);
          } else if (msg.type === 'resize' && ptyProcess) {
            const cols = Math.max(1, Number(msg.cols) || 80);
            const rows = Math.max(1, Number(msg.rows) || 24);
            ptyProcess.resize(cols, rows);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Client disconnected → kill PTY
      socket.on('close', () => {
        console.log('[PTY] Client disconnected — killing shell');
        if (ptyProcess) {
          try {
            ptyProcess.kill();
          } catch {
            // Already dead
          }
          ptyProcess = null;
        }
      });

      socket.on('error', (err) => {
        console.error('[PTY] Socket error:', err.message);
        if (ptyProcess) {
          try { ptyProcess.kill(); } catch {}
          ptyProcess = null;
        }
      });
    });
  });
}
