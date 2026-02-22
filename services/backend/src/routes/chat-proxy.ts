/**
 * chat-proxy.ts
 * WebSocket proxy that bridges the MC dashboard to the OpenClaw gateway.
 * Handles the gateway handshake, then proxies all frames bidirectionally.
 */
import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

export async function chatProxyRoutes(fastify: FastifyInstance) {
  fastify.register(async function wsPlugin(f) {
    f.get('/gateway', { websocket: true }, (socket, _req) => {
      console.log('[ChatProxy] Dashboard client connected');

      // Open a fresh WS connection to the actual gateway for this dashboard client
      const gw = new WebSocket(GATEWAY_URL);

      let handshakeDone = false;
      const pendingMessages: string[] = [];

      /** Forward a raw string from the gateway to the dashboard client */
      function forwardToClient(raw: string) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(raw);
        }
      }

      /** Send a typed message to the dashboard client (used for proxy-level messages) */
      function sendToClient(data: object) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      }

      // ── Gateway events ────────────────────────────────────────────────────

      gw.on('open', () => {
        console.log('[ChatProxy] Gateway WS open — waiting for connect.challenge...');
      });

      gw.on('message', (rawData: Buffer | string) => {
        const raw = rawData.toString();

        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          // Pass non-JSON through unchanged
          forwardToClient(raw);
          return;
        }

        // Respond to the challenge with a connect request
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          console.log('[ChatProxy] Received connect.challenge — sending connect request');
          const connectReq = {
            type: 'req',
            id: 'connect-1',
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'cli',          // known constant accepted by gateway
                version: '1.0.0',
                platform: 'linux',
                mode: 'backend',    // known constant accepted by gateway
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write', 'operator.approvals', 'operator.admin'],
              caps: [],
              commands: [],
              permissions: {},
              auth: { token: GATEWAY_TOKEN },
              locale: 'en-US',
              userAgent: 'mission-clawtrol/1.0.0',
            },
          };
          gw.send(JSON.stringify(connectReq));
          return; // Don't forward the challenge to the client
        }

        // Handle the connect response
        if (msg.type === 'res' && msg.id === 'connect-1') {
          if (msg.ok) {
            console.log('[ChatProxy] Gateway handshake complete');
            handshakeDone = true;

            // Flush queued client messages
            for (const pending of pendingMessages) {
              if (gw.readyState === WebSocket.OPEN) {
                gw.send(pending);
              }
            }
            pendingMessages.length = 0;

            // Tell client the proxy is ready
            sendToClient({ type: 'proxy-ready', timestamp: new Date().toISOString() });
          } else {
            console.error('[ChatProxy] Gateway handshake failed:', msg.error);
            sendToClient({ type: 'error', error: 'Gateway handshake failed', detail: msg.error });
            socket.close();
            gw.close();
          }
          return; // Don't forward the internal handshake response
        }

        // All other messages — forward verbatim to the dashboard client
        forwardToClient(raw);
      });

      gw.on('close', (code, reason) => {
        console.log(`[ChatProxy] Gateway closed (${code}): ${reason}`);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1001, 'Gateway disconnected');
        }
      });

      gw.on('error', (err) => {
        console.error('[ChatProxy] Gateway WS error:', err.message);
        sendToClient({ type: 'error', error: `Gateway error: ${err.message}` });
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1011, 'Gateway error');
        }
      });

      // ── Dashboard client events ───────────────────────────────────────────

      socket.on('message', (raw: Buffer | string) => {
        const msgStr = raw.toString();

        if (handshakeDone && gw.readyState === WebSocket.OPEN) {
          gw.send(msgStr);
        } else if (!handshakeDone) {
          // Queue until handshake completes
          pendingMessages.push(msgStr);
        }
      });

      socket.on('close', () => {
        console.log('[ChatProxy] Dashboard client disconnected');
        if (gw.readyState === WebSocket.OPEN || gw.readyState === WebSocket.CONNECTING) {
          gw.close();
        }
      });

      socket.on('error', (err) => {
        console.error('[ChatProxy] Dashboard socket error:', err.message);
        if (gw.readyState === WebSocket.OPEN) {
          gw.close();
        }
      });
    });
  });
}
