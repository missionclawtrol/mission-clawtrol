import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  createdAt: string;
}

/**
 * Convert database row to Webhook object
 */
function rowToWebhook(row: any): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events || '[]'),
    secret: row.secret,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

/**
 * Get all webhooks
 */
export async function getAllWebhooks(): Promise<Webhook[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM webhooks ORDER BY createdAt DESC');
    return rows.map(rowToWebhook);
  } catch (error) {
    console.error('Failed to load webhooks:', error);
    throw error;
  }
}

/**
 * Get a single webhook by ID
 */
export async function getWebhook(id: string): Promise<Webhook | null> {
  try {
    const row = await db.queryOne<any>('SELECT * FROM webhooks WHERE id = ?', [id]);
    return row ? rowToWebhook(row) : null;
  } catch (error) {
    console.error('Failed to get webhook:', error);
    throw error;
  }
}

/**
 * Get enabled webhooks that match a specific event type
 */
export async function getWebhooksForEvent(eventType: string): Promise<Webhook[]> {
  try {
    const rows = await db.query<any>('SELECT * FROM webhooks WHERE enabled = 1');
    const webhooks = rows.map(rowToWebhook);
    
    // Filter webhooks that have this event type in their events array
    return webhooks.filter(webhook => webhook.events.includes(eventType));
  } catch (error) {
    console.error('Failed to get webhooks for event:', error);
    throw error;
  }
}

/**
 * Create a new webhook
 */
export async function createWebhook(
  data: Omit<Webhook, 'id' | 'createdAt'>
): Promise<Webhook> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      'INSERT INTO webhooks (id, url, events, secret, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        data.url,
        JSON.stringify(data.events),
        data.secret,
        data.enabled ? 1 : 0,
        now,
      ]
    );

    const webhook = await getWebhook(id);
    if (!webhook) {
      throw new Error('Failed to retrieve created webhook');
    }
    return webhook;
  } catch (error) {
    console.error('Failed to create webhook:', error);
    throw error;
  }
}

/**
 * Update a webhook
 */
export async function updateWebhook(
  id: string,
  updates: Partial<Omit<Webhook, 'id' | 'createdAt'>>
): Promise<Webhook | null> {
  try {
    const webhook = await getWebhook(id);
    if (!webhook) {
      return null;
    }

    await db.execute(
      'UPDATE webhooks SET url = ?, events = ?, secret = ?, enabled = ? WHERE id = ?',
      [
        updates.url ?? webhook.url,
        JSON.stringify(updates.events ?? webhook.events),
        updates.secret ?? webhook.secret,
        (updates.enabled !== undefined ? updates.enabled : webhook.enabled) ? 1 : 0,
        id,
      ]
    );

    return await getWebhook(id);
  } catch (error) {
    console.error('Failed to update webhook:', error);
    throw error;
  }
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(id: string): Promise<boolean> {
  try {
    const result = await db.execute('DELETE FROM webhooks WHERE id = ?', [id]);
    return result.changes > 0;
  } catch (error) {
    console.error('Failed to delete webhook:', error);
    throw error;
  }
}
