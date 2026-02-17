/**
 * Auth Middleware - Protects API routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserById, User, UserRole } from '../user-store.js';

// Extend Fastify types via declaration merging
declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/**
 * Authentication middleware - validates session and attaches user to request
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check if session has userId
  const userId = request.session.get('userId');

  if (!userId) {
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  // Look up user by ID
  const user = await getUserById(userId);

  if (!user) {
    // Session exists but user was deleted - destroy session
    request.session.destroy();
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  // Attach user to request for downstream handlers
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
    // When auth is disabled, treat as admin
    if (process.env.DISABLE_AUTH === 'true') {
      return;
    }

    // requireAuth must run first to populate request.user
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
  // Members can modify tasks they created or are assigned to
  return user.id === task.createdBy || user.id === task.assignedTo;
}

/**
 * Create auth middleware with configurable exclusion patterns
 */
export function createAuthMiddleware(excludePatterns: RegExp[] = []) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Check if request path matches any exclusion pattern
    const path = request.url.split('?')[0]; // Remove query string
    
    for (const pattern of excludePatterns) {
      if (pattern.test(path)) {
        // Path is excluded from auth - allow through
        return;
      }
    }

    // Apply requireAuth for non-excluded paths
    return requireAuth(request, reply);
  };
}
