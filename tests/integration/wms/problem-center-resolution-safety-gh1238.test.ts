/**
 * GH-1238 / PC-SAFE-01 — fail-closed Problem Center resolutions (RED).
 *
 * Ratified (issue #1238):
 *   W1 backend default-deny source × exception-type × action eligibility. An
 *      unknown/unsupported combination returns HTTP 409 with ZERO mutations.
 *      Stock provenance is never inferred from a single positive truth row;
 *      caller-supplied source/type never authorizes system-owned or
 *      outside-truth stock effects. No generic full-row quarantine rewrite.
 *   W4 the legacy direct Pick-exception resolution shortcut is retired:
 *      reporting stays operator-permitted, but closing an incident requires
 *      canonical resolution/recovery evidence — for every role.
 *
 * Sections (brief):
 *   A  source-specific resolution eligibility + terminal statuses
 *   B  inventory safety (unknown provenance, partial quarantine, cross-warehouse)
 *   C  legacy Pick-exception closure (operator AND owner/admin)
 *   D  generic incident creation (forged system types, invalid quantity,
 *      phantom credit)
 *   F  GREEN controls specific to these boundaries (operator reporting,
 *      terminal re-resolution). GH-1202 / GH-1222 suites stay the authority
 *      for their own contracts and are not duplicated here.
 *
 * Every rejected action is compared against a shop-wide before/after
 * snapshot of: problem_center_tasks, pick_exceptions,
 * inventory_reconciliation_conflicts, inventory_recount_lines, return_jobs,
 * inventory_truth, inventory_movements, stow_tasks, alerts,
 * barcode_print_jobs and the shop's prob_label_sequence.
 *
 * Real routes through createApp (auth, FT2, commercial capability, RBAC) on
 * the disposable integration database. Incidents are produced by their real
 * writers wherever one is callable without a worker:
 *   reconciliation → createFulfillmentReconciliationConflict
 *   count          → reviewLine(decision: 'escalate')
 *   returns        → processReturnLine (shortfall)
 *   pick           → POST /wms/batch/:batchId/exception (operator)
 * bin_over_capacity, order_cancelled and legacy generic pick rows use the
 * persisted shape their writers produce (stow.service.ts confirmStow 4d,
 * cancellationUnwind, httpCreateProblemTask) — noted per seed.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { createFulfillmentReconciliationConflict } from 'api-src/services/wms/fulfillmentReconciliationConflict.service';
import { FulfillmentPhysicalLocationConflict } from 'api-src/services/wms/fulfillmentPhysicalRemoval.service';
import { reviewLine } from 'api-src/services/wms/inventoryRecount.service';
import { processReturnLine } from 'api-src/services/returns/returnJobs.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

const BIN = 'GH1238-B';
const PROB = 'GH1238-PROB';
const W2_BIN = 'GH1238-W2-B';

type Role = 'owner' | 'admin' | 'operator';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (GH-1202 install pattern + GH-1222 members/tier) ────────────

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

async function provisionFt2Shop(): Promise<{ shopId: number; userId: number }> {
  const shopDomain = `gh1238-${crypto.randomUUID().slice(0, 8)}-${Date.now()}.myshopify.com`;
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
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt2?.phase).toBe('FT2');
  return { shopId, userId };
}

async function createMember(shopId: number, role: Role): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `gh1238-${role}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: role,
        role,
      })
      .returning('id');
    const userId = row.id as number;
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role, revoked_at: null });
    return userId;
  });
}

type Shop = {
  shopId: number;
  warehouseId: string;
  rootCode: string;
  users: Record<Role, number>;
};

let shop: Shop;

beforeAll(async () => {
  // Fail closed: this suite must only ever run against a disposable DB.
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const { shopId } = await provisionFt2Shop();

  // problem_center capability is Growth (commercial-policy capabilities.ts).
  await withTenant(shopId, (trx) =>
    transitionShopSubscription(
      {
        shopId,
        to: { tier: 'growth', status: 'active', billingProvider: 'shopify' },
        source: 'gh1238_problem_center_resolution_safety_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );

  const users = {
    owner: await createMember(shopId, 'owner'),
    admin: await createMember(shopId, 'admin'),
    operator: await createMember(shopId, 'operator'),
  };

  const { warehouseId, rootCode } = await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses')
      .where({ shop_id: shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    expect(warehouse?.warehouse_id).toBeTruthy();

    await trx('warehouse_locations').insert(
      [
        [BIN, 'storage'],
        [PROB, 'problem'],
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

    // Cross-warehouse discriminator: an inactive W2 with one storage bin
    // (GH-1202 PC1202-09 pattern — inactive so one-active rules never reject).
    const w2Id = crypto.randomUUID();
    const w2Root = `GH1238-W2-${crypto.randomUUID().slice(0, 8)}`;
    await trx('warehouses').insert({
      warehouse_id: w2Id,
      shop_id: shopId,
      name: `GH1238 W2 ${w2Id.slice(0, 8)}`,
      root_location_code: w2Root,
      is_default: false,
      active: false,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: shopId, warehouse_id: w2Id, location_code: w2Root,
        type: 'warehouse', parent_location_code: null, active: true, zone_type: null,
      },
      {
        shop_id: shopId, warehouse_id: w2Id, location_code: W2_BIN,
        type: 'bin', parent_location_code: w2Root, active: true, zone_type: 'storage',
      },
    ]);

    const updated = await trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .update({ problem_bin_location: PROB, updated_at: trx.fn.now() });
    expect(updated).toBe(1);

    return {
      warehouseId: String(warehouse.warehouse_id),
      rootCode: String(warehouse.root_location_code),
    };
  });

  shop = { shopId, warehouseId, rootCode, users };
});

afterAll(async () => {
  await db.destroy();
});

// ── auth / routes ────────────────────────────────────────────────────────────

const auth = (role: Role) => ({
  Authorization: `Bearer ${issueTestToken({
    userId: shop.users[role],
    shopId: shop.shopId,
    tier: 'growth',
    roles: [role],
  })}`,
});

type Action = 're_stow' | 'discard' | 'write_off' | 'quarantine' | 'find_replacement';
const ALL_ACTIONS: Action[] = ['write_off', 'discard', 'quarantine', 're_stow', 'find_replacement'];

function resolve(taskId: string, action: Action, role: Role = 'owner') {
  return request(app)
    .post(`/api/v1/wms/problem-center/${taskId}/resolve`)
    .set(auth(role))
    .send({ resolution_action: action, resolution_notes: `GH1238 ${action}` });
}

function legacyResolve(exceptionId: string, role: Role) {
  return request(app)
    .post(`/api/v1/wms/problem-center/pick-exceptions/${exceptionId}/resolve`)
    .set(auth(role))
    .send({ resolution_note: `GH1238 legacy ${role}` });
}

function genericCreate(role: Role, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/problem-center').set(auth(role)).send(body);
}

// ── zero-side-effect snapshot ────────────────────────────────────────────────

const stable = (rows: any[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Shop-scoped persistent state every rejected action must leave untouched. */
async function snapshot() {
  const shopId = shop.shopId;
  return withTenant(shopId, async (trx) => ({
    problemTasks: stable(await trx('problem_center_tasks').where({ shop_id: shopId }).select('*')),
    pickExceptions: stable(await trx('pick_exceptions').where({ shop_id: shopId }).select('*')),
    reconciliationConflicts: stable(
      await trx('inventory_reconciliation_conflicts').where({ shop_id: shopId }).select('*')
    ),
    recountLines: stable(await trx('inventory_recount_lines').where({ shop_id: shopId }).select('*')),
    returnJobs: stable(await trx('return_jobs').where({ shop_id: shopId }).select('*')),
    inventoryTruth: stable(await trx('inventory_truth').where({ shop_id: shopId }).select('*')),
    inventoryMovementIds: (
      await trx('inventory_movements').where({ shop_id: shopId }).pluck('lasyncro_inventory_movement_id')
    ).map(String).sort(),
    stowTasks: stable(await trx('stow_tasks').where({ shop_id: shopId }).select('*')),
    alerts: stable(await trx('alerts').where({ shop_id: shopId }).select('*')),
    barcodePrintJobs: stable(await trx('barcode_print_jobs').where({ shop_id: shopId }).select('*')),
    probLabelSequence: (
      await trx('shop_wms_settings').where({ shop_id: shopId }).first('prob_label_sequence')
    )?.prob_label_sequence,
  }));
}

