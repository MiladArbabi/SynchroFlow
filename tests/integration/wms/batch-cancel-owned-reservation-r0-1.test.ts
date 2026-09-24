/**
 * GH-1145 R0-1 — PENDING-BATCH CANCELLATION RELEASES CURRENT OWNERSHIP.
 *
 * Contract: cancelUnclaimedBatch releases, per variant + location, exactly the
 * quantity the batch's SURVIVING pick_reservation_allocations still own. The
 * original aggregate reservation_hold is immutable history and an upper bound.
 * Ownership that cannot be proven consistent fails closed (typed 409) before
 * any ledger / truth / warehouse-state write.
 *
 *   C1  plain cancel — owned == hold, exact release, state removed
 *   C2  legitimate zero ownership — external fulfillment removed every
 *       allocation, membership remains → cancel succeeds, zero release rows
 *   C3  owned > hold → 409, zero mutation
 *   C4  allocation without a corresponding hold → 409, zero mutation
 *   C5  multi-location — exact current-owned release per location after a
 *       partial unwind
 *   C6  retry — a second cancellation cannot write another movement
 *   C7  ownership unknown — holds, zero allocations, live warehouse work
 *       → 409, zero mutation
 *
 * Real paths: POST /api/v1/wms/batch/release, POST /api/v1/wms/batch/:id/cancel
 * (createApp + supertest), orders/cancelled projection handler, Shopify
 * fulfillment physical service. Fixture conventions mirror
 * reservation-release-exactly-once-r0v1.test.ts.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import type { Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { handleOrdersCancelled } from 'api-src/projection/handlers/orders.cancelled';
import { applyFulfillmentPhysicalRemoval } from 'api-src/services/wms/fulfillmentPhysicalRemoval.service';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as release-regression-completion.test.ts) ────

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value',
      [`shopify-install+${shopDomain}@lasyncro.internal`])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

async function provisionFt2Shop(label: string): Promise<{ shopId: number; token: string }> {
  const shopDomain = `r01-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED', updated_at: new Date(),
    })
  );
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt2?.phase).toBe('FT2');
  return { shopId, token };
}

function postRelease(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`).send(body);
}

function postCancelBatch(token: string, batchId: string) {
  return request(app).post(`/api/v1/wms/batch/${batchId}/cancel`)
    .set('Authorization', `Bearer ${token}`).send({});
}

// ── fixtures ────────────────────────────────────────────────────────────────

async function pickRootVariant(shopId: number, minAvailable: number) {
  const locationCode = `WH-${shopId}-ROOT`;
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .where('it.location_code', locationCode)
      .orderBy('it.available_quantity', 'desc')
      .first('it.lasyncro_variant_id', 'v.lasyncro_product_id', 'it.available_quantity', 'it.reserved_quantity')
  );
  expect(row).toBeTruthy();
  expect(Number(row.available_quantity)).toBeGreaterThanOrEqual(minAvailable);
  expect(Number(row.reserved_quantity)).toBe(0);
  const pickableRows = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: row.lasyncro_variant_id })
      .where('available_quantity', '>', 0)
      .select('location_code')
  );
  expect(pickableRows.map((r: { location_code: string }) => r.location_code)).toEqual([locationCode]);
  return { variantId: row.lasyncro_variant_id as string, productId: row.lasyncro_product_id as string, locationCode };
}

async function seedHealthyOrder(
  shopId: number,
  opts: { quantity: number; variantId: string; productId: string }
): Promise<{ orderId: string; externalOrderId: string; lineItemId: string }> {
  const orderId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const now = new Date();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: shopId, payment_state: 'paid', currency: 'USD',
      total_price: '100.00', subtotal_price: '100.00', total_tax: '0.00',
      order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId, shop_id: shopId, platform: 'shopify', external_order_id: externalOrderId,
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId, lasyncro_order_id: orderId,
      lasyncro_product_id: opts.productId, lasyncro_variant_id: opts.variantId,
      sku: null, title: 'R0-1 Fixture Line', quantity: opts.quantity,
      unit_price: '10.00', line_total: (10 * opts.quantity).toFixed(2), created_at: now, updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded (0076);
    // transaction-local guard for this authorised fixture only.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: orderId,
      status: 'pending', status_updated_at: now,
    });
  });
  return { orderId, externalOrderId, lineItemId };
}

/** Transaction prepared exactly as projectDomainEventCore prepares one. */
function inProjectionTransaction(shopId: number, body: (trx: Knex.Transaction) => Promise<void>) {
  return runWithTenantContext(shopId, () =>
    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx.raw(`SET LOCAL "app.current_tenant" = '${Number(shopId)}'`);
      await body(trx);
    })
  );
}

