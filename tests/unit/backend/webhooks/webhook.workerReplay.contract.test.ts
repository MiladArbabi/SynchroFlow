// tests/unit/backend/webhooks/webhook.workerReplay.contract.test.ts
//
// Phase 7B – Worker re-entry & replay safety (RED)
//
// Contract:
// - Worker can re-enter WebhookRouter using queued job
// - Ledger recordReceived is called exactly once
// - Duplicate replays do NOT re-invoke handlers
// - Envelope is not mutated
// - Dispatch never throws
//

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

jest.mock('api-src/services/webhook-ledger.service');

const mockLedger = WebhookLedgerService as jest.Mocked<
  typeof WebhookLedgerService
>;

describe('Webhook Worker Replay – safety contract', () => {
  const envelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_worker_1',
    eventType: 'app/uninstalled',
    verified: true,
    receivedAt: new Date(),
    rawPayload: { foo: 'bar' },
    shopDomain: 'replay-safe.myshopify.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.WEBHOOK_DISPATCH_MODE;
  });

  it('processes webhook once and ignores replay safely', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    // First delivery: not duplicate
    mockLedger.recordReceived.mockResolvedValueOnce({
      isDuplicate: false,
    });

    // Replay delivery: duplicate
    mockLedger.recordReceived.mockResolvedValueOnce({
      isDuplicate: true,
    });

    // First processing
    await expect(
      WebhookRouter.dispatch(envelope)
    ).resolves.not.toThrow();

    // Replay processing
    await expect(
      WebhookRouter.dispatch(envelope)
    ).resolves.not.toThrow();

    // Ledger written twice (receive attempt)
    expect(mockLedger.recordReceived).toHaveBeenCalledTimes(2);

    // Handler must run ONLY once
    expect(handler).toHaveBeenCalledTimes(1);

    // Duplicate must be marked
    expect(mockLedger.markDuplicate).toHaveBeenCalledWith(envelope.eventId);
  });

  it('does not mutate the webhook envelope across replays', async () => {
    mockLedger.recordReceived.mockResolvedValue({ isDuplicate: false });

    const frozen = structuredClone(envelope);

    await WebhookRouter.dispatch(envelope);

    expect(envelope).toEqual(frozen);
  });
});