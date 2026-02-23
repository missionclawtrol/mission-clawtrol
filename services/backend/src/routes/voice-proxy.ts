/**
 * voice-proxy.ts
 * WebSocket proxy that bridges the MC dashboard to the Python voice sidecar.
 * The sidecar runs on VOICE_SIDECAR_URL (default: ws://localhost:8766/ws).
 *
 * Endpoint: GET /ws/voice  (registered under /ws prefix in index.ts)
 */

import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

const VOICE_SIDECAR_URL =
  process.env.VOICE_SIDECAR_URL || 'ws://localhost:8766/ws';

export async function voiceProxyRoutes(fastify: FastifyInstance) {
  fastify.register(async function wsPlugin(f) {
    f.get('/voice', { websocket: true }, (socket, _req) => {
      fastify.log.info('[VoiceProxy] Browser connected → connecting to voice sidecar');

      const sidecar = new WebSocket(VOICE_SIDECAR_URL);
      let sidecarReady = false;
      const pendingFromBrowser: (Buffer | string)[] = [];

      // ── Sidecar events ────────────────────────────────────────────────────

      sidecar.on('open', () => {
        fastify.log.info('[VoiceProxy] Voice sidecar connected');
        sidecarReady = true;
        // Flush any messages that arrived before sidecar was ready
        for (const msg of pendingFromBrowser) {
          if (sidecar.readyState === WebSocket.OPEN) {
            typeof msg === 'string' ? sidecar.send(msg) : sidecar.send(msg);
          }
        }
        pendingFromBrowser.length = 0;
      });

      sidecar.on('message', (data, isBinary) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data, { binary: isBinary });
        }
      });

      sidecar.on('close', (code, reason) => {
        fastify.log.info(`[VoiceProxy] Sidecar closed (${code}): ${reason}`);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1001, 'Voice sidecar disconnected');
        }
      });

      sidecar.on('error', (err) => {
        fastify.log.error(`[VoiceProxy] Sidecar error: ${err.message}`);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: `Voice sidecar unavailable: ${err.message}`,
            }),
          );
          socket.close(1011, 'Voice sidecar error');
        }
      });

      // ── Browser client events ─────────────────────────────────────────────

      socket.on('message', (data, isBinary) => {
        if (sidecarReady && sidecar.readyState === WebSocket.OPEN) {
          sidecar.send(data as Buffer, { binary: isBinary });
        } else {
          pendingFromBrowser.push(data as Buffer);
        }
      });

      socket.on('close', () => {
        fastify.log.info('[VoiceProxy] Browser disconnected');
        if (
          sidecar.readyState === WebSocket.OPEN ||
          sidecar.readyState === WebSocket.CONNECTING
        ) {
          sidecar.close();
        }
      });

      socket.on('error', (err) => {
        fastify.log.error(`[VoiceProxy] Browser socket error: ${err.message}`);
        if (sidecar.readyState === WebSocket.OPEN) {
          sidecar.close();
        }
      });
    });
  });
}
