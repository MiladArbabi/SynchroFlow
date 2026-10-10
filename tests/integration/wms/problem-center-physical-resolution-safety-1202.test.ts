/**
 * GH-1202 — Problem Center physical-resolution inventory safety (RED).
 *
 * For problem_center_tasks with exception_type 'order_cancelled' (picked unit
 * already removed from truth at Pick) and 'repackaging_required' (returned
 * unit never credited to truth), the physical unit the task represents is
 * OUTSIDE inventory_truth. Resolving such a task must never debit, relocate
 * or select unrelated stock merely because it is a positive truth row for the
 * same variant.
 *
 * Locked physical invariants (GREEN mechanism deliberately not prescribed):
 *   discard / write_off  → defined success, task resolved, unrelated truth
 *                          unchanged, no ledger row against the unrelated bin
 *   quarantine           → defined success, unrelated truth unchanged, the
 *                          problem bin gains exactly task.quantity, durable
 *                          across the canonical projection rebuild
 *   re_stow              → recovery stow credits the destination by the
 *                          placed quantity; nothing is debited from the
 *                          problem bin or the unrelated bin
 *
 * Real route: POST /api/v1/wms/problem-center/:taskId/resolve through
 * createApp (real auth, FT2, capability and RBAC middleware) on the
 * disposable integration database. Recovery placement uses the real
 * confirmStow. Durability uses the canonical
 * rebuildInventoryProjectionForVariants — no test-local projection.
 *
 * Fixture: one FT2 shop provisioned through the real install flow
 * (pack-gate-1086 pattern). Every case uses its own variant V, so truth,
 * ledger and rebuild assertions are variant-scoped and independent:
 *   B    W-owned bin holding 5 unrelated healthy units of V (ledger-backed)
 *   PROB W-owned problem bin (shop_wms_settings.problem_bin_location)
 *   DEST W-owned active re-stow destination bin
 * plus ONE different physical unit of V outside truth, represented by the
 * problem task (quantity 1) in the persisted shape its real writer produces.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemQuery,
  runWithTenantContext,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { confirmStow } from 'api-src/services/wms/stow.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

const BIN = 'GH1202-B';
const PROB = 'GH1202-PROB';
const DEST = 'GH1202-DEST';
const W2_BIN = 'GH1202-B2';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (pack-gate-1086 / pick-exception-allocation-1049 pattern) ───

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

async function provisionFt2Shop(): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `gh1202-${crypto.randomUUID().slice(0, 8)}-${Date.now()}.myshopify.com`;
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

type Shop = {
  shopId: number;
  userId: number;
  token: string;
  warehouseId: string;
  rootCode: string;
  receiveJobId: string;
};

let shop: Shop;

beforeAll(async () => {
  // Fail closed: this suite must only ever run against a disposable DB.
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const { shopId, userId, token } = await provisionFt2Shop();

  const { warehouseId, rootCode, receiveJobId } = await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses')
      .where({ shop_id: shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    expect(warehouse?.warehouse_id).toBeTruthy();

    await trx('warehouse_locations').insert(
      [
        [BIN, 'storage'],
        [PROB, 'problem'],
        [DEST, 'storage'],
      ].map(([location_code, zone_type]) => ({
        shop_id: shopId,
        warehouse_id: warehouse.warehouse_id,
        location_code,
        type: 'bin',
        parent_location_code: warehouse.root_location_code,
        active: true,
        zone_type,
      }))
    );

    const updated = await trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .update({ problem_bin_location: PROB, updated_at: trx.fn.now() });
    expect(updated).toBe(1);

    // inventory_units needs a Receive source anchor for synthetic LSUs.
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `GH1202 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplier.id })
      .returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id })
      .returning('receive_job_id');

    return {
      warehouseId: String(warehouse.warehouse_id),
      rootCode: String(warehouse.root_location_code),
      receiveJobId: String(job.receive_job_id),
    };
  });

  shop = { shopId, userId, token, warehouseId, rootCode, receiveJobId };
});

// ── persisted-state seeds ────────────────────────────────────────────────────

type CaseKind = 'order_cancelled' | 'repackaging_required';

type Case = {
  kind: CaseKind;
  variantId: string;
  productId: string;
  unitId: string;
  orderId: string;
};

async function seedMovement(
  trx: any,
  params: {
    variantId: string;
    movementType: 'inbound_purchase' | 'pick_removal';
    quantityDelta: number;
    locationCode: string;
    referenceType: string;
    referenceId: string;
    triggeredBy: string;
  }
): Promise<string> {
  const movementId = crypto.randomUUID();
  await trx('inventory_movements').insert({
    lasyncro_inventory_movement_id: movementId,
    lasyncro_variant_id: params.variantId,
    shop_id: shop.shopId,
    movement_type: params.movementType,
    quantity_delta: params.quantityDelta,
    location_code: params.locationCode,
    reference_type: params.referenceType,
    reference_id: params.referenceId,
    platform: 'wms',
    occurred_at: new Date(),
    device_event_id: crypto.randomUUID(),
    operator_id: shop.userId,
    triggered_by: params.triggeredBy,
  });
  return movementId;
}

async function rebuild(variantId: string): Promise<void> {
  await withTenant(shop.shopId, (trx) =>
    rebuildInventoryProjectionForVariants(shop.shopId, [variantId], trx, new Date())
  );
}

/** Non-zero on_hand per location for one variant. */
async function truthFor(variantId: string): Promise<Record<string, number>> {
  const rows = await withTenant(shop.shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .whereNot('on_hand_quantity', 0)
      .select('location_code', 'on_hand_quantity')
  );
  return Object.fromEntries(
    rows.map((row: any) => [String(row.location_code), Number(row.on_hand_quantity)])
  );
}

