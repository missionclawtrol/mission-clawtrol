/**
 * Webhook Routes - Manage webhook subscriptions for task events
 */

import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import {
  getAllWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  Webhook,
} from '../webhook-store.js';
import { dispatchWebhookEvent } from '../webhook-dispatcher.js';
import { logAudit } from '../audit-store.js';

/**
 * Valid event types for webhooks
 */
const VALID_EVENT_TYPES = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.comment_added',
];

/**
 * Generate a secure random secret for webhook signing
 */
function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

export async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * GET /webhooks - list all webhooks
   */
  fastify.get('/', async (request, reply) => {
    try {
      // Only admins can view webhooks
      const user = (request as any).user;
      if (user && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only admins can manage webhooks' });
      }

      const webhooks = await getAllWebhooks();
      return { webhooks, count: webhooks.length };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load webhooks' });
    }
  });

  /**
   * GET /webhooks/:id - get a single webhook
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      try {
        // Only admins can view webhooks
        const user = (request as any).user;
        if (user && user.role !== 'admin') {
          return reply.status(403).send({ error: 'Only admins can manage webhooks' });
        }

        const { id } = request.params;
        const webhook = await getWebhook(id);

        if (!webhook) {
          return reply.status(404).send({ error: 'Webhook not found' });
        }

        return webhook;
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to load webhook' });
      }
    }
  );

  /**
   * POST /webhooks - create a new webhook
   */
  fastify.post<{
    Body: {
      url: string;
      events: string[];
      secret?: string;
      enabled?: boolean;
    };
  }>('/', async (request, reply) => {
    try {
      // Only admins can create webhooks
      const user = (request as any).user;
      if (user && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only admins can manage webhooks' });
      }

      const { url, events, secret, enabled = true } = request.body;

      // Validate required fields
      if (!url || !events || events.length === 0) {
        return reply.status(400).send({
          error: 'Missing required fields: url, events',
        });
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        return reply.status(400).send({ error: 'Invalid URL format' });
      }

      // Validate event types
      const invalidEvents = events.filter(
        (event) => !VALID_EVENT_TYPES.includes(event)
      );
      if (invalidEvents.length > 0) {
        return reply.status(400).send({
          error: `Invalid event types: ${invalidEvents.join(', ')}`,
          validEvents: VALID_EVENT_TYPES,
        });
      }

      // Generate secret if not provided
      const webhookSecret = secret || generateSecret();

      const webhook = await createWebhook({
        url,
        events,
        secret: webhookSecret,
        enabled,
      });

      await logAudit({
        userId: user?.id,
        action: 'webhook.created',
        entityType: 'webhook',
        entityId: webhook.id,
        details: { url: webhook.url, events: webhook.events },
      });

      return reply.status(201).send(webhook);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to create webhook' });
    }
  });

  /**
   * PUT /webhooks/:id - update a webhook
   */
  fastify.put<{
    Params: { id: string };
    Body: Partial<Webhook>;
  }>('/:id', async (request, reply) => {
    try {
      // Only admins can update webhooks
      const user = (request as any).user;
      if (user && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only admins can manage webhooks' });
      }

      const { id } = request.params;
      const updates = request.body;

      // Validate URL if provided
      if (updates.url) {
        try {
          new URL(updates.url);
        } catch {
          return reply.status(400).send({ error: 'Invalid URL format' });
        }
      }

      // Validate event types if provided
      if (updates.events) {
        const invalidEvents = updates.events.filter(
          (event) => !VALID_EVENT_TYPES.includes(event)
        );
        if (invalidEvents.length > 0) {
          return reply.status(400).send({
            error: `Invalid event types: ${invalidEvents.join(', ')}`,
            validEvents: VALID_EVENT_TYPES,
          });
        }
      }

      const webhook = await updateWebhook(id, updates);

      if (!webhook) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      await logAudit({
        userId: user?.id,
        action: 'webhook.updated',
        entityType: 'webhook',
        entityId: webhook.id,
        details: updates,
      });

      return webhook;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update webhook' });
    }
  });

  /**
   * DELETE /webhooks/:id - delete a webhook
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      try {
        // Only admins can delete webhooks
        const user = (request as any).user;
        if (user && user.role !== 'admin') {
          return reply.status(403).send({ error: 'Only admins can manage webhooks' });
        }

        const { id } = request.params;
        const webhook = await getWebhook(id);

        if (!webhook) {
          return reply.status(404).send({ error: 'Webhook not found' });
        }

        const success = await deleteWebhook(id);

        if (!success) {
          return reply.status(404).send({ error: 'Webhook not found' });
        }

        await logAudit({
          userId: user?.id,
          action: 'webhook.deleted',
          entityType: 'webhook',
          entityId: id,
          details: { url: webhook.url },
        });

        return { success: true, id };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to delete webhook' });
      }
    }
  );

  /**
   * POST /webhooks/:id/test - send a test payload to a webhook
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/test',
    async (request, reply) => {
      try {
        // Only admins can test webhooks
        const user = (request as any).user;
        if (user && user.role !== 'admin') {
          return reply.status(403).send({ error: 'Only admins can manage webhooks' });
        }

        const { id } = request.params;
        const webhook = await getWebhook(id);

        if (!webhook) {
          return reply.status(404).send({ error: 'Webhook not found' });
        }

        // Dispatch a test event
        await dispatchWebhookEvent('task.created', {
          task: {
            id: 'test-task-id',
            title: 'Test Task',
            description: 'This is a test webhook payload',
            status: 'backlog',
            priority: 'P2',
            createdAt: new Date().toISOString(),
          },
        });

        await logAudit({
          userId: user?.id,
          action: 'webhook.tested',
          entityType: 'webhook',
          entityId: id,
          details: { url: webhook.url },
        });

        return { success: true, message: 'Test payload sent' };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to test webhook' });
      }
    }
  );
}
