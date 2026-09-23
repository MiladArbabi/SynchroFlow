import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

async function createShop(): Promise<{ shopId: number; userId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sla-consumer-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sla-consumer-${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: row.id,
      role: 'owner',
    });

    await trx('shop_operational_settings')
      .insert({
        shop_id: shopId,
        fulfillment_sla_hours: 24,
      })
      .onConflict('shop_id')
      .merge({ fulfillment_sla_hours: 24 });

    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: row.id, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
    return row.id as number;
  });

  return { shopId, userId };
}

async function seedOrder(input: {
  shopId: number;
  creationAgeHours: number;
  paidAgeHours: number;
  status?: 'pending' | 'fulfilled' | 'cancelled';
  constrained?: boolean;
  versions?: Array<{
    aggregateVersion: number;
    creationAgeHours: number;
    paidAgeHours: number;
  }>;
}): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();

  await withTenant(input.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: input.shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: new Date(now.getTime() - input.creationAgeHours * 3600000),
      paid_at: new Date(now.getTime() - input.paidAgeHours * 3600000),
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: input.status ?? 'pending',
      fulfilled_at: input.status === 'fulfilled' ? now : null,
    });

    const versions =
      input.versions ??
      [{
        aggregateVersion: 1,
        creationAgeHours: input.creationAgeHours,
        paidAgeHours: input.paidAgeHours,
      }];

    await trx('order_age_snapshot').insert(
      versions.map((v) => ({
        lasyncro_order_id: orderId,
        aggregate_version: v.aggregateVersion,
        age_since_creation_seconds: v.creationAgeHours * 3600,
        age_since_paid_seconds: v.paidAgeHours * 3600,
        age_since_fulfillment_seconds: null,
        is_shipping_sla_breached: v.paidAgeHours >= 24,
        is_delivery_sla_breached: false,
        snapshot_generated_at: now,
      }))
    );

    if (input.constrained) {
      await trx('order_constraints').insert({
        constraint_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        target_id: null,
        constraint_type: 'customer',
        block_type: 'awaiting_customer_response',
        started_at: now,
        is_active: true,
        write_source: 'sla-sem-01-test',
      });
    }
  });

  return orderId;
}


