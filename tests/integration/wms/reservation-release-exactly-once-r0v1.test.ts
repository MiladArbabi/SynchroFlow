/**
 * GH-1145 R0-V1 — RESERVATION RELEASE MUST OCCUR EXACTLY ONCE.
 *
 * Verification-only regression (no production change). Static hypothesis from
 * the GH-1145 Release / Order Pool audit:
 *
 *   - reserveBatchInventory writes ONE aggregate reservation_hold per
 *     batch + variant + location (reference_type = 'pick_batch').
 *   - unwindCancelledOrder releases each unscanned allocation of the cancelled
 *     order (reference_type = 'pick_reservation_allocation'), updates
 *     inventory_truth and deletes those allocations.
 *   - cancelUnclaimedBatch later re-reads the ORIGINAL aggregate pick_batch
 *     hold and releases it in full — a second release of the quantity the
 *     unwind already returned. The two release rows have different conflict
 *     identities, so nothing de-duplicates them.
 *
 * Invariant under test (both cases):
 *   Batch cancellation releases ONLY the reservation quantity the batch still
 *   owns. Per batch, the ledger nets to zero exactly once; inventory_truth
 *   reserved equals the remaining pick_reservation_allocations at the location;
 *   another batch's reservation is never consumed.
 *
 *   A  stuck-batch variant   — only batch A holds stock at the location.
 *   B  cross-batch variant   — batch B also holds stock at the same location,
 *                              enough for the stale full release to pass the
 *                              reserved_quantity >= quantity guard.
 *
 * Real paths exercised:
 *   Release        POST /api/v1/wms/batch/release  (createApp + supertest)
 *   Order cancel   the registered orders/cancelled projection handler
 *                  (handleOrdersCancelled → ingestStatus + unwindCancelledOrder),
 *                  inside a transaction prepared exactly as
 *                  projectDomainEventCore prepares it (projection GUC + tenant).
 *   Batch cancel   POST /api/v1/wms/batch/:batchId/cancel
 *
 * Fixture conventions mirror release-regression-completion.test.ts (fresh HMAC
 * install → seedFreshInstall → FT2). seedFreshInstall places all physical
 * stock at WH-{shopId}-ROOT with zero bins, so every allocation in this file
 * lands on one variant + location and the arithmetic is fully deterministic.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { handleOrdersCancelled } from 'api-src/projection/handlers/orders.cancelled';
import { issueTestToken } from '../../unit/helpers/auth';

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

async function provisionFt2Shop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `r0v1-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
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
  return { shopId, userId, token };
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

/**
 * The seeded variant with the most physical stock at WH-{shopId}-ROOT.
 * Preconditions are asserted, not assumed: enough stock for every fixture
 * reservation in the case, and no pre-existing reservation at the location.
 */
async function pickRootVariant(
  shopId: number,
  minAvailable: number
): Promise<{ variantId: string; productId: string; locationCode: string }> {
  const locationCode = `WH-${shopId}-ROOT`;
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .where('it.location_code', locationCode)
      .orderBy('it.available_quantity', 'desc')
      .first(
        'it.lasyncro_variant_id',
        'v.lasyncro_product_id',
        'it.available_quantity',
        'it.reserved_quantity'
      )
  );
  expect(row).toBeTruthy();
  expect(Number(row.available_quantity)).toBeGreaterThanOrEqual(minAvailable);
  expect(Number(row.reserved_quantity)).toBe(0);

  // Every capacity row for this variant must be the ROOT row, so the
  // reservation allocator cannot split demand onto another location.
  const pickableRows = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: row.lasyncro_variant_id })
      .where('available_quantity', '>', 0)
      .select('location_code')
  );
  expect(pickableRows.map((r: { location_code: string }) => r.location_code)).toEqual([locationCode]);

  return {
    variantId: row.lasyncro_variant_id,
    productId: row.lasyncro_product_id,
    locationCode,
  };
}

/** Direct healthy-order fixture (same shape as release-regression-completion.test.ts). */
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
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: opts.productId,
      lasyncro_variant_id: opts.variantId,
      sku: null,
      title: 'R0-V1 Fixture Line',
      quantity: opts.quantity,
      unit_price: '10.00',
      line_total: (10 * opts.quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded (0076);
    // transaction-local guard for this authorised fixture only.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return { orderId, externalOrderId, lineItemId };
}

