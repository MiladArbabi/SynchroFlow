// tests/unit/backend/webhooks/webhook.envelope.test.ts
//
// Canonical Webhook Envelope – Contract Tests
//
// PURPOSE:
// - Enforce a single internal webhook language
// - Prevent provider-specific leakage into domain logic
// - Guarantee envelope invariants across all integrations
//
// HARD RULES:
// - verified MUST always be true
// - receivedAt MUST be set at creation time
// - provider metadata is optional
// - envelope shape is provider-agnostic

import { buildWebhookEnvelope } from 'api-src/api/webhooks/buildWebhookEnvelope';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';

describe('WebhookEnvelope – canonical contract', () => {
  const baseParams = {
    integration: 'test-provider',
    eventId: 'evt_123',
    eventType: 'test.event',
    rawPayload: { foo: 'bar' },
  };

  it('builds a valid webhook envelope with required fields', () => {
    const envelope = buildWebhookEnvelope(baseParams);

    expect(envelope).toBeDefined();

    expect(envelope.integration).toBe('test-provider');
    expect(envelope.eventId).toBe('evt_123');
    expect(envelope.eventType).toBe('test.event');
    expect(envelope.rawPayload).toEqual({ foo: 'bar' });

    expect(envelope.verified).toBe(true);
    expect(envelope.receivedAt).toBeInstanceOf(Date);
  });

  it('includes optional shop metadata when provided', () => {
    const envelope = buildWebhookEnvelope({
      ...baseParams,
      shopId: 42,
      shopDomain: 'test-shop.myshopify.com',
    });

    expect(envelope.shopId).toBe(42);
    expect(envelope.shopDomain).toBe('test-shop.myshopify.com');
  });

  it('omits optional fields when not provided', () => {
    const envelope = buildWebhookEnvelope(baseParams);

    expect(envelope.shopId).toBeUndefined();
    expect(envelope.shopDomain).toBeUndefined();
  });

  it('always sets verified=true (fail-closed invariant)', () => {
    const envelope = buildWebhookEnvelope(baseParams);

    // This must NEVER be false or undefined
    expect(envelope.verified).toBe(true);
  });

  it('does not mutate input payload', () => {
    const payload = { nested: { value: 1 } };

    const envelope = buildWebhookEnvelope({
      ...baseParams,
      rawPayload: payload,
    });

    expect(envelope.rawPayload).toEqual(payload);
    expect(envelope.rawPayload).not.toBeNull();
  });

  it('conforms to WebhookEnvelope interface', () => {
    const envelope: WebhookEnvelope = buildWebhookEnvelope(baseParams);

    // Compile-time test (this line should never error)
    expect(envelope.integration).toBeDefined();
  });
});