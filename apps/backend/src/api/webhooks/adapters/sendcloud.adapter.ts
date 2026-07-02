import { buildWebhookEnvelope } from '../buildWebhookEnvelope.js';
import { WebhookEnvelope } from '../types.js';

export class SendcloudWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const payload = req.body;

    // Sendcloud parcel status webhook shape: { action: 'parcel_status_changed', parcel: {...} }
    const parcelId = payload?.parcel?.id;
    const statusMessage = payload?.parcel?.status?.message ?? payload?.parcel?.status?.id;

    if (!parcelId || !statusMessage) {
      throw new Error('[SendcloudWebhookAdapter] Missing parcel.id or parcel.status');
    }

    return buildWebhookEnvelope({
      integration: 'sendcloud',
      eventType: 'parcel_status_changed',
      rawPayload: payload,
      shopId: req.resolvedShopId,
      // eventId intentionally omitted — buildWebhookEnvelope derives a
      // deterministic hash from (integration, eventType, shopDomain, payload).
      // Sendcloud doesn't provide a stable webhook-delivery ID; the parcel
      // status payload itself (parcel id + status + timestamp) is the
      // natural idempotency key.
    });
  }
}