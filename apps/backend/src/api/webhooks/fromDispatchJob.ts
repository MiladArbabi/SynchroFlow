// apps/backend/src/api/webhooks/fromDispatchJob.ts
//
// Worker → Router re-entry
//
// Reconstructs a minimal WebhookEnvelope from a dispatch job.
// MUST be deterministic and side-effect free.
//

import { WebhookEnvelope } from './types';
import { WebhookDispatchJob } from './types.dispatchJob';

export function fromDispatchJob(
  job: WebhookDispatchJob
): WebhookEnvelope {
  return {
    integration: job.integration,
    eventId: job.eventId,
    eventType: job.eventType,
    rawPayload: job.rawPayload,
    shopDomain: job.shopDomain,
    verified: true,                 // invariant: jobs only exist post-verification
    receivedAt: new Date(job.enqueuedAt),
    __fromQueue: true,
  };
}