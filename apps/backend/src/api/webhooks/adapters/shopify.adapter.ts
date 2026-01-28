import { buildWebhookEnvelope } from '../buildWebhookEnvelope';
import { WebhookEnvelope } from '../types';

export class ShopifyWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const eventId =
      (req.headers['x-shopify-webhook-id'] as string | undefined) ??
      'missing_event_id';

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