type TruthCell = { onHand: number; available: number; reserved: number };

/** on_hand / available / reserved per location (non-zero on_hand rows). */
async function truthDetailFor(variantId: string): Promise<Record<string, TruthCell>> {
  const rows = await withTenant(shop.shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .whereNot('on_hand_quantity', 0)
      .select('location_code', 'on_hand_quantity', 'available_quantity', 'reserved_quantity')
  );
  return Object.fromEntries(
    rows.map((row: any) => [
      String(row.location_code),
      {
        onHand: Number(row.on_hand_quantity),
        available: Number(row.available_quantity),
        reserved: Number(row.reserved_quantity),
      },
    ])
  );
}

/** Unreserved physical stock: on_hand = available = n, reserved 0. */
const stock = (n: number): TruthCell => ({ onHand: n, available: n, reserved: 0 });

async function readUnit(unitId: string) {
  return withTenant(shop.shopId, (trx) =>
    trx('inventory_units')
      .where({ shop_id: shop.shopId, lasyncro_unit_id: unitId })
      .first('status', 'current_location_code')
  );
}

async function movementIdsFor(variantId: string): Promise<Set<string>> {
  const ids = await withTenant(shop.shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .pluck('lasyncro_inventory_movement_id')
  );
  return new Set(ids.map(String));
}

async function movementsSince(variantId: string, before: Set<string>) {
  const rows = await withTenant(shop.shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .select(
        'lasyncro_inventory_movement_id',
        'movement_type',
        'location_code',
        'quantity_delta',
        'reference_type',
        'reference_id'
      )
  );
  return rows
    .filter((row: any) => !before.has(String(row.lasyncro_inventory_movement_id)))
    .map((row: any) => ({
      movement_type: String(row.movement_type),
      location_code: String(row.location_code),
      quantity_delta: Number(row.quantity_delta),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
    }));
}

async function seedUnit(
  trx: any,
  variantId: string,
  status: 'picked' | 'returned'
): Promise<string> {
  const [line] = await trx('receive_job_lines')
    .insert({
      shop_id: shop.shopId,
      receive_job_id: shop.receiveJobId,
      lasyncro_variant_id: variantId,
      quantity_expected: 6,
    })
    .returning('receive_job_line_id');

  const unitId = `LSU-${crypto.randomBytes(5).toString('hex')}`;
  await trx('inventory_units').insert({
    shop_id: shop.shopId,
    lasyncro_unit_id: unitId,
    lasyncro_variant_id: variantId,
    receive_job_line_id: line.receive_job_line_id,
    receive_sequence: 1,
    status,
    current_location_code: null,
  });
  return unitId;
}

