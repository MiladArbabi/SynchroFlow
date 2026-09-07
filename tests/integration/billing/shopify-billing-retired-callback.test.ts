// BILL-CALLBACK-AUTH-01
//
// Runtime regression for Shopify Managed Pricing.
// The retired direct-charge callback must not be reachable through the real
// Express application. The surviving subscription route acts as a control
// proving the /api/v1/shopify-billing router itself is still mounted.

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';

const app = createApp();

describe('retired Shopify billing callback', () => {
  it('keeps the Shopify billing router mounted', async () => {
    const res = await request(app)
      .get('/api/v1/shopify-billing/subscription');

    expect(res.status).toBe(401);
  });

  it('returns 404 for the retired callback even with legacy tier parameters', async () => {
    const res = await request(app)
      .get('/api/v1/shopify-billing/callback')
      .query({
        shopId: '1',
        tier: 'scale',
        interval: 'monthly',
        charge_id: 'legacy-test-charge',
      });

    expect(res.status).toBe(404);
  });
});
