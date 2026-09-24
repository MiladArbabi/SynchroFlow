import crypto from 'crypto';
import fs from 'node:fs';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  createNotificationOccurrenceInTransaction,
  type NotificationOccurrence,
} from 'api-src/services/notifications/notificationOccurrence.service';
import { planNotificationDeliveriesInTransaction } from 'api-src/services/notifications/notificationDeliveryPlanner.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

type FixtureTenant = {
  shopId: number;
  userId: number;
  token: string;
};

type DeliveryRow = {
  channel: string;
  status: string;
  attempt_count: number;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
};

async function seedTenant(
  label: string,
  options: {
    preferences?: Record<string, unknown>;
    email?: string | null;
    revoked?: boolean;
    ft2?: boolean;
  } = {},
): Promise<FixtureTenant> {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${label}-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  let userId = 0;

  await withTenant(shopId, async (trx) => {
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email: options.email === undefined
          ? `${label}-${suffix}@example.com`
          : options.email,
        first_name: 'Delivery',
        last_name: 'Planner',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);

    userId = Number(user.id);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
      revoked_at: options.revoked ? new Date() : null,
      notification_preferences: options.preferences === undefined
        ? null
        : JSON.stringify(options.preferences),
    });

    if (options.ft2) {
      await trx('user_lifecycle_snapshot').insert({
        shop_id: shopId,
        user_id: userId,
        phase: 'FT2',
        since: new Date(),
        last_event_id: crypto.randomUUID(),
      });
    }
  });

  expect(userId).toBeGreaterThan(0);

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, roles: ['owner'] }),
  };
}

async function seedPushSubscription(
  shopId: number,
  userId: number,
  count = 1,
): Promise<void> {
  await withTenant(shopId, async (trx) => {
    for (let index = 0; index < count; index += 1) {
      await trx('push_subscriptions').insert({
        shop_id: shopId,
        user_id: userId,
        device_type: 'web',
        endpoint: `https://push.example.test/${crypto.randomUUID()}`,
        p256dh: `p256dh-${index}`,
        auth: `auth-${index}`,
      });
    }
  });
}

