import crypto from 'crypto';
import request from 'supertest';
import { knex as knexFactory, Knex } from 'knex';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { createApp } from 'api-src/bootstrap/express';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { releaseBatch } from 'api-src/services/wms/pickBatch.service';
import { handleOrdersCancelled } from 'api-src/projection/handlers/orders.cancelled';

jest.setTimeout(120_000);
const app = createApp();

async function fixture() {
  process.env.SHOPIFY_API_SECRET ||= 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY ||= 'test_shopify_key';
  process.env.API_URL ||= 'https://api.test';
  const shop = `order-anchor-${crypto.randomUUID()}.myshopify.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(`shop=${shop}&timestamp=${timestamp}`).digest('hex');
  const install = await request(app).get('/api/v1/integrations/shopify/install')
    .query({ shop, timestamp, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(db.raw('SELECT public.resolve_auth_user_by_email(?) AS value',
    [`shopify-install+${shop}@lasyncro.internal`]));
  const shopId: number = lookup.rows[0].value.shop_id;
  await seedFreshInstall(shopId);
  const locationCode = `WH-${shopId}-ROOT`;
  const variant = await withTenant(shopId, trx => trx('inventory_truth as it')
    .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
    .where({ 'it.shop_id': shopId, 'it.location_code': locationCode })
    .orderBy('it.available_quantity', 'desc')
    .first('it.lasyncro_variant_id', 'v.lasyncro_product_id', 'it.on_hand_quantity'));
  const orderId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const externalOrderId = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000));
  await withTenant(shopId, async trx => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: shopId, payment_state: 'paid', currency: 'USD',
      total_price: '20.00', subtotal_price: '20.00', total_tax: '0.00',
      order_created_at: new Date(), order_updated_at: new Date(),
      created_at: new Date(), updated_at: new Date(),
    });
    await trx('external_order_identity_map').insert({
      shop_id: shopId, lasyncro_order_id: orderId, platform: 'shopify', external_order_id: externalOrderId,
    });
    await trx('order_line_items').insert({
      lasyncro_order_id: orderId, lasyncro_line_item_id: lineId,
      lasyncro_product_id: variant.lasyncro_product_id, lasyncro_variant_id: variant.lasyncro_variant_id,
      title: 'Order anchor fixture', quantity: 2, unit_price: '10.00', line_total: '20.00',
      created_at: new Date(), updated_at: new Date(),
    });
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: orderId,
      status: 'pending', status_updated_at: new Date(),
    });
  });
  return { shopId, orderId, lineId, externalOrderId, locationCode,
    variantId: String(variant.lasyncro_variant_id), onHand: Number(variant.on_hand_quantity) };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function transaction<T>(ctx: Fixture, body: (trx: Knex.Transaction) => Promise<T>) {
  return runWithTenantContext(ctx.shopId, () => db.transaction(async trx => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${ctx.shopId}'`);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    return body(trx);
  }));
}
function cancel(ctx: Fixture) {
  const now = new Date();
  return transaction(ctx, trx => handleOrdersCancelled({
    domainEvent: { shop_id: ctx.shopId, event_type: 'orders/cancelled',
      event_payload: { id: ctx.externalOrderId, cancelled_at: now.toISOString() } },
    domain_event_id: 0, canonicalEventTime: now, trx,
  }));
}
function release(ctx: Fixture) {
  return transaction(ctx, trx => releaseBatch(trx, ctx.shopId, 'manual', null,
    null, null, [ctx.orderId], true));
}

async function until<T>(probe: () => Promise<T>, description: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
  }
  throw new Error(`Order anchor barrier timed out: ${description}`);
}

