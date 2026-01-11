import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
const app = createApp();
import db from 'api-src/db';
import { signStripePayload } from '../../helpers/stripeTestSignature';

jest.mock('api-src/services/commercial-grant.service', () => ({
  CommercialGrantService: {
    apply: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Stripe webhook – transport ledger', () => {
  const payload = {
    id: 'evt_ledger_test_001',
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        metadata: { shopId: '1' },
        lines: {
          data: [
            {
              price: { metadata: { module: 'analytics' } },
            },
          ],
        },
      },
    },
  };

  beforeEach(async () => {
    await db('integration_webhook_events').del();
    await db('commercial_grant_events').del();
  });

  it('writes ledger row before domain mutation', async () => {

    const raw = Buffer.from(JSON.stringify(payload));
    const signature = signStripePayload(
    raw,
    process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
        .post('/api/v1/billing/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(JSON.stringify(payload))
        .expect(200);

    const ledger = await db('integration_webhook_events')
      .where({ external_event_id: payload.id })
      .first();

    expect(ledger).toBeDefined();
    expect(ledger.integration).toBe('stripe');
    expect(ledger.processing_status).toBe('processed');
  });

  it('does not duplicate ledger rows on redelivery', async () => {
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = signStripePayload(
    raw,
    process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
    .post('/api/v1/billing/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(JSON.stringify(payload));

    await request(app)
    .post('/api/v1/billing/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(JSON.stringify(payload));

    const rows = await db('integration_webhook_events')
      .where({ external_event_id: payload.id });

    expect(rows.length).toBe(1);
    expect(rows[0].processing_status).toBe('duplicate');
  });
});