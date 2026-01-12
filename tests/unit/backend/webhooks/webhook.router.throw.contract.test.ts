// tests/unit/backend/webhooks/webhook.router.throw.contract.test.ts

import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';

jest.mock('api-src/services/webhook-ledger.service');

describe('WebhookRouter — throw semantics contract', () => {
  const envelope: WebhookEnvelope = {
    integration: 'stripe',
    eventId: 'evt_throw_test',
    eventType: 'payment_intent.succeeded',
    verified: true,
    receivedAt: new Date(),
    rawPayload: {},
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (WebhookLedgerService.recordReceived as jest.Mock).mockResolvedValue({
      isDuplicate: false,
    });
  });

  it('throws immediately on invalid WEBHOOK_DISPATCH_MODE', async () => {
    process.env.WEBHOOK_DISPATCH_MODE = 'invalid_mode';

    await expect(
      WebhookRouter.dispatch(envelope)
    ).rejects.toThrow(/Invalid WEBHOOK_DISPATCH_MODE/);
  });

  it('does NOT throw when handler throws (failure is absorbed)', async () => {
    process.env.WEBHOOK_DISPATCH_MODE = 'sync';

    WebhookRouter.register({
      integration: 'stripe',
      eventType: 'payment_intent.succeeded',
      handle: async () => {
        throw new Error('handler failure');
      },
    });

    await expect(
      WebhookRouter.dispatch(envelope)
    ).resolves.toBeUndefined();
  });
});