/** 409 with no persistent change anywhere in the shop. */
async function expectRejectedWithoutSideEffects(
  act: () => Promise<request.Response>,
  expectedStatus: number | number[] = 409,
  watchVariantId?: string
): Promise<request.Response> {
  const before = await snapshot();
  const truthBefore = watchVariantId ? await truthFor(watchVariantId) : undefined;
  const res = await act();
  const after = await snapshot();
  const truthAfter = watchVariantId ? await truthFor(watchVariantId) : undefined;
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const changed = (Object.keys(before) as Array<keyof typeof before>).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
  // One readable verdict first (status, body, which state moved), then the
  // exact snapshot equality.
  expect({ status: res.status, body: res.body, changed, variantTruth: truthAfter }).toEqual({
    status: allowed.includes(res.status) ? res.status : `one of ${allowed.join('/')}`,
    body: res.body,
    changed: [],
    variantTruth: truthBefore,
  });
  expect(after).toEqual(before);
  return res;
}

// ── persisted-state seeds ────────────────────────────────────────────────────

async function seedVariant(label: string): Promise<{ variantId: string; productId: string }> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shop.shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shop.shopId,
      title: `GH1238 ${label} product`,
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shop.shopId,
      sku: `GH1238-${variantId.slice(0, 8)}`,
      title: `GH1238 ${label} variant`,
      unit_cost: '1.00',
      status: 'active',
    });
  });
  return { variantId, productId };
}

