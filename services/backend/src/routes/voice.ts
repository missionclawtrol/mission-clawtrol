/**
 * voice.ts
 * WebSocket voice interface: Browser mic → faster-whisper (STT) → OpenClaw → Piper TTS → Audio
 * 
 * Protocol (browser ↔ backend):
 *   Browser → Backend:
 *     { type: 'config', agentId: 'jarvis', sttModel: 'base', voiceModel: '/path/to/model.onnx' }
 *     { type: 'audio', data: '<base64 webm/wav audio>' }
 *     { type: 'cancel' }
 *   
 *   Backend → Browser:
 *     { type: 'ready' }
 *     { type: 'transcript', text: '...' }
 *     { type: 'thinking' }
 *     { type: 'response_text', text: '...', final: false }
 *     { type: 'audio_chunk', data: '<base64 wav>' }
 *     { type: 'audio_end' }
 *     { type: 'error', message: '...' }
 */

import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// Default piper voice model path
const DEFAULT_VOICE_MODEL = process.env.PIPER_VOICE_MODEL || 
  path.join(process.env.HOME || '/root', '.openclaw', 'piper-voices', 'en_US-amy-medium.onnx');

// Default STT model (tiny is fast, base is more accurate)
const DEFAULT_STT_MODEL = process.env.WHISPER_MODEL || 'base';

// Default agent session key
const DEFAULT_AGENT_ID = process.env.VOICE_AGENT_ID || 'jarvis';

// ── Device Identity (reuse same approach as chat-proxy.ts) ───────────────────

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const IDENTITY_PATH = path.join(process.env.HOME || '/root', '.openclaw', 'mc-voice-device.json');

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
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

function buildDeviceAuthPayload(params: {
  deviceId: string; clientId: string; clientMode: string; role: string;
  scopes: string[]; signedAtMs: number; token: string; nonce?: string;
}): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const base = [version, params.deviceId, params.clientId, params.clientMode, params.role, scopes, String(params.signedAtMs), params.token];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}

