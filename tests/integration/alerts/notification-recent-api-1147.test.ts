import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

type SeededTenant = {
  shopId: number;
  userId: number;
  otherUserId: number;
  token: string;
  otherToken: string;
};

async function seedTenant(options: { ft2?: boolean } = { ft2: true }): Promise<SeededTenant> {
  const label = crypto.randomBytes(6).toString('hex');
  const created = await systemQuery(
    db.raw('SELECT public.create_tenant_shop(?) AS id', [
      `GH-1147 recent API ${label}`,
    ]),
  );

  const shopId = Number(created.rows?.[0]?.id);
  expect(shopId).toBeGreaterThan(0);

  let userId = 0;
  let otherUserId = 0;

  await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `recent-owner-${label}@example.com`,
        first_name: 'Recent',
        last_name: 'Owner',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);

    const [other] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `recent-other-${label}@example.com`,
        first_name: 'Recent',
        last_name: 'Other',
        role: 'operator',
        password_hash: 'test-only',
      })
      .returning(['id']);

    userId = Number(owner.id);
    otherUserId = Number(other.id);

    await trx('shop_memberships').insert([
      { shop_id: shopId, user_id: userId, role: 'owner' },
      { shop_id: shopId, user_id: otherUserId, role: 'operator' },
    ]);

    if (options.ft2 !== false) {
      await trx('user_lifecycle_snapshot').insert({
        shop_id: shopId,
        user_id: userId,
        phase: 'FT2',
        since: new Date(),
        last_event_id: crypto.randomUUID(),
      });
    }
  });

  return {
    shopId,
    userId,
    otherUserId,
    token: issueTestToken({ userId, shopId, roles: ['owner'] }),
    otherToken: issueTestToken({
      userId: otherUserId,
      shopId,
      roles: ['operator'],
    }),
  };
}

async function insertNotification(params: {
  shopId: number;
  userId: number;
  conditionKey?: string;
  urgency?: 'critical' | 'important' | 'informational';
  title: string;
  message?: string;
  createdAt?: Date;
  readAt?: Date | null;
  clickedAt?: Date | null;
  context?: Record<string, unknown>;
  action?: Record<string, unknown> | null;
}): Promise<string> {
  return withTenant(params.shopId, async (trx) => {
    const [event] = await trx('notification_events')
      .insert({
        shop_id: params.shopId,
        user_id: params.userId,
        condition_key: params.conditionKey ?? 'delivery_overdue',
        source_type: 'alert',
        source_id: crypto.randomUUID(),
        occurrence_key: `recent-api:${crypto.randomUUID()}`,
        source_fingerprint: `recent-api=${crypto.randomUUID()}`,
        urgency: params.urgency ?? 'important',
        title: params.title,
        message: params.message ?? params.title,
        context_json: JSON.stringify(params.context ?? {}),
        action_json:
          params.action === undefined
            ? null
            : params.action === null
              ? null
              : JSON.stringify(params.action),
        read_at: params.readAt ?? null,
        clicked_at: params.clickedAt ?? null,
        created_at: params.createdAt ?? new Date(),
      })
      .returning(['id']);

    return String(event.id);
  });
}