function cancelOrderThroughProjectionHandler(shopId: number, externalOrderId: string) {
  const cancelledAt = new Date();
  return inProjectionTransaction(shopId, (trx) =>
    handleOrdersCancelled({
      domainEvent: {
        shop_id: shopId,
        event_type: 'orders/cancelled',
        event_payload: { id: externalOrderId, cancelled_at: cancelledAt.toISOString() },
      },
      domain_event_id: 0,
      canonicalEventTime: cancelledAt,
      trx,
    })
  );
}

function fulfillOrderPhysically(shopId: number, orderId: string) {
  const fulfilledAt = new Date();
  return inProjectionTransaction(shopId, (trx) =>
    applyFulfillmentPhysicalRemoval(trx, shopId, orderId, fulfilledAt)
  );
}

// ── state readers ───────────────────────────────────────────────────────────

type LedgerRow = {
  movement_type: string;
  reference_type: string;
  reference_id: string;
  location_code: string;
  quantity_delta: number;
};

async function reservationLedger(shopId: number, variantId: string): Promise<LedgerRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId })
      .whereIn('movement_type', ['reservation_hold', 'reservation_release'])
      .select('movement_type', 'reference_type', 'reference_id', 'location_code', 'quantity_delta')
  );
  return rows
    .map((r: any) => ({
      movement_type: r.movement_type, reference_type: r.reference_type,
      reference_id: String(r.reference_id), location_code: r.location_code,
      quantity_delta: Number(r.quantity_delta),
    }))
    .sort((a: LedgerRow, b: LedgerRow) =>
      `${a.movement_type}|${a.reference_type}|${a.reference_id}|${a.location_code}`.localeCompare(
        `${b.movement_type}|${b.reference_type}|${b.reference_id}|${b.location_code}`));
}

async function truthAt(shopId: number, variantId: string, locationCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .first('on_hand_quantity', 'reserved_quantity', 'available_quantity'));
  return { onHand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity), available: Number(row.available_quantity) };
}

type AllocationRow = {
  allocation_id: string;
  lasyncro_order_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  quantity: number;
};

async function batchAllocations(shopId: number, batchId: string): Promise<AllocationRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: shopId, pick_batch_id: batchId })
      .orderBy('allocation_id')
      .select('allocation_id', 'lasyncro_order_id', 'lasyncro_variant_id', 'location_code', 'quantity'));
  return rows.map((r: any) => ({ ...r, quantity: Number(r.quantity) }));
}

async function batchStatus(shopId: number, batchId: string): Promise<string | null> {
  const row = await withTenant(shopId, (trx) =>
    trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).first('status'));
  return row?.status ?? null;
}

async function batchMembers(shopId: number, batchId: string): Promise<string[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_batch_orders').where({ shop_id: shopId, pick_batch_id: batchId })
      .orderBy('lasyncro_order_id').select('lasyncro_order_id'));
  return rows.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id);
}