/**
 * Real commercial-cancellation path: the registered orders/cancelled
 * projection handler, in a transaction prepared exactly as
 * projectDomainEventCore prepares one (projection writer GUC + tenant GUC).
 */
async function cancelOrderThroughProjectionHandler(
  shopId: number,
  externalOrderId: string
): Promise<void> {
  const cancelledAt = new Date();
  await runWithTenantContext(shopId, () =>
    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx.raw(`SET LOCAL "app.current_tenant" = '${Number(shopId)}'`);
      await handleOrdersCancelled({
        domainEvent: {
          shop_id: shopId,
          event_type: 'orders/cancelled',
          event_payload: { id: externalOrderId, cancelled_at: cancelledAt.toISOString() },
        },
        domain_event_id: 0,
        canonicalEventTime: cancelledAt,
        trx,
      });
    })
  );
}

// ── state readers ───────────────────────────────────────────────────────────

async function truthAt(shopId: number, variantId: string, locationCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .first('on_hand_quantity', 'reserved_quantity', 'available_quantity')
  );
  return {
    onHand: Number(row.on_hand_quantity),
    reserved: Number(row.reserved_quantity),
    available: Number(row.available_quantity),
  };
}

/** Every inventory_truth row except the target, for the zero-unrelated-change proof. */
async function otherTruth(shopId: number, variantId: string, locationCode: string) {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId })
      .whereNot((qb) => qb.where({ lasyncro_variant_id: variantId, location_code: locationCode }))
      .orderBy(['lasyncro_variant_id', 'location_code'])
      .select('lasyncro_variant_id', 'location_code',
        'on_hand_quantity', 'reserved_quantity', 'available_quantity')
  );
  return JSON.stringify(rows);
}

type LedgerRow = {
  movement_type: string;
  reference_type: string;
  reference_id: string;
  quantity_delta: number;
};

/** Reservation ledger at the target variant + location, deterministically sorted. */
async function reservationLedger(
  shopId: number,
  variantId: string,
  locationCode: string
): Promise<LedgerRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .whereIn('movement_type', ['reservation_hold', 'reservation_release'])
      .select('movement_type', 'reference_type', 'reference_id', 'quantity_delta')
  );
  return rows
    .map((r: any) => ({
      movement_type: r.movement_type,
      reference_type: r.reference_type,
      reference_id: String(r.reference_id),
      quantity_delta: Number(r.quantity_delta),
    }))
    .sort((a: LedgerRow, b: LedgerRow) =>
      `${a.movement_type}|${a.reference_type}|${a.reference_id}|${a.quantity_delta}`.localeCompare(
        `${b.movement_type}|${b.reference_type}|${b.reference_id}|${b.quantity_delta}`
      )
    );
}

type AllocationRow = {
  allocation_id: string;
  pick_batch_id: string;
  lasyncro_order_id: string;
  location_code: string;
  quantity: number;
};

async function allocationsAt(
  shopId: number,
  variantId: string,
  locationCode: string
): Promise<AllocationRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .select('allocation_id', 'pick_batch_id', 'lasyncro_order_id', 'location_code', 'quantity')
  );
  return rows
    .map((r: any) => ({ ...r, quantity: Number(r.quantity) }))
    .sort((a: AllocationRow, b: AllocationRow) =>
      `${a.pick_batch_id}|${a.lasyncro_order_id}`.localeCompare(`${b.pick_batch_id}|${b.lasyncro_order_id}`)
    );
}

/**
 * Net reservation ledger owned by one batch: its aggregate pick_batch rows
 * plus any per-allocation releases written against that batch's allocations.
 */
