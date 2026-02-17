// apps/backend/src/api/webhooks/types.dispatchJob.ts
//
// Canonical webhook dispatch job
// Versioned and replay-safe

import { WebhookEnvelope } from './types.js';

export interface WebhookDispatchJobV1 {
  version: 1;
  integration: string;
  eventId: string;
  eventType: string;
  rawPayload: unknown;
  shopDomain?: string;
  enqueuedAt: string;
  __fromQueue: true; // internal transport flag
}

export type WebhookDispatchJob = WebhookDispatchJobV1;