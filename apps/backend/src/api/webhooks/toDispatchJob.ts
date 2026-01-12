// apps/backend/src/api/webhooks/toDispatchJob.ts
//
// Phase 7A – Webhook → Dispatch Job adapter
//
// HARD RULES:
// - Pure function
// - No mutation
// - Deterministic output
// - Replay-safe

import { WebhookEnvelope } from './types';
import { WebhookDispatchJob } from './types.dispatchJob';

export function toDispatchJob(
  envelope: WebhookEnvelope
): WebhookDispatchJob {
  return {
    version: 1,
    integration: envelope.integration,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    rawPayload: envelope.rawPayload,
    shopDomain: envelope.shopDomain,
    enqueuedAt: new Date().toISOString(),
  };
}