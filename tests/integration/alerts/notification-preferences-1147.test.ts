import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET =
    process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY =
    process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL =
    process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret';
});

async function seedShop(label: string): Promise<{
  shopId: number;
  userId: number;
  token: string;
}> {
  const shopDomain =
    `alerts-prefs-${label}-${crypto.randomBytes(6).toString('hex')}.myshopify.com`;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');

  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);

  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ]),
  );

  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();

  const shopId = ghost.shop_id as number;
  const userId = ghost.id as number;

  await seedFreshInstall(shopId);

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId }),
  };
}

const DEFAULTS = {
  schema_version: 2,
  urgency: 'important_critical',
  channels: {
    in_app: true,
    push: true,
    email: false,
  },
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    allow_critical: true,
  },
  daily_summary: 'off',
  conditions: {},
};

describe('GH-1147 — notification preferences', () => {
  it('returns strong normalized defaults for a user with no saved preferences', async () => {
    const shop = await seedShop('defaults');

    const response = await request(app)
      .get('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`);

    expect(response.status).toBe(200);
    expect(response.body.preferences).toEqual(
      expect.objectContaining(DEFAULTS),
    );
  });

  it('persists a partial notification settings update and returns the normalized document', async () => {
    const shop = await seedShop('update');

    const patch = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        urgency: 'critical_only',
        channels: {
          push: false,
          email: true,
        },
        quiet_hours: {
          enabled: true,
          start: '21:30',
          end: '06:30',
          allow_critical: true,
        },
        daily_summary: 'morning',
        conditions: {
          delivery_overdue: {
            enabled: true,
            email: true,
          },
          orders_close_to_shipping_deadline: {
            enabled: true,
            threshold_minutes: 90,
          },
        },
      });

    expect(patch.status).toBe(200);
    expect(patch.body.preferences).toEqual(
      expect.objectContaining({
        ...DEFAULTS,
        push_enabled: false,
        urgency: 'critical_only',
        channels: {
          in_app: true,
          push: false,
          email: true,
        },
        quiet_hours: {
          enabled: true,
          start: '21:30',
          end: '06:30',
          allow_critical: true,
        },
        daily_summary: 'morning',
        conditions: {
          delivery_overdue: {
            enabled: true,
            email: true,
          },
          orders_close_to_shipping_deadline: {
            enabled: true,
            threshold_minutes: 90,
          },
        },
      }),
    );

    const readBack = await request(app)
      .get('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`);

    expect(readBack.status).toBe(200);
    expect(readBack.body.preferences).toEqual(patch.body.preferences);
  });

  it('patching one condition does not erase another saved condition', async () => {
    const shop = await seedShop('condition-merge');

    const first = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ conditions: { delivery_overdue: { enabled: true, email: true } } });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({ conditions: { orders_close_to_shipping_deadline: { enabled: false } } });
    expect(second.status).toBe(200);

    const readBack = await request(app)
      .get('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`);

    expect(readBack.status).toBe(200);
    expect(readBack.body.preferences.conditions).toEqual({
      delivery_overdue: { enabled: true, email: true },
      orders_close_to_shipping_deadline: { enabled: false },
    });
  });

  it('never allows the baseline in-app channel to be disabled', async () => {
    const shop = await seedShop('critical-in-app');

    const response = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        channels: {
          in_app: false,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.preferences.channels.in_app).toBe(true);
  });

  it('keeps legacy push_enabled synchronized with canonical channels.push', async () => {
    const shop = await seedShop('push-sync');

    const canonicalPatch = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        channels: {
          push: false,
        },
      });

    expect(canonicalPatch.status).toBe(200);
    expect(canonicalPatch.body.preferences.channels.push).toBe(false);
    expect(canonicalPatch.body.preferences.push_enabled).toBe(false);

    const legacyPatch = await request(app)
      .patch('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        push_enabled: true,
      });

    expect(legacyPatch.status).toBe(200);
    expect(legacyPatch.body.preferences.channels.push).toBe(true);
    expect(legacyPatch.body.preferences.push_enabled).toBe(true);
  });

  it('normalizes stored legacy push_enabled documents without losing the value', async () => {
    const shop = await seedShop('legacy-push');

    await withTenant(shop.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: shop.shopId, user_id: shop.userId })
        .update({
          notification_preferences: JSON.stringify({
            push_enabled: false,
            alert_tone: 'silent',
            alert_types: {
              idle: true,
            },
          }),
        }),
    );

    const response = await request(app)
      .get('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`);

    expect(response.status).toBe(200);
    expect(response.body.preferences.channels.push).toBe(false);
    expect(response.body.preferences.push_enabled).toBe(false);
    expect(response.body.preferences.alert_tone).toBe('silent');
    expect(response.body.preferences.alert_types).toEqual({ idle: true });
  });

  it('uses canonical channels.push when stored v2 push fields disagree', async () => {
    const shop = await seedShop('canonical-push');

    await withTenant(shop.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: shop.shopId, user_id: shop.userId })
        .update({
          notification_preferences: JSON.stringify({
            schema_version: 2,
            channels: {
              in_app: true,
              push: false,
              email: false,
            },
            push_enabled: true,
          }),
        }),
    );

    const response = await request(app)
      .get('/api/v1/members/me/preferences')
      .set('Authorization', `Bearer ${shop.token}`);

    expect(response.status).toBe(200);
    expect(response.body.preferences.channels.push).toBe(false);
    expect(response.body.preferences.push_enabled).toBe(false);
  });

  it('rejects unsupported v2 preference configuration keys', async () => {
    const shop = await seedShop('validation');

    const invalidPayloads = [
      { unsupported: true },
      { schema_version: 3 },
      { channels: { sms: true } },
      { quiet_hours: { timezone: 'UTC' } },
      { conditions: { delivery_overdue: { in_app: true } } },
      { conditions: { delivery_overdue: { urgency: 'critical_only' } } },
      { conditions: { delivery_overdue: { threshold_count: 2 } } },
      { conditions: { delivery_overdue: { custom_rule: true } } },
    ];

    for (const payload of invalidPayloads) {
      const response = await request(app)
        .patch('/api/v1/members/me/preferences')
        .set('Authorization', `Bearer ${shop.token}`)
        .send(payload);

      expect(response.status).toBe(400);
    }
  });
});
