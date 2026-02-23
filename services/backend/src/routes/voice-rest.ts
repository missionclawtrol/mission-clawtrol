/**
 * voice-rest.ts
 * REST API proxy that forwards requests to the Python voice sidecar.
 * Registered under /api/voice prefix.
 *
 * Endpoints:
 *   GET /api/voice/health  → sidecar /health
 *   GET /api/voice/voices  → sidecar /api/voices
 */

import { FastifyInstance } from 'fastify';

const VOICE_SIDECAR_HTTP =
  process.env.VOICE_SIDECAR_HTTP || 'http://localhost:8766';

async function proxyGet(path: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${VOICE_SIDECAR_HTTP}${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = await res.json().catch(() => ({ error: 'invalid response' }));
    return { status: res.status, body };
  } catch (err: any) {
    return { status: 503, body: { error: `Voice sidecar unavailable: ${err.message}` } };
  }
}

export async function voiceRestRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (_req, reply) => {
    const { status, body } = await proxyGet('/health');
    return reply.status(status).send(body);
  });

  fastify.get('/voices', async (_req, reply) => {
    const { status, body } = await proxyGet('/api/voices');
    return reply.status(status).send(body);
  });
}
