import crypto from 'crypto';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  aggregateAlertsForShop,
  aggregateAlertsForShopInTransaction,
} from 'api-src/services/alerts/alerts.aggregator';

type FixtureShop = {
  shopId: number;
  ownerId: number;
  operatorId: number;
};

const now = new Date('2026-09-22T12:00:00.000Z');

async function createFixtureShop(label: string): Promise<FixtureShop> {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${label}-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  return withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${label}-owner-${suffix}@example.com`,
        first_name: 'Source',
        last_name: 'Owner',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);
    const [operator] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${label}-operator-${suffix}@example.com`,
        first_name: 'Source',
        last_name: 'Operator',
        role: 'operator',
        password_hash: 'test-only',
      })
      .returning(['id']);

    const ownerId = Number(owner.id);
    const operatorId = Number(operator.id);

    await trx('shop_memberships').insert([
      {
        shop_id: shopId,
        user_id: ownerId,
        role: 'owner',
      },
      {
        shop_id: shopId,
        user_id: operatorId,
        role: 'operator',
      },
    ]);

    return { shopId, ownerId, operatorId };
  });
}

async function seedConstraint(shopId: number, constraintType: string) {
  const orderId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '125.00',
      subtotal_price: '125.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints').insert({
      constraint_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      constraint_type: constraintType,
      block_type: `${constraintType}_block`,
      started_at: now,
      is_active: true,
      write_source: 'notification-source-adapter-1147',
    });
  });

  return orderId;
}

async function setConstraintActive(
  shopId: number,
  orderId: string,
  isActive: boolean,
) {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .update({
        is_active: isActive,
        resolved_at: isActive ? null : trx.fn.now(),
      });
  });
}

async function notificationEvents(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('notification_events')
      .where({ shop_id: shopId })
      .orderBy(['created_at', 'user_id'])
      .select('*'),
  );
}

async function notificationDeliveries(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const events = await trx('notification_events')
      .where({ shop_id: shopId })
      .select('id');

    if (events.length === 0) return [];

    return trx('notification_deliveries')
      .whereIn('notification_event_id', events.map((event) => event.id))
      .select('*');
  });
}