async function seedOrder(trx: any): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();
  await trx('orders').insert({
    lasyncro_order_id: orderId,
    shop_id: shop.shopId,
    payment_state: 'paid',
    currency: 'USD',
    total_price: '10.00',
    subtotal_price: '10.00',
    total_tax: '0.00',
    order_created_at: now,
    order_updated_at: now,
    created_at: now,
    updated_at: now,
  });
  return orderId;
}

async function nextProbLabel(trx: any): Promise<string> {
  const result = await trx.raw(
    `UPDATE shop_wms_settings
     SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
     WHERE shop_id = ?
     RETURNING prob_label_sequence`,
    [shop.shopId]
  );
  return `PROB-${shop.shopId}-${String(result.rows[0].prob_label_sequence).padStart(4, '0')}`;
}

/**
 * A variant with 5 unrelated healthy units at B (ledger-backed, projected by
 * the canonical rebuild) and one different physical unit outside truth.
 *
 * order_cancelled: the cancelled unit was received at B and picked from it
 * (inbound +6, pick_removal −1 → B = 5). Its picked LSU, confirmed scan and
 * cancelled warehouse line are persisted as cancellationUnwind leaves them.
 *
 * repackaging_required: inbound +5 at B; the returned unit was never
 * credited to truth (returnJobs.service.ts writes no movement at intake).
 */
async function seedCase(kind: CaseKind): Promise<Case> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const seeded = await withTenant(shop.shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shop.shopId,
      title: `GH1202 ${kind} product`,
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shop.shopId,
      sku: `GH1202-${variantId.slice(0, 8)}`,
      title: `GH1202 ${kind} variant`,
      unit_cost: '1.00',
      status: 'active',
    });

    const orderId = await seedOrder(trx);

    if (kind === 'order_cancelled') {
      await seedMovement(trx, {
        variantId,
        movementType: 'inbound_purchase',
        quantityDelta: 6,
        locationCode: BIN,
        referenceType: 'receive_job',
        referenceId: crypto.randomUUID(),
        triggeredBy: 'receive_job',
      });

      const lineItemId = crypto.randomUUID();
      const now = new Date();
      await trx('order_line_items').insert({
        lasyncro_line_item_id: lineItemId,
        lasyncro_order_id: orderId,
        lasyncro_product_id: productId,
        lasyncro_variant_id: variantId,
        title: 'GH1202 cancelled picked line',
        quantity: 1,
        unit_price: '10.00',
        line_total: '10.00',
        created_at: now,
        updated_at: now,
      });

      const pickRemovalId = await seedMovement(trx, {
        variantId,
        movementType: 'pick_removal',
        quantityDelta: -1,
        locationCode: BIN,
        referenceType: 'order_line_item',
        referenceId: lineItemId,
        triggeredBy: 'pick_scan',
      });

      const unitId = await seedUnit(trx, variantId, 'picked');
      const pickBatchId = crypto.randomUUID();

      await trx('pick_batches').insert({
        pick_batch_id: pickBatchId,
        shop_id: shop.shopId,
        status: 'picking',
        release_trigger: 'manual',
        max_line_items: 10,
        total_line_items: 1,
        total_units: 1,
        released_at: now,
        picked_by: shop.userId,
        pick_last_activity_at: now,
      });
      await trx('pick_scan_log').insert({
        shop_id: shop.shopId,
        pick_batch_id: pickBatchId,
        lasyncro_line_item_id: lineItemId,
        lasyncro_variant_id: variantId,
        lasyncro_unit_id: unitId,
        location_code: BIN,
        quantity_confirmed: 1,
        status: 'confirmed',
        scanned_by: shop.userId,
        scanned_at: now,
        inventory_movement_id: pickRemovalId,
      });
      await trx('order_line_item_warehouse_status').insert({
        lasyncro_line_item_id: lineItemId,
        lasyncro_order_id: orderId,
        shop_id: shop.shopId,
        status: 'cancelled',
        status_updated_at: now,
      });

      return { unitId, orderId };
    }

    await seedMovement(trx, {
      variantId,
      movementType: 'inbound_purchase',
      quantityDelta: 5,
      locationCode: BIN,
      referenceType: 'receive_job',
      referenceId: crypto.randomUUID(),
      triggeredBy: 'receive_job',
    });

    const unitId = await seedUnit(trx, variantId, 'returned');
    return { unitId, orderId };
  });

  await rebuild(variantId);

  return { kind, variantId, productId, ...seeded };
}

