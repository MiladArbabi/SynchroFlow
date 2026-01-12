// tests/unit/backend/webhooks/webhook.router.test.ts
//
// Phase 2 – Webhook Router (RED)
//
// Contract:
// - Routes by integration:eventType
// - Dispatches exactly one handler
// - Marks unsupported events as ignored
// - Marks failures as failed
// - NEVER throws uncaught errors
// - Does NOT mutate envelope
//

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

jest.mock('api-src/services/webhook-ledger.service');

const mockLedger = WebhookLedgerService as jest.Mocked<
  typeof WebhookLedgerService
>;

describe('WebhookRouter – dispatch contract', () => {
  const baseEnvelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_123',
    eventType: 'app/uninstalled',
    verified: true,
    receivedAt: new Date(),
    rawPayload: { foo: 'bar' },
    shopDomain: 'test-shop.myshopify.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();

    mockLedger.recordReceived.mockResolvedValue({
      isDuplicate: false,
    });
  });

  it('dispatches to the correct handler based on integration + eventType', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await WebhookRouter.dispatch(baseEnvelope);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(baseEnvelope);
  });

  it('marks unsupported events as ignored and does not throw', async () => {
    mockLedger.markIgnored.mockResolvedValue(undefined);

    const unsupportedEnvelope: WebhookEnvelope = {
      ...baseEnvelope,
      eventType: 'unknown/event',
    };

    await expect(
      WebhookRouter.dispatch(unsupportedEnvelope)
    ).resolves.not.toThrow();

    expect(mockLedger.markIgnored).toHaveBeenCalledWith(
      unsupportedEnvelope.eventId,
      'unsupported_event'
    );
  });

  it('marks handler failures as failed and does not throw', async () => {
    const error = new Error('boom');

    const failingHandler = jest.fn().mockRejectedValue(error);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: failingHandler,
    });

    mockLedger.markFailed.mockResolvedValue(undefined);

    await expect(
      WebhookRouter.dispatch(baseEnvelope)
    ).resolves.not.toThrow();

    expect(mockLedger.markFailed).toHaveBeenCalledWith(
      baseEnvelope.eventId,
      'boom'
    );
  });

  it('never dispatches more than one handler', async () => {
    const handlerA = jest.fn().mockResolvedValue(undefined);
    const handlerB = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handlerA,
    });

    // accidental duplicate registration (should be impossible or last-write-wins)
    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handlerB,
    });

    await WebhookRouter.dispatch(baseEnvelope);

    // EXACTLY ONE handler must fire
    expect(handlerA.mock.calls.length + handlerB.mock.calls.length).toBe(1);
  });

  it('does not mutate the webhook envelope', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    const frozen = structuredClone(baseEnvelope);

    await WebhookRouter.dispatch(baseEnvelope);

    expect(baseEnvelope).toEqual(frozen);
  });
});