function signPayload(identity: DeviceIdentity, payload: string): string {
  const key = crypto.createPrivateKey(identity.privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

const deviceIdentity = loadOrCreateIdentity();
console.log(`[Voice] Device identity: ${deviceIdentity.deviceId.substring(0, 16)}...`);

// ── STT via faster-whisper ────────────────────────────────────────────────────

async function transcribeAudio(audioData: Buffer, sttModel: string): Promise<string> {
  const tempId = randomUUID();
  const inputPath = join(tmpdir(), `voice-in-${tempId}.webm`);
  const outputPath = join(tmpdir(), `voice-out-${tempId}.txt`);

  await writeFile(inputPath, audioData);

  return new Promise((resolve, reject) => {
    const script = `
import sys
import json
import os

try:
    from faster_whisper import WhisperModel
    
    model_size = ${JSON.stringify(sttModel)}
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    segments, info = model.transcribe(${JSON.stringify(inputPath)}, beam_size=5, language="en", vad_filter=True)
    
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text, "language": info.language}))
    sys.stdout.flush()
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

    const proc = spawn('python3', ['-c', script], { timeout: 60000 });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      // Clean up temp files
      try { await unlink(inputPath); } catch {}

      if (code !== 0) {
        reject(new Error(`STT failed: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result.text || '');
        }
      } catch {
        reject(new Error(`STT parse error: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`STT process error: ${err.message}`));
    });
  });
}

// ── TTS via piper-tts ────────────────────────────────────────────────────────

async function synthesizeSpeech(text: string, voiceModel: string): Promise<Buffer> {
  if (!existsSync(voiceModel)) {
    throw new Error(`Voice model not found: ${voiceModel}`);
  }

  return new Promise((resolve, reject) => {
    const script = `
import sys
import io
import json
import wave

try:
    from piper.voice import PiperVoice

    model_path = ${JSON.stringify(voiceModel)}
    text = ${JSON.stringify(text)}
    
    voice = PiperVoice.load(model_path)
    
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav_file:
        voice.synthesize_wav(text, wav_file)
    
    sys.stdout.buffer.write(buf.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

    const proc = spawn('python3', ['-c', script], { timeout: 30000 });
    const chunks: Buffer[] = [];
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { chunks.push(d); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`TTS failed: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    proc.on('error', (err) => {
      reject(new Error(`TTS process error: ${err.message}`));
    });
  });
}

// ── Voice WebSocket Handler ───────────────────────────────────────────────────

export async function voiceRoutes(fastify: FastifyInstance) {
  fastify.register(async function wsPlugin(f) {
    f.get('/voice', { websocket: true }, async (socket, req) => {
      console.log('[Voice] Browser connected');

      let agentId = DEFAULT_AGENT_ID;
      let sttModel = DEFAULT_STT_MODEL;
      let voiceModel = DEFAULT_VOICE_MODEL;
      let sessionKey = `agent:${agentId}:mc-voice`;

      // State
      let isProcessing = false;
      let cancelled = false;
      let currentResponseText = '';
      let streamingDone = false;

      // Gateway connection
      let gw: WebSocket | null = null;
      let gwReady = false;
      const pendingGwReqs = new Map<string, (payload: any) => void>();
      const pendingGwMessages: string[] = [];

      function send(data: object) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      }

      function sendError(message: string) {
        send({ type: 'error', message });
        isProcessing = false;
        cancelled = false;
      }

      // ── Gateway connection ──────────────────────────────────────────────

      function connectGateway() {
        gw = new WebSocket(GATEWAY_URL);

        gw.on('open', () => {
          console.log('[Voice] Gateway WebSocket open');
        });

        gw.on('message', (rawData: Buffer | string) => {
          const raw = rawData.toString();
          let msg: any;
          try { msg = JSON.parse(raw); } catch { return; }

          // Handle challenge
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            const { nonce, ts } = msg.payload;

            const publicKeyRaw = crypto.createPublicKey(deviceIdentity.publicKeyPem)
              .export({ type: 'spki', format: 'der' }) as Buffer;
            let rawKey: Buffer;
            if (publicKeyRaw.length === ED25519_SPKI_PREFIX.length + 32 &&
                publicKeyRaw.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
              rawKey = publicKeyRaw.subarray(ED25519_SPKI_PREFIX.length);
            } else {
              rawKey = publicKeyRaw;
            }

            const scopes = ['operator.read', 'operator.write'];
            const authPayload = buildDeviceAuthPayload({
              deviceId: deviceIdentity.deviceId,
              clientId: 'cli',
              clientMode: 'cli',
              role: 'operator',
              scopes,
              signedAtMs: ts,
              token: GATEWAY_TOKEN,
              nonce,
            });
            const signature = signPayload(deviceIdentity, authPayload);

            const connectReq = {
              type: 'req', id: 'voice-connect-1', method: 'connect',
              params: {
                minProtocol: 3, maxProtocol: 3,
                client: { id: 'cli', version: '1.0.0', platform: 'linux', mode: 'cli' },
                role: 'operator', scopes, caps: [], commands: [], permissions: {},
                auth: { token: GATEWAY_TOKEN },
                locale: 'en-US', userAgent: 'mission-clawtrol-voice/1.0.0',
                device: {
                  id: deviceIdentity.deviceId,
                  publicKey: base64UrlEncode(rawKey),
                  signature,
                  signedAt: ts,
                  nonce,
                },
              },
            };
            gw!.send(JSON.stringify(connectReq));
            return;
          }

          // Handle connect response
          if (msg.type === 'res' && msg.id === 'voice-connect-1') {
            if (msg.ok) {
              console.log('[Voice] Gateway handshake complete');
              gwReady = true;
              for (const pending of pendingGwMessages) {
                gw!.send(pending);
              }
              pendingGwMessages.length = 0;
              send({ type: 'ready' });
            } else {
              console.error('[Voice] Gateway handshake failed:', msg.error);
              send({ type: 'error', message: 'Gateway connection failed' });
            }
            return;
          }

          // Handle pending request responses
          if (msg.type === 'res') {
            const cb = pendingGwReqs.get(msg.id);
            if (cb) {
              pendingGwReqs.delete(msg.id);
              cb(msg);
            }
            return;
          }

          // Handle streaming chat events
          if (msg.type === 'event') {
            handleGatewayEvent(msg.event, msg.payload);
          }
        });

        gw.on('close', () => {
          console.log('[Voice] Gateway disconnected');
          gwReady = false;
        });

        gw.on('error', (err) => {
          console.error('[Voice] Gateway error:', err.message);
        });
      }

      function sendToGateway(data: object) {
        const str = JSON.stringify(data);
        if (gwReady && gw?.readyState === WebSocket.OPEN) {
          gw.send(str);
        } else {
          pendingGwMessages.push(str);
        }
      }

      // ── Gateway event handling ──────────────────────────────────────────

      let responseTextBuffer = '';
      let responseComplete = false;
      let responseResolve: ((text: string) => void) | null = null;
      let responseReject: ((err: Error) => void) | null = null;

      function handleGatewayEvent(event: string, payload: any) {
        if (event === 'chat') {
          const state = payload?.state;
          const messageData = payload?.message;

          if (state === 'delta' && messageData) {
            const text = messageData.content?.find((c: any) => c.type === 'text')?.text ?? '';
            if (text && !cancelled) {
              responseTextBuffer = text;
              send({ type: 'response_text', text, final: false });
            }
            return;
          }

          if (state === 'final') {
            const finalText = messageData?.content?.find((c: any) => c.type === 'text')?.text ?? responseTextBuffer;
            responseComplete = true;
            if (responseResolve) {
              responseResolve(finalText);
              responseResolve = null;
              responseReject = null;
            }
            return;
          }

          if (state === 'aborted' || state === 'error') {
            responseComplete = true;
            if (responseReject) {
              responseReject(new Error(`Chat ${state}`));
              responseResolve = null;
              responseReject = null;
            }
            return;
          }
        }

        // Handle legacy event formats
        if (event === 'chat.chunk' || event === 'chat.delta') {
          const delta = payload?.delta ?? payload?.content ?? payload?.text ?? '';
          if (delta && !cancelled) {
            responseTextBuffer += delta;
            send({ type: 'response_text', text: responseTextBuffer, final: false });
          }
          return;
        }

        if (event === 'chat.done' || event === 'chat.complete') {
          responseComplete = true;
          if (responseResolve) {
            responseResolve(responseTextBuffer);
            responseResolve = null;
            responseReject = null;
          }
          return;
        }
      }

      // ── Send message and wait for response ──────────────────────────────

      function sendChatAndWait(text: string, sk: string): Promise<string> {
        return new Promise((resolve, reject) => {
          responseTextBuffer = '';
          responseComplete = false;
          responseResolve = resolve;
          responseReject = reject;

          const reqId = randomUUID();
          const idempotencyKey = randomUUID();

          // Set timeout (60s)
          const timeout = setTimeout(() => {
            if (responseResolve) {
              // If we have partial text, use it
              if (responseTextBuffer) {
                responseResolve(responseTextBuffer);
              } else {
                responseReject?.(new Error('Response timeout'));
              }
              responseResolve = null;
              responseReject = null;
            }
          }, 60000);

          // Override resolve to clear timeout
          const origResolve = resolve;
          responseResolve = (text: string) => {
            clearTimeout(timeout);
            origResolve(text);
          };

          const origReject = reject;
          responseReject = (err: Error) => {
            clearTimeout(timeout);
            origReject(err);
          };

          sendToGateway({
            type: 'req',
            id: reqId,
            method: 'chat.send',
            params: { sessionKey: sk, message: text, idempotencyKey }
          });
        });
      }

      // ── Process audio message ─────────────────────────────────────────────

      async function processAudio(audioBase64: string) {
        if (isProcessing) {
          send({ type: 'error', message: 'Already processing — please wait' });
          return;
        }

        isProcessing = true;
        cancelled = false;

        try {
          // 1. Decode audio
          const audioBuffer = Buffer.from(audioBase64, 'base64');
          if (audioBuffer.length < 100) {
            sendError('Audio too short');
            return;
          }

          // 2. STT
          console.log(`[Voice] Transcribing ${audioBuffer.length} bytes with model: ${sttModel}`);
          let transcript: string;
          try {
            transcript = await transcribeAudio(audioBuffer, sttModel);
          } catch (err: any) {
            sendError(`Transcription failed: ${err.message}`);
            return;
          }

          if (!transcript || !transcript.trim()) {
            send({ type: 'transcript', text: '' });
            sendError('No speech detected');
            return;
          }

          console.log(`[Voice] Transcript: "${transcript}"`);
          send({ type: 'transcript', text: transcript });

          if (cancelled) { isProcessing = false; return; }

          // 3. Send to OpenClaw
          send({ type: 'thinking' });

          let responseText: string;
          try {
            responseText = await sendChatAndWait(transcript, sessionKey);
          } catch (err: any) {
            sendError(`Agent error: ${err.message}`);
            return;
          }

          if (cancelled) { isProcessing = false; return; }

          // Send final text
          send({ type: 'response_text', text: responseText, final: true });

          console.log(`[Voice] Response (${responseText.length} chars), generating TTS`);

          // 4. TTS
          if (!existsSync(voiceModel)) {
            send({ type: 'audio_end' });
            console.warn(`[Voice] Voice model not found: ${voiceModel}, skipping TTS`);
            isProcessing = false;
            return;
          }

          let audioWav: Buffer;
          try {
            // Strip markdown for TTS (simpler speech)
            const ttsText = responseText
              .replace(/```[\s\S]*?```/g, 'code block')
              .replace(/`([^`]+)`/g, '$1')
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\*([^*]+)\*/g, '$1')
              .replace(/#{1,6}\s/g, '')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .slice(0, 1000); // Limit TTS length

            audioWav = await synthesizeSpeech(ttsText, voiceModel);
          } catch (err: any) {
            console.error('[Voice] TTS error:', err.message);
            send({ type: 'audio_end' });
            isProcessing = false;
            return;
          }

          if (cancelled) { isProcessing = false; return; }

          // Send audio in chunks (base64 encoded)
          const CHUNK_SIZE = 32 * 1024; // 32KB chunks
          for (let offset = 0; offset < audioWav.length; offset += CHUNK_SIZE) {
            if (cancelled) break;
            const chunk = audioWav.subarray(offset, offset + CHUNK_SIZE);
            send({ type: 'audio_chunk', data: chunk.toString('base64') });
          }
          send({ type: 'audio_end' });

        } catch (err: any) {
          console.error('[Voice] Unexpected error:', err);
          sendError(`Unexpected error: ${err.message}`);
        } finally {
          isProcessing = false;
        }
      }

      // ── Connect to gateway immediately ────────────────────────────────────

      connectGateway();

      // ── Handle browser messages ────────────────────────────────────────────

      socket.on('message', async (raw: Buffer | string) => {
        const msgStr = raw.toString();

        // Handle binary audio (legacy support)
        if (typeof raw !== 'string' && !(msgStr.startsWith('{'))) {
          // Raw binary — treat as audio
          const audioBase64 = (raw as Buffer).toString('base64');
          await processAudio(audioBase64);
          return;
        }

        let msg: any;
        try { msg = JSON.parse(msgStr); } catch {
          send({ type: 'error', message: 'Invalid message format' });
          return;
        }

        switch (msg.type) {
          case 'config':
            if (msg.agentId) {
              agentId = msg.agentId;
              sessionKey = `agent:${agentId}:mc-voice`;
            }
            if (msg.sttModel) sttModel = msg.sttModel;
            if (msg.voiceModel) voiceModel = msg.voiceModel;
            console.log(`[Voice] Config: agent=${agentId}, stt=${sttModel}`);
            send({ type: 'config_ok', agentId, sttModel, voiceModel });
            break;

          case 'audio':
            if (!msg.data) {
              send({ type: 'error', message: 'No audio data' });
              return;
            }
            await processAudio(msg.data);
            break;

          case 'cancel':
            cancelled = true;
            isProcessing = false;
            send({ type: 'cancelled' });
            break;

          case 'ping':
            send({ type: 'pong' });
            break;

          default:
            console.warn('[Voice] Unknown message type:', msg.type);
        }
      });

      // ── Cleanup on disconnect ─────────────────────────────────────────────

      socket.on('close', () => {
        console.log('[Voice] Browser disconnected');
        cancelled = true;
        if (gw && (gw.readyState === WebSocket.OPEN || gw.readyState === WebSocket.CONNECTING)) {
          gw.close();
        }
      });

      socket.on('error', (err) => {
        console.error('[Voice] Socket error:', err.message);
      });
    });
  });
}