/**
 * One Problem Center task for ONE physical unit outside truth, in the shape
 * its real writer persists (cancellationUnwind.raiseProblemTask /
 * returnJobs.service.ts applyReturnLineCascade).
 */
async function seedProblemTask(
  testCase: Case,
  problemBin: string = PROB
): Promise<string> {
  return withTenant(shop.shopId, async (trx) => {
    const notes = await nextProbLabel(trx);

    if (testCase.kind === 'order_cancelled') {
      const [row] = await trx('problem_center_tasks')
        .insert({
          shop_id: shop.shopId,
          status: 'open',
          source: 'pick',
          source_exception_id: testCase.orderId,
          lasyncro_variant_id: testCase.variantId,
          quantity: 1,
          exception_type: 'order_cancelled',
          problem_bin_location: problemBin,
          notes,
        })
        .returning('problem_task_id');
      return String(row.problem_task_id);
    }

    const now = new Date();
    const [job] = await trx('return_jobs')
      .insert({
        shop_id: shop.shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: null,
        lasyncro_order_id: testCase.orderId,
        status: 'in_progress',
        claimed_by: shop.userId,
        claimed_at: now,
        source: 'scan_intake',
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');
    const returnJobId = String(job.return_job_id ?? job);

    const revenueUnitId = crypto.randomUUID();
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: testCase.orderId,
      lasyncro_product_id: testCase.productId,
      lasyncro_variant_id: testCase.variantId,
      title: 'GH1202 returned line',
      quantity: 1,
      unit_price: 10,
      line_total: 10,
      estimated_unit_cost: 1,
    });
    await trx('refund_execution_line_items').insert({
      lasyncro_refund_line_item_id: crypto.randomUUID(),
      lasyncro_refund_execution_id: null,
      lasyncro_revenue_unit_id: revenueUnitId,
      return_job_id: returnJobId,
      refunded_quantity: 1,
      item_condition: 'repackable',
      quantity_received: 1,
      condition_notes: 'GH1202 repackaging fixture',
      processed_by: shop.userId,
      processed_at: now,
      source: 'scan_intake_manual',
      created_at: now,
    });

    const [row] = await trx('problem_center_tasks')
      .insert({
        shop_id: shop.shopId,
        status: 'open',
        source: 'returns',
        source_exception_id: returnJobId,
        lasyncro_variant_id: testCase.variantId,
        quantity: 1,
        exception_type: 'repackaging_required',
        problem_bin_location: problemBin,
        notes,
      })
      .returning('problem_task_id');
    return String(row.problem_task_id);
  });
}

// ── real resolution / recovery paths ─────────────────────────────────────────

type Action = 'discard' | 'write_off' | 'quarantine' | 're_stow';

function resolve(taskId: string, action: Action) {
  return request(app)
    .post(`/api/v1/wms/problem-center/${taskId}/resolve`)
    .set('Authorization', `Bearer ${shop.token}`)
    .send({ resolution_action: action, resolution_notes: `GH1202 ${action}` });
}

function expectResolved(
  res: { status: number; body: any },
  taskId: string,
  action: Action
): void {
  expect({ status: res.status, body: res.body }).toMatchObject({
    status: 200,
    body: {
      problem_task_id: taskId,
      resolved: true,
      resolution_action: action,
      status: 'resolved',
    },
  });
}

async function readTask(taskId: string) {
  return withTenant(shop.shopId, (trx) =>
    trx('problem_center_tasks')
      .where({ shop_id: shop.shopId, problem_task_id: taskId })
      .first('status', 'resolution_action')
  );
}

/**
 * The recovery stow task created by re_stow, claimed and assigned to DEST as
 * persisted state (claim/assignment routes are not under test), then placed
 * through the real confirmStow with the problem unit's LSU.
 */
