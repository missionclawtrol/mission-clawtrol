/**
 * User Routes - List users for assignment and display
 */

import { FastifyInstance } from 'fastify';
import { listUsers, updateUser, getUserById, UserRole, deleteUser } from '../user-store.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../audit-store.js';

export async function userRoutes(fastify: FastifyInstance) {
  /**
   * GET /users - list all users (for task assignment dropdowns, etc.)
   */
  fastify.get('/', async (_request, reply) => {
    try {
      const users = await listUsers();
      
      // Return safe subset (no sensitive fields)
      const safeUsers = users.map(u => ({
        id: u.id,
        githubLogin: u.githubLogin,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        role: u.role,
      }));

      // When auth is disabled, inject the mock dev user if no real users exist
      if (process.env.DISABLE_AUTH === 'true' && safeUsers.length === 0) {
        safeUsers.push({
          id: 'dev-user',
          githubLogin: 'dev',
          name: 'Local Developer',
          email: 'dev@localhost',
          avatarUrl: null,
          role: 'admin',
        });
      }

      return { users: safeUsers };
    } catch (error) {
      fastify.log.error(error, 'Failed to list users');
      return reply.status(500).send({ error: 'Failed to list users' });
    }
  });

  /**
   * PATCH /users/:id - update user role (admin only)
   */
  fastify.patch<{
    Params: { id: string };
    Body: { role?: UserRole };
  }>('/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { role } = request.body;

      if (!role) {
        return reply.status(400).send({ error: 'No updates provided' });
      }

      const validRoles: UserRole[] = ['admin', 'member', 'viewer'];
      if (!validRoles.includes(role)) {
        return reply.status(400).send({ error: 'Invalid role. Must be admin, member, or viewer' });
      }

      // Prevent demoting yourself
      const currentUser = (request as any).user;
      if (currentUser?.id === id && role !== 'admin') {
        return reply.status(400).send({ error: 'Cannot change your own role' });
      }

      const user = await updateUser(id, { role });
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await logAudit({
        userId: currentUser?.id,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        details: { newRole: role },
      });

      return {
        id: user.id,
        githubLogin: user.githubLogin,
        name: user.name,
        role: user.role,
      };
    } catch (error) {
      fastify.log.error(error, 'Failed to update user');
      return reply.status(500).send({ error: 'Failed to update user' });
    }
  });

  /**
   * DELETE /users/:id - remove a user (admin only)
   */
  fastify.delete<{
    Params: { id: string };
  }>('/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    try {
      const { id } = request.params;
      const currentUser = (request as any).user;

      // Can't delete yourself
      if (currentUser?.id === id) {
        return reply.status(400).send({ error: 'Cannot delete your own account' });
      }

      const success = await deleteUser(id);
      if (!success) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await logAudit({
        userId: currentUser?.id,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        details: {},
      });

      return { success: true };
    } catch (error) {
      fastify.log.error(error, 'Failed to delete user');
      return reply.status(500).send({ error: 'Failed to delete user' });
    }
  });
}
