import { WebhookEnvelope } from './types';

export function buildWebhookEnvelope(params: {
  integration: string;
  eventId: string;
  eventType: string;
  rawPayload: unknown;
  shopId?: number;
  shopDomain?: string;
}): WebhookEnvelope {
  return {
    integration: params.integration,
    eventId: params.eventId,
    eventType: params.eventType,
    verified: true,
    receivedAt: new Date(),
    rawPayload: params.rawPayload,
    shopId: params.shopId,
    shopDomain: params.shopDomain,
  };
}