async function placeRecovery(taskId: string, unitId: string) {
  const stowTask = await withTenant(shop.shopId, (trx) =>
    trx('stow_tasks')
      .where({ shop_id: shop.shopId, source_task_id: taskId })
      .first('stow_task_id', 'quantity', 'status', 'trigger')
  );
  expect(stowTask).toBeTruthy();
  expect(stowTask.quantity).toBe(1);
  expect(stowTask.status).toBe('pending');

  await withTenant(shop.shopId, (trx) =>
    trx('stow_tasks')
      .where({ shop_id: shop.shopId, stow_task_id: stowTask.stow_task_id })
      .update({
        location_code: DEST,
        status: 'in_progress',
        claimed_by: shop.userId,
        claimed_at: new Date(),
        updated_at: new Date(),
      })
  );

  await withTenant(shop.shopId, (trx) =>
    confirmStow(trx, {
      stowTaskId: stowTask.stow_task_id,
      shopId: shop.shopId,
      claimedBy: shop.userId,
      quantityPlaced: 1,
      lasyncroUnitId: unitId,
    })
  );

  return stowTask;
}

/**
 * Disposal of a unit outside truth: defined success, task resolved, no
 * ledger row against the unrelated bin, unrelated truth unchanged now and
 * after the canonical rebuild, and the problem bin never goes negative.
 */
async function expectSafeDisposal(kind: CaseKind, action: 'discard' | 'write_off') {
  const testCase = await seedCase(kind);
  const taskId = await seedProblemTask(testCase);

  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
  const unitBefore = await readUnit(testCase.unitId);
  const before = await movementIdsFor(testCase.variantId);

  const res = await resolve(taskId, action);
  expectResolved(res, taskId, action);
  expect(await readTask(taskId)).toEqual({ status: 'resolved', resolution_action: action });

  const created = await movementsSince(testCase.variantId, before);
  expect(created.filter((movement) => movement.location_code === BIN)).toEqual([]);
  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
  // The task does not identify an exact LSU: no unit may be guessed.
  expect(await readUnit(testCase.unitId)).toEqual(unitBefore);

  await rebuild(testCase.variantId);
  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
}

/**
 * Quarantine of a unit outside truth: the physical unit lands in PROB.
 * Unrelated truth stays at B; PROB gains exactly the task quantity as
 * unreserved on_hand = available (the representation canonical rebuild
 * derives), durably.
 */
async function expectSafeQuarantine(kind: CaseKind) {
  const testCase = await seedCase(kind);
  const taskId = await seedProblemTask(testCase);

  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
  const unitBefore = await readUnit(testCase.unitId);
  const before = await movementIdsFor(testCase.variantId);

  const res = await resolve(taskId, 'quarantine');
  expectResolved(res, taskId, 'quarantine');
  expect(await readTask(taskId)).toEqual({ status: 'resolved', resolution_action: 'quarantine' });

  const created = await movementsSince(testCase.variantId, before);
  expect(created.filter((movement) => movement.location_code === BIN)).toEqual([]);
  expect(await truthDetailFor(testCase.variantId)).toEqual({
    [BIN]: stock(5),
    [PROB]: stock(1),
  });
  expect(await readUnit(testCase.unitId)).toEqual(unitBefore);

  await rebuild(testCase.variantId);
  expect(await truthDetailFor(testCase.variantId)).toEqual({
    [BIN]: stock(5),
    [PROB]: stock(1),
  });
}

/**
 * An invalid quarantine destination fails closed before any write: 409 with
 * the ratified body, task still open, no movement, no truth anywhere new,
 * unrelated stock and the problem unit untouched.
 */
async function expectQuarantineRejected(
  testCase: Case,
  taskId: string,
  problemBin: string
) {
  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
  const unitBefore = await readUnit(testCase.unitId);
  const before = await movementIdsFor(testCase.variantId);

  const res = await resolve(taskId, 'quarantine');
  expect({ status: res.status, body: res.body }).toEqual({
    status: 409,
    body: { error: 'Problem bin is not a valid quarantine location' },
  });

  const task = await withTenant(shop.shopId, (trx) =>
    trx('problem_center_tasks')
      .where({ shop_id: shop.shopId, problem_task_id: taskId })
      .first('status', 'resolution_action', 'resolved_at')
  );
  expect(task).toEqual({ status: 'open', resolution_action: null, resolved_at: null });

  expect(await movementsSince(testCase.variantId, before)).toEqual([]);
  expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });

  const problemBinTruth = await withTenant(shop.shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shop.shopId, location_code: problemBin })
      .select('lasyncro_variant_id')
  );
  expect(problemBinTruth).toEqual([]);
  expect(await readUnit(testCase.unitId)).toEqual(unitBefore);
}

