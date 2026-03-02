/**
 * Rules API — CRUD endpoints for the rules engine
 *
 * GET    /api/rules          — list all rules
 * GET    /api/rules/:id      — get single rule
 * POST   /api/rules          — create rule
 * PATCH  /api/rules/:id      — update rule
 * DELETE /api/rules/:id      — delete rule (built-ins cannot be deleted)
 */

import { FastifyInstance } from 'fastify';
import {
  getAllRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  type Rule,
  type CreateRuleInput,
  type UpdateRuleInput,
} from '../rule-store.js';
import {
  isValidCronExpression,
  registerCronRule,
  unregisterCronRule,
} from '../cron-scheduler.js';

const VALID_TRIGGERS = [
  'task.status.changed',
  'task.created',
  'task.assigned',
  'agent.session.started',
  'cron',
];

const VALID_ACTION_TYPES = [
  'spawn_agent',
  'inject_context',
  'conflict_check',
  'notify',
  'warn',
];

export async function rulesRoutes(fastify: FastifyInstance) {
  // GET /api/rules — list all rules
  fastify.get('/', async (request, reply) => {
    try {
      const rules = await getAllRules();
      return { rules, count: rules.length };
    } catch (err) {
      fastify.log.error(err, 'Failed to list rules');
      return reply.status(500).send({ error: 'Failed to list rules' });
    }
  });

  // GET /api/rules/:id — get single rule
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const rule = await getRule(request.params.id);
      if (!rule) return reply.status(404).send({ error: 'Rule not found' });
      return rule;
    } catch (err) {
      fastify.log.error(err, 'Failed to get rule');
      return reply.status(500).send({ error: 'Failed to get rule' });
    }
  });

  // POST /api/rules — create a rule
  fastify.post<{
    Body: {
      name: string;
      trigger: string;
      conditions?: Record<string, any>;
      actions?: Array<Record<string, any>>;
      enabled?: boolean;
      priority?: number;
      projectId?: string | null;
      schedule?: string | null;
    };
  }>('/', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot create rules' });
      }

      const { name, trigger, conditions, actions, enabled, priority, projectId, schedule } = request.body;

      if (!name || !trigger) {
        return reply.status(400).send({ error: 'name and trigger are required' });
      }

      // Validate cron-specific requirements
      if (trigger === 'cron') {
        if (!schedule) {
          return reply.status(400).send({ error: 'schedule is required for trigger=cron' });
        }
        if (!isValidCronExpression(schedule)) {
          return reply.status(400).send({ error: `Invalid cron expression: "${schedule}"` });
        }
      }

      const rule = await createRule({
        name,
        trigger,
        conditions: conditions ?? {},
        actions: actions ?? [],
        enabled: enabled !== false,
        priority: priority ?? 100,
        projectId: projectId ?? null,
        isBuiltIn: false,
        schedule: schedule ?? null,
      });

      // Register cron job if this is an enabled cron rule
      if (rule.trigger === 'cron' && rule.enabled && rule.schedule) {
        registerCronRule(rule);
      }

      return reply.status(201).send(rule);
    } catch (err) {
      fastify.log.error(err, 'Failed to create rule');
      return reply.status(500).send({ error: 'Failed to create rule' });
    }
  });

  // PATCH /api/rules/:id — update a rule
  fastify.patch<{
    Params: { id: string };
    Body: Partial<UpdateRuleInput>;
  }>('/:id', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot update rules' });
      }

      const existing = await getRule(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Rule not found' });

      // Validate schedule if provided (regardless of existing or updated trigger)
      const newTrigger = request.body.trigger ?? existing.trigger;
      const newSchedule = 'schedule' in request.body ? request.body.schedule : existing.schedule;

      if (newTrigger === 'cron' && newSchedule && !isValidCronExpression(newSchedule)) {
        return reply.status(400).send({ error: `Invalid cron expression: "${newSchedule}"` });
      }
      if (newTrigger === 'cron' && !newSchedule) {
        return reply.status(400).send({ error: 'schedule is required for trigger=cron' });
      }

      // Built-in rules can only have enabled toggled (not name/trigger/conditions/actions)
      const updates: UpdateRuleInput = {};
      if (existing.isBuiltIn) {
        if (request.body.enabled !== undefined) {
          updates.enabled = request.body.enabled;
        }
        // Silently ignore other fields for built-ins
      } else {
        // Custom rules: allow all updates
        Object.assign(updates, request.body);
        // Strip protected fields
        delete (updates as any).id;
        delete (updates as any).isBuiltIn;
        delete (updates as any).createdAt;
        delete (updates as any).updatedAt;
      }

      const updated = await updateRule(request.params.id, updates);
      if (!updated) return reply.status(404).send({ error: 'Rule not found' });

      // Handle cron scheduler registration/unregistration
      if (updated.trigger === 'cron') {
        if (updated.enabled && updated.schedule) {
          // (Re-)register the cron job
          registerCronRule(updated);
        } else {
          // Disabled or no schedule — unregister
          unregisterCronRule(updated.id);
        }
      } else if (existing.trigger === 'cron') {
        // Trigger changed away from cron — unregister old job
        unregisterCronRule(updated.id);
      }

      return updated;
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update rule');
      return reply.status(500).send({ error: err.message || 'Failed to update rule' });
    }
  });

  // DELETE /api/rules/:id — delete a rule (built-ins cannot be deleted)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot delete rules' });
      }

      const existing = await getRule(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'Rule not found' });
      if (existing.isBuiltIn) {
        return reply.status(400).send({
          error: 'Built-in rules cannot be deleted. Disable them instead.',
          code: 'BUILTIN_RULE',
        });
      }

      // Unregister cron job before deleting
      if (existing.trigger === 'cron') {
        unregisterCronRule(existing.id);
      }

      const deleted = await deleteRule(request.params.id);
      if (!deleted) return reply.status(404).send({ error: 'Rule not found' });
      return { success: true, id: request.params.id };
    } catch (err: any) {
      fastify.log.error(err, 'Failed to delete rule');
      return reply.status(500).send({ error: err.message || 'Failed to delete rule' });
    }
  });
}
