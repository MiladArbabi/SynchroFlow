import crypto from 'crypto';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

async function seedTenant(): Promise<{ shopId: number; userId: number }> {
  const name =
    `GH-1147 notification history ${crypto.randomBytes(6).toString('hex')}`;

  const created = await systemQuery(
    db.raw('SELECT public.create_tenant_shop(?) AS id', [name]),
  );

  const shopId = Number(created.rows?.[0]?.id);
  expect(shopId).toBeGreaterThan(0);

  let userId = 0;

  await withTenant(shopId, async (trx) => {
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email:
          `alerts-history-${crypto.randomBytes(5).toString('hex')}@example.com`,
        first_name: 'Alerts',
        last_name: 'Test',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);

    userId = Number(user.id);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    });
  });

  expect(userId).toBeGreaterThan(0);

  return { shopId, userId };
}

describe('GH-1147 — notification history persistence', () => {
  it('stores one logical notification occurrence per user', async () => {
    const { shopId, userId } = await seedTenant();
    const occurrenceKey = `inventory-short:${crypto.randomUUID()}`;

    await withTenant(shopId, async (trx) => {
      await trx('notification_events').insert({
        shop_id: shopId,
        user_id: userId,
        condition_key: 'not_enough_stock',
        source_type: 'alert',
        source_id: crypto.randomUUID(),
        occurrence_key: occurrenceKey,
        source_fingerprint: 'orders=4|sku=SKU-481',
        urgency: 'critical',
        title: 'Not enough stock for 4 orders',
        message: 'SKU-481 needs attention.',
        context_json: JSON.stringify({ sku: 'SKU-481', order_count: 4 }),
        action_json: JSON.stringify({
          route: '/inventory/reconcile',
          label: 'Review stock',
        }),
      });

      await expect(
        trx.transaction(async (savepoint) => {
          await savepoint('notification_events').insert({
            shop_id: shopId,
            user_id: userId,
            condition_key: 'not_enough_stock',
            source_type: 'alert',
            source_id: crypto.randomUUID(),
            occurrence_key: occurrenceKey,
            source_fingerprint: 'orders=4|sku=SKU-481',
            urgency: 'critical',
            title: 'Not enough stock for 4 orders',
            message: 'SKU-481 needs attention.',
          });
        }),
      ).rejects.toMatchObject({
        code: '23505',
      });

      const rows = await trx('notification_events')
        .where({
          shop_id: shopId,
          user_id: userId,
          occurrence_key: occurrenceKey,
        });

      expect(rows).toHaveLength(1);
    });
  });

  it('allows several delivery channels without duplicating Recent history', async () => {
    const { shopId, userId } = await seedTenant();

    await withTenant(shopId, async (trx) => {
      const [event] = await trx('notification_events')
        .insert({
          shop_id: shopId,
          user_id: userId,
          condition_key: 'delivery_overdue',
          source_type: 'purchase_order',
          source_id: 'PO-1042',
          occurrence_key: `delivery-overdue:${crypto.randomUUID()}`,
          source_fingerprint: 'po=PO-1042|overdue=true',
          urgency: 'important',
          title: 'Delivery PO-1042 overdue',
          message: 'This delivery is overdue.',
        })
        .returning(['id']);

      await trx('notification_deliveries').insert([
        {
          notification_event_id: event.id,
          channel: 'in_app',
          status: 'delivered',
          attempt_count: 1,
        },
        {
          notification_event_id: event.id,
          channel: 'push',
          status: 'sent',
          attempt_count: 1,
        },
        {
          notification_event_id: event.id,
          channel: 'email',
          status: 'sent',
          attempt_count: 1,
        },
      ]);

      const events = await trx('notification_events')
        .where({ shop_id: shopId, user_id: userId });

      const deliveries = await trx('notification_deliveries')
        .where({ notification_event_id: event.id });

      expect(events).toHaveLength(1);
      expect(deliveries).toHaveLength(3);
    });
  });

  it('tracks read and clicked state on the logical notification event', async () => {
    const { shopId, userId } = await seedTenant();

    await withTenant(shopId, async (trx) => {
      const [event] = await trx('notification_events')
        .insert({
          shop_id: shopId,
          user_id: userId,
          condition_key: 'shopify_sync_delayed',
          source_type: 'shopify_sync',
          source_id: String(shopId),
          occurrence_key: `shopify-sync:${crypto.randomUUID()}`,
          source_fingerprint: 'sync=delayed',
          urgency: 'important',
          title: 'Shopify stock updates are delayed',
          message: 'Stock updates need attention.',
        })
        .returning(['id']);

      const readAt = new Date();
      const clickedAt = new Date();

      await trx('notification_events')
        .where({ id: event.id, shop_id: shopId })
        .update({
          read_at: readAt,
          clicked_at: clickedAt,
        });

      const saved = await trx('notification_events')
        .where({ id: event.id, shop_id: shopId })
        .first();

      expect(saved.read_at).toBeTruthy();
      expect(saved.clicked_at).toBeTruthy();
    });
  });

  it('enforces recipient membership and tenant RLS for events and deliveries', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    let tenantBEventId = '';
    let tenantBDeliveryId = '';

    await withTenant(tenantA.shopId, async (trx) => {
      await expect(
        trx.transaction(async (savepoint) => {
          await savepoint('notification_events').insert({
            shop_id: tenantA.shopId,
            user_id: tenantB.userId,
            condition_key: 'not_enough_stock',
            source_type: 'alert',
            source_id: crypto.randomUUID(),
            occurrence_key: `cross-tenant:${crypto.randomUUID()}`,
            source_fingerprint: 'cross-tenant-recipient',
            urgency: 'critical',
            title: 'Cross tenant recipient',
            message: 'This should be rejected.',
          });
        }),
      ).rejects.toMatchObject({
        code: '23503',
      });
    });

    await withTenant(tenantB.shopId, async (trx) => {
      const [event] = await trx('notification_events')
        .insert({
          shop_id: tenantB.shopId,
          user_id: tenantB.userId,
          condition_key: 'delivery_overdue',
          source_type: 'purchase_order',
          source_id: 'PO-TENANT-B',
          occurrence_key: `tenant-b:${crypto.randomUUID()}`,
          source_fingerprint: 'tenant=b',
          urgency: 'important',
          title: 'Tenant B notification',
          message: 'Tenant B only.',
        })
        .returning(['id']);

      tenantBEventId = String(event.id);

      const [delivery] = await trx('notification_deliveries')
        .insert({
          notification_event_id: tenantBEventId,
          channel: 'push',
          status: 'sent',
          attempt_count: 1,
        })
        .returning(['id']);

      tenantBDeliveryId = String(delivery.id);
    });

    await withTenant(tenantA.shopId, async (trx) => {
      const events = await trx('notification_events')
        .where({ id: tenantBEventId });
      const deliveries = await trx('notification_deliveries')
        .where({ id: tenantBDeliveryId });

      expect(events).toHaveLength(0);
      expect(deliveries).toHaveLength(0);
    });
  });

  it('prevents duplicate delivery rows for the same event and channel', async () => {
    const { shopId, userId } = await seedTenant();

    await withTenant(shopId, async (trx) => {
      const [event] = await trx('notification_events')
        .insert({
          shop_id: shopId,
          user_id: userId,
          condition_key: 'receiving_stopped',
          source_type: 'receive_job',
          source_id: crypto.randomUUID(),
          occurrence_key: `receiving-stopped:${crypto.randomUUID()}`,
          source_fingerprint: 'progress=stopped',
          urgency: 'important',
          title: 'Receiving has stopped',
          message: 'Receiving has made no progress.',
        })
        .returning(['id']);

      await trx('notification_deliveries').insert({
        notification_event_id: event.id,
        channel: 'push',
        status: 'sent',
        attempt_count: 1,
      });

      await expect(
        trx('notification_deliveries').insert({
          notification_event_id: event.id,
          channel: 'push',
          status: 'sent',
          attempt_count: 2,
        }),
      ).rejects.toMatchObject({
        code: '23505',
      });
    });
  });
});
