// tests/unit/backend/shopify/shopify.webhook.ledger.test.ts
//
// Shopify webhook → transport ledger
//
// Guarantees:
// - Webhook facts are persisted before any domain mutation
// - Duplicate deliveries are detected and recorded
// - Missing required headers are observable in the ledger
//
// This test suite is TRANSPORT-ONLY.
// Domain services are mocked by design.

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db from 'api-src/db';

jest.mock('api-src/services/shopify-app.service', () => ({
  ShopifyAppService: {
    markAppUninstalled: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Shopify webhook – transport ledger', () => {
  const app = createApp();

  const shopDomain = 'test-shop.myshopify.com';
  const eventId = 'shopify_evt_uninstall_001';

  beforeEach(async () => {
    await db('integration_webhook_events').del();
  });

  it('writes ledger row on first delivery', async () => {
    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .send({})
      .expect(200);

    const ledger = await db('integration_webhook_events')
      .where({ external_event_id: eventId })
      .first();

    expect(ledger).toBeDefined();
    expect(ledger.integration).toBe('shopify');
    expect(ledger.event_type).toBe('app/uninstalled');
    expect(ledger.processing_status).toBe('processed');
  });

  it('marks duplicate on redelivery', async () => {
    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .send({})
      .expect(200);

    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .send({})
      .expect(200);

    const rows = await db('integration_webhook_events')
      .where({ external_event_id: eventId });

    expect(rows.length).toBe(1);
    expect(rows[0].processing_status).toBe('duplicate');
  });

  it('records failure when shop domain header is missing', async () => {
    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('X-Shopify-Webhook-Id', eventId)
      .send({})
      .expect(200);

    const ledger = await db('integration_webhook_events')
      .where({ external_event_id: eventId })
      .first();

    expect(ledger).toBeDefined();
    expect(ledger.processing_status).toBe('failed');
  });
});