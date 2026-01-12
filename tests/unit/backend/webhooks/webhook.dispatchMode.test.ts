// tests/unit/backend/webhooks/webhook.dispatchMode.test.ts
//
// Phase 6A – Dispatch Mode Declaration (RED)
//
// Contract:
// - Dispatch mode is explicit
// - Defaults to "sync"
// - Rejects invalid values
// - Router behavior remains synchronous
// - No silent fallbacks
//

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';

jest.mock('api-src/services/webhook-ledger.service');

const mockLedger = WebhookLedgerService as jest.Mocked<
  typeof WebhookLedgerService
>;

describe('Webhook Dispatch Mode – declaration contract', () => {
  const baseEnvelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_dispatch_mode',
    eventType: 'app/uninstalled',
    verified: true,
    receivedAt: new Date(),
    rawPayload: { ok: true },
    shopDomain: 'test.myshopify.com',
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.WEBHOOK_DISPATCH_MODE;

    // Default ledger behavior for router tests
    (WebhookLedgerService.recordReceived as jest.Mock).mockResolvedValue({
        isDuplicate: false,
    });
  });

  it('defaults to sync dispatch mode when env is not set', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await WebhookRouter.dispatch(baseEnvelope);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts explicit sync dispatch mode', async () => {
    process.env.WEBHOOK_DISPATCH_MODE = 'sync';

    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await WebhookRouter.dispatch(baseEnvelope);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('throws on invalid dispatch mode', async () => {
    process.env.WEBHOOK_DISPATCH_MODE = 'banana';

    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await expect(
      WebhookRouter.dispatch(baseEnvelope)
    ).rejects.toThrow(/WEBHOOK_DISPATCH_MODE/i);
  });

  it('does not change ledger behavior in sync mode', async () => {
    mockLedger.recordReceived.mockResolvedValue({ isDuplicate: false });

    const handler = jest.fn().mockResolvedValue(undefined);

    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'app/uninstalled',
      handle: handler,
    });

    await WebhookRouter.dispatch(baseEnvelope);

    expect(mockLedger.recordReceived).toHaveBeenCalledTimes(1);
    expect(mockLedger.markProcessed).toHaveBeenCalledTimes(1);
  });
});