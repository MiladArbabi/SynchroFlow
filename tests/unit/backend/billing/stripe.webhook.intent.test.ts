// tests/unit/backend/billing/stripe.webhook.intent.test.ts

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { CommercialGrantService } from 'api-src/services/commercial-grant.service';

jest.mock('api-src/services/commercial-grant.service');

describe('Stripe webhook → CommercialGrant intent mapping', () => {

  beforeEach(() => {
   jest.clearAllMocks();
  });
  
  const app = createApp();

  it('maps a Stripe paid event into a CommercialGrant intent (no entitlement logic)', async () => {
    // ─────────────────────────────────────────────
    // Arrange
    // ─────────────────────────────────────────────
    const stripeEvent = {
      id: 'evt_test_123',
      type: 'invoice.paid',
      created: 1710000000,
      data: {
        object: {
          metadata: {
            shopId: '42',
          },
          lines: {
            data: [
              {
                price: {
                  metadata: {
                    module: 'analytics',
                  },
                },
              },
            ],
          },
        },
      },
    };

    // ─────────────────────────────────────────────
    // Act
    // ─────────────────────────────────────────────
    await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .send(stripeEvent)
      .expect(200);

    // ─────────────────────────────────────────────
    // Assert
    // ─────────────────────────────────────────────
    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);

    expect(CommercialGrantService.apply).toHaveBeenCalledWith({
      shopId: 42,
      source: 'billing',
      grants: {
        modules: ['analytics'],
      },
      metadata: {
        externalRef: 'evt_test_123',
        issuedAt: new Date(1710000000 * 1000).toISOString(),
      },
    });
  });

  it('is idempotent when the same Stripe event is delivered twice', async () => {
    const app = createApp();

    const stripeEvent = {
        id: 'evt_test_idempotent',
        type: 'invoice.paid',
        created: 1710000001,
        data: {
        object: {
            metadata: {
            shopId: '99',
            },
            lines: {
            data: [
                {
                price: {
                    metadata: {
                    module: 'finances',
                    },
                },
                },
            ],
            },
        },
        },
    };

    await request(app)
        .post('/api/v1/billing/stripe/webhook')
        .send(stripeEvent)
        .expect(200);

    await request(app)
        .post('/api/v1/billing/stripe/webhook')
        .send(stripeEvent)
        .expect(200);

    expect(CommercialGrantService.apply).toHaveBeenCalledTimes(1);
    });

});