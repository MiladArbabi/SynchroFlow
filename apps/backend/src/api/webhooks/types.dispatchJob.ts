// apps/backend/src/api/webhooks/types.dispatchJob.ts
//
// Canonical webhook dispatch job
// Versioned and replay-safe

import { WebhookEnvelope } from './types';

export interface WebhookDispatchJobV1 {
  version: 1;
  integration: string;
  eventId: string;
  eventType: string;
  rawPayload: unknown;
  shopDomain?: string;
  enqueuedAt: string;
}

export type WebhookDispatchJob = WebhookDispatchJobV1;