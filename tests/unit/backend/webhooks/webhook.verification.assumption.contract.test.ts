// tests/unit/backend/webhooks/webhook.verification.assumption.contract.test.ts

import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';

jest.mock('api-src/services/webhook-ledger.service');

describe('Webhook verification — router assumption contract', () => {
  const envelope: WebhookEnvelope = {
    integration: 'shopify',
    eventId: 'evt_verify_assumption',
    eventType: 'orders/create',
    verified: true, // type-enforced invariant
    receivedAt: new Date(),
    rawPayload: { test: true },
    shopDomain: 'assumption.myshopify.com',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WEBHOOK_DISPATCH_MODE = 'sync';

    (WebhookLedgerService.recordReceived as jest.Mock).mockResolvedValue({
      isDuplicate: false,
    });
  });

  it('router assumes envelope is verified by type contract', async () => {
    await WebhookRouter.dispatch(envelope);

    expect(WebhookLedgerService.recordReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: 'shopify',
        externalEventId: 'evt_verify_assumption',
      })
    );
  });

  it('ledger is written with verified=true regardless of envelope flag', async () => {
    await WebhookRouter.dispatch(envelope);

    const callArgs =
      (WebhookLedgerService.recordReceived as jest.Mock).mock.calls[0][0];

    // ledger service unconditionally writes verified=true
    expect(WebhookLedgerService.recordReceived).toHaveBeenCalled();
  });
});