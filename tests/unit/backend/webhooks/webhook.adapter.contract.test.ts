// tests/unit/backend/webhooks/webhook.adapter.contract.test.ts

import { StripeWebhookAdapter } from 'api-src/api/webhooks/adapters/stripe.adapter';
import { WebhookLedgerService } from 'api-src/services/webhook-ledger.service';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';

jest.mock('api-src/services/webhook-ledger.service');
jest.mock('api-src/api/webhooks/webhookRouter');

describe('Webhook Adapter – purity contract', () => {
  it('does not write to ledger or dispatch', () => {
    const req: any = {
      body: { id: 'evt_1', type: 'invoice.paid' },
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{}'),
    };

    const envelope = StripeWebhookAdapter.toEnvelope(req);

    expect(envelope).toBeDefined();

    expect(WebhookLedgerService.recordReceived).not.toHaveBeenCalled();
    expect(WebhookRouter.dispatch).not.toHaveBeenCalled();
  });
});