/** Every row a cancellation could write, for zero-side-effect proofs. */
async function shopStateSnapshot(shopId: number, orderIds: string[]) {
  return withTenant(shopId, async (trx) => ({
    movements: await trx('inventory_movements').where({ shop_id: shopId })
      .orderBy('lasyncro_inventory_movement_id')
      .select('lasyncro_inventory_movement_id', 'movement_type', 'reference_type', 'reference_id',
        'lasyncro_variant_id', 'location_code', 'quantity_delta'),
    truth: await trx('inventory_truth').where({ shop_id: shopId })
      .orderBy(['lasyncro_variant_id', 'location_code'])
      .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity'),
    allocations: await trx('pick_reservation_allocations').where({ shop_id: shopId })
      .orderBy('allocation_id')
      .select('allocation_id', 'pick_batch_id', 'lasyncro_order_id', 'lasyncro_variant_id', 'location_code', 'quantity'),
    batches: await trx('pick_batches').where({ shop_id: shopId })
      .orderBy('pick_batch_id').select('pick_batch_id', 'status'),
    memberships: await trx('pick_batch_orders').where({ shop_id: shopId })
      .orderBy(['pick_batch_id', 'lasyncro_order_id']).select('pick_batch_id', 'lasyncro_order_id'),
    lineStates: await trx('order_line_item_warehouse_status').where({ shop_id: shopId })
      .whereIn('lasyncro_order_id', orderIds).orderBy('lasyncro_line_item_id')
      .select('lasyncro_line_item_id', 'status'),
    orderStates: await trx('order_warehouse_status').whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_order_id').select('lasyncro_order_id', 'pick_batch_id', 'status'),
  }));
}

// ── shared arrangement: batch A = A1 (2) + A2 (1) at WH-{shop}-ROOT ─────────

const QTY_A1 = 2;
const QTY_A2 = 1;

async function arrangeBatchA(label: string) {
  const { shopId, token } = await provisionFt2Shop(label);
  const { variantId, productId, locationCode } = await pickRootVariant(shopId, QTY_A1 + QTY_A2);
  const before = await truthAt(shopId, variantId, locationCode);
  const a1 = await seedHealthyOrder(shopId, { quantity: QTY_A1, variantId, productId });
  const a2 = await seedHealthyOrder(shopId, { quantity: QTY_A2, variantId, productId });

  const release = await postRelease(token, { priority_order_ids: [a1.orderId, a2.orderId], exclusive: true });
  expect(release.status).toBe(201);
  expect(release.body.order_count).toBe(2);
  const batchA: string = release.body.pick_batch_id;

  expect(await batchStatus(shopId, batchA)).toBe('pending');
  expect(await truthAt(shopId, variantId, locationCode)).toEqual({
    onHand: before.onHand, reserved: QTY_A1 + QTY_A2, available: before.onHand - (QTY_A1 + QTY_A2),
  });
  expect(await reservationLedger(shopId, variantId)).toEqual([
    { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchA,
      location_code: locationCode, quantity_delta: QTY_A1 + QTY_A2 },
  ]);
  const allocations = await batchAllocations(shopId, batchA);
  expect(allocations.map((a) => a.quantity).sort()).toEqual([QTY_A2, QTY_A1].sort());

  return {
    shopId, token, variantId, productId, locationCode, before, a1, a2, batchA,
    orderIds: [a1.orderId, a2.orderId],
    allocationFor: (orderId: string) => allocations.find((a) => a.lasyncro_order_id === orderId)!,
  };
}

async function expectOwnershipConflictWithZeroMutation(
  ctx: Awaited<ReturnType<typeof arrangeBatchA>>,
  reason: string
) {
  const snapshotBefore = await shopStateSnapshot(ctx.shopId, ctx.orderIds);
  const cancel = await postCancelBatch(ctx.token, ctx.batchA);
  const snapshotAfter = await shopStateSnapshot(ctx.shopId, ctx.orderIds);

  expect({
    httpStatus: cancel.status,
    code: cancel.body?.code,
    reason: cancel.body?.reason,
  }).toEqual({ httpStatus: 409, code: 'BATCH_RESERVATION_OWNERSHIP_CONFLICT', reason });
  expect(snapshotAfter).toEqual(snapshotBefore);
  expect(await batchStatus(ctx.shopId, ctx.batchA)).toBe('pending');
}

