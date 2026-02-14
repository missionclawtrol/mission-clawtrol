import { FastifyInstance } from 'fastify';
import { db } from '../database';

export interface Settings {
  humanHourlyRate: number;
  [key: string]: any;
}

/**
 * Load settings from the SQLite database
 */
function loadSettings(): Settings {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings: Settings = {
      humanHourlyRate: 100, // Default
    };

    for (const row of rows as any[]) {
      // Try to parse as JSON first, then fall back to string
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        // If JSON parsing fails, treat as string or try to convert to number
        const numValue = parseFloat(row.value);
        settings[row.key] = isNaN(numValue) ? row.value : numValue;
      }
    }

    return settings;
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Return defaults if there's an error
    return {
      humanHourlyRate: 100,
    };
  }
}

/**
 * Save a setting to the SQLite database
 */
function saveSetting(key: string, value: any): void {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stringValue);
  } catch (error) {
    console.error('Failed to save setting:', error);
    throw error;
  }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /settings - get all settings
  fastify.get<{}>('/', async (request, reply) => {
    try {
      const settings = loadSettings();
      return settings;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to load settings' });
    }
  });

  // PUT /settings - update settings
  fastify.put<{ Body: Partial<Settings> }>('/', async (request, reply) => {
    try {
      const updates = request.body;

      for (const [key, value] of Object.entries(updates)) {
        saveSetting(key, value);
      }

      const settings = loadSettings();
      return settings;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update settings' });
    }
  });
}