async function getDetail(shopId: number, userId: number, orderId: string) {
  return request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${issueTestToken({ shopId, userId })}`);
}

it('SLA-TREAT-01 reads current age, preserves blocker identity, and repeated reads mutate nothing', async () => {
  const { shopId, userId } = await createShop();
  const orderId = await seedOrder({ shopId, creationAgeHours: 30, paidAgeHours: 25, constrained: true, versions: [{ aggregateVersion: 1, creationAgeHours: 1, paidAgeHours: 1 }, { aggregateVersion: 2, creationAgeHours: 2, paidAgeHours: 2 }] });
  const snapshot = () => withTenant(shopId, async trx => ({
    order: await trx('orders').where({ lasyncro_order_id: orderId }).first(),
    fulfillment: await trx('order_fulfillment_status').where({ lasyncro_order_id: orderId }).first(),
    constraints: await trx('order_constraints').where({ lasyncro_order_id: orderId }).select('*'),
    ages: await trx('order_age_snapshot').where({ lasyncro_order_id: orderId }).orderBy('aggregate_version').select('*'),
    batches: await trx('pick_batches').where({ shop_id: shopId }).select('*'),
    membership: await trx('pick_batch_orders').where({ shop_id: shopId }).select('*'),
    reservations: await trx('inventory_movements').where({ shop_id: shopId }).select('*'),
    usage: await trx('shop_usage_metrics').where({ shop_id: shopId }).select('*'),
    events: await trx('domain_events').where({ shop_id: shopId }).select('*'),
    outbox: await trx('domain_event_outbox as x').join('domain_events as e', 'e.id', 'x.domain_event_id').where('e.shop_id', shopId).select('x.*'),
    alerts: await trx('alerts').where({ shop_id: shopId }).select('*'),
  }));
  const before = await snapshot();
  const response = await getDetail(shopId, userId, orderId);
  expect(response.status).toBe(200);
  expect(response.body.slaTreatment?.sla).toMatchObject({ state: 'breached', evidenceVersion: 2 });
  expect(response.body.slaTreatment.activeBlockerRefs).toEqual(expect.arrayContaining([expect.objectContaining({ constraint_id: before.constraints[0].constraint_id })]));
  expect(response.body.slaTreatment.assistance.kind).toBe('existing_blocker');
  await getDetail(shopId, userId, orderId);
  expect(await snapshot()).toEqual(before);
  const other = await createShop();
  expect((await getDetail(other.shopId, other.userId, orderId)).status).toBe(404);
});

it('SLA-TREAT-01 uses batch membership and authenticated picker ownership', async () => {
  const { shopId, userId } = await createShop();
  const orderId = await seedOrder({ shopId, creationAgeHours: 22, paidAgeHours: 21 });
  const batchId = crypto.randomUUID();
  await withTenant(shopId, async trx => {
    await trx('shop_wms_settings').insert({ shop_id: shopId, idle_alert_threshold_minutes: 15, bootstrap_model: 'legacy_opening_balance_v1' }).onConflict('shop_id').merge({ idle_alert_threshold_minutes: 15 });
    await trx('pick_batches').insert({ shop_id: shopId, pick_batch_id: batchId, status: 'picking', released_at: new Date(), pick_last_activity_at: new Date(Date.now()-16*60000), picked_by: userId, release_trigger: 'manual', max_line_items: 10, total_line_items: 1, total_units: 1 });
    await trx('pick_batch_orders').insert({ shop_id: shopId, pick_batch_id: batchId, lasyncro_order_id: orderId });
  });
  const own = await getDetail(shopId, userId, orderId);
  expect(own.body.slaTreatment?.execution.assessment).toBe('picking_stalled');
  expect(own.body.slaTreatment.assistance.href).toBe(`/wms?batchId=${batchId}`);
  const otherUser = await withTenant(shopId, async trx => {
    const [u] = await trx('users').insert({ shop_id: shopId, email: `sla-other-${crypto.randomUUID()}@test.example`, role: 'owner', password_hash: 'test' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: u.id, role: 'owner' });
    return u.id;
  });
  const other = await getDetail(shopId, otherUser, orderId);
  expect(other.body.slaTreatment.assistance.label).toBe('Review warehouse work');
});

it('SLA-TREAT-01 suppresses fulfilled and cancelled SLA treatment', async () => {
  const { shopId, userId } = await createShop();
  const fulfilled = await seedOrder({ shopId, creationAgeHours: 50, paidAgeHours: 50, status: 'fulfilled' });
  const cancelled = await seedOrder({ shopId, creationAgeHours: 50, paidAgeHours: 50, status: 'cancelled' });
  expect((await getDetail(shopId, userId, fulfilled)).body.slaTreatment?.sla.state).toBeNull();
  expect((await getDetail(shopId, userId, cancelled)).body.slaTreatment?.sla.state).toBeNull();
});

it('SLA-TREAT-01 server pool and blocked queue rank priority above fresh SLA, including approaching', async () => {
  const { shopId, userId } = await createShop();
  const normal = await seedOrder({ shopId, creationAgeHours: 40, paidAgeHours: 2 });
  const approaching = await seedOrder({ shopId, creationAgeHours: 22, paidAgeHours: 21 });
  const breached = await seedOrder({ shopId, creationAgeHours: 26, paidAgeHours: 25 });
  const priority = await seedOrder({ shopId, creationAgeHours: 3, paidAgeHours: 2 });
  const ids = [normal, approaching, breached, priority];
  await withTenant(shopId, async trx => {
    const productId = crypto.randomUUID();
    await trx('products').insert({ shop_id: shopId, lasyncro_product_id: productId, title: 'SLA queue fixture' });
    for (const orderId of ids) {
      await trx('order_line_items').insert({ lasyncro_line_item_id: crypto.randomUUID(), lasyncro_order_id: orderId, lasyncro_product_id: productId, lasyncro_variant_id: crypto.randomUUID(), title: 'Queue line', quantity: 1, unit_price: '1.00', line_total: '1.00', created_at: new Date(), updated_at: new Date() });
    }
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').where({ lasyncro_order_id: priority }).update({ is_priority_flagged: true });
    // Snapshots deliberately disagree: urgency must use current canonical anchors.
    await trx('order_age_snapshot').whereIn('lasyncro_order_id', ids).update({ age_since_paid_seconds: 0, is_shipping_sla_breached: false });
  });
  const token = issueTestToken({ shopId, userId });
  const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
  expect(pool.status).toBe(200);
  expect(pool.body.orders.map((o: any) => o.lasyncro_order_id)).toEqual([priority, breached, approaching, normal]);
  expect(pool.body.orders.map((o: any) => o.sla_state)).toEqual(['normal', 'breached', 'approaching', 'normal']);
  await withTenant(shopId, async trx => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    for (const orderId of ids) await trx('order_constraints').insert({ constraint_id: crypto.randomUUID(), lasyncro_order_id: orderId, constraint_type: 'customer', block_type: 'awaiting_customer_response', started_at: new Date(), is_active: true, write_source: 'sla-treatment-test' });
  });
  const blocked = await request(app).get('/api/v1/orders/constrained').set('Authorization', `Bearer ${token}`);
  expect(blocked.status).toBe(200);
  expect(blocked.body.data.map((o: any) => o.order_id)).toEqual([priority, breached, approaching, normal]);
});
