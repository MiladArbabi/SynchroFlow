// apps/backend/src/api/webhooks/dispatchQueue.ts
//
// Phase 6B – Queue seam
//
// This module defines the async boundary for webhook dispatch.
// It does NOT implement workers or retry logic.
//
// Contract:
// - Accept a fully-formed WebhookEnvelope
// - Enqueue exactly once
// - Never throw (fail-closed upstream)

import { WebhookEnvelope } from './types';

export async function enqueueWebhookEnvelope(
  envelope: WebhookEnvelope
): Promise<void> {
  // IMPLEMENTATION COMES IN FUTURE PHASE
  // For now this is a seam only.

  // This function will eventually:
  // - serialize the envelope
  // - publish to a durable queue
  // - return immediately

  return;
}