describe('GH-1147 — recent notification API', () => {
  it('reports push registered destination status behind auth, FT2, current user, and current tenant only', async () => {
    const noAuth = await request(app)
      .get('/api/v1/notifications/push-status');

    expect(noAuth.status).toBe(401);

    const preFt2 = await seedTenant({ ft2: false });
    const gated = await request(app)
      .get('/api/v1/notifications/push-status')
      .set('Authorization', `Bearer ${preFt2.token}`);

    expect(gated.status).toBe(403);

    const tenantA = await seedTenant();
    const tenantB = await seedTenant();

    const zero = await request(app)
      .get('/api/v1/notifications/push-status')
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(zero.status).toBe(200);
    expect(zero.body).toEqual({
      registered_destination_count: 0,
      has_registered_destination: false,
      web_count: 0,
      expo_count: 0,
    });

    await withTenant(tenantA.shopId, async (trx) => {
      await trx('push_subscriptions').insert([
        {
          shop_id: tenantA.shopId,
          user_id: tenantA.userId,
          device_type: 'web',
          endpoint: 'https://push.example.com/current-user',
          p256dh: 'current-user-p256dh',
          auth: 'current-user-auth',
        },
        {
          shop_id: tenantA.shopId,
          user_id: tenantA.userId,
          device_type: 'web',
          endpoint: 'https://push.example.com/incomplete-web',
          p256dh: '',
          auth: 'incomplete-auth',
        },
        {
          shop_id: tenantA.shopId,
          user_id: tenantA.userId,
          device_type: 'expo',
          expo_push_token: '',
        },
      ]);
    });

    const webOnly = await request(app)
      .get('/api/v1/notifications/push-status')
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(webOnly.status).toBe(200);
    expect(webOnly.body).toEqual({
      registered_destination_count: 1,
      has_registered_destination: true,
      web_count: 1,
      expo_count: 0,
    });

    await withTenant(tenantA.shopId, async (trx) => {
      await trx('push_subscriptions').insert([
        {
          shop_id: tenantA.shopId,
          user_id: tenantA.userId,
          device_type: 'expo',
          expo_push_token: 'ExponentPushToken[current-user]',
        },
        {
          shop_id: tenantA.shopId,
          user_id: tenantA.otherUserId,
          device_type: 'web',
          endpoint: 'https://push.example.com/other-member',
          p256dh: 'other-member-p256dh',
          auth: 'other-member-auth',
        },
      ]);
    });

    await withTenant(tenantB.shopId, async (trx) => {
      await trx('push_subscriptions').insert({
        shop_id: tenantB.shopId,
        user_id: tenantB.userId,
        device_type: 'expo',
        expo_push_token: 'ExponentPushToken[other-tenant]',
      });
    });

    const registered = await request(app)
      .get('/api/v1/notifications/push-status')
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(registered.status).toBe(200);
    expect(registered.body).toEqual({
      registered_destination_count: 2,
      has_registered_destination: true,
      web_count: 1,
      expo_count: 1,
    });
    expect(JSON.stringify(registered.body)).not.toContain('endpoint');
    expect(JSON.stringify(registered.body)).not.toContain('p256dh');
    expect(JSON.stringify(registered.body)).not.toContain('auth');
    expect(JSON.stringify(registered.body)).not.toContain('expo_push_token');
    expect(JSON.stringify(registered.body)).not.toContain('current-user-p256dh');
    expect(JSON.stringify(registered.body)).not.toContain('current-user-auth');
    expect(JSON.stringify(registered.body)).not.toContain('ExponentPushToken');
  });

  it('exposes the canonical notification condition catalog behind auth and FT2', async () => {
    const noAuth = await request(app)
      .get('/api/v1/notifications/conditions');

    expect(noAuth.status).toBe(401);

    const preFt2 = await seedTenant({ ft2: false });
    const gated = await request(app)
      .get('/api/v1/notifications/conditions')
      .set('Authorization', `Bearer ${preFt2.token}`);

    expect(gated.status).toBe(403);

    const tenant = await seedTenant();
    const response = await request(app)
      .get('/api/v1/notifications/conditions')
      .set('Authorization', `Bearer ${tenant.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      conditions: [
        {
          key: 'orders_cannot_be_fulfilled',
          area: 'fulfillment',
          merchantLabel: 'Orders cannot be fulfilled',
          urgency: 'critical',
          defaultEnabled: true,
          criticalInAppProtection: true,
          action: {
            route: '/orders',
            label: 'Review orders',
          },
        },
        {
          key: 'not_enough_stock_to_fulfill_orders',
          area: 'inventory',
          merchantLabel: 'Not enough stock to fulfill orders',
          urgency: 'important',
          defaultEnabled: true,
          criticalInAppProtection: false,
          action: {
            route: '/orders/flow?constraint=inventory',
            label: 'Resolve stockouts',
          },
        },
      ],
    });
  });

  it('requires authentication and the existing FT2 notifications route gate', async () => {
    const noAuth = await request(app).get('/api/v1/notifications/recent');
    expect(noAuth.status).toBe(401);

    const preFt2 = await seedTenant({ ft2: false });
    const gated = await request(app)
      .get('/api/v1/notifications/recent')
      .set('Authorization', `Bearer ${preFt2.token}`);

    expect(gated.status).toBe(403);
  });

  it('returns only the authenticated user recent history, newest first, without delivery metadata', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const base = Date.now();

    const oldestUnreadId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Oldest unread',
      createdAt: new Date(base - 30_000),
      context: { sku: 'SKU-OLD' },
    });
    await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Read middle',
      createdAt: new Date(base - 20_000),
      readAt: new Date(base - 19_000),
      action: { route: '/inventory/reconcile', label: 'Review stock' },
    });
    const clickedNewestId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Clicked newest',
      createdAt: new Date(base - 10_000),
      readAt: new Date(base - 9_000),
      clickedAt: new Date(base - 8_000),
      context: { sku: 'SKU-NEW' },
      action: { route: '/orders/1', label: 'Open order' },
    });
    await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Newest unread outside limit',
      createdAt: new Date(base - 5_000),
    });
    await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.otherUserId,
      title: 'Same shop other member',
      createdAt: new Date(base),
    });
    await insertNotification({
      shopId: tenantB.shopId,
      userId: tenantB.userId,
      title: 'Other tenant',
      createdAt: new Date(base + 5_000),
    });

    await withTenant(tenantA.shopId, async (trx) => {
      await trx('notification_deliveries').insert({
        notification_event_id: clickedNewestId,
        channel: 'push',
        status: 'sent',
        attempt_count: 3,
        provider_message_id: 'provider-secret',
        last_error: 'hidden',
      });
    });

    const response = await request(app)
      .get('/api/v1/notifications/recent')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(response.status).toBe(200);
    expect(response.body.unread_count).toBe(2);
    expect(response.body.notifications).toHaveLength(2);
    expect(response.body.notifications.map((n: any) => n.title)).toEqual([
      'Newest unread outside limit',
      'Clicked newest',
    ]);

    const clicked = response.body.notifications.find(
      (n: any) => n.id === clickedNewestId,
    );
    expect(clicked).toEqual(
      expect.objectContaining({
        id: clickedNewestId,
        condition_key: 'delivery_overdue',
        urgency: 'important',
        title: 'Clicked newest',
        message: 'Clicked newest',
        context: { sku: 'SKU-NEW' },
        action: { route: '/orders/1', label: 'Open order' },
        state: 'clicked',
      }),
    );
    expect(clicked).not.toHaveProperty('source_fingerprint');
    expect(clicked).not.toHaveProperty('occurrence_key');
    expect(clicked).not.toHaveProperty('notification_deliveries');
    expect(clicked).not.toHaveProperty('provider_message_id');
    expect(clicked).not.toHaveProperty('last_error');
    expect(clicked).not.toHaveProperty('attempt_count');

    const ids = response.body.notifications.map((n: any) => n.id);
    expect(ids).not.toContain(oldestUnreadId);
  });

  it('validates limit without adding a broad filter language', async () => {
    const tenant = await seedTenant();

    for (const limit of ['0', '101', 'abc', '1.5']) {
      const response = await request(app)
        .get('/api/v1/notifications/recent')
        .query({ limit })
        .set('Authorization', `Bearer ${tenant.token}`);

      expect(response.status).toBe(400);
    }
  });

  it('uses a default maximum of 50 recent notifications', async () => {
    const tenant = await seedTenant();
    const base = Date.now();

    for (let index = 0; index < 55; index += 1) {
      await insertNotification({
        shopId: tenant.shopId,
        userId: tenant.userId,
        title: `Default limit ${index}`,
        createdAt: new Date(base + index),
      });
    }

    const response = await request(app)
      .get('/api/v1/notifications/recent')
      .set('Authorization', `Bearer ${tenant.token}`);

    expect(response.status).toBe(200);
    expect(response.body.notifications).toHaveLength(50);
    expect(response.body.notifications[0].title).toBe('Default limit 54');
    expect(response.body.unread_count).toBe(55);
  });

  it('marks only the authenticated user notification read idempotently', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const notificationId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Read target',
    });
    const clickedAt = new Date(Date.now() - 5_000);
    const clickedId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Already clicked',
      readAt: new Date(Date.now() - 6_000),
      clickedAt,
    });
    const otherUserId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.otherUserId,
      title: 'Other member read target',
    });
    const otherTenantId = await insertNotification({
      shopId: tenantB.shopId,
      userId: tenantB.userId,
      title: 'Other tenant read target',
    });

    const first = await request(app)
      .patch(`/api/v1/notifications/recent/${notificationId}/read`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(first.status).toBe(200);
    expect(first.body.notification.state).toBe('read');
    expect(first.body.notification.read_at).toBeTruthy();
    expect(first.body.notification.clicked_at).toBeNull();

    const second = await request(app)
      .patch(`/api/v1/notifications/recent/${notificationId}/read`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(second.status).toBe(200);
    expect(second.body.notification.read_at).toBe(first.body.notification.read_at);
    expect(second.body.notification.clicked_at).toBeNull();

    const clickedRead = await request(app)
      .patch(`/api/v1/notifications/recent/${clickedId}/read`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(clickedRead.status).toBe(200);
    expect(clickedRead.body.notification.state).toBe('clicked');
    expect(clickedRead.body.notification.clicked_at).toBe(clickedAt.toISOString());

    for (const foreignId of [otherUserId, otherTenantId]) {
      const response = await request(app)
        .patch(`/api/v1/notifications/recent/${foreignId}/read`)
        .set('Authorization', `Bearer ${tenantA.token}`);

      expect(response.status).toBe(404);
    }
  });

  it('marks only the authenticated user notification clicked idempotently', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const notificationId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.userId,
      title: 'Click target',
    });
    const otherUserId = await insertNotification({
      shopId: tenantA.shopId,
      userId: tenantA.otherUserId,
      title: 'Other member click target',
    });
    const otherTenantId = await insertNotification({
      shopId: tenantB.shopId,
      userId: tenantB.userId,
      title: 'Other tenant click target',
    });

    const first = await request(app)
      .patch(`/api/v1/notifications/recent/${notificationId}/click`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(first.status).toBe(200);
    expect(first.body.notification.state).toBe('clicked');
    expect(first.body.notification.read_at).toBeTruthy();
    expect(first.body.notification.clicked_at).toBeTruthy();

    const second = await request(app)
      .patch(`/api/v1/notifications/recent/${notificationId}/click`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(second.status).toBe(200);
    expect(second.body.notification.state).toBe('clicked');
    expect(second.body.notification.read_at).toBe(first.body.notification.read_at);
    expect(second.body.notification.clicked_at).toBe(first.body.notification.clicked_at);

    for (const foreignId of [otherUserId, otherTenantId]) {
      const response = await request(app)
        .patch(`/api/v1/notifications/recent/${foreignId}/click`)
        .set('Authorization', `Bearer ${tenantA.token}`);

      expect(response.status).toBe(404);
    }
  });
  it('rejects malformed notification IDs at the API boundary', async () => {
    const tenant = await seedTenant();

    for (const action of ['read', 'click']) {
      const response = await request(app)
        .patch(`/api/v1/notifications/recent/not-a-uuid/${action}`)
        .set('Authorization', `Bearer ${tenant.token}`);

      expect(response.status).toBe(400);
    }
  });

});
