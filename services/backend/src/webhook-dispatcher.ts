import { createHmac } from 'crypto';
import { getWebhooksForEvent } from './webhook-store.js';

const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Dispatch webhook event to all registered webhooks
 * Fire-and-forget with timeout and error logging
 */
export async function dispatchWebhookEvent(
  eventType: string,
  payload: object
): Promise<void> {
  try {
    const webhooks = await getWebhooksForEvent(eventType);
    
    if (webhooks.length === 0) {
      // No webhooks registered for this event type
      return;
    }

    const timestamp = new Date().toISOString();
    const body = JSON.stringify({
      event: eventType,
      data: payload,
      timestamp,
    });

    // Fire webhooks in parallel, don't await
    webhooks.forEach((webhook) => {
      const signature = generateSignature(body, webhook.secret);

      // Fire-and-forget POST with timeout
      fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': eventType,
        },
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
        .then((response) => {
          if (!response.ok) {
            console.warn(
              `[Webhook] Failed to deliver ${eventType} to ${webhook.url}: ${response.status} ${response.statusText}`
            );
          } else {
            console.log(`[Webhook] Delivered ${eventType} to ${webhook.url}`);
          }
        })
        .catch((error) => {
          console.error(
            `[Webhook] Error delivering ${eventType} to ${webhook.url}:`,
            error.message
          );
        });
    });
  } catch (error) {
    console.error(`[Webhook] Error dispatching event ${eventType}:`, error);
  }
}
