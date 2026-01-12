// tests/unit/backend/webhooks/webhook.dispatchQueued.test.ts
//
// Phase 6B – Queued Dispatch (RED)
//
// Contract:
// - When WEBHOOK_DISPATCH_MODE=queued
// - Router MUST enqueue the webhook envelope
// - Router MUST NOT invoke handler inline
// - Ledger recordReceived MUST still be called exactly once
// - Envelope MUST NOT be mutated
// - Dispatch MUST resolve without throwing
//

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

// Queue seam (to be implemented)
import { enqueueWebhookEnvelope } from 'api-src/api/webhooks/dispatchQueue';

jest.mock('api-src/services/webhook-ledger.service');
jest.mock('api-src/api/webhooks/dispatchQueue');

const mockLedger = WebhookLedgerService as jest.Mocked<
  typeof WebhookLedgerService
>;

const mockEnqueue = enqueueWebhookEnvelope as jest.MockedFunction<
  typeof enqueueWebhookEnvelope
>;

describe('WebhookRouter – queued dispatch contract', () => {
  const baseEnvelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_queued_1',
    eventType: 'app/uninstalled',
    verified: true,
    receivedAt: new Date(),
    rawPayload: { hello: 'world' },
    shopDomain: 'queued-test.myshopify.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WEBHOOK_DISPATCH_MODE = 'queued';

    mockLedger.recordReceived.mockResolvedValue({
      isDuplicate: false,
    });

    mockEnqueue.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_DISPATCH_MODE;
  });

  it('enqueues the webhook envelope instead of invoking handler', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await expect(
      WebhookRouter.dispatch(baseEnvelope)
    ).resolves.not.toThrow();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(baseEnvelope);

    expect(handler).not.toHaveBeenCalled();
  });

  it('still writes to ledger exactly once before enqueue', async () => {
    await WebhookRouter.dispatch(baseEnvelope);

    expect(mockLedger.recordReceived).toHaveBeenCalledTimes(1);
    expect(mockLedger.recordReceived).toHaveBeenCalledWith({
      integration: baseEnvelope.integration,
      externalEventId: baseEnvelope.eventId,
      eventType: baseEnvelope.eventType,
      payload: baseEnvelope.rawPayload,
      idempotencyKey: `${baseEnvelope.integration}:${baseEnvelope.eventId}`,
    });
  });

  it('does not mutate the webhook envelope', async () => {
    const frozen = structuredClone(baseEnvelope);

    await WebhookRouter.dispatch(baseEnvelope);

    expect(baseEnvelope).toEqual(frozen);
  });

  it('does not mark processed synchronously in queued mode', async () => {
    await WebhookRouter.dispatch(baseEnvelope);

    expect(mockLedger.markProcessed).not.toHaveBeenCalled();
    expect(mockLedger.markFailed).not.toHaveBeenCalled();
    expect(mockLedger.markIgnored).not.toHaveBeenCalled();
  });
});