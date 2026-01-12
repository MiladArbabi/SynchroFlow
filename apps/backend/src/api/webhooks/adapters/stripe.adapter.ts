import { buildWebhookEnvelope } from '../buildWebhookEnvelope';
import { WebhookEnvelope } from '../types';

export class StripeWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const event = req.body;

    return buildWebhookEnvelope({
      integration: 'stripe',
      eventId: event.id,
      eventType: event.type,
      rawPayload: event,
      shopId: event?.data?.object?.metadata?.shopId
        ? Number(event.data.object.metadata.shopId)
        : undefined,
    });
  }
}