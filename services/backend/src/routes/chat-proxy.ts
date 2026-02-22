/**
 * chat-proxy.ts
 * WebSocket proxy that bridges the MC dashboard to the OpenClaw gateway.
 * Handles the gateway handshake (including device identity + challenge signing),
 * then proxies all frames bidirectionally.
 */
import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// ── Device Identity ─────────────────────────────────────────────────────────

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const IDENTITY_PATH = path.join(process.env.HOME || '/root', '.openclaw', 'mc-proxy-device.json');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  let raw: Buffer;
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    raw = spki.subarray(ED25519_SPKI_PREFIX.length);
  } else {
    raw = spki;
  }
  return crypto.createHash('sha256').update(raw).digest('hex');
}

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function loadOrCreateIdentity(): DeviceIdentity {
  try {
    if (fs.existsSync(IDENTITY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        return { deviceId: parsed.deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }
  } catch {}

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  const stored = { version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() };
  const dir = path.dirname(IDENTITY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });

  return { deviceId, publicKeyPem, privateKeyPem };
}

// Build the exact payload format the gateway expects for device auth
function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce?: string;
}): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    params.token,
  ];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}

function signPayload(identity: DeviceIdentity, payload: string): string {
  const key = crypto.createPrivateKey(identity.privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

// Load identity once at startup
const deviceIdentity = loadOrCreateIdentity();
console.log(`[ChatProxy] Device identity: ${deviceIdentity.deviceId.substring(0, 16)}...`);

// ── WebSocket Proxy ─────────────────────────────────────────────────────────

export async function chatProxyRoutes(fastify: FastifyInstance) {
  fastify.register(async function wsPlugin(f) {
    f.get('/gateway', { websocket: true }, (socket, _req) => {
      console.log('[ChatProxy] Dashboard client connected');

      const gw = new WebSocket(GATEWAY_URL);
      let handshakeDone = false;
      const pendingMessages: string[] = [];

      function forwardToClient(raw: string) {
        if (socket.readyState === WebSocket.OPEN) socket.send(raw);
      }

      function sendToClient(data: object) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
      }

      // ── Gateway events ──────────────────────────────────────────────────

      gw.on('open', () => {
        console.log('[ChatProxy] Gateway WS open — waiting for connect.challenge...');
      });

      gw.on('message', (rawData: Buffer | string) => {
        const raw = rawData.toString();
        let msg: any;
        try { msg = JSON.parse(raw); } catch { forwardToClient(raw); return; }

        // Respond to the challenge
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          const { nonce, ts } = msg.payload;
          console.log('[ChatProxy] Received connect.challenge — signing and connecting');

          const publicKeyRaw = crypto.createPublicKey(deviceIdentity.publicKeyPem)
            .export({ type: 'spki', format: 'der' });
          let rawKey: Buffer;
          if (publicKeyRaw.length === ED25519_SPKI_PREFIX.length + 32 &&
              publicKeyRaw.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
            rawKey = publicKeyRaw.subarray(ED25519_SPKI_PREFIX.length);
          } else {
            rawKey = publicKeyRaw;
          }

          const scopes = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];
          const signedAtMs = ts;

          const authPayload = buildDeviceAuthPayload({
            deviceId: deviceIdentity.deviceId,
            clientId: 'gateway-client',
            clientMode: 'backend',
            role: 'operator',
            scopes,
            signedAtMs,
            token: GATEWAY_TOKEN,
            nonce,
          });
          const signature = signPayload(deviceIdentity, authPayload);

          const connectReq = {
            type: 'req',
            id: 'connect-1',
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'linux',
                mode: 'backend',
              },
              role: 'operator',
              scopes,
              caps: [],
              commands: [],
              permissions: {},
              auth: { token: GATEWAY_TOKEN },
              locale: 'en-US',
              userAgent: 'mission-clawtrol/1.0.0',
              device: {
                id: deviceIdentity.deviceId,
                publicKey: base64UrlEncode(rawKey),
                signature,
                signedAt: signedAtMs,
                nonce,
              },
            },
          };
          gw.send(JSON.stringify(connectReq));
          return;
        }

        // Handle the connect response
        if (msg.type === 'res' && msg.id === 'connect-1') {
          if (msg.ok) {
            console.log('[ChatProxy] Gateway handshake complete');
            handshakeDone = true;

            // Store device token if provided
            if (msg.payload?.auth?.deviceToken) {
              console.log('[ChatProxy] Received device token');
            }

            // Flush queued client messages
            for (const pending of pendingMessages) {
              if (gw.readyState === WebSocket.OPEN) gw.send(pending);
            }
            pendingMessages.length = 0;

            sendToClient({ type: 'proxy-ready', timestamp: new Date().toISOString() });
          } else {
            console.error('[ChatProxy] Gateway handshake failed:', msg.error);
            sendToClient({ type: 'error', error: 'Gateway handshake failed', detail: msg.error });
            socket.close();
            gw.close();
          }
          return;
        }

        // All other messages — forward to dashboard client
        forwardToClient(raw);
      });

      gw.on('close', (code, reason) => {
        console.log(`[ChatProxy] Gateway closed (${code}): ${reason}`);
        if (socket.readyState === WebSocket.OPEN) socket.close(1001, 'Gateway disconnected');
      });

      gw.on('error', (err) => {
        console.error('[ChatProxy] Gateway WS error:', err.message);
        sendToClient({ type: 'error', error: `Gateway error: ${err.message}` });
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Gateway error');
      });

      // ── Dashboard client events ─────────────────────────────────────────

      socket.on('message', (raw: Buffer | string) => {
        const msgStr = raw.toString();
        if (handshakeDone && gw.readyState === WebSocket.OPEN) {
          gw.send(msgStr);
        } else if (!handshakeDone) {
          pendingMessages.push(msgStr);
        }
      });

      socket.on('close', () => {
        console.log('[ChatProxy] Dashboard client disconnected');
        if (gw.readyState === WebSocket.OPEN || gw.readyState === WebSocket.CONNECTING) gw.close();
      });

      socket.on('error', (err) => {
        console.error('[ChatProxy] Dashboard socket error:', err.message);
        if (gw.readyState === WebSocket.OPEN) gw.close();
      });
    });
  });
}
