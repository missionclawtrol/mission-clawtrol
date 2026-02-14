import { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface Settings {
  humanHourlyRate: number;
}

const SETTINGS_FILE = join(process.env.HOME || '', '.openclaw/settings.json');

/**
 * Load settings from the settings.json file
 */
async function loadSettings(): Promise<Settings> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Return defaults if file doesn't exist
    return {
      humanHourlyRate: 100,
    };
  }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /settings - get all settings
  fastify.get<{}>('/', async (request, reply) => {
    try {
      const settings = await loadSettings();
      return settings;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load settings' });
    }
  });
}
