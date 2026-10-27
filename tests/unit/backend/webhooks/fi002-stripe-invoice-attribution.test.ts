import { StripeWebhookAdapter } from
  'api-src/api/webhooks/adapters/stripe.adapter';

function adapt(
  invoice: Record<string, unknown>,
  type = 'invoice.payment_succeeded'
) {
  return StripeWebhookAdapter.toEnvelope({
    body: {
      id: 'evt_fi002_attribution',
      type,
      data: { object: invoice },
    },
  });
}

describe('FI-002 — Stripe invoice attribution', () => {
  it('FI002-ATTR-01: resolves subscription snapshot metadata', () => {
    const envelope = adapt({
      id: 'in_fi002',
      metadata: {},
      customer: 'cus_fi002',
      parent: {
        type: 'subscription_details',
        subscription_details: {
          subscription: 'sub_fi002',
          metadata: { shopId: '42' },
        },
      },
    });

    expect(envelope.shopId).toBe(42);
  });

  it('FI002-ATTR-02: conflicting tenant metadata fails closed', () => {
    expect(() => adapt({
      id: 'in_fi002_conflict',
      metadata: { shopId: '84' },
      parent: {
        type: 'subscription_details',
        subscription_details: {
          subscription: 'sub_fi002',
          metadata: { shopId: '42' },
        },
      },
    })).toThrow();
  });

  it('FI002-ATTR-03: subscription webhook metadata remains supported', () => {
    const envelope = adapt({
      id: 'sub_fi002',
      metadata: { shopId: '42' },
    }, 'customer.subscription.updated');

    expect(envelope.shopId).toBe(42);
  });

  it('FI002-ATTR-04: missing tenant identity is never guessed', () => {
    const envelope = adapt({
      id: 'in_fi002_unknown',
      metadata: {},
      parent: null,
    });

    expect(envelope.shopId).toBeUndefined();
  });
});
