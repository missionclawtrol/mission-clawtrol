/**
 * Auth Middleware - Protects API routes using mc_session cookie
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession, hasAnyUsers, User, UserRole } from '../user-store.js';

const COOKIE_NAME = 'mc_session';

// Extend Fastify types via declaration merging
declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/**
 * Core authentication check — validates the mc_session cookie.
 * Attaches user to request.user on success.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = request.cookies?.[COOKIE_NAME];

  if (!token) {
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  const user = await validateSession(token);
  if (!user) {
    return reply.status(401).send({ error: 'Session expired or invalid' });
  }

  request.user = user;
}

/**
 * Role-based authorization middleware
 * Usage: { preHandler: requireRole('admin') } or requireRole('member', 'admin')
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (process.env.DISABLE_AUTH === 'true') {
      return;
    }

    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}

/**
 * Check if user can modify a task (admin, or member who created/is assigned to the task)
 */
export function canModifyTask(user: User, task: { createdBy?: string | null; assignedTo?: string | null }): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'viewer') return false;
  return user.id === task.createdBy || user.id === task.assignedTo;
}

/**
 * Create auth middleware with configurable exclusion patterns.
 *
 * Special behaviour:
 * - If DISABLE_AUTH=true: pass all requests through
 * - If no local users exist (fresh install): only allow setup + excluded routes;
 *   all other routes get 403 { error: "Setup required", setupRequired: true }
 */
export function createAuthMiddleware(excludePatterns: RegExp[] = []) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Auth fully disabled for local dev
    if (process.env.DISABLE_AUTH === 'true') {
      return;
    }

    const path = request.url.split('?')[0]; // strip query string

    // Always allow excluded paths
    for (const pattern of excludePatterns) {
      if (pattern.test(path)) {
        return;
      }
    }

    // If no users exist yet, block everything except /api/auth/setup
    const anyUsers = await hasAnyUsers();
    if (!anyUsers) {
      return reply.status(403).send({ error: 'Setup required', setupRequired: true });
    }

    // Normal auth check
    return requireAuth(request, reply);
  };
}