// ── fixture proof ────────────────────────────────────────────────────────────

describe('GH-1202 fixture proof', () => {
  it('PC1202-F — FT2 shop, W-owned B/PROB/DEST, ledger-backed B=5 and a unit outside truth per case kind', async () => {
    const locations = await withTenant(shop.shopId, (trx) =>
      trx('warehouse_locations')
        .where({ shop_id: shop.shopId })
        .whereIn('location_code', [BIN, PROB, DEST])
        .orderBy('location_code', 'asc')
        .select('location_code', 'warehouse_id', 'type', 'active')
    );
    expect(locations).toEqual(
      [BIN, DEST, PROB].sort().map((location_code) => ({
        location_code,
        warehouse_id: shop.warehouseId,
        type: 'bin',
        active: true,
      }))
    );

    for (const kind of ['order_cancelled', 'repackaging_required'] as const) {
      const testCase = await seedCase(kind);
      const taskId = await seedProblemTask(testCase);

      expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5 });

      const task = await withTenant(shop.shopId, (trx) =>
        trx('problem_center_tasks')
          .where({ shop_id: shop.shopId, problem_task_id: taskId })
          .first('status', 'source', 'exception_type', 'quantity', 'problem_bin_location')
      );
      expect(task).toEqual({
        status: 'open',
        source: kind === 'order_cancelled' ? 'pick' : 'returns',
        exception_type: kind,
        quantity: 1,
        problem_bin_location: PROB,
      });

      const unit = await withTenant(shop.shopId, (trx) =>
        trx('inventory_units')
          .where({ shop_id: shop.shopId, lasyncro_unit_id: testCase.unitId })
          .first('status', 'current_location_code')
      );
      expect(unit).toEqual({
        status: kind === 'order_cancelled' ? 'picked' : 'returned',
        current_location_code: null,
      });
    }
  });
});

// ── physical-resolution contract ─────────────────────────────────────────────

describe('GH-1202 order_cancelled — the picked unit is already outside truth', () => {
  it('PC1202-01 — discard resolves without debiting unrelated stock', async () => {
    await expectSafeDisposal('order_cancelled', 'discard');
  });

  it('PC1202-02 — write_off resolves without debiting unrelated stock', async () => {
    await expectSafeDisposal('order_cancelled', 'write_off');
  });

  it('PC1202-03 — quarantine places exactly the task quantity in PROB and leaves B intact', async () => {
    await expectSafeQuarantine('order_cancelled');
  });

  it('PC1202-04 — re_stow recovery credits DEST by the placed unit and debits nothing (baseline)', async () => {
    const testCase = await seedCase('order_cancelled');
    const taskId = await seedProblemTask(testCase);

    const res = await resolve(taskId, 're_stow');
    expectResolved(res, taskId, 're_stow');
    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5 });

    const stowTask = await placeRecovery(taskId, testCase.unitId);
    expect(stowTask.trigger).toBe('order_cancelled_mid_pick');

    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5, [DEST]: 1 });
    await rebuild(testCase.variantId);
    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5, [DEST]: 1 });
  });
});

