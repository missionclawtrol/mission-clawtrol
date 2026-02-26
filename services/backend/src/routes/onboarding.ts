import { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import crypto from 'crypto';

const OPENCLAW_CONFIG_PATH = join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');
const BUSINESS_DIR = join(process.env.HOME || '/root', '.openclaw', 'business');
const PROFILE_JSON = join(BUSINESS_DIR, 'PROFILE.json');
const PROFILE_MD = join(BUSINESS_DIR, 'PROFILE.md');
const TOOLS_MD = join(BUSINESS_DIR, 'TOOLS.md');

interface CompanyProfile {
  companyName: string;
  industry: string;
  whatYouDo: string;
  targetCustomers: string;
  missionValues: string;
  websiteUrl: string;
  teamSize: string;
  goalsAndChallenges: string;
  tools: ToolEntry[];
}

interface ToolEntry {
  name: string;
  url: string;
  username: string;
  password: string;
  purpose: string;
}

interface AgentTraining {
  instructions: string;
  tools: ToolEntry[];
}

async function ensureDir(path: string) {
  await fs.mkdir(path, { recursive: true });
}

async function readJsonSafe<T>(filePath: string, defaultVal: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultVal;
  }
}

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateProfileMd(profile: CompanyProfile): string {
  const toolsSection = profile.tools && profile.tools.length > 0
    ? `## General Tools\n\n${profile.tools.map(t =>
        `### ${t.name}\n- URL: ${t.url}\n- Username: ${t.username}\n- Purpose: ${t.purpose}`
      ).join('\n\n')}`
    : '';

  return `# Company Profile

## ${profile.companyName}

**Industry:** ${profile.industry}
**Team Size:** ${profile.teamSize}
**Website:** ${profile.websiteUrl}

## What We Do

${profile.whatYouDo}

## Target Customers

${profile.targetCustomers}

## Mission & Values

${profile.missionValues}

## Goals & Challenges

${profile.goalsAndChallenges}

${toolsSection}
`.trim() + '\n';
}

function generateToolsMd(tools: ToolEntry[]): string {
  if (!tools || tools.length === 0) return '# Tools\n\nNo tools configured yet.\n';
  return `# Company Tools\n\n${tools.map(t =>
    `## ${t.name}\n- **URL:** ${t.url}\n- **Username:** ${t.username}\n- **Password:** ${t.password}\n- **Purpose:** ${t.purpose}`
  ).join('\n\n')}\n`;
}

function generateTrainingMd(agentId: string, training: AgentTraining): string {
  const toolsSection = training.tools && training.tools.length > 0
    ? `\n## Role-Specific Tools\n\n${training.tools.map(t =>
        `### ${t.name}\n- URL: ${t.url}\n- Username: ${t.username}\n- Password: ${t.password}\n- Purpose: ${t.purpose}`
      ).join('\n\n')}`
    : '';

  return `# Training: ${agentId}

## Role Instructions