function batchLedgerNet(ledger: LedgerRow[], batchId: string, allocationIds: string[]): number {
  return ledger
    .filter(
      (r) =>
        (r.reference_type === 'pick_batch' && r.reference_id === batchId) ||
        (r.reference_type === 'pick_reservation_allocation' && allocationIds.includes(r.reference_id))
    )
    .reduce((sum, r) => sum + r.quantity_delta, 0);
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

async function fulfillmentStatus(shopId: number, orderId: string): Promise<string | null> {
  const row = await withTenant(shopId, (trx) =>
    trx('order_fulfillment_status').where({ lasyncro_order_id: orderId }).first('status'));
  return row?.status ?? null;
}

// Fixture quantities. Distinct values make every arithmetic step attributable.
const QTY_A1 = 2;
const QTY_A2 = 1;
const QTY_B1 = 3;

describe('GH-1145 R0-V1 — reservation release must occur exactly once', () => {
  it('A — stuck-batch: after one order is unwound, batch cancel releases only the quantity the batch still owns', async () => {
    const { shopId, token } = await provisionFt2Shop('a');
    const { variantId, productId, locationCode } = await pickRootVariant(shopId, QTY_A1 + QTY_A2);

    const before = await truthAt(shopId, variantId, locationCode);
    expect(before.reserved).toBe(0);
    expect(before.available).toBe(before.onHand);
    const othersBefore = await otherTruth(shopId, variantId, locationCode);

    const a1 = await seedHealthyOrder(shopId, { quantity: QTY_A1, variantId, productId });
    const a2 = await seedHealthyOrder(shopId, { quantity: QTY_A2, variantId, productId });

    // ── 1-3. real release of both orders into ONE pending batch ──────────────
    const release = await postRelease(token, {
      priority_order_ids: [a1.orderId, a2.orderId],
      exclusive: true,
    });
    expect(release.status).toBe(201);
    expect(release.body.order_count).toBe(2);
    expect(release.body.skipped_orders).toEqual([]);
    expect(release.body.newly_blocked_orders).toEqual([]);
    const batchA: string = release.body.pick_batch_id;
    expect(await batchStatus(shopId, batchA)).toBe('pending');
    expect(await batchMembers(shopId, batchA)).toEqual([a1.orderId, a2.orderId].sort());

    // ── 4. initial truth, ledger and allocations exactly ─────────────────────
    expect(await truthAt(shopId, variantId, locationCode)).toEqual({
      onHand: before.onHand,
      reserved: QTY_A1 + QTY_A2,
      available: before.onHand - (QTY_A1 + QTY_A2),
    });
    expect(await reservationLedger(shopId, variantId, locationCode)).toEqual([
      { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchA, quantity_delta: QTY_A1 + QTY_A2 },
    ]);
    const allocationsAfterRelease = await allocationsAt(shopId, variantId, locationCode);
    expect(allocationsAfterRelease.map(({ allocation_id, ...rest }) => rest)).toEqual(
      [
        { pick_batch_id: batchA, lasyncro_order_id: a1.orderId, location_code: locationCode, quantity: QTY_A1 },
        { pick_batch_id: batchA, lasyncro_order_id: a2.orderId, location_code: locationCode, quantity: QTY_A2 },
      ].sort((x, y) => x.lasyncro_order_id.localeCompare(y.lasyncro_order_id))
    );
    const batchAAllocationIds = allocationsAfterRelease.map((a) => a.allocation_id);
    const a1AllocationIds = allocationsAfterRelease
      .filter((a) => a.lasyncro_order_id === a1.orderId)
      .map((a) => a.allocation_id);
    expect(a1AllocationIds).toHaveLength(1);

    // ── 5. real cancellation unwind of A1 only ───────────────────────────────
    await cancelOrderThroughProjectionHandler(shopId, a1.externalOrderId);

    // ── 6. only A1's reservation was released ────────────────────────────────
    expect(await fulfillmentStatus(shopId, a1.orderId)).toBe('cancelled');
    expect(await fulfillmentStatus(shopId, a2.orderId)).toBe('pending');
    expect(await truthAt(shopId, variantId, locationCode)).toEqual({
      onHand: before.onHand,
      reserved: QTY_A2,
      available: before.onHand - QTY_A2,
    });
    expect(await reservationLedger(shopId, variantId, locationCode)).toEqual([
      { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchA, quantity_delta: QTY_A1 + QTY_A2 },
      { movement_type: 'reservation_release', reference_type: 'pick_reservation_allocation', reference_id: a1AllocationIds[0], quantity_delta: -QTY_A1 },
    ]);
    expect((await allocationsAt(shopId, variantId, locationCode)).map(({ allocation_id, ...rest }) => rest)).toEqual([
      { pick_batch_id: batchA, lasyncro_order_id: a2.orderId, location_code: locationCode, quantity: QTY_A2 },
    ]);
    expect(await batchStatus(shopId, batchA)).toBe('pending');
    expect(await batchMembers(shopId, batchA)).toEqual([a2.orderId]);

    // ── 7. cancel the still-pending batch through the real route ─────────────
    const cancel = await postCancelBatch(token, batchA);

    // ── 8. exact post-state vs the invariant ─────────────────────────────────
    const ledgerAfter = await reservationLedger(shopId, variantId, locationCode);
    const observed = {
      httpStatus: cancel.status,
      error: cancel.body?.error ?? null,
      batchStatus: await batchStatus(shopId, batchA),
      batchMembers: await batchMembers(shopId, batchA),
      truth: await truthAt(shopId, variantId, locationCode),
      batchALedgerNet: batchLedgerNet(ledgerAfter, batchA, batchAAllocationIds),
      remainingAllocations: (await allocationsAt(shopId, variantId, locationCode)).map(
        ({ allocation_id, ...rest }) => rest
      ),
    };

    expect(observed).toEqual({
      httpStatus: 200,
      error: null,
      batchStatus: 'cancelled',
      batchMembers: [],
      // Everything batch A reserved is released exactly once in total.
      truth: { onHand: before.onHand, reserved: 0, available: before.onHand },
      batchALedgerNet: 0,
      remainingAllocations: [],
    });

    // Zero unrelated change anywhere else in inventory_truth.
    expect(await otherTruth(shopId, variantId, locationCode)).toBe(othersBefore);
  }, 240_000);

  it('B — cross-batch: cancelling batch A after an A1 unwind never consumes batch B’s reservation at the same location', async () => {
    const { shopId, token } = await provisionFt2Shop('b');
    const { variantId, productId, locationCode } = await pickRootVariant(
      shopId,
      QTY_A1 + QTY_A2 + QTY_B1
    );

    const before = await truthAt(shopId, variantId, locationCode);
    expect(before.reserved).toBe(0);
    expect(before.available).toBe(before.onHand);
    const othersBefore = await otherTruth(shopId, variantId, locationCode);

    const a1 = await seedHealthyOrder(shopId, { quantity: QTY_A1, variantId, productId });
    const a2 = await seedHealthyOrder(shopId, { quantity: QTY_A2, variantId, productId });
    const b1 = await seedHealthyOrder(shopId, { quantity: QTY_B1, variantId, productId });

    // ── batch A = A1 + A2, batch B = B1, all at the same variant + location ─
    const releaseA = await postRelease(token, {
      priority_order_ids: [a1.orderId, a2.orderId],
      exclusive: true,
    });
    expect(releaseA.status).toBe(201);
    expect(releaseA.body.order_count).toBe(2);
    expect(releaseA.body.newly_blocked_orders).toEqual([]);
    const batchA: string = releaseA.body.pick_batch_id;

    const releaseB = await postRelease(token, { priority_order_ids: [b1.orderId], exclusive: true });
    expect(releaseB.status).toBe(201);
    expect(releaseB.body.order_count).toBe(1);
    expect(releaseB.body.newly_blocked_orders).toEqual([]);
    const batchB: string = releaseB.body.pick_batch_id;
    expect(batchB).not.toBe(batchA);

    const totalReserved = QTY_A1 + QTY_A2 + QTY_B1;
    expect(await truthAt(shopId, variantId, locationCode)).toEqual({
      onHand: before.onHand,
      reserved: totalReserved,
      available: before.onHand - totalReserved,
    });
    expect(await reservationLedger(shopId, variantId, locationCode)).toEqual(
      [
        { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchA, quantity_delta: QTY_A1 + QTY_A2 },
        { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchB, quantity_delta: QTY_B1 },
      ].sort((x, y) =>
        `${x.movement_type}|${x.reference_type}|${x.reference_id}|${x.quantity_delta}`.localeCompare(
          `${y.movement_type}|${y.reference_type}|${y.reference_id}|${y.quantity_delta}`
        )
      )
    );
    const allocationsAfterRelease = await allocationsAt(shopId, variantId, locationCode);
    // Precondition for the cross-batch case: every allocation shares the location.
    expect(allocationsAfterRelease.every((a) => a.location_code === locationCode)).toBe(true);
    const batchAAllocationIds = allocationsAfterRelease
      .filter((a) => a.pick_batch_id === batchA).map((a) => a.allocation_id);
    const batchBAllocationIds = allocationsAfterRelease
      .filter((a) => a.pick_batch_id === batchB).map((a) => a.allocation_id);
    const a1AllocationIds = allocationsAfterRelease
      .filter((a) => a.lasyncro_order_id === a1.orderId).map((a) => a.allocation_id);
    expect(batchAAllocationIds).toHaveLength(2);
    expect(batchBAllocationIds).toHaveLength(1);
    expect(a1AllocationIds).toHaveLength(1);

    // ── unwind A1 through the real cancellation path ─────────────────────────
    await cancelOrderThroughProjectionHandler(shopId, a1.externalOrderId);

    expect(await fulfillmentStatus(shopId, a1.orderId)).toBe('cancelled');
    expect(await truthAt(shopId, variantId, locationCode)).toEqual({
      onHand: before.onHand,
      reserved: QTY_A2 + QTY_B1,
      available: before.onHand - (QTY_A2 + QTY_B1),
    });
    const ledgerAfterUnwind = await reservationLedger(shopId, variantId, locationCode);
    expect(ledgerAfterUnwind.filter((r) => r.movement_type === 'reservation_release')).toEqual([
      { movement_type: 'reservation_release', reference_type: 'pick_reservation_allocation', reference_id: a1AllocationIds[0], quantity_delta: -QTY_A1 },
    ]);
    // The stale full release of batch A (QTY_A1 + QTY_A2 = 3) now fits under
    // the location's reserved_quantity (QTY_A2 + QTY_B1 = 4): the guard in
    // cancelUnclaimedBatch cannot reject it.
    expect(QTY_A2 + QTY_B1).toBeGreaterThanOrEqual(QTY_A1 + QTY_A2);

    const batchBAllocationsBefore = (await allocationsAt(shopId, variantId, locationCode))
      .filter((a) => a.pick_batch_id === batchB);

    // ── cancel batch A through the real route ────────────────────────────────
    const cancel = await postCancelBatch(token, batchA);

    const ledgerAfter = await reservationLedger(shopId, variantId, locationCode);
    const remainingAllocations = await allocationsAt(shopId, variantId, locationCode);
    const truthAfter = await truthAt(shopId, variantId, locationCode);
    const observed = {
      httpStatus: cancel.status,
      error: cancel.body?.error ?? null,
      batchAStatus: await batchStatus(shopId, batchA),
      batchBStatus: await batchStatus(shopId, batchB),
      batchBMembers: await batchMembers(shopId, batchB),
      truth: truthAfter,
      batchALedgerNet: batchLedgerNet(ledgerAfter, batchA, batchAAllocationIds),
      batchBLedgerNet: batchLedgerNet(ledgerAfter, batchB, batchBAllocationIds),
      remainingAllocations: remainingAllocations.map(({ allocation_id, ...rest }) => rest),
      // inventory_truth.reserved must equal what allocations still own.
      truthReservedMinusRemainingAllocations:
        truthAfter.reserved - remainingAllocations.reduce((s, a) => s + a.quantity, 0),
    };

    expect(observed).toEqual({
      httpStatus: 200,
      error: null,
      batchAStatus: 'cancelled',
      batchBStatus: 'pending',
      batchBMembers: [b1.orderId],
      // Only batch B's reservation remains.
      truth: {
        onHand: before.onHand,
        reserved: QTY_B1,
        available: before.onHand - QTY_B1,
      },
      batchALedgerNet: 0,
      batchBLedgerNet: QTY_B1,
      remainingAllocations: batchBAllocationsBefore.map(({ allocation_id, ...rest }) => rest),
      truthReservedMinusRemainingAllocations: 0,
    });

    expect(await otherTruth(shopId, variantId, locationCode)).toBe(othersBefore);
  }, 240_000);
});