describe('GH-1202 repackaging_required — the returned unit was never in truth', () => {
  it('PC1202-05 — discard resolves without debiting unrelated stock', async () => {
    await expectSafeDisposal('repackaging_required', 'discard');
  });

  it('PC1202-06 — write_off resolves without debiting unrelated stock', async () => {
    await expectSafeDisposal('repackaging_required', 'write_off');
  });

  it('PC1202-07 — quarantine places exactly the task quantity in PROB and leaves B intact', async () => {
    await expectSafeQuarantine('repackaging_required');
  });

  it('PC1202-08 — re_stow recovery credits DEST without a problem-bin or unrelated debit', async () => {
    const testCase = await seedCase('repackaging_required');
    const taskId = await seedProblemTask(testCase);

    const before = await movementIdsFor(testCase.variantId);
    const res = await resolve(taskId, 're_stow');
    expectResolved(res, taskId, 're_stow');
    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5 });

    await placeRecovery(taskId, testCase.unitId);

    const created = await movementsSince(testCase.variantId, before);
    expect(
      created.filter(
        (movement) =>
          (movement.location_code === PROB || movement.location_code === BIN) &&
          movement.quantity_delta < 0
      )
    ).toEqual([]);
    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5, [DEST]: 1 });

    await rebuild(testCase.variantId);
    expect(await truthFor(testCase.variantId)).toEqual({ [BIN]: 5, [DEST]: 1 });
  });
});

describe('GH-1202 cross-warehouse discriminator', () => {
  it('PC1202-09 — W1 order_cancelled resolutions never select or mutate W2 stock of the same variant', async () => {
    // problem_center_tasks carries no warehouse column. The task belongs to
    // W1's physical workflow through its problem_bin_location (PROB is
    // W1-owned) and its W1 pick evidence (picked from B). W2 is inactive so
    // existing one-active-warehouse rules never reject the fixture.
    const testCase = await seedCase('order_cancelled');
    const w2Id = crypto.randomUUID();

    await withTenant(shop.shopId, async (trx) => {
      const w2Root = `GH1202-W2-${crypto.randomUUID().slice(0, 8)}`;
      await trx('warehouses').insert({
        warehouse_id: w2Id,
        shop_id: shop.shopId,
        name: `GH1202 W2 ${w2Id.slice(0, 8)}`,
        root_location_code: w2Root,
        is_default: false,
        active: false,
      });
      await trx('warehouse_locations').insert([
        {
          shop_id: shop.shopId, warehouse_id: w2Id, location_code: w2Root,
          type: 'warehouse', parent_location_code: null, active: true, zone_type: null,
        },
        {
          shop_id: shop.shopId, warehouse_id: w2Id, location_code: W2_BIN,
          type: 'bin', parent_location_code: w2Root, active: true, zone_type: 'storage',
        },
      ]);
      await seedMovement(trx, {
        variantId: testCase.variantId,
        movementType: 'inbound_purchase',
        quantityDelta: 7,
        locationCode: W2_BIN,
        referenceType: 'receive_job',
        referenceId: crypto.randomUUID(),
        triggeredBy: 'receive_job',
      });
    });
    await rebuild(testCase.variantId);
    expect(await truthDetailFor(testCase.variantId)).toEqual({
      [BIN]: stock(5),
      [W2_BIN]: stock(7),
    });

    const unitBefore = await readUnit(testCase.unitId);
    const before = await movementIdsFor(testCase.variantId);
    const results: Array<{ action: Action; status: number; body: unknown }> = [];

    for (const action of ['discard', 'write_off', 'quarantine'] as const) {
      const taskId = await seedProblemTask(testCase);
      const res = await resolve(taskId, action);
      results.push({ action, status: res.status, body: res.body });
    }

    expect(
      results.map(({ action, status, body }) => ({
        action,
        status,
        error: (body as any)?.error,
      }))
    ).toEqual([
      { action: 'discard', status: 200, error: undefined },
      { action: 'write_off', status: 200, error: undefined },
      { action: 'quarantine', status: 200, error: undefined },
    ]);

    const created = await movementsSince(testCase.variantId, before);
    expect(
      created.filter(
        (movement) => movement.location_code === W2_BIN || movement.location_code === BIN
      )
    ).toEqual([]);

    const expected = {
      [BIN]: stock(5),
      [W2_BIN]: stock(7),
      [PROB]: stock(1),
    };
    expect(await truthDetailFor(testCase.variantId)).toEqual(expected);
    expect(await readUnit(testCase.unitId)).toEqual(unitBefore);
    await rebuild(testCase.variantId);
    expect(await truthDetailFor(testCase.variantId)).toEqual(expected);
  });
});

