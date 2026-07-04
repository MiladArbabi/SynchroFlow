import { buildWebhookEnvelope } from '../buildWebhookEnvelope.js';
import { WebhookEnvelope } from '../types.js';

export class ShippoWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const payload = req.body;

    if (payload?.event !== 'track_updated') {
      throw new Error(`[ShippoWebhookAdapter] Unexpected event type: ${payload?.event}`);
    }

    const trackingNumber = payload?.data?.tracking_number;
    if (!trackingNumber) {
      throw new Error('[ShippoWebhookAdapter] Missing data.tracking_number');
    }

    return buildWebhookEnvelope({
      integration: 'shippo',
      eventType: 'track_updated',
      rawPayload: payload,
      shopId: req.resolvedShopId,
      // No stable delivery ID from Shippo either — buildWebhookEnvelope
      // derives a deterministic hash from (integration, eventType,
      // shopDomain, payload), same idempotency approach as Sendcloud.
    });
  }
}