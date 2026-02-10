/**
 * Approvals API routes
 */
import { FastifyInstance } from 'fastify';
import { gatewayClient, ApprovalRequest } from '../gateway-client.js';

// In-memory cache of pending approvals (gateway is source of truth)
const pendingApprovals = new Map<string, ApprovalRequest>();
const resolvedApprovals = new Map<string, { request: ApprovalRequest; decision: string; resolvedAt: number }>();

// Keep resolved for 5 minutes for UI display
const RESOLVED_TTL_MS = 5 * 60 * 1000;

// Wire up gateway events
gatewayClient.on('approval-requested', (request: ApprovalRequest) => {
  pendingApprovals.set(request.id, request);
  
  // Clean up expired approvals
  const now = Date.now();
  for (const [id, req] of pendingApprovals) {
    if (req.expiresAtMs < now) {
      pendingApprovals.delete(id);
    }
  }
});

gatewayClient.on('approval-resolved', (resolved: { id: string; decision: string }) => {
  const request = pendingApprovals.get(resolved.id);
  if (request) {
    pendingApprovals.delete(resolved.id);
    resolvedApprovals.set(resolved.id, {
      request,
      decision: resolved.decision,
      resolvedAt: Date.now(),
    });
    
    // Schedule cleanup
    setTimeout(() => {
      resolvedApprovals.delete(resolved.id);
    }, RESOLVED_TTL_MS);
  }
});

export async function approvalRoutes(fastify: FastifyInstance) {
  // GET /api/approvals - List pending approvals
  fastify.get('/', async () => {
    const now = Date.now();
    const pending = Array.from(pendingApprovals.values())
      .filter((a) => a.expiresAtMs > now)
      .map((a) => ({
        id: a.id,
        command: a.request.command,
        cwd: a.request.cwd,
        host: a.request.host,
        agentId: a.request.agentId,
        sessionKey: a.request.sessionKey,
        expiresAtMs: a.expiresAtMs,
        expiresInSec: Math.max(0, Math.round((a.expiresAtMs - now) / 1000)),
      }));

    const resolved = Array.from(resolvedApprovals.values()).map((r) => ({
      id: r.request.id,
      command: r.request.request.command,
      decision: r.decision,
      resolvedAt: r.resolvedAt,
    }));

    return {
      pending,
      resolved,
      gatewayConnected: gatewayClient.isConnected(),
    };
  });

  // POST /api/approvals/:id/resolve - Resolve an approval
  fastify.post<{
    Params: { id: string };
    Body: { decision: 'allow-once' | 'allow-always' | 'deny' };
  }>('/:id/resolve', async (request, reply) => {
    const { id } = request.params;
    const { decision } = request.body;

    if (!['allow-once', 'allow-always', 'deny'].includes(decision)) {
      reply.status(400);
      return { error: 'Invalid decision. Must be allow-once, allow-always, or deny' };
    }

    if (!gatewayClient.isConnected()) {
      reply.status(503);
      return { error: 'Not connected to gateway' };
    }

    try {
      await gatewayClient.resolveApproval(id, decision);
      return { success: true, id, decision };
    } catch (err) {
      reply.status(500);
      return { error: `Failed to resolve approval: ${(err as Error).message}` };
    }
  });

  // GET /api/approvals/status - Gateway connection status
  fastify.get('/status', async () => {
    return {
      connected: gatewayClient.isConnected(),
      pendingCount: pendingApprovals.size,
    };
  });
}