/** Ledger-backed healthy stock, projected by the canonical rebuild. */
async function seedStock(variantId: string, locationCode: string, quantity: number): Promise<void> {
  await withTenant(shop.shopId, async (trx) => {
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shop.shopId,
      movement_type: 'inbound_purchase',
      quantity_delta: quantity,
      location_code: locationCode,
      reference_type: 'receive_job',
      reference_id: crypto.randomUUID(),
      platform: 'wms',
      occurred_at: new Date(),
      device_event_id: crypto.randomUUID(),
      operator_id: shop.users.owner,
      triggered_by: 'receive_job',
    });
  });
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
  return Object.fromEntries(rows.map((r: any) => [String(r.location_code), Number(r.on_hand_quantity)]));
}

async function seedOrderLine(
  trx: any,
  v: { variantId: string; productId: string },
  quantity = 1
): Promise<{ orderId: string; lineId: string }> {
  const orderId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
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
  await trx('order_line_items').insert({
    lasyncro_line_item_id: lineId,
    lasyncro_order_id: orderId,
    lasyncro_product_id: v.productId,
    lasyncro_variant_id: v.variantId,
    title: 'GH1238 line',
    quantity,
    unit_price: '10.00',
    line_total: '10.00',
    created_at: now,
    updated_at: now,
  });
  return { orderId, lineId };
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

async function findTask(where: Record<string, unknown>): Promise<string> {
  const row = await withTenant(shop.shopId, (trx) =>
    trx('problem_center_tasks').where({ shop_id: shop.shopId, ...where }).first('problem_task_id')
  );
  expect(row?.problem_task_id).toBeTruthy();
  return String(row.problem_task_id);
}

// ── source families (section A) ──────────────────────────────────────────────

type Family =
  | 'reconciliation/fulfillment_location_not_found'
  | 'reconciliation/fulfillment_location_ambiguous'
  | 'count/recount_variance'
  | 'stow/bin_over_capacity'
  | 'returns/return_shortfall';

const FAMILIES: Family[] = [
  'reconciliation/fulfillment_location_not_found',
  'reconciliation/fulfillment_location_ambiguous',
  'count/recount_variance',
  'stow/bin_over_capacity',
  'returns/return_shortfall',
];

/**
 * Every family's variant also owns exactly ONE healthy, unrelated positive
 * truth row (B = 5), so existing single-location guards never mask a missing
 * eligibility decision.
 */
async function seedFamily(family: Family): Promise<{ taskId: string; variantId: string }> {
  const v = await seedVariant(family);
  await seedStock(v.variantId, BIN, 5);

  if (family.startsWith('reconciliation/')) {
    const code = family.endsWith('ambiguous') ? 'LOCATION_AMBIGUOUS' : 'LOCATION_NOT_FOUND';
    const conflictId = await withTenant(shop.shopId, async (trx) => {
      const { orderId, lineId } = await seedOrderLine(trx, v);
      const [event] = await trx('domain_events')
        .insert({
          shop_id: shop.shopId,
          event_type: 'orders/fulfilled',
          event_payload: { order_id: orderId, status: 'fulfilled', line_items: [{ id: lineId, quantity: 1 }] },
          event_time: new Date(),
          event_version: 1,
          external_event_id: `test:gh1238:${crypto.randomUUID()}`,
        })
        .returning(['id']);
      const created = await createFulfillmentReconciliationConflict(trx, {
        shopId: shop.shopId,
        sourceDomainEventId: Number(event.id),
        lasyncroOrderId: orderId,
        occurredAt: new Date(),
        conflict: new FulfillmentPhysicalLocationConflict({
          code,
          lasyncroLineItemId: lineId,
          lasyncroVariantId: v.variantId,
          quantity: 1,
          candidateLocations:
            code === 'LOCATION_AMBIGUOUS'
              ? [{ location_code: BIN, on_hand_quantity: '5' }, { location_code: W2_BIN, on_hand_quantity: '1' }]
              : [],
        }),
      });
      return created.conflictId;
    });
    const taskId = await findTask({ source: 'reconciliation', source_exception_id: conflictId });
    return { taskId, variantId: v.variantId };
  }

  if (family === 'count/recount_variance') {
    const lineId = await withTenant(shop.shopId, async (trx) => {
      const [task] = await trx('inventory_recount_tasks')
        .insert({
          shop_id: shop.shopId,
          warehouse_id: shop.warehouseId,
          label: `GH1238-RC-${crypto.randomBytes(3).toString('hex')}`,
          scope: 'location',
          status: 'manual_review',
        })
        .returning('recount_task_id');
      const recountTaskId = String(task.recount_task_id ?? task);
      const [line] = await trx('inventory_recount_lines')
        .insert({
          recount_task_id: recountTaskId,
          shop_id: shop.shopId,
          lasyncro_variant_id: v.variantId,
          location_code: BIN,
          expected_quantity: 5,
          counted_quantity: 3,
          variance: -2,
          count_method: 'bin_quantity',
          counted_by: shop.users.operator,
          window_from: new Date(),
        })
        .returning('recount_line_id');
      const recountLineId = String(line.recount_line_id ?? line);
      // Real writer: owner escalates the variance to Problem Center.
      await reviewLine(trx, {
        shopId: shop.shopId,
        recountTaskId,
        recountLineId,
        decision: 'escalate',
        reviewedBy: shop.users.owner,
      });
      return recountLineId;
    });
    const taskId = await findTask({ source: 'count', source_exception_id: lineId });
    return { taskId, variantId: v.variantId };
  }

  if (family === 'stow/bin_over_capacity') {
    // Persisted shape of stow.service.ts confirmStow step 4d: source_exception_id
    // is the stow task, quantity is the bin's whole stowed count, and
    // problem_bin_location is the over-capacity storage bin itself.
    const taskId = await withTenant(shop.shopId, async (trx) => {
      const [stow] = await trx('stow_tasks')
        .insert({
          shop_id: shop.shopId,
          lasyncro_variant_id: v.variantId,
          quantity: 5,
          location_code: BIN,
          status: 'completed',
          trigger: 'inbound_stock',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('stow_task_id');
      const probLabel = await nextProbLabel(trx);
      const [row] = await trx('problem_center_tasks')
        .insert({
          shop_id: shop.shopId,
          status: 'open',
          source: 'stow',
          source_exception_id: String(stow.stow_task_id ?? stow),
          lasyncro_variant_id: v.variantId,
          quantity: 5,
          exception_type: 'bin_over_capacity',
          problem_bin_location: BIN,
          notes: `${probLabel} — Bin ${BIN} has 5 units, max is 4. Audit required.`,
        })
        .returning('problem_task_id');
      return String(row.problem_task_id);
    });
    return { taskId, variantId: v.variantId };
  }

  // returns/return_shortfall — real writer processReturnLine: 2 refunded,
  // 1 received damaged → shortfall task for the unit that never arrived.
  const { returnJobId, refundLineItemId } = await withTenant(shop.shopId, async (trx) => {
    const { orderId } = await seedOrderLine(trx, v, 2);
    const now = new Date();
    const [job] = await trx('return_jobs')
      .insert({
        shop_id: shop.shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: null,
        lasyncro_order_id: orderId,
        status: 'in_progress',
        claimed_by: shop.users.operator,
        claimed_at: now,
        source: 'scan_intake',
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');
    const revenueUnitId = crypto.randomUUID();
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: v.productId,
      lasyncro_variant_id: v.variantId,
      title: 'GH1238 returned line',
      quantity: 2,
      unit_price: 10,
      line_total: 20,
      estimated_unit_cost: 1,
    });
    const refundLineItemId = crypto.randomUUID();
    await trx('refund_execution_line_items').insert({
      lasyncro_refund_line_item_id: refundLineItemId,
      lasyncro_refund_execution_id: null,
      lasyncro_revenue_unit_id: revenueUnitId,
      return_job_id: String(job.return_job_id ?? job),
      refunded_quantity: 2,
      item_condition: 'damaged',
      quantity_received: 0,
      condition_notes: null,
      processed_by: shop.users.operator,
      processed_at: now,
      source: 'scan_intake_manual',
      created_at: now,
    });
    return { returnJobId: String(job.return_job_id ?? job), refundLineItemId };
  });
  await processReturnLine({
    shopId: shop.shopId,
    returnJobId,
    refundLineItemId,
    itemCondition: 'damaged',
    quantityReceived: 1,
    operatorId: shop.users.operator,
  } as any);
  const taskId = await findTask({
    source: 'returns',
    exception_type: 'return_shortfall',
    source_exception_id: returnJobId,
  });
  return { taskId, variantId: v.variantId };
}

/** Persisted shape of cancellationUnwind.raiseProblemTask (GH-1202 seed). */
async function seedOrderCancelledTask(status: string): Promise<string> {
  const v = await seedVariant(`order_cancelled ${status}`);
  return withTenant(shop.shopId, async (trx) => {
    const { orderId } = await seedOrderLine(trx, v);
    const notes = await nextProbLabel(trx);
    const terminal = status !== 'open';
    const [row] = await trx('problem_center_tasks')
      .insert({
        shop_id: shop.shopId,
        status,
        source: 'pick',
        source_exception_id: orderId,
        lasyncro_variant_id: v.variantId,
        quantity: 1,
        exception_type: 'order_cancelled',
        problem_bin_location: PROB,
        notes,
        resolution_action: terminal ? 'discard' : null,
        resolved_by: terminal ? shop.users.owner : null,
        resolved_at: terminal ? new Date() : null,
      })
      .returning('problem_task_id');
    return String(row.problem_task_id);
  });
}

/**
 * Persisted shape of a generic (httpCreateProblemTask) pick incident: no
 * source exception, no allocation, no location evidence — stock provenance
 * is unknown.
 */
async function seedUnknownProvenanceTask(variantId: string, exceptionType = 'item_missing'): Promise<string> {
  return withTenant(shop.shopId, async (trx) => {
    const notes = await nextProbLabel(trx);
    const [row] = await trx('problem_center_tasks')
      .insert({
        shop_id: shop.shopId,
        status: 'open',
        source: 'pick',
        source_exception_id: null,
        lasyncro_variant_id: variantId,
        quantity: 1,
        exception_type: exceptionType,
        problem_bin_location: PROB,
        notes,
      })
      .returning('problem_task_id');
    return String(row.problem_task_id);
  });
}

/** An active pick batch holding one order line for the variant. */
async function seedPickContext(v: { variantId: string; productId: string }) {
  return withTenant(shop.shopId, async (trx) => {
    const { orderId, lineId } = await seedOrderLine(trx, v);
    const batchId = crypto.randomUUID();
    const now = new Date();
    await trx('pick_batches').insert({
      pick_batch_id: batchId,
      shop_id: shop.shopId,
      status: 'picking',
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
      released_at: now,
      picked_by: shop.users.operator,
      pick_last_activity_at: now,
    });
    await trx('pick_batch_orders').insert({ pick_batch_id: batchId, lasyncro_order_id: orderId, shop_id: shop.shopId });
    return { batchId, orderId, lineId };
  });
}

/** Real operator report route — GH-1049 server-owned incident + alert. */
async function reportPickException(
  v: { variantId: string; productId: string },
  exceptionType: 'item_missing' | 'product_defect'
): Promise<{ exceptionId: string; taskId: string; batchId: string }> {
  const { batchId, lineId } = await seedPickContext(v);
  const res = await request(app)
    .post(`/api/v1/wms/batch/${batchId}/exception`)
    .set(auth('operator'))
    .send({
      lasyncro_line_item_id: lineId,
      lasyncro_variant_id: v.variantId,
      exception_type: exceptionType,
      stage: 'pick',
      quantity_required: 1,
      quantity_found: 0,
    });
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
  const exceptionId = String(res.body.pick_exception_id);
  const taskId = await findTask({ source_pick_exception_id: exceptionId });
  return { exceptionId, taskId, batchId };
}

// ── fixture proof ────────────────────────────────────────────────────────────

describe('GH-1238 fixture proof', () => {
  it('PC1238-F — every source family is produced open, for a variant with exactly one healthy row (B=5)', async () => {
    const observed: Array<Record<string, unknown>> = [];
    for (const family of FAMILIES) {
      const { taskId, variantId } = await seedFamily(family);
      const task = await withTenant(shop.shopId, (trx) =>
        trx('problem_center_tasks')
          .where({ shop_id: shop.shopId, problem_task_id: taskId })
          .first('status', 'source', 'exception_type')
      );
      observed.push({ family, ...task, truth: await truthFor(variantId) });
    }
    expect(observed).toEqual(
      FAMILIES.map((family) => {
        const [source, exception_type] = family.split('/');
        return { family, status: 'open', source, exception_type, truth: { [BIN]: 5 } };
      })
    );
  });
});

// ── A: source-specific eligibility ───────────────────────────────────────────

describe('GH-1238 A — unsupported source × type × action is rejected 409 with zero side effects', () => {
  const cases = FAMILIES.flatMap((family) => ALL_ACTIONS.map((action) => [family, action] as const));

  it.each(cases)('PC1238-A EXPECTED RED: %s → %s', async (family, action) => {
    const { taskId, variantId } = await seedFamily(family);
    await expectRejectedWithoutSideEffects(() => resolve(taskId, action), 409, variantId);
  });
});

describe('GH-1238 A — terminal tasks cannot be acted on again', () => {
  it('PC1238-T1 GREEN CONTROL: a task resolved through the route rejects a second resolution (409, zero side effects)', async () => {
    const taskId = await seedOrderCancelledTask('open');
    const first = await resolve(taskId, 'discard');
    expect({ status: first.status, body: first.body }).toMatchObject({ status: 200, body: { status: 'resolved' } });

    await expectRejectedWithoutSideEffects(() => resolve(taskId, 're_stow'));
  });

  it.each(['resolved', 'discarded', 'returned_to_supplier'])(
    'PC1238-T2 %s: a terminal task rejects re_stow (409, no recovery stow task, zero side effects)',
    async (status) => {
      const taskId = await seedOrderCancelledTask(status);
      await expectRejectedWithoutSideEffects(() => resolve(taskId, 're_stow'));
    }
  );
});

// ── B: inventory safety ──────────────────────────────────────────────────────

describe('GH-1238 B — unknown provenance never debits an unrelated healthy row', () => {
  it.each(['write_off', 'discard'] as const)(
    'PC1238-B1 EXPECTED RED: %s of an unknown-provenance incident with ONE healthy W1 row (B=5) → 409, B untouched',
    async (action) => {
      const v = await seedVariant(`B1 ${action}`);
      await seedStock(v.variantId, BIN, 5);
      const taskId = await seedUnknownProvenanceTask(v.variantId);

      await expectRejectedWithoutSideEffects(() => resolve(taskId, action), 409, v.variantId);
      expect(await truthFor(v.variantId)).toEqual({ [BIN]: 5 });
    }
  );

  it.each(['write_off', 'discard'] as const)(
    'PC1238-B2 EXPECTED RED (cross-warehouse): %s of a W1 incident whose only positive row is in W2 → 409, W2 untouched',
    async (action) => {
      const v = await seedVariant(`B2 ${action}`);
      await seedStock(v.variantId, W2_BIN, 7);
      const taskId = await seedUnknownProvenanceTask(v.variantId);

      await expectRejectedWithoutSideEffects(() => resolve(taskId, action), 409, v.variantId);
      expect(await truthFor(v.variantId)).toEqual({ [W2_BIN]: 7 });
    }
  );
});

describe('GH-1238 B — ordinary quarantine never relocates a whole projection row', () => {
  it('PC1238-B3 EXPECTED RED: quarantine of a 1-unit operator-reported product_defect with B=5 refuses the whole-row move', async () => {
    const v = await seedVariant('B3 partial quarantine');
    await seedStock(v.variantId, BIN, 5);
    const { taskId } = await reportPickException(v, 'product_defect');

    await expectRejectedWithoutSideEffects(() => resolve(taskId, 'quarantine'), 409, v.variantId);
    expect(await truthFor(v.variantId)).toEqual({ [BIN]: 5 });
  });

  it('PC1238-B4 EXPECTED RED (cross-warehouse): quarantine of a W1 incident never moves the W2 row into the W1 problem bin', async () => {
    const v = await seedVariant('B4 cross-warehouse quarantine');
    await seedStock(v.variantId, W2_BIN, 7);
    const taskId = await seedUnknownProvenanceTask(v.variantId, 'product_defect');

    await expectRejectedWithoutSideEffects(() => resolve(taskId, 'quarantine'), 409, v.variantId);
    expect(await truthFor(v.variantId)).toEqual({ [W2_BIN]: 7 });
  });
});

// ── C: legacy Pick-exception closure ─────────────────────────────────────────

describe('GH-1238 C — legacy Pick-exception resolution cannot close an incident without recovery evidence', () => {
  it('PC1238-C0 GREEN CONTROL: operator reporting stays possible (201, open exception, open paired task, active alert)', async () => {
    const v = await seedVariant('C0 report');
    const { exceptionId, taskId, batchId } = await reportPickException(v, 'item_missing');

    const state = await withTenant(shop.shopId, async (trx) => ({
      exception: await trx('pick_exceptions')
        .where({ shop_id: shop.shopId, pick_exception_id: exceptionId }).first('resolved'),
      task: await trx('problem_center_tasks')
        .where({ shop_id: shop.shopId, problem_task_id: taskId }).first('status', 'source', 'exception_type'),
      activeAlerts: Number(
        (await trx('alerts')
          .where({ shop_id: shop.shopId, entity_id: batchId, is_active: true })
          .count<{ count: string }>('* as count').first())?.count ?? 0
      ),
    }));
    expect(state).toEqual({
      exception: { resolved: false },
      task: { status: 'open', source: 'pick', exception_type: 'item_missing' },
      activeAlerts: 1,
    });
  });

  it.each(['operator', 'owner', 'admin'] as const)(
    'PC1238-C1 EXPECTED RED: %s → POST /problem-center/pick-exceptions/:id/resolve leaves exception, paired task and alert unchanged',
    async (role) => {
      const v = await seedVariant(`C1 ${role}`);
      const { exceptionId } = await reportPickException(v, 'item_missing');

      await expectRejectedWithoutSideEffects(
        () => legacyResolve(exceptionId, role),
        [403, 404, 405, 409, 410]
      );
    }
  );
});

// ── D: generic incident creation ─────────────────────────────────────────────

describe('GH-1238 D — the client-facing generic endpoint cannot forge system-owned incidents', () => {
  const forged = [
    ['operator', 'returns', 'repackaging_required'],
    ['owner', 'returns', 'repackaging_required'],
    ['operator', 'pick', 'order_cancelled'],
    ['owner', 'pick', 'order_cancelled'],
  ] as const;

  it.each(forged)(
    'PC1238-D1 EXPECTED RED: %s creates %s/%s → rejected, no task, no PROB label job, no sequence bump',
    async (role, source, exceptionType) => {
      const v = await seedVariant(`D1 ${source}/${exceptionType}`);
      await expectRejectedWithoutSideEffects(
        () => genericCreate(role, {
          lasyncro_variant_id: v.variantId,
          quantity: 1,
          exception_type: exceptionType,
          source,
        }),
        [400, 403, 409, 422]
      );
    }
  );

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['non-numeric', 'abc'],
  ] as const)(
    'PC1238-D2 %s quantity is rejected 400 with zero side effects',
    async (_label, quantity) => {
      const v = await seedVariant(`D2 ${_label}`);
      await expectRejectedWithoutSideEffects(
        () => genericCreate('operator', {
          lasyncro_variant_id: v.variantId,
          quantity,
          exception_type: 'item_missing',
          source: 'pick',
        }),
        400
      );
    }
  );

  it('PC1238-D3 EXPECTED RED: a forged returns/repackaging_required task cannot enable a phantom quarantine credit', async () => {
    const v = await seedVariant('D3 phantom credit');
    const before = await movementCountFor(v.variantId);
    expect(await truthFor(v.variantId)).toEqual({});

    const created = await genericCreate('operator', {
      lasyncro_variant_id: v.variantId,
      quantity: 3,
      exception_type: 'repackaging_required',
      source: 'returns',
    });
    const forgedTaskId: string | undefined = created.body?.problem_task_id;
    const credit = forgedTaskId ? await resolve(forgedTaskId, 'quarantine') : null;

    expect({
      create: created.status,
      credit: credit?.status ?? null,
      truth: await truthFor(v.variantId),
      movements: await movementCountFor(v.variantId),
    }).toEqual({
      create: expect.any(Number),
      credit: null,
      truth: {},
      movements: before,
    });
  });
});

async function movementCountFor(variantId: string): Promise<number> {
  const row = await withTenant(shop.shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .count<{ count: string }>('* as count')
      .first()
  );
  return Number(row?.count ?? 0);
}

// ── Correction B: residual reservation safety (GH-1238 correction) ──────────
//
// An allocation-backed Pick incident leaves its missing units RESERVED at the
// allocation location (recordShortPickPhysicalOutcome removes and releases
// only the units found). No resolution path settles that residual reservation
// yet (GH-1240), so an ordinary Pick Write Off / Discard must be refused:
// otherwise it debits on_hand and AVAILABLE — i.e. healthy unreserved units at
// the same bin — while the stale reservation stays behind.
//
// Fixture through the real routes: owner releases a batch (allocation of the
// full line at PICK_BIN), operator claims it and reports the incident with
// the allocation id. Each case owns its variant, order and batch.

const PICK_BIN = 'GH1238-PICK';

async function ensurePickBin(): Promise<void> {
  await withTenant(shop.shopId, async (trx) => {
    const existing = await trx('warehouse_locations')
      .where({ shop_id: shop.shopId, location_code: PICK_BIN })
      .first('location_code');
    if (existing) return;
    await trx('warehouse_locations').insert({
      shop_id: shop.shopId,
      warehouse_id: shop.warehouseId,
      location_code: PICK_BIN,
      type: 'bin',
      parent_location_code: shop.rootCode,
      active: true,
      zone_type: 'pick',
    });
  });
}

/** Release-eligible order (pack-gate-1086 seedOrder shape). */
async function seedReleasableOrder(
  v: { variantId: string; productId: string },
  quantity: number
): Promise<{ orderId: string; lineId: string }> {
  const orderId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shop.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shop.shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '50.00',
      subtotal_price: '50.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shop.shopId,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: v.productId,
      lasyncro_variant_id: v.variantId,
      sku: null,
      title: 'GH1238 allocation line',
      quantity,
      unit_price: '10.00',
      line_total: (10 * quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded; same
    // transaction-local guard pack-gate-1086 uses for this fixture.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });
  });
  return { orderId, lineId };
}

