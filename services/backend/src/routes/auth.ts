/**
 * Auth Routes - GitHub OAuth authentication
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fastifyOauth2 } from '@fastify/oauth2';
import { createUser, getUserByGithubId, updateLastLogin } from '../user-store.js';

declare module 'fastify' {
  interface FastifyInstance {
    githubOAuth2: any;
  }
  interface Session {
    userId?: string;
    githubAccessToken?: string;
  }
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
  const ALLOWED_ORG = process.env.ALLOWED_ORG;
  const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173';

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    fastify.log.warn('GitHub OAuth credentials not configured - auth endpoints will not work');
  }

  // Register OAuth2 plugin
  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
    await fastify.register(fastifyOauth2, {
      name: 'githubOAuth2',
      scope: ['user:email', 'read:org'],
      credentials: {
        client: {
          id: GITHUB_CLIENT_ID,
          secret: GITHUB_CLIENT_SECRET,
        },
        auth: {
          authorizeHost: 'https://github.com',
          authorizePath: '/login/oauth/authorize',
          tokenHost: 'https://github.com',
          tokenPath: '/login/oauth/access_token',
        },
      },
      callbackUri: `${PUBLIC_URL}/api/auth/callback`,
    });
  }

  /**
   * GET /api/auth/login
   * Redirects to GitHub OAuth authorization URL
   */
  fastify.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fastify.githubOAuth2) {
      return reply.status(503).send({ error: 'GitHub OAuth not configured' });
    }

    try {
      return reply.redirect(
        await fastify.githubOAuth2.getAuthorizeURL({
          state: Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64'),
        })
      );
    } catch (err) {
      fastify.log.error({ err }, 'OAuth redirect error');
      return reply.status(500).send({ error: 'Failed to initiate OAuth flow' });
    }
  });

  /**
   * GET /api/auth/callback
   * Handles GitHub OAuth callback
   */
  fastify.get('/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fastify.githubOAuth2) {
      return reply.status(503).send({ error: 'GitHub OAuth not configured' });
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = (tokenResponse.token as TokenResponse).access_token;

      // Fetch GitHub user profile
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        fastify.log.error({ status: userResponse.status }, 'GitHub user fetch failed');
        return reply.status(500).send({ error: 'Failed to fetch GitHub user' });
      }

      const githubUser: GitHubUser = await userResponse.json();

      // If ALLOWED_ORG is set, verify user is a member
      if (ALLOWED_ORG) {
        const orgCheckResponse = await fetch(
          `https://api.github.com/orgs/${ALLOWED_ORG}/members/${githubUser.login}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        if (orgCheckResponse.status === 404) {
          fastify.log.warn(`User ${githubUser.login} is not a member of ${ALLOWED_ORG}`);
          return reply.status(403).send({
            error: `Access denied. You must be a member of the ${ALLOWED_ORG} GitHub organization.`,
          });
        }

        if (!orgCheckResponse.ok) {
          fastify.log.error({ status: orgCheckResponse.status }, 'Org membership check failed');
          return reply.status(500).send({ error: 'Failed to verify organization membership' });
        }
      }

      // Get user email if not public
      let email = githubUser.email;
      if (!email) {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (emailsResponse.ok) {
          const emails: Array<{ email: string; primary: boolean }> = await emailsResponse.json();
          const primaryEmail = emails.find((e) => e.primary);
          email = primaryEmail?.email || emails[0]?.email || null;
        }
      }

      // Check if user exists, create or update
      let user = await getUserByGithubId(githubUser.id);

      if (user) {
        // Update existing user
        user = await updateLastLogin(githubUser.id);
        fastify.log.info(`User logged in: ${user?.githubLogin}`);
      } else {
        // Create new user - first user becomes admin
        user = await createUser({
          githubId: githubUser.id,
          githubLogin: githubUser.login,
          name: githubUser.name,
          email: email,
          avatarUrl: githubUser.avatar_url,
        });
        fastify.log.info(`New user created: ${user.githubLogin} as ${user.role}`);
      }

      if (!user) {
        return reply.status(500).send({ error: 'Failed to create or update user' });
      }

      // Set session
      request.session.set('userId', user.id);
      request.session.set('githubAccessToken', accessToken);

      // Redirect to public URL
      return reply.redirect(PUBLIC_URL);
    } catch (err) {
      fastify.log.error({ err }, 'OAuth callback error');
      return reply.status(500).send({ error: 'Authentication failed' });
    }
  });

  /**
   * GET /api/auth/me
   * Returns current user info from session (or mock user when auth disabled)
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    // When auth is disabled, return a mock admin user
    if (process.env.DISABLE_AUTH === 'true') {
      return {
        id: 'dev-user',
        githubLogin: 'dev',
        name: 'Local Developer',
        email: 'dev@localhost',
        avatarUrl: null,
        role: 'admin',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
    }

    const userId = request.session.get('userId');

    if (!userId) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const { getUserById } = await import('../user-store.js');
    const user = await getUserById(userId);

    if (!user) {
      // Session exists but user was deleted - destroy session
      request.session.destroy();
      return reply.status(401).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  });

  /**
   * POST /api/auth/logout
   * Clears session, returns success
   */
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.session.destroy();
    return { success: true };
  });
}
