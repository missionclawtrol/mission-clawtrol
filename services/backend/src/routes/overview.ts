/**
 * Overview Routes — /api/overview
 *
 * Aggregated summary endpoint for the dashboard overview page.
 * Returns high-level counts and lists used by the main dashboard widgets.
 */

import type { FastifyInstance } from 'fastify';
import { getDeliverables } from '../deliverable-store.js';

export async function overviewRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/overview
   * Returns aggregated overview data including deliverables ready for review.
   * Includes BOTH 'review' and 'pending_review' statuses so no deliverables are missed.
   */
  fastify.get('/', async (_request, reply) => {
    try {
      const deliverablesReadyForReview = await getDeliverables({
        status: ['review', 'pending_review'],
      });

      return reply.send({
        deliverablesReadyForReview,
      });
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch overview data');
      return reply.status(500).send({ error: 'Failed to fetch overview data' });
    }
  });
}
