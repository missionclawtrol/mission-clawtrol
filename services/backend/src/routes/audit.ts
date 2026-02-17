/**
 * Audit Log Routes
 */

import { FastifyInstance } from 'fastify';
import { getAuditLog } from '../audit-store.js';

export async function auditRoutes(fastify: FastifyInstance) {
  // GET /api/audit - get audit log entries
  fastify.get<{
    Querystring: {
      entityType?: string;
      entityId?: string;
      userId?: string;
      limit?: number;
    };
  }>('/', async (request, reply) => {
    try {
      const { entityType, entityId, userId, limit } = request.query;

      const filters: {
        entityType?: string;
        entityId?: string;
        userId?: string;
        limit?: number;
      } = {};

      if (entityType) filters.entityType = entityType;
      if (entityId) filters.entityId = entityId;
      if (userId) filters.userId = userId;
      if (limit) filters.limit = Math.min(limit, 1000); // Cap at 1000

      const auditLog = await getAuditLog(filters);

      return { auditLog, count: auditLog.length };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load audit log' });
    }
  });
}