type ResidualCase = {
  exceptionType: 'item_missing' | 'short_pick' | 'product_defect' | 'packaging_defect';
  action: 'write_off' | 'discard';
  quantityFound: number;
  /** Units of healthy, unreserved stock at PICK_BIN beyond the allocation. */
  extraAtPickBin: number;
};

const ALLOCATION_QTY = 5;

async function seedResidualIncident(c: ResidualCase) {
  await ensurePickBin();
  const v = await seedVariant(`residual ${c.exceptionType} ${c.action}`);
  await seedStock(v.variantId, PICK_BIN, ALLOCATION_QTY + c.extraAtPickBin);
  await seedStock(v.variantId, W2_BIN, 7);
  const { orderId, lineId } = await seedReleasableOrder(v, ALLOCATION_QTY);

  const release = await request(app)
    .post('/api/v1/wms/batch/release')
    .set(auth('owner'))
    .send({ priority_order_ids: [orderId], exclusive: true });
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { order_count: 1 } });
  const batchId = String(release.body.pick_batch_id);

  const claim = await request(app).post(`/api/v1/wms/batch/${batchId}/claim`).set(auth('operator')).send({});
  expect(claim.status).toBe(200);

  const allocation = await withTenant(shop.shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: shop.shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId })
      .first('allocation_id', 'location_code', 'quantity')
  );
  expect(allocation).toMatchObject({ location_code: PICK_BIN, quantity: ALLOCATION_QTY });

  const report = await request(app)
    .post(`/api/v1/wms/batch/${batchId}/exception`)
    .set(auth('operator'))
    .send({
      lasyncro_line_item_id: lineId,
      lasyncro_variant_id: v.variantId,
      reservation_allocation_id: allocation.allocation_id,
      exception_type: c.exceptionType,
      stage: 'pick',
      quantity_required: ALLOCATION_QTY,
      quantity_found: c.quantityFound,
      device_event_id: crypto.randomUUID(),
    });
  expect({ status: report.status, body: report.body }).toMatchObject({ status: 201 });
  const exceptionId = String(report.body.pick_exception_id);
  const taskId = await findTask({ source_pick_exception_id: exceptionId });

  return { variantId: v.variantId, taskId, exceptionId };
}

