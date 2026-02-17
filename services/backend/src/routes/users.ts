/**
 * User Routes - List users for assignment and display
 */

import { FastifyInstance } from 'fastify';
import { listUsers } from '../user-store.js';

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
}
