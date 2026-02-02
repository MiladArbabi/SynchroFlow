import { buildWebhookEnvelope } from '../buildWebhookEnvelope';
import { WebhookEnvelope } from '../types';
import crypto from 'crypto';

export class ShopifyWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const rawBody =
      req.rawBody ??
      Buffer.from(JSON.stringify(req.body), 'utf8');

    /**
     * Deterministic Shopify eventId
     * -----------------------------
     * Shopify guarantees at-least-once delivery.
     * We must guarantee exactly-once processing.
     *
     * Rules:
     * - Prefer Shopify-provided webhook ID
     * - Otherwise derive a stable hash from (topic + rawBody)
     * - NEVER use a constant fallback
     */
    const providedEventId =
      req.headers['x-shopify-webhook-id'] as string | undefined;

    const eventId =
      providedEventId ??
      crypto
        .createHash('sha256')
        .update(
          `${req.headers['x-shopify-topic']}::${req.rawBody?.toString('utf8')}`,
          'utf8'
        )
        .digest('hex');

    const shopDomain =
      req.headers['x-shopify-shop-domain'] as string | undefined;

    /**
     * Shopify → WebhookEnvelope adapter
     *
     * CONTRACT:
     * - `eventType` MUST be a canonical, exact-match string.
     * - WebhookRouter dispatch keys are strict string equality:
     *     <integration>::<eventType>
     *
     * WHY:
     * - Shopify headers may include casing variance or hidden whitespace.
     * - Any deviation causes silent dispatch failure (handler not invoked).
     *
     * NORMALIZATION RULES:
     * - string only
     * - trimmed
     * - lowercased
     * - no JSON/stringification
     *
     * Example:
     *   Header:  "Fulfillments/Create "
     *   Emits:   "fulfillments/create"
     */
    const rawTopic = req.headers['x-shopify-topic'];

    if (typeof rawTopic !== 'string') {
      throw new Error('[ShopifyWebhookAdapter] Missing or invalid x-shopify-topic header');
    }

    const eventType = rawTopic.trim().toLowerCase();

    return buildWebhookEnvelope({
      integration: 'shopify',
      eventId,
      eventType, // ← canonical dispatch key
      rawPayload: req.body,
      shopDomain,
    });
  }
}