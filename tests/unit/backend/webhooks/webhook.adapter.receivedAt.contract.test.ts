// tests/unit/backend/webhooks/webhook.adapter.receivedAt.contract.test.ts

import { ShopifyWebhookAdapter } from 'api-src/api/webhooks/adapters/shopify.adapter';
import { StripeWebhookAdapter } from 'api-src/api/webhooks/adapters/stripe.adapter';
import { buildWebhookEnvelope } from 'api-src/api/webhooks/buildWebhookEnvelope';

jest.mock('api-src/api/webhooks/buildWebhookEnvelope');

describe('Webhook adapters — receivedAt ownership contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('adapters do NOT set receivedAt directly (Shopify)', () => {
    const req: any = {
      headers: {
        'x-shopify-webhook-id': 'evt_shopify_1',
        'x-shopify-topic': 'orders/create',
      },
      body: { foo: 'bar' },
    };

    ShopifyWebhookAdapter.toEnvelope(req);

    const call = (buildWebhookEnvelope as jest.Mock).mock.calls[0][0];

    expect(call.receivedAt).toBeUndefined();
  });

  it('adapters do NOT set receivedAt directly (Stripe)', () => {
    const req: any = {
      body: {
        id: 'evt_stripe_1',
        type: 'payment_intent.succeeded',
      },
    };

    StripeWebhookAdapter.toEnvelope(req);

    const call = (buildWebhookEnvelope as jest.Mock).mock.calls[0][0];

    expect(call.receivedAt).toBeUndefined();
  });
});