async function interleave(ctx: Fixture, cancellationFirst: boolean) {
  const database = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('Order anchor DDL requires a disposable test database');
  }
  const coord = knexFactory({ client: 'pg', connection: {
    host: process.env.PGHOST, port: Number(process.env.PGPORT), database,
    user: process.env.PGMIGRATION_USER, password: String(process.env.PGMIGRATION_PASSWORD || ''),
  }, pool: { min: 1, max: 1 } });
  const key = crypto.randomInt(1, 2_000_000_000);
  const name = `r01_anchor_${crypto.randomUUID().replace(/-/g, '')}`;
  const table = cancellationFirst ? 'order_fulfillment_status' : 'pick_batch_orders';
  const tasks: Promise<unknown>[] = [];
  try {
    await coord.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END; $$`);
    const event = cancellationFirst ? 'UPDATE' : 'INSERT';
    const predicate = cancellationFirst ? " AND NEW.status = 'cancelled'" : '';
    await coord.raw(`CREATE TRIGGER ${name} AFTER ${event} ON ${table} FOR EACH ROW
      WHEN (NEW.lasyncro_order_id = '${ctx.orderId}'${predicate}) EXECUTE FUNCTION ${name}()`);
    await coord.raw(`SELECT pg_advisory_lock(${key})`);
    const first = cancellationFirst ? cancel(ctx) : release(ctx);
    tasks.push(first);
    void first.catch(() => undefined);
    const pid = await until(async () => {
      const result = await coord.raw(`SELECT pid FROM pg_locks WHERE locktype='advisory'
        AND classid=0 AND objid=${key} AND objsubid=1 AND NOT granted`);
      return result.rows[0]?.pid as number | undefined;
    }, 'first transaction owns order and is parked');
    const second = cancellationFirst ? release(ctx) : cancel(ctx);
    tasks.push(second);
    void second.catch(() => undefined);
    const blocked = await until(async () => {
      const result = await coord.raw(`SELECT pid, query, pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE pid <> ? AND ? = ANY(pg_blocking_pids(pid))`, [pid, pid]);
      return result.rows[0];
    }, 'competing transaction waits for canonical order');
    expect(blocked.query).toMatch(/"orders"/);
    expect(blocked.query).toMatch(/for update/i);
    expect(blocked.blockers).toContain(pid);
    await withTenant(ctx.shopId, async trx => {
      expect(await trx('pick_batch_orders').where({ shop_id: ctx.shopId, lasyncro_order_id: ctx.orderId })).toEqual([]);
      expect(await trx('pick_reservation_allocations').where({ shop_id: ctx.shopId, lasyncro_order_id: ctx.orderId })).toEqual([]);
    });
    await coord.raw(`SELECT pg_advisory_unlock(${key})`);
    const outcomes = await Promise.allSettled(tasks);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const released = outcomes[cancellationFirst ? 1 : 0];
    const value = released.status === 'fulfilled' ? released.value as Awaited<ReturnType<typeof release>> : null;
    if (cancellationFirst) expect(value?.pick_batch_id ?? null).toBeNull();
    else expect(value?.pick_batch_id).toEqual(expect.any(String));
    process.stdout.write(`\n[ORDER_ANCHOR_EVIDENCE] ${JSON.stringify({ cancellationFirst, pid, blocked, outcomes })}\n`);
    return value?.pick_batch_id ?? null;
  } finally {
    await coord.raw('SELECT pg_advisory_unlock_all()');
    await Promise.allSettled(tasks);
    await coord.raw(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    await coord.raw(`DROP FUNCTION IF EXISTS ${name}()`);
    await coord.destroy();
  }
}

describe('GH-1145 R0-1 canonical order anchor', () => {
  it('Release locks ROOT before a later bin while still allocating bin stock first', async () => {
    const ctx = await fixture();
    const binCode = `ZZ-${ctx.shopId}-PICK`;
    await withTenant(ctx.shopId, async trx => {
      const root = await trx('warehouse_locations')
        .where({ shop_id: ctx.shopId, location_code: ctx.locationCode }).first('warehouse_id');
      await trx('warehouse_locations').insert({
        shop_id: ctx.shopId, warehouse_id: root.warehouse_id, location_code: binCode,
        type: 'bin', parent_location_code: ctx.locationCode, active: true, zone_type: 'pick',
      });
      await trx('inventory_truth').insert({
        shop_id: ctx.shopId, lasyncro_variant_id: ctx.variantId, location_code: binCode,
        on_hand_quantity: 1, reserved_quantity: 0, committed_quantity: 0,
        available_quantity: 1, last_evaluated_at: new Date(),
      });
    });
    let unlock!: () => void;
    const gate = new Promise<void>(resolve => { unlock = resolve; });
    let ready!: (pid: number) => void;
    const locked = new Promise<number>(resolve => { ready = resolve; });
    const holder = transaction(ctx, async trx => {
      await trx('inventory_truth').where({ shop_id: ctx.shopId,
        lasyncro_variant_id: ctx.variantId, location_code: ctx.locationCode }).forUpdate().first();
      ready(Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      await gate;
    });
    let releasing: ReturnType<typeof release> | undefined;
    try {
      const pid = await Promise.race([locked, holder.then(() => { throw new Error('Root lock was not acquired'); })]);
      releasing = release(ctx);
      void releasing.catch(() => undefined);
      const blocked = await until(() => withTenant(ctx.shopId, async trx => {
        const result = await trx.raw(`SELECT query FROM pg_stat_activity
          WHERE ? = ANY(pg_blocking_pids(pid))`, [pid]);
        return result.rows[0];
      }), 'Release waits on ROOT inventory truth');
      expect(blocked.query).toContain('inventory_truth');
      // NOWAIT proves Release has not locked the later bin before ROOT.
      await withTenant(ctx.shopId, trx => trx('inventory_truth').where({
        shop_id: ctx.shopId, lasyncro_variant_id: ctx.variantId, location_code: binCode,
      }).forUpdate().noWait().first());
      unlock();
      await holder;
      const result = await releasing;
      expect(result?.pick_batch_id).toEqual(expect.any(String));
      const allocations = await withTenant(ctx.shopId, trx => trx('pick_reservation_allocations')
        .where({ shop_id: ctx.shopId, pick_batch_id: result!.pick_batch_id })
        .orderBy('location_code').select('location_code', 'quantity'));
      expect(allocations).toEqual([
        { location_code: ctx.locationCode, quantity: 1 }, { location_code: binCode, quantity: 1 },
      ]);
    } finally {
      unlock();
      await Promise.allSettled([holder, ...(releasing ? [releasing] : [])]);
    }
  });

  it.each([true, false])('serializes Release and cancellation; cancellation first = %s', async cancellationFirst => {
    const ctx = await fixture();
    const batchId = await interleave(ctx, cancellationFirst);
    await cancel(ctx);
    await withTenant(ctx.shopId, async trx => {
      expect(await trx('pick_batch_orders').where({ shop_id: ctx.shopId, lasyncro_order_id: ctx.orderId })).toEqual([]);
      expect(await trx('pick_reservation_allocations').where({ shop_id: ctx.shopId, lasyncro_order_id: ctx.orderId })).toEqual([]);
      const truth = await trx('inventory_truth').where({ shop_id: ctx.shopId,
        lasyncro_variant_id: ctx.variantId, location_code: ctx.locationCode }).first();
      expect(Number(truth.reserved_quantity)).toBe(0);
      expect(Number(truth.on_hand_quantity)).toBe(ctx.onHand);
      expect(Number(truth.available_quantity)).toBe(ctx.onHand);
      const status = await trx('order_fulfillment_status').where({ lasyncro_order_id: ctx.orderId }).first();
      expect(status.status).toBe('cancelled');
      const movements = await trx('inventory_movements').where({ shop_id: ctx.shopId,
        lasyncro_variant_id: ctx.variantId, location_code: ctx.locationCode })
        .whereIn('movement_type', ['reservation_hold', 'reservation_release']);
      expect(movements).toHaveLength(cancellationFirst ? 0 : 2);
      expect(movements.reduce((sum, row) => sum + Number(row.quantity_delta), 0)).toBe(0);
      if (batchId) {
        expect((await trx('pick_batches').where({ shop_id: ctx.shopId, pick_batch_id: batchId }).first()).status).toBe('cancelled');
        expect(movements.filter(row => row.movement_type === 'reservation_release')).toEqual([
          expect.objectContaining({ reference_type: 'pick_reservation_allocation', quantity_delta: -2 }),
        ]);
      }
    });
  });
});
