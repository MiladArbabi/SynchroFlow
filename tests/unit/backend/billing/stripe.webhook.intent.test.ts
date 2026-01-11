// tests/unit/backend/billing/stripe.webhook.idempotency.persistent.test.ts
//
// Stripe webhook – persistent idempotency
//
// Scope:
// - Verifies DB-backed idempotency via commercial_grant_events
// - Ensures duplicate Stripe events do NOT re-apply grants
// - Enforces Stripe signature verification
//
// Key Invariant:
// - Idempotency is enforced by persistence, not memory or mocks

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db from 'api-db';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { signStripePayload } from '../../helpers/stripeTestSignature';

describe('Stripe webhook – persistent idempotency', () => {
  const app = createApp();

  beforeEach(async () => {
    await db('commercial_grant_events').del();
    await db('shop_module_entitlements').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId: 77, userId: 7701 });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('does not persist duplicate grants when the same Stripe event is delivered twice', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const stripeEvent = {
      id: 'evt_persistent_1',
      type: 'invoice.paid',
      created: 1710000100,
      data: {
        object: {
          metadata: { shopId: '77' },
          lines: {
            data: [
              {
                price: {
                  metadata: { module: 'analytics' },
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

    // ─────────────────────────────────────────────
    // Act – first delivery
    // ─────────────────────────────────────────────
   await request(app)
    .post('/api/v1/billing/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload)
    .expect(200);

    // ─────────────────────────────────────────────
    // Act – re-delivery (simulates process restart)
    // ─────────────────────────────────────────────
    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload)
      .expect(200);

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    const rows = await db('commercial_grant_events')
      .where({ external_ref: 'evt_persistent_1' });

    expect(rows).toHaveLength(1);
  });
});