${training.instructions}
${toolsSection}
`.trim() + '\n';
}

const DEFAULT_PROFILE: CompanyProfile = {
  companyName: '',
  industry: '',
  whatYouDo: '',
  targetCustomers: '',
  missionValues: '',
  websiteUrl: '',
  teamSize: '',
  goalsAndChallenges: '',
  tools: [],
};

const DEFAULT_TRAINING: AgentTraining = {
  instructions: '',
  tools: [],
};

// ── API Key Helpers ──────────────────────────────────────────────────────────

/**
 * Read openclaw.json safely, returning {} on failure
 */
async function readOpenClawConfig(): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write openclaw.json with a deep merge of the provided patch
 */
async function writeOpenClawConfig(patch: Record<string, any>): Promise<void> {
  const existing = await readOpenClawConfig();
  const merged = deepMerge(existing, patch);
  await fs.writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(merged, null, 4), 'utf-8');
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, any>, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Mask an API key: show first 8 chars then ***
 * e.g. "sk-ant-api03-abc..." → "sk-ant-a***"
 */
function maskKey(key: string): string {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 8) + '***';
}

export async function onboardingRoutes(fastify: FastifyInstance) {
  // Register multipart plugin for file uploads
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 10,
    },
  });

  // ── API Keys ─────────────────────────────────────────────────────────────

  // GET /api/onboarding/api-keys
  fastify.get('/api-keys', async (_request, reply) => {
    try {
      const config = await readOpenClawConfig();
      const env: Record<string, string> = config.env || {};

      const anthropicKey = env.ANTHROPIC_API_KEY || '';
      const openaiKey = env.OPENAI_API_KEY || '';

      return {
        anthropicKey: anthropicKey ? maskKey(anthropicKey) : '',
        anthropicConfigured: !!anthropicKey,
        openaiKey: openaiKey ? maskKey(openaiKey) : '',
        openaiConfigured: !!openaiKey,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to read API key configuration' });
    }
  });

  // PUT /api/onboarding/api-keys
  fastify.put<{ Body: { anthropicKey?: string; openaiKey?: string } }>('/api-keys', async (request, reply) => {
    try {
      const { anthropicKey, openaiKey } = request.body || {};

      // Build env patch — only update keys that were provided and non-empty
      const envPatch: Record<string, string> = {};
      if (anthropicKey && anthropicKey.trim() && !anthropicKey.includes('***')) {
        envPatch.ANTHROPIC_API_KEY = anthropicKey.trim();
      }
      if (openaiKey !== undefined && openaiKey.trim() && !openaiKey.includes('***')) {
        envPatch.OPENAI_API_KEY = openaiKey.trim();
      }

      if (Object.keys(envPatch).length === 0) {
        return reply.status(400).send({ error: 'No valid keys provided' });
      }

      // Check config is writable before attempting write
      try {
        await fs.access(OPENCLAW_CONFIG_PATH, fs.constants.W_OK);
      } catch {
        return reply.status(500).send({
          error: `Config file is not writable: ${OPENCLAW_CONFIG_PATH}. Check file permissions.`,
        });
      }

      await writeOpenClawConfig({ env: envPatch });

      return { ok: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: err?.message || 'Failed to save API keys',
      });
    }
  });

  // ── Company Profile ──────────────────────────────────────────────────────

  // GET /api/onboarding/company
  fastify.get('/company', async (_request, reply) => {
    try {
      await ensureDir(BUSINESS_DIR);
      const profile = await readJsonSafe<CompanyProfile>(PROFILE_JSON, DEFAULT_PROFILE);
      return profile;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to load company profile' });
    }
  });

  // PUT /api/onboarding/company
  fastify.put<{ Body: CompanyProfile }>('/company', async (request, reply) => {
    try {
      await ensureDir(BUSINESS_DIR);
      const profile = request.body;

      // Save structured JSON
      await writeJson(PROFILE_JSON, profile);

      // Generate and save Markdown for agents
      await fs.writeFile(PROFILE_MD, generateProfileMd(profile), 'utf-8');

      // Save tools to TOOLS.md
      await fs.writeFile(TOOLS_MD, generateToolsMd(profile.tools || []), 'utf-8');

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to save company profile' });
    }
  });

  // ── Agent Training ───────────────────────────────────────────────────────

  // GET /api/onboarding/agent/:agentId
  fastify.get<{ Params: { agentId: string } }>('/agent/:agentId', async (request, reply) => {
    try {
      const { agentId } = request.params;
      const agentDir = join(BUSINESS_DIR, 'agents', agentId);
      await ensureDir(agentDir);
      const training = await readJsonSafe<AgentTraining>(
        join(agentDir, 'training.json'),
        DEFAULT_TRAINING
      );
      return training;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to load agent training' });
    }
  });

  // PUT /api/onboarding/agent/:agentId
  fastify.put<{ Params: { agentId: string }; Body: AgentTraining }>('/agent/:agentId', async (request, reply) => {
    try {
      const { agentId } = request.params;
      const agentDir = join(BUSINESS_DIR, 'agents', agentId);
      await ensureDir(agentDir);
      const training = request.body;

      // Save structured JSON (used by the API)
      await writeJson(join(agentDir, 'training.json'), training);

      // Generate and save TRAINING.md for the agent to read
      await fs.writeFile(
        join(agentDir, 'TRAINING.md'),
        generateTrainingMd(agentId, training),
        'utf-8'
      );

      // Save tools as tools.json
      await writeJson(join(agentDir, 'tools.json'), training.tools || []);

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to save agent training' });
    }
  });

  // ── File Management ──────────────────────────────────────────────────────

  // POST /api/onboarding/upload
  // multipart params: file (the file), category (handbook|brand|training|agent), agentId (optional)
  fastify.post('/upload', async (request, reply) => {
    try {
      const parts = request.parts();
      let category = 'training';
      let agentId: string | undefined;
      let uploadedFile: string | undefined;

      // Collect all parts — buffer file data so fields are processed first
      const fields: { name: string; value: string }[] = [];
      const files: { filename: string; data: Buffer }[] = [];

      for await (const part of parts) {
        if (part.type === 'field') {
          fields.push({ name: part.fieldname, value: part.value as string });
        } else if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          files.push({ filename: part.filename, data: Buffer.concat(chunks) });
        }
      }

      // Apply fields first (order-independent)
      for (const f of fields) {
        if (f.name === 'category') category = f.value;
        if (f.name === 'agentId') agentId = f.value;
      }

      // Now write files with correct category
      for (const file of files) {
          // Determine directory
          let targetDir: string;
          if (category === 'agent' && agentId) {
            targetDir = join(BUSINESS_DIR, 'agents', agentId);
          } else {
            targetDir = join(BUSINESS_DIR, category);
          }
          await ensureDir(targetDir);

          const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const destPath = join(targetDir, safeName);
          await fs.writeFile(destPath, file.data);
          uploadedFile = safeName;
      }

      if (!uploadedFile) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      return { success: true, filename: uploadedFile, category, agentId };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to upload file' });
    }
  });

  // GET /api/onboarding/files
  // Returns list of all uploaded files organized by category
  fastify.get('/files', async (_request, reply) => {
    try {
      await ensureDir(BUSINESS_DIR);
      const categories = ['handbook', 'brand', 'training'];
      const result: Record<string, { name: string; path: string; size: number }[]> = {};

      for (const cat of categories) {
        const catDir = join(BUSINESS_DIR, cat);
        try {
          const files = await fs.readdir(catDir);
          result[cat] = await Promise.all(
            files.map(async (f) => {
              const stat = await fs.stat(join(catDir, f));
              return { name: f, path: `${cat}/${f}`, size: stat.size };
            })
          );
        } catch {
          result[cat] = [];
        }
      }

      // Also get agent-specific files
      const agentsDir = join(BUSINESS_DIR, 'agents');
      try {
        const agentIds = await fs.readdir(agentsDir);
        for (const agId of agentIds) {
          const agDir = join(agentsDir, agId);
          const stat = await fs.stat(agDir);
          if (stat.isDirectory()) {
            try {
              const files = await fs.readdir(agDir);
              const fileEntries = await Promise.all(
                files
                  .filter(f => !f.endsWith('.json') && !f.endsWith('.md'))
                  .map(async (f) => {
                    const fstat = await fs.stat(join(agDir, f));
                    return { name: f, path: `agents/${agId}/${f}`, size: fstat.size };
                  })
              );
              if (fileEntries.length > 0) {
                result[`agent:${agId}`] = fileEntries;
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // agents dir doesn't exist yet
      }

      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to list files' });
    }
  });

  // DELETE /api/onboarding/files/:filename
  // filename is URL-encoded relative path like "handbook/myfile.pdf"
  fastify.delete<{ Params: { filename: string } }>('/files/:filename', async (request, reply) => {
    try {
      // Decode the filename — it can contain slashes so use splat
      const relativePath = decodeURIComponent(request.params.filename);

      // Security: ensure path stays within BUSINESS_DIR
      const fullPath = join(BUSINESS_DIR, relativePath);
      if (!fullPath.startsWith(BUSINESS_DIR)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      await fs.unlink(fullPath);
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return reply.status(404).send({ error: 'File not found' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete file' });
    }
  });

  // ── Wildcard delete for nested paths ─────────────────────────────────────
  // DELETE /api/onboarding/files/* — handles paths with slashes
  fastify.delete('/files/*', async (request, reply) => {
    try {
      const params = request.params as Record<string, string>;
      const relativePath = decodeURIComponent(params['*'] || '');

      const fullPath = join(BUSINESS_DIR, relativePath);
      if (!fullPath.startsWith(BUSINESS_DIR)) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      await fs.unlink(fullPath);
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return reply.status(404).send({ error: 'File not found' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete file' });
    }
  });
}
