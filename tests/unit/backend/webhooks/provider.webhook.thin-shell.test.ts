// tests/unit/backend/webhooks/provider.webhook.thin-shell.test.ts

import { stripeWebhookHandler } from 'api-src/api/billing/stripe.webhook';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';

jest.mock('api-src/api/webhooks/webhookRouter');

describe('Stripe webhook – thin shell contract', () => {
  it('delegates to WebhookRouter exactly once', async () => {
    const req: any = {
      body: { id: 'evt_1', type: 'invoice.paid' },
      headers: {},
      rawBody: Buffer.from('{}'),
    };

    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await stripeWebhookHandler(req, res);

    expect(WebhookRouter.dispatch).toHaveBeenCalledTimes(1);
  });
});