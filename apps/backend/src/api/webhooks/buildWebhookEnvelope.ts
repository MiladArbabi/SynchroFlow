// apps/backend/src/api/webhooks/buildWebhookEnvelope.ts

import { WebhookEnvelope } from './types';
import crypto from 'crypto';

/**
 * Deterministic webhook event identity
 * -----------------------------------
 * Shopify does NOT guarantee a stable event ID.
 *
 * Rule:
 * - If upstream provides an eventId → use it
 * - Else → derive a deterministic hash from immutable inputs
 *
 * Guarantees:
 * - Idempotent across retries
 * - Stable for identical payloads
 * - No inference, no randomness
 */
function deriveEventId(params: {
  integration: string;
  eventType: string;
  rawPayload: unknown;
  shopDomain?: string;
}): string {
  const material = JSON.stringify({
    integration: params.integration,
    eventType: params.eventType,
    shopDomain: params.shopDomain ?? null,
    payload: params.rawPayload,
  });

  return crypto
    .createHash('sha256')
    .update(material, 'utf8')
    .digest('hex');
}

export function buildWebhookEnvelope(params: {
  integration: string;
  eventId?: string;               // ← now optional
  eventType: string;
  rawPayload: unknown;
  shopId?: number;
  shopDomain?: string;
}): WebhookEnvelope {
  const eventId =
    params.eventId && params.eventId.length > 0
      ? params.eventId
      : deriveEventId({
          integration: params.integration,
          eventType: params.eventType,
          rawPayload: params.rawPayload,
          shopDomain: params.shopDomain,
        });

  return {
    integration: params.integration,
    eventId,
    eventType: params.eventType,
    verified: true,
    receivedAt: new Date(),
    rawPayload: params.rawPayload,
    shopId: params.shopId,
    shopDomain: params.shopDomain,
  };
}