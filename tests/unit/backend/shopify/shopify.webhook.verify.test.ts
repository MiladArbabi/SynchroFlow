// tests/unit/backend/shopify/shopify.webhook.verify.test.ts

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db from '@lasyncro/backend-core/db.js';

const app = createApp();

function signShopifyPayload(raw: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(raw)
    .digest('base64');
}

beforeAll(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = 'test_shopify_secret';
});

describe('Shopify webhook – verification middleware', () => {
  const eventId = 'shopify_evt_verify_001';
  const shopDomain = 'test-shop.myshopify.com';

  const payload = {
    id: eventId,
    topic: 'app/uninstalled',
    shop_id: 123,
    shop_domain: shopDomain,
  };

  beforeEach(async () => {
    await db('integration_webhook_events').del();
  });

  it('rejects webhook when HMAC header is missing', async () => {
    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .send(payload)
      .expect(400);

    const rows = await db('integration_webhook_events');
    expect(rows.length).toBe(0);
  });

  it('rejects webhook when HMAC is invalid', async () => {
    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .set('X-Shopify-Hmac-Sha256', 'invalid-signature')
      .send(payload)
      .expect(400);

    const rows = await db('integration_webhook_events');
    expect(rows.length).toBe(0);
  });

  it('accepts webhook when HMAC is valid and writes ledger row', async () => {
    const raw = JSON.stringify(payload);
    const signature = signShopifyPayload(
      raw,
      process.env.SHOPIFY_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .set('X-Shopify-Hmac-Sha256', signature)
      .send(raw)
      .expect(200);

    const ledger = await db('integration_webhook_events')
      .where({ external_event_id: eventId })
      .first();

    expect(ledger).toBeDefined();
    expect(ledger.integration).toBe('shopify');
    expect(ledger.processing_status).toBe('processed');
  });

  it('remains idempotent on replay with valid signature', async () => {
    const raw = JSON.stringify(payload);
    const signature = signShopifyPayload(
      raw,
      process.env.SHOPIFY_WEBHOOK_SECRET!
    );

    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .set('X-Shopify-Hmac-Sha256', signature)
      .send(raw)
      .expect(200);

    await request(app)
      .post('/api/v1/shopify/webhooks/app-uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', eventId)
      .set('X-Shopify-Hmac-Sha256', signature)
      .send(raw)
      .expect(200);

    const rows = await db('integration_webhook_events')
      .where({ external_event_id: eventId });

    expect(rows.length).toBe(1);
    expect(rows[0].processing_status).toBe('duplicate');
  });

  afterAll(() => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
  });
});