async function pickBinCell(variantId: string) {
  const row = await withTenant(shop.shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shop.shopId, lasyncro_variant_id: variantId, location_code: PICK_BIN })
      .first('on_hand_quantity', 'available_quantity', 'reserved_quantity')
  );
  return {
    onHand: Number(row?.on_hand_quantity),
    available: Number(row?.available_quantity),
    reserved: Number(row?.reserved_quantity),
  };
}

describe('GH-1238 Correction B — ordinary Pick disposition never acts on unsettled reserved stock', () => {
  it('PC1238-R0 fixture proof: short_pick 3 of 5 leaves 2 reserved beside 3 healthy unreserved units at the same bin', async () => {
    const { variantId, taskId } = await seedResidualIncident({
      exceptionType: 'short_pick', action: 'write_off', quantityFound: 3, extraAtPickBin: 3,
    });
    expect(await pickBinCell(variantId)).toEqual({ onHand: 5, available: 3, reserved: 2 });
    expect(await truthFor(variantId)).toEqual({ [PICK_BIN]: 5, [W2_BIN]: 7 });
    const task = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId, problem_task_id: taskId })
        .first('status', 'quantity', 'exception_type'));
    expect(task).toEqual({ status: 'open', quantity: 2, exception_type: 'short_pick' });
  });

  it.each([
    ['short_pick', 'write_off', 3],
    ['item_missing', 'write_off', 0],
    ['product_defect', 'discard', 0],
    ['packaging_defect', 'discard', 0],
  ] as const)(
    'PC1238-R1 %s → %s with healthy unreserved stock at the same bin and W2 stock: 409 RESOLUTION_NOT_ELIGIBLE, zero side effects',
    async (exceptionType, action, quantityFound) => {
      const { variantId, taskId } = await seedResidualIncident({
        exceptionType, action, quantityFound, extraAtPickBin: 3,
      });
      const cellBefore = await pickBinCell(variantId);

      const res = await expectRejectedWithoutSideEffects(() => resolve(taskId, action), 409, variantId);

      expect(res.body?.code).toBe('RESOLUTION_NOT_ELIGIBLE');
      expect(await pickBinCell(variantId)).toEqual(cellBefore);
    }
  );

  it('PC1238-R2 short_pick → write_off with NO spare stock (available 0): 409 RESOLUTION_NOT_ELIGIBLE, zero side effects', async () => {
    const { variantId, taskId } = await seedResidualIncident({
      exceptionType: 'short_pick', action: 'write_off', quantityFound: 3, extraAtPickBin: 0,
    });
    expect(await pickBinCell(variantId)).toEqual({ onHand: 2, available: 0, reserved: 2 });

    const res = await expectRejectedWithoutSideEffects(() => resolve(taskId, 'write_off'), 409, variantId);
    expect(res.body?.code).toBe('RESOLUTION_NOT_ELIGIBLE');
  });

  it('PC1238-R3 GREEN CONTROL: short_pick → discard is not a short-pick disposition (409 RESOLUTION_NOT_ELIGIBLE, zero side effects)', async () => {
    const { variantId, taskId } = await seedResidualIncident({
      exceptionType: 'short_pick', action: 'discard', quantityFound: 3, extraAtPickBin: 3,
    });
    const res = await expectRejectedWithoutSideEffects(() => resolve(taskId, 'discard'), 409, variantId);
    expect(res.body?.code).toBe('RESOLUTION_NOT_ELIGIBLE');
  });
});