describe('GH-1202 quarantine destination validation', () => {
  it('PC1202-10A — a problem bin with no warehouse location fails closed before any write', async () => {
    const missingBin = 'GH1202-MISSING-PROB';
    const testCase = await seedCase('order_cancelled');
    const taskId = await seedProblemTask(testCase, missingBin);

    const missing = await withTenant(shop.shopId, (trx) =>
      trx('warehouse_locations')
        .where({ shop_id: shop.shopId, location_code: missingBin })
        .first('location_code')
    );
    expect(missing).toBeUndefined();

    await expectQuarantineRejected(testCase, taskId, missingBin);
  });

  it('PC1202-10B — a pickable problem bin fails closed so quarantine never becomes releasable stock', async () => {
    // pickableLocationCondition: (zone_type='pick' AND type='bin') OR type='warehouse'.
    const pickableBin = `GH1202-PICKPROB-${crypto.randomUUID().slice(0, 8)}`;
    await withTenant(shop.shopId, (trx) =>
      trx('warehouse_locations').insert({
        shop_id: shop.shopId,
        warehouse_id: shop.warehouseId,
        location_code: pickableBin,
        type: 'bin',
        parent_location_code: shop.rootCode,
        active: true,
        zone_type: 'pick',
      })
    );

    const testCase = await seedCase('order_cancelled');
    const taskId = await seedProblemTask(testCase, pickableBin);

    await expectQuarantineRejected(testCase, taskId, pickableBin);
  });
});

/**
 * Wait until a backend of this database is blocked by `blockerPid`. This is
 * the synchronization point: it proves the HTTP request reached a row-lock
 * wait held by the barrier transaction, rather than guessing with a sleep.
 */
async function waitForBlockedBy(blockerPid: number, timeoutMs = 15000): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await withTenant(shop.shopId, (trx) =>
      trx.raw(
        `SELECT pid
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND ? = ANY(pg_blocking_pids(pid))`,
        [blockerPid]
      )
    );

    if (result.rows.length > 0) return Number(result.rows[0].pid);
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }

  throw new Error(`[PC1202-11] resolve request never waited on barrier pid ${blockerPid}`);
}

describe('GH-1202 resolution serialization', () => {
  it('PC1202-11 — a resolution that waited behind a concurrent resolution re-checks the task and creates no recovery work', async () => {
    const testCase = await seedCase('order_cancelled');
    const taskId = await seedProblemTask(testCase);
    const before = await movementIdsFor(testCase.variantId);

    const barrier = await db.transaction();
    let pending: Promise<request.Response> | undefined;

    try {
      await setTenantContext(barrier, shop.shopId);
      const pidRow = await barrier.raw('SELECT pg_backend_pid() AS pid');
      const barrierPid = Number(pidRow.rows[0].pid);

      const locked = await barrier('problem_center_tasks')
        .where({ shop_id: shop.shopId, problem_task_id: taskId })
        .forUpdate()
        .first('status');
      expect(locked).toEqual({ status: 'open' });

      // Fire the real resolve request without awaiting it.
      pending = resolve(taskId, 're_stow').then((res) => res);

      const waitingPid = await waitForBlockedBy(barrierPid);
      expect(waitingPid).not.toBe(barrierPid);

      // A concurrent resolution wins first and commits.
      await barrier('problem_center_tasks')
        .where({ shop_id: shop.shopId, problem_task_id: taskId })
        .update({
          status: 'resolved',
          resolution_action: 're_stow',
          resolved_at: new Date(),
          updated_at: new Date(),
        });
      await barrier.commit();
    } finally {
      if (!barrier.isCompleted()) await barrier.rollback();
    }

    const res = await pending!;
    const recoveryTasks = await withTenant(shop.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: shop.shopId, source_task_id: taskId })
        .count<{ count: string }>('* as count')
        .first()
    );

    expect({
      status: res.status,
      body: res.body,
      recoveryStowTasks: Number(recoveryTasks?.count ?? 0),
    }).toEqual({
      status: 409,
      body: { error: 'Task already resolved' },
      recoveryStowTasks: 0,
    });

    expect(await movementsSince(testCase.variantId, before)).toEqual([]);
    expect(await truthDetailFor(testCase.variantId)).toEqual({ [BIN]: stock(5) });
  });
});