async function seedAdditionalMember(
  shopId: number,
  label: string,
  preferences: Record<string, unknown>,
): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const suffix = crypto.randomBytes(6).toString('hex');
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${label}-${suffix}@example.com`,
        first_name: 'Other',
        last_name: 'Member',
        role: 'operator',
        password_hash: 'test-only',
      })
      .returning(['id']);
    const userId = Number(user.id);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'operator',
      notification_preferences: JSON.stringify(preferences),
    });

    return userId;
  });
}

function occurrenceInput(tenant: FixtureTenant, conditionKey = 'orders_cannot_be_fulfilled') {
  return {
    shopId: tenant.shopId,
    userId: tenant.userId,
    conditionKey,
    sourceType: 'alert',
    sourceId: crypto.randomUUID(),
    occurrenceKey: `delivery-planning:${crypto.randomUUID()}`,
    sourceFingerprint: `fingerprint:${crypto.randomUUID()}`,
    title: 'Orders cannot be fulfilled',
    message: 'Some orders need attention.',
    context: { source: 'notification-delivery-planning-1147' },
  };
}

async function createAndPlan(
  tenant: FixtureTenant,
  options: {
    conditionKey?: string;
    planTwice?: boolean;
  } = {},
) {
  let notificationEventId = '';

  await withTenant(tenant.shopId, async (trx) => {
    const result = await createNotificationOccurrenceInTransaction(
      trx,
      occurrenceInput(
        tenant,
        options.conditionKey ?? 'orders_cannot_be_fulfilled',
      ),
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;

    notificationEventId = result.notification.id;
    await planNotificationDeliveriesInTransaction(trx, result.notification);

    if (options.planTwice) {
      await planNotificationDeliveriesInTransaction(trx, result.notification);
    }
  });

  expect(notificationEventId).not.toBe('');
  return notificationEventId;
}

async function createEventWithoutPlanning(
  tenant: FixtureTenant,
): Promise<NotificationOccurrence> {
  let notification: NotificationOccurrence | null = null;

  await withTenant(tenant.shopId, async (trx) => {
    const result = await createNotificationOccurrenceInTransaction(
      trx,
      occurrenceInput(tenant),
    );

    expect(result.status).toBe('created');
    if (result.status === 'created') notification = result.notification;
  });

  expect(notification).not.toBeNull();
  return notification as NotificationOccurrence;
}

async function deliveryRows(
  shopId: number,
  notificationEventId: string,
): Promise<DeliveryRow[]> {
  return withTenant(shopId, (trx) =>
    trx('notification_deliveries')
      .where({ notification_event_id: notificationEventId })
      .orderBy('channel', 'asc')
      .select('channel', 'status', 'attempt_count', 'sent_at', 'delivered_at'),
  );
}

function byChannel(rows: DeliveryRow[]) {
  return Object.fromEntries(rows.map((row) => [row.channel, row]));
}

describe('GH-1147 — notification delivery planning', () => {
  it('plans exactly one delivered in-app row with default preferences and no push subscription', async () => {
    const tenant = await seedTenant('default-no-push');
    const eventId = await createAndPlan(tenant);

    const rows = await deliveryRows(tenant.shopId, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        channel: 'in_app',
        status: 'delivered',
        attempt_count: 0,
      }),
    );
    expect(rows[0].sent_at).toBeTruthy();
    expect(rows[0].delivered_at).toBeTruthy();
  });

  it('queues one logical push row when push is enabled and subscriptions exist', async () => {
    const tenant = await seedTenant('push-enabled');
    await seedPushSubscription(tenant.shopId, tenant.userId, 2);

    const eventId = await createAndPlan(tenant);

    const rows = await deliveryRows(tenant.shopId, eventId);
    expect(rows).toHaveLength(2);
    expect(byChannel(rows).in_app).toMatchObject({ status: 'delivered' });
    expect(byChannel(rows).push).toMatchObject({
      status: 'queued',
      attempt_count: 0,
    });
  });

  it('does not queue push when global push is false', async () => {
    const tenant = await seedTenant('push-global-false', {
      preferences: { channels: { push: false } },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);

    expect(Object.keys(byChannel(await deliveryRows(tenant.shopId, eventId)))).toEqual([
      'in_app',
    ]);
  });

  it('lets condition push=false override global push=true', async () => {
    const tenant = await seedTenant('push-condition-false', {
      preferences: {
        channels: { push: true },
        conditions: {
          orders_cannot_be_fulfilled: { push: false },
        },
      },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);

    expect(Object.keys(byChannel(await deliveryRows(tenant.shopId, eventId)))).toEqual([
      'in_app',
    ]);
  });

  it('keeps global push=false authoritative even when condition push=true', async () => {
    const tenant = await seedTenant('push-global-master', {
      preferences: {
        channels: { push: false },
        conditions: {
          orders_cannot_be_fulfilled: { push: true },
        },
      },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);

    expect(Object.keys(byChannel(await deliveryRows(tenant.shopId, eventId)))).toEqual([
      'in_app',
    ]);
  });

  it('queues push when global push=true and condition push=true', async () => {
    const tenant = await seedTenant('push-both-true', {
      preferences: {
        channels: { push: true },
        conditions: {
          orders_cannot_be_fulfilled: { push: true },
        },
      },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);

    expect(byChannel(await deliveryRows(tenant.shopId, eventId)).push).toMatchObject({
      status: 'queued',
    });
  });

  it('does not queue email when email defaults to false', async () => {
    const tenant = await seedTenant('email-default-false');

    const eventId = await createAndPlan(tenant);

    expect(byChannel(await deliveryRows(tenant.shopId, eventId)).email).toBeUndefined();
  });

  it('queues one email row when global email is true and the user has email', async () => {
    const tenant = await seedTenant('email-global-true', {
      preferences: { channels: { email: true } },
    });

    const eventId = await createAndPlan(tenant);

    expect(byChannel(await deliveryRows(tenant.shopId, eventId)).email).toMatchObject({
      status: 'queued',
      attempt_count: 0,
    });
  });

  it('does not queue email when enabled but the user email is whitespace-only', async () => {
    const tenant = await seedTenant('email-whitespace', {
      email: '\t \t',
      preferences: { channels: { email: true } },
    });

    const eventId = await createAndPlan(tenant);

    expect(Object.keys(byChannel(await deliveryRows(tenant.shopId, eventId)))).toEqual([
      'in_app',
    ]);
  });

  it('lets condition email=false override global email=true', async () => {
    const tenant = await seedTenant('email-condition-false', {
      preferences: {
        channels: { email: true },
        conditions: {
          orders_cannot_be_fulfilled: { email: false },
        },
      },
    });

    const eventId = await createAndPlan(tenant);

    expect(byChannel(await deliveryRows(tenant.shopId, eventId)).email).toBeUndefined();
  });

  it('keeps global email=false authoritative even when condition email=true', async () => {
    const tenant = await seedTenant('email-global-master', {
      preferences: {
        channels: { email: false },
        conditions: {
          orders_cannot_be_fulfilled: { email: true },
        },
      },
    });

    const eventId = await createAndPlan(tenant);

    expect(Object.keys(byChannel(await deliveryRows(tenant.shopId, eventId)))).toEqual([
      'in_app',
    ]);
  });

  it('queues email when global email=true and condition email=true', async () => {
    const tenant = await seedTenant('email-both-true', {
      preferences: {
        channels: { email: true },
        conditions: {
          orders_cannot_be_fulfilled: { email: true },
        },
      },
    });

    const eventId = await createAndPlan(tenant);

    expect(byChannel(await deliveryRows(tenant.shopId, eventId)).email).toMatchObject({
      status: 'queued',
    });
  });

  it('suppresses critical external channels when the critical condition is disabled', async () => {
    const tenant = await seedTenant('critical-external-disabled', {
      preferences: {
        channels: { push: true, email: true },
        conditions: {
          orders_cannot_be_fulfilled: { enabled: false },
        },
      },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);
    const rows = await deliveryRows(tenant.shopId, eventId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'in_app',
      status: 'delivered',
    });
  });

  it('is duplicate-safe when the planner is called twice for the same event', async () => {
    const tenant = await seedTenant('planner-duplicate-safe', {
      preferences: { channels: { email: true } },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId, 2);

    const eventId = await createAndPlan(tenant, { planTwice: true });

    expect((await deliveryRows(tenant.shopId, eventId)).map((row) => row.channel).sort()).toEqual([
      'email',
      'in_app',
      'push',
    ]);
  });

  it('keeps Recent as one logical notification when multiple channels are enabled', async () => {
    const tenant = await seedTenant('recent-one-logical', {
      preferences: { channels: { email: true, push: true } },
      ft2: true,
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);

    const eventId = await createAndPlan(tenant);
    expect(await deliveryRows(tenant.shopId, eventId)).toHaveLength(3);

    const response = await request(app)
      .get('/api/v1/notifications/recent')
      .set('Authorization', `Bearer ${tenant.token}`);

    expect(response.status).toBe(200);
    expect(response.body.notifications).toHaveLength(1);
    expect(response.body.notifications[0].id).toBe(eventId);
  });

  it('does not create an event or delivery for revoked membership', async () => {
    const tenant = await seedTenant('revoked-no-delivery', { revoked: true });

    await withTenant(tenant.shopId, async (trx) => {
      const result = await createNotificationOccurrenceInTransaction(
        trx,
        occurrenceInput(tenant),
      );

      expect(result).toEqual({
        status: 'suppressed',
        reason: 'inactive_membership',
      });
    });

    await withTenant(tenant.shopId, async (trx) => {
      expect(await trx('notification_events').where({ shop_id: tenant.shopId })).toHaveLength(0);
      expect(await trx('notification_deliveries')).toHaveLength(0);
    });
  });

  it('creates zero deliveries when membership is revoked before direct planner invocation', async () => {
    const tenant = await seedTenant('revoked-before-planner');
    const notification = await createEventWithoutPlanning(tenant);

    await withTenant(tenant.shopId, async (trx) => {
      await trx('shop_memberships')
        .where({ shop_id: tenant.shopId, user_id: tenant.userId })
        .update({ revoked_at: new Date() });

      await expect(
        planNotificationDeliveriesInTransaction(trx, notification),
      ).resolves.toEqual({
        status: 'skipped',
        reason: 'inactive_membership',
      });
    });

    expect(await deliveryRows(tenant.shopId, notification.id)).toHaveLength(0);
  });

  it('creates zero deliveries when supplied occurrence user identity mismatches the event row', async () => {
    const tenant = await seedTenant('identity-mismatch', {
      preferences: { channels: { email: false, push: false } },
    });
    const otherUserId = await seedAdditionalMember(tenant.shopId, 'identity-mismatch-other', {
      channels: { email: true, push: true },
    });
    await seedPushSubscription(tenant.shopId, otherUserId);
    const notification = await createEventWithoutPlanning(tenant);

    await withTenant(tenant.shopId, async (trx) => {
      await expect(
        planNotificationDeliveriesInTransaction(trx, {
          ...notification,
          userId: otherUserId,
        }),
      ).resolves.toEqual({
        status: 'skipped',
        reason: 'event_identity_mismatch',
      });
    });

    expect(await deliveryRows(tenant.shopId, notification.id)).toHaveLength(0);
  });

  it('creates zero deliveries when supplied occurrence condition mismatches the event row', async () => {
    const tenant = await seedTenant('condition-mismatch', {
      preferences: { channels: { email: true, push: true } },
    });
    await seedPushSubscription(tenant.shopId, tenant.userId);
    const notification = await createEventWithoutPlanning(tenant);

    await withTenant(tenant.shopId, async (trx) => {
      await expect(
        planNotificationDeliveriesInTransaction(trx, {
          ...notification,
          conditionKey: 'not_enough_stock_to_fulfill_orders',
        }),
      ).resolves.toEqual({
        status: 'skipped',
        reason: 'event_identity_mismatch',
      });
    });

    expect(await deliveryRows(tenant.shopId, notification.id)).toHaveLength(0);
  });

  it('does not import or call provider dispatch from the planner', () => {
    const source = fs.readFileSync(
      'apps/backend/src/services/notifications/notificationDeliveryPlanner.service.ts',
      'utf8',
    );

    expect(source).not.toContain('notificationDispatch.service');
    expect(source).not.toContain('dispatchNotification');
    expect(source).not.toContain('web-push');
    expect(source).not.toContain('expo-server-sdk');
    expect(source).not.toContain('resend');
  });
});