describe('GH-1145 R0-1 — pending-batch cancellation releases current reservation ownership', () => {
  it('C1 — plain cancel: current allocations equal the hold, exact release, state removed', async () => {
    const ctx = await arrangeBatchA('c1');

    const cancel = await postCancelBatch(ctx.token, ctx.batchA);

    expect(cancel.status).toBe(200);
    expect(cancel.body).toEqual({
      pick_batch_id: ctx.batchA,
      status: 'cancelled',
      returned_order_count: 2,
      released_reservation_count: 1,
      released_units: QTY_A1 + QTY_A2,
    });
    expect(await reservationLedger(ctx.shopId, ctx.variantId)).toEqual([
      { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: ctx.batchA,
        location_code: ctx.locationCode, quantity_delta: QTY_A1 + QTY_A2 },
      { movement_type: 'reservation_release', reference_type: 'pick_batch', reference_id: ctx.batchA,
        location_code: ctx.locationCode, quantity_delta: -(QTY_A1 + QTY_A2) },
    ]);
    expect(await truthAt(ctx.shopId, ctx.variantId, ctx.locationCode)).toEqual(ctx.before);
    const after = await shopStateSnapshot(ctx.shopId, ctx.orderIds);
    expect({
      batchStatus: await batchStatus(ctx.shopId, ctx.batchA),
      members: await batchMembers(ctx.shopId, ctx.batchA),
      allocations: await batchAllocations(ctx.shopId, ctx.batchA),
      lineStates: after.lineStates,
      orderStates: after.orderStates,
    }).toEqual({ batchStatus: 'cancelled', members: [], allocations: [], lineStates: [], orderStates: [] });
  }, 240_000);

  it('C2 — legitimate zero ownership: fulfillment removed every allocation, cancel releases nothing', async () => {
    const ctx = await arrangeBatchA('c2');

    await fulfillOrderPhysically(ctx.shopId, ctx.a1.orderId);
    await fulfillOrderPhysically(ctx.shopId, ctx.a2.orderId);

    const truthBeforeCancel = await truthAt(ctx.shopId, ctx.variantId, ctx.locationCode);
    const ledgerBeforeCancel = await reservationLedger(ctx.shopId, ctx.variantId);
    expect(truthBeforeCancel).toEqual({
      onHand: ctx.before.onHand - (QTY_A1 + QTY_A2), reserved: 0, available: ctx.before.onHand - (QTY_A1 + QTY_A2),
    });
    expect(await batchAllocations(ctx.shopId, ctx.batchA)).toEqual([]);
    expect(await batchMembers(ctx.shopId, ctx.batchA)).toEqual([...ctx.orderIds].sort());
    expect((await shopStateSnapshot(ctx.shopId, ctx.orderIds)).lineStates.map((l: any) => l.status))
      .toEqual(['shipped', 'shipped']);

    const cancel = await postCancelBatch(ctx.token, ctx.batchA);

    expect(cancel.status).toBe(200);
    expect(cancel.body).toEqual({
      pick_batch_id: ctx.batchA,
      status: 'cancelled',
      returned_order_count: 2,
      released_reservation_count: 0,
      released_units: 0,
    });
    // No new reservation_release (in particular no quantity_delta = 0 row).
    expect(await reservationLedger(ctx.shopId, ctx.variantId)).toEqual(ledgerBeforeCancel);
    expect(await truthAt(ctx.shopId, ctx.variantId, ctx.locationCode)).toEqual(truthBeforeCancel);
    expect(await batchStatus(ctx.shopId, ctx.batchA)).toBe('cancelled');
    expect(await batchMembers(ctx.shopId, ctx.batchA)).toEqual([]);
  }, 240_000);

  it('C3 — owned quantity exceeding the original hold fails closed with zero mutation', async () => {
    const ctx = await arrangeBatchA('c3');
    // Corrupt ownership: A1 now claims one unit more than the batch ever held.
    await withTenant(ctx.shopId, (trx) =>
      trx('pick_reservation_allocations')
        .where({ shop_id: ctx.shopId, allocation_id: ctx.allocationFor(ctx.a1.orderId).allocation_id })
        .update({ quantity: QTY_A1 + 1 }));

    await expectOwnershipConflictWithZeroMutation(ctx, 'OWNED_EXCEEDS_HOLD');
  }, 240_000);

  it('C4 — an allocation without a corresponding hold fails closed with zero mutation', async () => {
    const ctx = await arrangeBatchA('c4');
    const otherVariant = await withTenant(ctx.shopId, (trx) =>
      trx('variants').where({ shop_id: ctx.shopId })
        .whereNot({ lasyncro_variant_id: ctx.variantId })
        .orderBy('lasyncro_variant_id').first('lasyncro_variant_id'));
    expect(otherVariant).toBeTruthy();
    // Corrupt ownership: A2's allocation now names a variant the batch never held.
    await withTenant(ctx.shopId, (trx) =>
      trx('pick_reservation_allocations')
        .where({ shop_id: ctx.shopId, allocation_id: ctx.allocationFor(ctx.a2.orderId).allocation_id })
        .update({ lasyncro_variant_id: otherVariant.lasyncro_variant_id }));

    await expectOwnershipConflictWithZeroMutation(ctx, 'ALLOCATION_WITHOUT_HOLD');
  }, 240_000);

  it('C5 — multi-location: exact current-owned release at each location after a partial unwind', async () => {
    const { shopId, token } = await provisionFt2Shop('c5');
    const QTY = { a1: 2, a2: 2, a3: 1 };
    const BIN_STOCK = 3;
    const { variantId, productId, locationCode: rootCode } =
      await pickRootVariant(shopId, QTY.a1 + QTY.a2 + QTY.a3);
    const binCode = `R01-BIN-${shopId}-${crypto.randomUUID().slice(0, 8)}`;

    // Authorised fixture: one active pick bin holding BIN_STOCK of the variant.
    await withTenant(shopId, async (trx) => {
      const root = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: rootCode }).first('warehouse_id');
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: root.warehouse_id, location_code: binCode, type: 'bin',
        parent_location_code: rootCode, active: true, zone_type: 'pick',
      });
      await trx('inventory_truth').insert({
        shop_id: shopId, lasyncro_variant_id: variantId, location_code: binCode,
        on_hand_quantity: BIN_STOCK, reserved_quantity: 0, committed_quantity: 0,
        available_quantity: BIN_STOCK, last_evaluated_at: new Date(),
      });
    });
    const truthBefore = {
      [rootCode]: await truthAt(shopId, variantId, rootCode),
      [binCode]: await truthAt(shopId, variantId, binCode),
    };

    const a1 = await seedHealthyOrder(shopId, { quantity: QTY.a1, variantId, productId });
    const a2 = await seedHealthyOrder(shopId, { quantity: QTY.a2, variantId, productId });
    const a3 = await seedHealthyOrder(shopId, { quantity: QTY.a3, variantId, productId });
    const release = await postRelease(token, {
      priority_order_ids: [a1.orderId, a2.orderId, a3.orderId], exclusive: true,
    });
    expect(release.status).toBe(201);
    expect(release.body.order_count).toBe(3);
    const batchA: string = release.body.pick_batch_id;

    const holds = (await reservationLedger(shopId, variantId))
      .filter((r) => r.movement_type === 'reservation_hold' && r.reference_id === batchA);
    // Bins first: BIN_STOCK at the bin, remainder at ROOT — two hold keys.
    expect(holds.map((h) => [h.location_code, h.quantity_delta]).sort()).toEqual(
      [[binCode, BIN_STOCK], [rootCode, QTY.a1 + QTY.a2 + QTY.a3 - BIN_STOCK]].sort());
    const allAllocationIds = (await batchAllocations(shopId, batchA)).map((a) => a.allocation_id);

    await cancelOrderThroughProjectionHandler(shopId, a1.externalOrderId);

    const survivors = await batchAllocations(shopId, batchA);
    expect(survivors.every((a) => a.lasyncro_order_id !== a1.orderId)).toBe(true);
    const ownedAt = (code: string) =>
      survivors.filter((a) => a.location_code === code).reduce((s, a) => s + a.quantity, 0);
    const expectedOwned = { [rootCode]: ownedAt(rootCode), [binCode]: ownedAt(binCode) };
    expect(expectedOwned[rootCode] + expectedOwned[binCode]).toBe(QTY.a2 + QTY.a3);

    const cancel = await postCancelBatch(token, batchA);

    expect(cancel.status).toBe(200);
    expect(cancel.body.released_units).toBe(QTY.a2 + QTY.a3);
    expect(cancel.body.released_reservation_count)
      .toBe([rootCode, binCode].filter((code) => expectedOwned[code] > 0).length);

    const ledger = await reservationLedger(shopId, variantId);
    for (const code of [rootCode, binCode]) {
      const batchReleases = ledger.filter((r) =>
        r.movement_type === 'reservation_release' && r.reference_type === 'pick_batch' &&
        r.reference_id === batchA && r.location_code === code);
      // Exactly the quantity still owned at this location; nothing when zero.
      expect(batchReleases.map((r) => r.quantity_delta))
        .toEqual(expectedOwned[code] > 0 ? [-expectedOwned[code]] : []);
      const netAtLocation = ledger
        .filter((r) => r.location_code === code && (
          (r.reference_type === 'pick_batch' && r.reference_id === batchA) ||
          (r.reference_type === 'pick_reservation_allocation' && allAllocationIds.includes(r.reference_id))))
        .reduce((s, r) => s + r.quantity_delta, 0);
      expect({ code, netAtLocation, truth: await truthAt(shopId, variantId, code) })
        .toEqual({ code, netAtLocation: 0, truth: truthBefore[code] });
    }
    expect(await batchStatus(shopId, batchA)).toBe('cancelled');
    expect(await batchAllocations(shopId, batchA)).toEqual([]);
  }, 240_000);

  it('C6 — retry: a second cancellation cannot write another movement', async () => {
    const ctx = await arrangeBatchA('c6');

    const first = await postCancelBatch(ctx.token, ctx.batchA);
    expect(first.status).toBe(200);
    const snapshotAfterFirst = await shopStateSnapshot(ctx.shopId, ctx.orderIds);

    const second = await postCancelBatch(ctx.token, ctx.batchA);

    expect({ httpStatus: second.status, error: second.body?.error })
      .toEqual({ httpStatus: 409, error: 'Batch is not cancellable: cancelled' });
    expect(await shopStateSnapshot(ctx.shopId, ctx.orderIds)).toEqual(snapshotAfterFirst);
    expect((await reservationLedger(ctx.shopId, ctx.variantId))
      .filter((r) => r.movement_type === 'reservation_release')).toHaveLength(1);
  }, 240_000);

  it('C7 — ownership unknown: holds, zero allocations, live warehouse work fails closed with zero mutation', async () => {
    const ctx = await arrangeBatchA('c7');
    // Corrupt ownership: allocations vanish while both orders are still awaiting pick.
    await withTenant(ctx.shopId, (trx) =>
      trx('pick_reservation_allocations').where({ shop_id: ctx.shopId, pick_batch_id: ctx.batchA }).delete());
    expect((await shopStateSnapshot(ctx.shopId, ctx.orderIds)).lineStates.map((l: any) => l.status))
      .toEqual(['awaiting_pick', 'awaiting_pick']);

    await expectOwnershipConflictWithZeroMutation(ctx, 'OWNERSHIP_UNKNOWN');
  }, 240_000);

  it('C8 — same variant/location: one active line missing ownership fails closed with zero mutation', async () => {
    const ctx = await arrangeBatchA('c8');
    // Corrupt ownership: A1 still owns the variant/location, but active A2
    // has no surviving allocation. Aggregate variant/location ownership must
    // not hide the per-line gap.
    await withTenant(ctx.shopId, (trx) =>
      trx('pick_reservation_allocations')
        .where({
          shop_id: ctx.shopId,
          allocation_id: ctx.allocationFor(ctx.a2.orderId).allocation_id,
        })
        .delete());

    expect((await shopStateSnapshot(ctx.shopId, ctx.orderIds)).lineStates.map((l: any) => l.status))
      .toEqual(['awaiting_pick', 'awaiting_pick']);
    expect(await batchAllocations(ctx.shopId, ctx.batchA)).toEqual([
      {
        allocation_id: ctx.allocationFor(ctx.a1.orderId).allocation_id,
        lasyncro_order_id: ctx.a1.orderId,
        lasyncro_variant_id: ctx.variantId,
        location_code: ctx.locationCode,
        quantity: QTY_A1,
      },
    ]);

    await expectOwnershipConflictWithZeroMutation(ctx, 'OWNERSHIP_UNKNOWN');
  }, 240_000);
});
