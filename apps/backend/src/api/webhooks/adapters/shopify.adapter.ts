import { buildWebhookEnvelope } from '../buildWebhookEnvelope';
import { WebhookEnvelope } from '../types';

export class ShopifyWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const eventId =
      (req.headers['x-shopify-webhook-id'] as string | undefined) ??
      'missing_event_id';

    const shopDomain =
      req.headers['x-shopify-shop-domain'] as string | undefined;

    return buildWebhookEnvelope({
      integration: 'shopify',
      eventId,
      eventType: req.headers['x-shopify-topic'] as string,
      rawPayload: req.body,
      shopDomain,
    });
  }
}