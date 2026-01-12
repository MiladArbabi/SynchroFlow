// tests/unit/backend/webhooks/webhook.dispatchJob.contract.test.ts
//
// Phase 7A – WebhookDispatchJob Contract (RED)
//
// Contract:
// - Async queue payload MUST be versioned
// - MUST be JSON-serializable
// - MUST NOT contain Dates or functions
// - MUST NOT mutate the source WebhookEnvelope
// - MUST contain only worker-safe fields
//

import { WebhookEnvelope } from 'api-src/api/webhooks/types';

// NOTE: This does NOT exist yet — RED by design
import { toDispatchJob } from 'api-src/api/webhooks/toDispatchJob';

describe('WebhookDispatchJob – async payload contract', () => {
  const envelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_async_001',
    eventType: 'app/uninstalled',
    verified: true,
    receivedAt: new Date('2026-01-01T00:00:00Z'),
    rawPayload: { hello: 'world' },
    shopDomain: 'async-test.myshopify.com',
  };

  it('produces a versioned, JSON-serializable job', () => {
    const job = toDispatchJob(envelope);

    // versioning is mandatory
    expect(job.version).toBe(1);

    // must survive JSON round-trip
    expect(() => JSON.stringify(job)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(job));

    expect(parsed).toEqual(job);
  });

  it('does not include Date objects or runtime-only fields', () => {
    const job = toDispatchJob(envelope);

    // receivedAt must be serialized (string), not Date
    expect(typeof job.enqueuedAt).toBe('string');

    // rawPayload must be preserved verbatim
    expect(job.rawPayload).toEqual(envelope.rawPayload);

    // job must NOT include verified flag
    expect((job as any).verified).toBeUndefined();
  });

  it('does not mutate the source webhook envelope', () => {
    const frozen = structuredClone(envelope);

    toDispatchJob(envelope);

    expect(envelope).toEqual(frozen);
  });

  it('contains only worker-safe fields', () => {
    const job = toDispatchJob(envelope);

    expect(job).toEqual({
      version: 1,
      integration: envelope.integration,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      rawPayload: envelope.rawPayload,
      shopDomain: envelope.shopDomain,
      enqueuedAt: expect.any(String),
    });
  });
});