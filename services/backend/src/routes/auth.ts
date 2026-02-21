/**
 * Auth Routes - Username/Password authentication
 *
 * Endpoints:
 *   POST /api/auth/login      — validate credentials, set session cookie
 *   POST /api/auth/logout     — clear session cookie
 *   GET  /api/auth/me         — return current user (or 401)
 *   POST /api/auth/setup      — first-time setup (no users exist)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  hasAnyUsers,
  createLocalUser,
  validateUser,
  createSession,
  deleteSession,
  validateSession,
  getUserById,
} from '../user-store.js';

const COOKIE_NAME = 'mc_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

// Only set secure cookies when explicitly using HTTPS (not just production mode)
// Marketplace droplets often run HTTP-only behind an IP address
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.BASE_URL?.startsWith('https');

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: !!COOKIE_SECURE,
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.setCookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: !!COOKIE_SECURE,
  });
}

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/auth/login
   * Body: { username: string, password: string }
   */
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username?: string; password?: string };

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    const user = await validateUser(username, password);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid username or password' });
    }

    const token = await createSession(user.id);
    setSessionCookie(reply, token);

    return {
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
    };
  });

  /**
   * POST /api/auth/logout
   */
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.[COOKIE_NAME];
    if (token) {
      await deleteSession(token);
    }
    clearSessionCookie(reply);
    return { success: true };
  });

  /**
   * GET /api/auth/me
   * Returns current user, or 401 with setupRequired flag if no users exist.
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    // When auth is disabled, return a mock admin user
    if (process.env.DISABLE_AUTH === 'true') {
      return {
        id: 'dev-user',
        username: 'dev',
        name: 'Local Developer',
        email: 'dev@localhost',
        avatarUrl: null,
        role: 'admin',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
    }

    // Check if any users exist — if not, flag setup required
    const anyUsers = await hasAnyUsers();
    if (!anyUsers) {
      return reply.status(401).send({ error: 'Setup required', setupRequired: true });
    }

    const token = request.cookies?.[COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const user = await validateSession(token);
    if (!user) {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Session expired or invalid' });
    }

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  });

  /**
   * POST /api/auth/setup
   * First-time only: create the initial admin user.
   * Returns 403 if users already exist.
   */
  fastify.post('/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    const anyUsers = await hasAnyUsers();
    if (anyUsers) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const { username, password } = request.body as { username?: string; password?: string };

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return reply.status(400).send({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' });
    }

    const user = await createLocalUser(username, password);

    // Auto-login: create session
    const token = await createSession(user.id);
    setSessionCookie(reply, token);

    return {
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
    };
  });
}
