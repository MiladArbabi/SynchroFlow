// tests/unit/backend/billing/stripe.webhook.idempotency.persistent.test.ts
//
// Stripe webhook → CommercialGrant intent mapping
//
// Guarantees:
// - Stripe signature verification is enforced
// - Billing produces intent only (no entitlement coupling)
// - Intent-level idempotency is respected

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';
import { signStripePayload } from '../../helpers/stripeTestSignature';
import db from '@lasyncro/backend-core/db.js';

jest.mock('api-src/services/commercial-grant.service');

describe('Stripe webhook → CommercialGrant intent mapping', () => {
  const app = createApp();

  beforeEach(async () => {
    jest.clearAllMocks();
    await db('integration_webhook_events').del();
    await db('commercial_grant_events').del();
  });

  it('is idempotent at the intent level when the same event is delivered twice', async () => {
    const stripeEvent = {
      id: 'evt_test_idempotent',
      type: 'invoice.paid',
      created: 1710000001,
      data: {
        object: {
          metadata: { shopId: '99' },
          lines: {
            data: [
              {
                price: {
                  metadata: { module: 'finances' },
                },
              },
            ],
          },
        },
      },
    };

    const payload = JSON.stringify(stripeEvent);

    const signature = signStripePayload(
      Buffer.from(payload),
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);
  });
});
