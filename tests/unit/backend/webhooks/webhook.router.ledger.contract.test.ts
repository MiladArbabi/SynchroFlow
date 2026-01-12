// tests/unit/backend/webhooks/webhook.router.ledger.contract.test.ts

import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import { buildWebhookEnvelope } from 'api-src/api/webhooks/buildWebhookEnvelope';

jest.mock('api-src/services/webhook-ledger.service');

describe('WebhookRouter – ledger authority', () => {
  it('writes to ledger exactly once per dispatch', async () => {
    (WebhookLedgerService.recordReceived as jest.Mock).mockResolvedValue({
      isDuplicate: false,
    });

    const envelope = buildWebhookEnvelope({
      integration: 'shopify',
      eventId: 'evt_123',
      eventType: 'app/uninstalled',
      rawPayload: {},
    });

    await WebhookRouter.dispatch(envelope);

    expect(WebhookLedgerService.recordReceived).toHaveBeenCalledTimes(1);
  });
});