describe('GH-1147 notification source adapter', () => {
  it('fans out first operational activation to active members', async () => {
    const shop = await createFixtureShop('operational-activation');
    await seedConstraint(shop.shopId, 'operational');

    await aggregateAlertsForShop(shop.shopId);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.condition_key)).toEqual([
      'orders_cannot_be_fulfilled',
      'orders_cannot_be_fulfilled',
    ]);
    expect(new Set(events.map((event) => event.occurrence_key)).size).toBe(1);
  });

  it('maps first inventory activation to the inventory condition', async () => {
    const shop = await createFixtureShop('inventory-activation');
    await seedConstraint(shop.shopId, 'inventory');

    await aggregateAlertsForShop(shop.shopId);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(2);
    expect(events.every((event) =>
      event.condition_key === 'not_enough_stock_to_fulfill_orders',
    )).toBe(true);
  });

  it('does not emit again while the same aggregate alert remains active', async () => {
    const shop = await createFixtureShop('active-refresh');
    await seedConstraint(shop.shopId, 'operational');

    await aggregateAlertsForShop(shop.shopId);
    await aggregateAlertsForShop(shop.shopId);

    expect(await notificationEvents(shop.shopId)).toHaveLength(2);
  });

  it('does not notify on clearing and emits a new occurrence on reactivation', async () => {
    const shop = await createFixtureShop('reactivation');
    const orderId = await seedConstraint(shop.shopId, 'operational');

    await aggregateAlertsForShop(shop.shopId);
    await setConstraintActive(shop.shopId, orderId, false);
    await aggregateAlertsForShop(shop.shopId);

    const afterClear = await notificationEvents(shop.shopId);
    expect(afterClear).toHaveLength(2);

    await setConstraintActive(shop.shopId, orderId, true);
    await aggregateAlertsForShop(shop.shopId);

    const afterReactivation = await notificationEvents(shop.shopId);
    expect(afterReactivation).toHaveLength(4);
    expect(new Set(afterReactivation.map((event) => event.occurrence_key)).size).toBe(2);
  });

  it('applies preferences per user for noncritical inventory notifications', async () => {
    const shop = await createFixtureShop('per-user-preferences');
    await seedConstraint(shop.shopId, 'inventory');

    await withTenant(shop.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: shop.shopId, user_id: shop.operatorId })
        .update({
          notification_preferences: JSON.stringify({
            conditions: {
              not_enough_stock_to_fulfill_orders: {
                enabled: false,
              },
            },
          }),
        }),
    );

    await aggregateAlertsForShop(shop.shopId);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: shop.ownerId,
      condition_key: 'not_enough_stock_to_fulfill_orders',
    });
  });

  it('keeps critical operational notifications protected when disabled', async () => {
    const shop = await createFixtureShop('critical-protected');
    await seedConstraint(shop.shopId, 'operational');

    await withTenant(shop.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: shop.shopId, user_id: shop.operatorId })
        .update({
          notification_preferences: JSON.stringify({
            conditions: {
              orders_cannot_be_fulfilled: {
                enabled: false,
              },
            },
          }),
        }),
    );

    await aggregateAlertsForShop(shop.shopId);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.user_id).sort()).toEqual([
      shop.ownerId,
      shop.operatorId,
    ].sort());
  });

  it('does not notify revoked memberships', async () => {
    const shop = await createFixtureShop('revoked-membership');
    await seedConstraint(shop.shopId, 'operational');

    await withTenant(shop.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: shop.shopId, user_id: shop.operatorId })
        .update({ revoked_at: trx.fn.now() }),
    );

    await aggregateAlertsForShop(shop.shopId);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(1);
    expect(events[0].user_id).toBe(shop.ownerId);
  });

  it('ignores unmapped constraint alert types', async () => {
    const shop = await createFixtureShop('unmapped');
    await seedConstraint(shop.shopId, 'customer');

    await aggregateAlertsForShop(shop.shopId);

    expect(await notificationEvents(shop.shopId)).toHaveLength(0);
  });

  it('creates one in-app delivery per source activation event without push or email by default', async () => {
    const shop = await createFixtureShop('default-in-app-deliveries');
    await seedConstraint(shop.shopId, 'operational');

    await aggregateAlertsForShop(shop.shopId);

    expect(await notificationEvents(shop.shopId)).toHaveLength(2);
    const deliveries = await notificationDeliveries(shop.shopId);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.channel === 'in_app')).toBe(true);
    expect(deliveries.every((delivery) => delivery.status === 'delivered')).toBe(true);
  });

  it('rolls back alert activation, notification events, and deliveries together', async () => {
    const shop = await createFixtureShop('rollback');
    await seedConstraint(shop.shopId, 'operational');

    await expect(
      db.transaction(async (trx) => {
        await aggregateAlertsForShopInTransaction(trx, shop.shopId);

        const alerts = await trx('alerts')
          .where({
            shop_id: shop.shopId,
            alert_key: `constraint:shop-${shop.shopId}:operational`,
          })
          .select('*');
        const events = await trx('notification_events')
          .where({ shop_id: shop.shopId })
          .select('*');
        const deliveries = await trx('notification_deliveries')
          .whereIn('notification_event_id', events.map((event) => event.id))
          .select('*');

        expect(alerts).toHaveLength(1);
        expect(events).toHaveLength(2);
        expect(deliveries).toHaveLength(2);

        throw new Error('forced outer transaction rollback');
      }),
    ).rejects.toThrow('forced outer transaction rollback');

    await withTenant(shop.shopId, async (trx) => {
      const alerts = await trx('alerts')
        .where({
          shop_id: shop.shopId,
          alert_key: `constraint:shop-${shop.shopId}:operational`,
        })
        .select('*');

      expect(alerts).toHaveLength(0);
    });
    expect(await notificationEvents(shop.shopId)).toHaveLength(0);
    expect(await notificationDeliveries(shop.shopId)).toHaveLength(0);
  });

  it('emits one activation episode under concurrent aggregate attempts', async () => {
    const shop = await createFixtureShop('concurrent-activation');
    await seedConstraint(shop.shopId, 'operational');

    await Promise.all([
      aggregateAlertsForShop(shop.shopId),
      aggregateAlertsForShop(shop.shopId),
    ]);

    const events = await notificationEvents(shop.shopId);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.occurrence_key)).size).toBe(1);
  });
});
