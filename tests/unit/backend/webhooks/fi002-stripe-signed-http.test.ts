import crypto from 'crypto';
import request from 'supertest';

jest.mock('api-src/api/webhooks/webhookRouter', () => ({
  WebhookRouter: {
    register: jest.fn(),
    dispatch: jest.fn(),
  },
}));

import { createApp } from 'api-src/bootstrap/express';
import { WebhookRouter } from
  'api-src/api/webhooks/webhookRouter';

const app = createApp();
const PATH = '/api/v1/billing/stripe/webhook';
const SECRET = 'whsec_fi002_local_test_only';
const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;

function invoice(
  snapshotShopId: string | null,
  topLevelShopId?: string
) {
  return {
    id: 'evt_fi002_signed',
    object: 'event',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_fi002_signed',
        object: 'invoice',
        metadata: topLevelShopId
          ? { shopId: topLevelShopId }
          : {},
        parent: {
          type: 'subscription_details',
          subscription_details: {
            subscription: 'sub_fi002_signed',
            metadata: snapshotShopId
              ? { shopId: snapshotShopId }
              : {},
          },
        },
      },
    },
  };
}

function signature(raw: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac('sha256', SECRET)
    .update(`${timestamp}.${raw}`)
    .digest('hex');

  return `t=${timestamp},v1=${digest}`;
}

async function signedPost(event: Record<string, unknown>) {
  const raw = JSON.stringify(event);

  return request(app)
    .post(PATH)
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature(raw))
    .send(raw);
}

describe('FI-002 — signed Stripe HTTP attribution', () => {
  const dispatch = WebhookRouter.dispatch as jest.Mock;

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  beforeEach(() => {
    dispatch.mockReset();
    dispatch.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (oldSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
    }
  });

  it('FI002-HTTP-01: signed snapshot reaches correct tenant', async () => {
    const response = await signedPost(invoice('42'));

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 42,
        integration: 'stripe',
        eventType: 'invoice.payment_succeeded',
      })
    );
  });

  it('FI002-HTTP-02: signed conflicting identity is rejected', async () => {
    const response = await signedPost(invoice('42', '84'));

    expect(response.status).toBe(500);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('FI002-HTTP-03: unsigned invoice is rejected', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(invoice('42')));

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
