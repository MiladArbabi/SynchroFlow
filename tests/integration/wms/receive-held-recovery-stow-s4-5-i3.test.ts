// S8-C5 / S4-5 I3 — recovery Stow of held Receive units
// (contract SF-RECEIVE-S8C5-S4-CONTRACT-026 + Addenda A1–A3; 0227 certified in I1).
const mockSyncStowedQuantityToShopify = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('api-src/services/wms/shopifyInventorySync.service', () => ({
  syncStowedQuantityToShopify: (...args: unknown[]) => mockSyncStowedQuantityToShopify(...args),
}));

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { inspectReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { recoveryCreditIdentity } from 'api-src/services/wms/receiveHeldRecoveryStow.service';
import { issueTestToken } from '../../unit/helpers/auth';

/**
 * Fixtures follow the I2 suite: held capture, labels, custody and close through
 * the real routes; re_stow through POST /wms/problem-center/:taskId/resolve;
 * then PATCH /location → POST /claim → POST /confirm on the recovery Stow.
 *
 *   S1  confirm: one recovered event, one +1 inbound_purchase (reference_type
 *       inventory_unit = the unit UUID, triggered_by receive_recovery) at the
 *       destination, truth +1 there, unit stowed, Stow completed, task resolved;
 *       nothing at the custody bin; PO, Receive and supplier rows unchanged; the
 *       receipt and the recovery are distinguishable; projection rebuild
 *       reproduces truth; snapshot job enqueued; no Shopify push; no inbound
 *       alert wording; the Stow list exposes the held LSU before confirmation.
 *   O1  positive control: an ordinary inbound Stow of the same Receive still
 *       credits by transfer and still pushes to Shopify.
 *   V1  destination refused at assignment: custody bin, problem-zone bin,
 *       configured problem bin, inactive bin, non-bin; storage/pick bins allowed.
 *   V2  destination revalidated at confirmation: zero side effects.
 *   V3  LSU required and exact; a repeat confirmation is refused; one credit.
 *   V4  pre-existing credit identity → refused, every write rolled back.
 *   C1  two confirmations released together from one Stow lock → one credit.
 *   C2  claim racing confirmation → no deadlock, confirmation wins alone.
 *   C3  discard racing confirmation (unit lock) → no deadlock, one outcome.
 *   SH1 recovery is refused at ROOT and never pushes to Shopify; a later
 *       ordinary Stow to the same bin pushes only its own +1 (I4 boundary).
 *   CAP1 the recovered unit counts toward bin capacity: at the limit no audit
 *       task; over it one bin_over_capacity task, the recovery kept.
 *   T1  another shop cannot assign, claim or confirm; zero side effects.
 *
 * Commits held units, custody, recovery Stows, outcome events and recovery
 * credits: runs only in the isolated held-unit CI step.
 */

const app = createApp();
jest.setTimeout(300000);

const DELIVERY_DATE = '2026-10-30';
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (I2 pattern) ──────────────────────────────────────────────

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id'));
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
      [`shopify-install+${shopDomain}@lasyncro.internal`]));
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

interface Shop { shopId: number; userId: number; token: string; problemBin: string; bin: (zone?: string | null, active?: boolean, type?: string) => Promise<string> }

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs45i3-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      sync_status: 'COMPLETED', updated_at: new Date(),
    }));
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const token = issueTestToken({ userId, shopId, tier: 'scale' });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);

  const bin = async (zone: string | null = 'storage', active = true, type = 'bin') => {
    const code = `S45I3-${(zone ?? 'none').toUpperCase()}-${shopId}-${crypto.randomBytes(3).toString('hex')}`;
    await withTenant(shopId, async (trx) => {
      const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
        .first('warehouse_id', 'root_location_code');
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code: code,
        parent_location_code: warehouse.root_location_code, active, type, zone_type: zone,
      });
    });
    return code;
  };
  const problemBin = await bin('problem');
  return { shopId, userId, token, problemBin, bin };
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S45I3${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/S45I3${nonce}`,
        title: `S4-5 I3 recovery fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-5-I3-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/S45I3${nonce}`, unitCost: { amount: '4.00' } },
        } }] },
      },
    }]));
  const mapping = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_variant_id: externalVariantId })
      .first('lasyncro_variant_id'));
  expect(mapping?.lasyncro_variant_id).toBeTruthy();
  return mapping!.lasyncro_variant_id as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function addOperator(shop: Shop): Promise<string> {
  const userId = await withTenant(shop.shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.shopId,
        email: `receive-s45i3-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'operator',
        role: 'operator',
      })
      .returning('id');
    await trx('shop_memberships').insert({ shop_id: shop.shopId, user_id: row.id, role: 'operator', revoked_at: null });
    return row.id as number;
  });
  return issueTestToken({ userId, shopId: shop.shopId, tier: 'scale', roles: ['operator'] });
}

interface Job {
  shop: Shop; poId: string; supplierId: string; receiveJobId: string; lineId: string; variantId: string;
  acceptedIds: string[]; heldIds: string[]; taskIds: string[];
}

/** One accepted unit plus `held` recoverable (defect) units, labelled, placed and closed. */
async function heldJob(shop: Shop, held: number): Promise<Job> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const accepted = 1;
  const variantId = await seedMappedVariant(shop.shopId);
  const { poId, supplierId } = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-5 I3 supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-5 I3 held line', quantity_ordered: accepted + held, unit_cost_cents: 400,
    });
    return { poId: po.id as string, supplierId: String(supplier.id) };
  });
  const created = await request(app).post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
    .set(auth(shop.token)).send({ assigned_operator_id: shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  expect((await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  const line = await withTenant(shop.shopId, (trx) =>
    trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_id: receiveJobId }).first('receive_job_line_id'));
  const lineId = line.receive_job_line_id as string;
  expect((await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
    .set(auth(shop.token)).send({ quantity_confirmed: accepted, device_event_id: crypto.randomUUID() })).status).toBe(200);

  await withTenant(shop.shopId, async (trx) => {
    await trx('receive_exceptions').insert({
      shop_id: shop.shopId, receive_job_id: receiveJobId, receive_job_line_id: lineId,
      lasyncro_variant_id: variantId, exception_type: 'defect', quantity_affected: held,
      accounting_role: null, counts_toward_shortfall: false, disposition: 'recoverable_held',
      notes: 'cracked casing', raised_by: shop.userId, raised_at: new Date(),
    });
    await inspectReceiveJobLine(trx, {
      shopId: shop.shopId, receiveJobId, lasyncroVariantId: variantId, receiveJobLineId: lineId,
      quantityAccepted: accepted, quantityRejected: 0, quantityMissing: 0, quantityDeferred: 0,
      quantityHeldRecoverable: held, deviceEventId: crypto.randomUUID(),
      requireExplicitDisposition: true, inspectedBy: shop.userId,
    });
  });
  const units = await withTenant(shop.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: shop.shopId, receive_job_line_id: lineId })
      .orderBy('receive_sequence').select('lasyncro_unit_id', 'status'));
  const heldIds = units.filter((u: any) => u.status === 'held').map((u: any) => u.lasyncro_unit_id as string);
  const acceptedIds = units.filter((u: any) => u.status !== 'held').map((u: any) => u.lasyncro_unit_id as string);
  expect(heldIds).toHaveLength(held);

  expect((await request(app).post(`/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  for (const unitId of heldIds) {
    const placed = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/held-units/${unitId}/custody`)
      .set(auth(shop.token)).send({ location_code: shop.problemBin, device_event_id: crypto.randomUUID() });
    expect(placed.status).toBe(201);
  }
  const closed = await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/close`)
    .set(auth(shop.token)).send({ actual_delivery_date: DELIVERY_DATE });
  expect(closed.status).toBe(200);

  const taskIds: string[] = [];
  for (const unitId of heldIds) {
    const t = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId, source: 'receive', lasyncro_unit_id: unitId })
        .first('problem_task_id'));
    taskIds.push(t.problem_task_id as string);
  }
  return { shop, poId, supplierId, receiveJobId, lineId, variantId, acceptedIds, heldIds, taskIds };
}

// ── recovery Stow helpers ──────────────────────────────────────────────────

async function reStow(j: Job, i: number): Promise<string> {
  const res = await request(app).post(`/api/v1/wms/problem-center/${j.taskIds[i]}/resolve`)
    .set(auth(j.shop.token)).send({ resolution_action: 're_stow' });
  expect(res.status).toBe(200);
  return res.body.stow_task_id as string;
}
const setLocation = (token: string, stowId: string, location_code: string) =>
  request(app).patch(`/api/v1/wms/stow-tasks/${stowId}/location`).set(auth(token)).send({ location_code });
const claim = (token: string, stowId: string) =>
  request(app).post(`/api/v1/wms/stow-tasks/${stowId}/claim`).set(auth(token)).send({});
const confirm = (token: string, stowId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/wms/stow-tasks/${stowId}/confirm`).set(auth(token)).send(body);

/** re_stow → valid destination → claimed by the owner: ready to confirm. */
async function claimedRecovery(j: Job, i: number, destination: string): Promise<string> {
  const stowId = await reStow(j, i);
  expect((await setLocation(j.shop.token, stowId, destination)).status).toBe(200);
  expect((await claim(j.shop.token, stowId)).status).toBe(200);
  return stowId;
}

/** Everything recovery could touch, scoped to this fixture. */
async function snapshot(j: Job) {
  return withTenant(j.shop.shopId, async (trx) => ({
    units: await trx('inventory_units').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .orderBy('receive_sequence').select('lasyncro_unit_id', 'status', 'current_location_code'),
    tasks: await trx('problem_center_tasks').whereIn('problem_task_id', j.taskIds).orderBy('lasyncro_unit_id')
      .select('problem_task_id', 'status', 'resolution_action'),
    recoveryStows: await trx('stow_tasks').where({ shop_id: j.shop.shopId, trigger: 'receive_recovery' })
      .whereIn('source_task_id', j.taskIds).orderBy('source_task_id')
      .select('stow_task_id', 'source_task_id', 'status', 'quantity_placed', 'location_code', 'claimed_by'),
    outcomes: await trx('receive_held_recovery_events').where({ shop_id: j.shop.shopId }).whereIn('lasyncro_unit_id', j.heldIds)
      .orderBy('lasyncro_unit_id').select('device_event_id', 'lasyncro_unit_id', 'problem_task_id', 'outcome', 'stow_task_id', 'location_code'),
    movements: await trx('inventory_movements').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .orderBy('lasyncro_inventory_movement_id')
      .select('lasyncro_inventory_movement_id', 'movement_type', 'quantity_delta', 'location_code',
        'reference_type', 'reference_id', 'triggered_by', 'device_event_id'),
    truth: await trx('inventory_truth').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .orderBy('location_code').select('location_code', 'on_hand_quantity', 'available_quantity'),
  }));
}

/** Purchasing, Receive and supplier evidence that recovery must never edit (026 I7). */
async function purchasingEvidence(j: Job) {
  return withTenant(j.shop.shopId, async (trx) => ({
    poLines: await trx('purchase_order_line_items').where({ shop_id: j.shop.shopId, po_id: j.poId })
      .select('quantity_ordered', 'quantity_received'),
    po: await trx('purchase_orders').where({ shop_id: j.shop.shopId, id: j.poId }).select('status'),
    line: await trx('receive_job_lines').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .select('quantity_accepted', 'quantity_rejected', 'quantity_held_recoverable'),
    job: await trx('receive_jobs').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).select('status'),
    exceptions: await trx('receive_exceptions').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId })
      .orderBy('receive_exception_id').select('exception_type', 'disposition', 'quantity_affected'),
    supplier: await trx('suppliers').where({ shop_id: j.shop.shopId, id: j.supplierId }).select('*'),
  }));
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const unitOf = (s: Snap, id: string) => s.units.find((u: any) => u.lasyncro_unit_id === id);
const taskOf = (s: Snap, id: string) => s.tasks.find((t: any) => t.problem_task_id === id);
const stowOf = (s: Snap, id: string) => s.recoveryStows.find((r: any) => r.stow_task_id === id);
const recoveryCredits = (s: Snap) => s.movements.filter((m: any) => m.triggered_by === 'receive_recovery');

/**
 * Real overlap: hold one row lock, start the requests, wait until `expected`
 * requests are blocked on locks inside their own transactions, then release.
 */
async function raceOnRowLock(
  shopId: number,
  table: 'stow_tasks' | 'inventory_units',
  where: Record<string, unknown>,
  expected: number,
  start: () => Promise<request.Response>[]
) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const holding = new Promise<void>((r) => { locked = r; });
  const holder = withTenant(shopId, async (trx) => {
    await trx(table).where({ shop_id: shopId, ...where }).forUpdate().first();
    locked();
    await gate;
  });
  await holding;

  const pending = Promise.all(start());
  let waiting = 0;
  for (let i = 0; i < 100 && waiting < expected; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const row = await withTenant(shopId, (trx) => trx.raw(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`));
    waiting = row.rows[0].n;
  }
  release();
  await holder;
  const results = await pending;
  return { waiting, results };
}

let shopA: Shop;
let shopB: Shop;

beforeAll(async () => {
  shopA = await provisionFt2Shop('a');
  shopB = await provisionFt2Shop('b');
});

beforeEach(() => {
  mockSyncStowedQuantityToShopify.mockClear();
});

afterAll(async () => {
  await db.destroy();
});

describe('S4-5 I3 — recovery Stow confirmation (A1 D.T5, A2, A3)', () => {
  it('S1 — one recovered event, one +1 inbound_purchase, truth, unit, Stow and task, atomically; nothing else', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const lsu = j.heldIds[0];
    const stowId = await claimedRecovery(j, 0, destination);

    const listed = await request(app).get('/api/v1/wms/stow-tasks').set(auth(shopA.token));
    expect(listed.status).toBe(200);
    const row = listed.body.stow_tasks.find((t: any) => t.stow_task_id === stowId);
    expect(row).toEqual(expect.objectContaining({ trigger: 'receive_recovery', unit_ids: [lsu] }));

    const before = await snapshot(j);
    const purchasingBefore = await purchasingEvidence(j);
    const unitUuid = await withTenant(shopA.shopId, (trx) =>
      trx('inventory_units').where({ shop_id: shopA.shopId, lasyncro_unit_id: lsu }).first('id'));

    const res = await confirm(shopA.token, stowId, { lasyncro_unit_id: lsu });
    expect(res.status).toBe(200);

    const after = await snapshot(j);
    const identity = recoveryCreditIdentity(stowId, lsu);
    expect(after.outcomes).toEqual([{
      device_event_id: identity.deviceEventId, lasyncro_unit_id: lsu, problem_task_id: j.taskIds[0],
      outcome: 'recovered', stow_task_id: stowId, location_code: destination,
    }]);
    expect(recoveryCredits(after)).toEqual([{
      lasyncro_inventory_movement_id: identity.movementId, movement_type: 'inbound_purchase', quantity_delta: 1,
      location_code: destination, reference_type: 'inventory_unit', reference_id: unitUuid.id,
      triggered_by: 'receive_recovery', device_event_id: identity.deviceEventId,
    }]);
    // Exactly one new movement; no debit anywhere; nothing at the custody bin.
    expect(after.movements).toHaveLength(before.movements.length + 1);
    expect(after.movements.filter((m: any) => m.location_code === shopA.problemBin)).toEqual([]);
    expect(after.truth.find((t: any) => t.location_code === destination))
      .toEqual({ location_code: destination, on_hand_quantity: 1, available_quantity: 1 });
    expect(after.truth.filter((t: any) => t.location_code !== destination))
      .toEqual(before.truth.filter((t: any) => t.location_code !== destination));
    expect(unitOf(after, lsu)).toEqual({ lasyncro_unit_id: lsu, status: 'stowed', current_location_code: destination });
    expect(stowOf(after, stowId)).toEqual(expect.objectContaining({ status: 'completed', quantity_placed: 1 }));
    expect(taskOf(after, j.taskIds[0])).toEqual(expect.objectContaining({ status: 'resolved', resolution_action: 're_stow' }));

    // 026 I7 / A3: purchasing, Receive and supplier evidence untouched; the
    // receipt and the recovery are distinguishable and never double-counted.
    expect(await purchasingEvidence(j)).toEqual(purchasingBefore);
    const receipts = after.movements.filter((m: any) => m.movement_type === 'inbound_purchase' && m.reference_type === 'receive_job');
    expect(receipts.reduce((n: number, m: any) => n + m.quantity_delta, 0)).toBe(j.acceptedIds.length);
    expect(receipts.every((m: any) => m.triggered_by === 'receive_job')).toBe(true);
    expect(after.movements.filter((m: any) => m.movement_type === 'inbound_purchase')).toHaveLength(receipts.length + 1);

    // Side effects: snapshot job enqueued; no Shopify push (I4); no inbound wording.
    const job = await withTenant(shopA.shopId, (trx) => trx('shop_snapshot_jobs').where({ shop_id: shopA.shopId }).first('shop_id'));
    expect(job).toBeTruthy();
    expect(mockSyncStowedQuantityToShopify).not.toHaveBeenCalled();
    const alerts = await withTenant(shopA.shopId, (trx) =>
      trx('alerts').where({ shop_id: shopA.shopId }).where('alert_key', `wms:stow:pending:${stowId}`).select('message'));
    expect(alerts.every((a: any) => !/inbound/i.test(a.message))).toBe(true);

    // A3 / INV-PROJ-MULTILOC-01: the ledger reproduces truth, including the bin credit.
    await withTenant(shopA.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(shopA.shopId, [j.variantId], trx, new Date());
    });
    const rebuilt = await snapshot(j);
    expect(rebuilt.truth.filter((t: any) => t.on_hand_quantity !== 0))
      .toEqual(after.truth.filter((t: any) => t.on_hand_quantity !== 0));
  });

  it('O1 — positive control: an ordinary inbound Stow still transfers and still pushes to Shopify', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('pick');
    const inbound = await withTenant(shopA.shopId, (trx) =>
      trx('stow_tasks').where({ shop_id: shopA.shopId, trigger: 'inbound_stock', receive_job_line_id: j.lineId })
        .first('stow_task_id'));
    expect(inbound).toBeTruthy();
    expect((await setLocation(shopA.token, inbound.stow_task_id, destination)).status).toBe(200);
    expect((await claim(shopA.token, inbound.stow_task_id)).status).toBe(200);
    const res = await confirm(shopA.token, inbound.stow_task_id, { lasyncro_unit_id: j.acceptedIds[0] });
    expect(res.status).toBe(200);

    const s = await snapshot(j);
    expect(s.movements.filter((m: any) => m.reference_type === 'inventory_unit')
      .map((m: any) => [m.movement_type, m.quantity_delta]).sort())
      .toEqual([['location_transfer', -1], ['location_transfer', 1]]);
    expect(recoveryCredits(s)).toEqual([]);
    expect(unitOf(s, j.heldIds[0]).status).toBe('held');
    expect(mockSyncStowedQuantityToShopify).toHaveBeenCalledTimes(1);
  });
});

describe('S4-5 I3 — destination, LSU and duplicate-credit refusals', () => {
  it('V1 — assignment refuses custody, problem, configured problem, inactive and non-bin destinations', async () => {
    const j = await heldJob(shopA, 1);
    const stowId = await reStow(j, 0);
    const configured = await shopA.bin('storage');
    const original = await withTenant(shopA.shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopA.shopId }).first('problem_bin_location'));
    await withTenant(shopA.shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopA.shopId }).update({ problem_bin_location: configured }));
    try {
      const refused = [
        shopA.problemBin,
        await shopA.bin('problem'),
        configured,
        await shopA.bin('storage', false),
        await shopA.bin('quarantine'),
        await shopA.bin('storage', true, 'shelf'),
      ];
      for (const destination of refused) {
        const res = await setLocation(shopA.token, stowId, destination);
        expect([destination, res.status, res.body.code]).toEqual([destination, 409, 'RECEIVE_RECOVERY_DESTINATION_INVALID']);
      }
      expect(stowOf(await snapshot(j), stowId).location_code).toBeNull();
    } finally {
      await withTenant(shopA.shopId, (trx) =>
        trx('shop_wms_settings').where({ shop_id: shopA.shopId }).update({ problem_bin_location: original.problem_bin_location }));
    }
    for (const zone of ['storage', 'pick', null]) {
      const destination = await shopA.bin(zone);
      expect((await setLocation(shopA.token, stowId, destination)).status).toBe(200);
    }
  });

  it('V2 — a destination that became invalid is refused at confirmation with zero side effects', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    await withTenant(shopA.shopId, (trx) =>
      trx('warehouse_locations').where({ shop_id: shopA.shopId, location_code: destination }).update({ active: false }));
    const before = await snapshot(j);
    const res = await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] });
    expect([res.status, res.body.code]).toEqual([409, 'RECEIVE_RECOVERY_DESTINATION_INVALID']);
    expect(await snapshot(j)).toEqual(before);
  });

  it('V3 — the exact held LSU is required; a repeat confirmation is refused; one credit', async () => {
    const j = await heldJob(shopA, 2);
    const destination = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    const before = await snapshot(j);
    for (const body of [{}, { lasyncro_unit_id: j.heldIds[1] }, { lasyncro_unit_id: j.acceptedIds[0] }]) {
      const res = await confirm(shopA.token, stowId, body);
      expect(res.status).toBe(409);
      expect(['RECOVERY_LSU_REQUIRED', 'RECOVERY_LSU_MISMATCH']).toContain(res.body.code);
    }
    expect(await snapshot(j)).toEqual(before);

    expect((await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(200);
    const once = await snapshot(j);
    expect((await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(409);
    const twice = await snapshot(j);
    expect(twice).toEqual(once);
    expect(recoveryCredits(twice)).toHaveLength(1);
    expect(unitOf(twice, j.heldIds[1]).status).toBe('held');
  });

  it('V4 — an existing credit with the recovery identity refuses the confirmation and rolls every write back', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const other = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    const { deviceEventId } = recoveryCreditIdentity(stowId, j.heldIds[0]);
    await withTenant(shopA.shopId, (trx) =>
      trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(), lasyncro_variant_id: j.variantId, shop_id: shopA.shopId,
        movement_type: 'inbound_purchase', quantity_delta: 1, location_code: other,
        reference_type: 'receive_job', reference_id: crypto.randomUUID(), platform: 'wms',
        occurred_at: new Date(), device_event_id: deviceEventId, operator_id: shopA.userId, triggered_by: 'receive_job',
      }));
    const before = await snapshot(j);
    const res = await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] });
    expect([res.status, res.body.code]).toEqual([409, 'RECEIVE_RECOVERY_CREDIT_DUPLICATE']);
    const after = await snapshot(j);
    expect(after).toEqual(before);
    expect([after.outcomes.length, unitOf(after, j.heldIds[0]).status, stowOf(after, stowId).status, taskOf(after, j.taskIds[0]).status])
      .toEqual([0, 'held', 'in_progress', 'open']);
  });
});

describe('S4-5 I3 — concurrency (A1 G, real concurrent transactions)', () => {
  it('C1 — two confirmations released together from one Stow lock: one credit, one outcome', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    const body = { lasyncro_unit_id: j.heldIds[0] };
    const { waiting, results } = await raceOnRowLock(shopA.shopId, 'stow_tasks', { stow_task_id: stowId }, 2,
      () => [confirm(shopA.token, stowId, body), confirm(shopA.token, stowId, body)]);
    expect(waiting).toBe(2);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const s = await snapshot(j);
    expect(s.outcomes).toHaveLength(1);
    expect(recoveryCredits(s)).toHaveLength(1);
    expect(s.truth.find((t: any) => t.location_code === destination)?.on_hand_quantity).toBe(1);
  });

  it('C2 — claim racing confirmation never deadlocks; the confirmation wins alone', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    const operator = await addOperator(shopA);
    // Claim's guarded UPDATE (status = 'pending') never matches the in_progress
    // row, so it takes no row lock (A1 G.5): only the confirmation waits.
    const { waiting, results } = await raceOnRowLock(shopA.shopId, 'stow_tasks', { stow_task_id: stowId }, 1,
      () => [confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] }), claim(operator, stowId)]);
    expect(waiting).toBe(1);
    const [confirmed, claimed] = results;
    expect(confirmed.status).toBe(200);
    expect(claimed.status).not.toBe(200);
    const s = await snapshot(j);
    expect(stowOf(s, stowId)).toEqual(expect.objectContaining({ status: 'completed', claimed_by: shopA.userId }));
    expect(recoveryCredits(s)).toHaveLength(1);
  });

  it('C3 — discard racing confirmation on one unit never deadlocks; exactly one recovered outcome', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await claimedRecovery(j, 0, destination);
    const { waiting, results } = await raceOnRowLock(shopA.shopId, 'inventory_units', { lasyncro_unit_id: j.heldIds[0] }, 2,
      () => [
        confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] }),
        request(app).post(`/api/v1/wms/problem-center/${j.taskIds[0]}/resolve`)
          .set(auth(shopA.token)).send({ resolution_action: 'discard' }),
      ]);
    expect(waiting).toBe(2);
    const [confirmed, discarded] = results;
    expect(confirmed.status).toBe(200);
    expect(discarded.status).toBe(409);
    const s = await snapshot(j);
    expect(s.outcomes.map((o: any) => o.outcome)).toEqual(['recovered']);
    expect(unitOf(s, j.heldIds[0]).status).toBe('stowed');
    expect(recoveryCredits(s)).toHaveLength(1);
  });
});

describe('S4-5 I3 — Shopify boundary and bin capacity (A3)', () => {
  it('SH1 — recovery never reaches ROOT or Shopify; a later ordinary Stow to the same bin pushes only its own delta', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await reStow(j, 0);
    // The historical repair's ledger-vs-truth check reads only WH-{shop}-ROOT.
    expect((await setLocation(shopA.token, stowId, `WH-${shopA.shopId}-ROOT`)).status).toBe(409);
    expect((await setLocation(shopA.token, stowId, destination)).status).toBe(200);
    expect((await claim(shopA.token, stowId)).status).toBe(200);
    expect((await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(200);
    expect(mockSyncStowedQuantityToShopify).not.toHaveBeenCalled();

    const inbound = await withTenant(shopA.shopId, (trx) =>
      trx('stow_tasks').where({ shop_id: shopA.shopId, trigger: 'inbound_stock', receive_job_line_id: j.lineId })
        .first('stow_task_id'));
    expect((await setLocation(shopA.token, inbound.stow_task_id, destination)).status).toBe(200);
    expect((await claim(shopA.token, inbound.stow_task_id)).status).toBe(200);
    expect((await confirm(shopA.token, inbound.stow_task_id, { lasyncro_unit_id: j.acceptedIds[0] })).status).toBe(200);

    expect(mockSyncStowedQuantityToShopify).toHaveBeenCalledTimes(1);
    expect(mockSyncStowedQuantityToShopify).toHaveBeenCalledWith(expect.objectContaining({
      shopId: shopA.shopId, lasyncroVariantId: j.variantId, locationCode: destination, quantityDelta: 1,
    }));
    const s = await snapshot(j);
    expect(s.truth.find((t: any) => t.location_code === destination)?.on_hand_quantity).toBe(2);
    expect(recoveryCredits(s)).toHaveLength(1);
  });

  it('CAP1 — recovery counts toward bin capacity: at the limit no audit task; over it one bin_over_capacity task, recovery kept', async () => {
    const j = await heldJob(shopA, 2);
    const destination = await shopA.bin('storage');
    await withTenant(shopA.shopId, (trx) =>
      trx('warehouse_locations').where({ shop_id: shopA.shopId, location_code: destination }).update({ max_capacity: 1 }));
    const audits = () => withTenant(shopA.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shopA.shopId, source: 'stow', exception_type: 'bin_over_capacity',
        problem_bin_location: destination }).select('source_exception_id', 'quantity', 'status'));

    const first = await claimedRecovery(j, 0, destination);
    expect((await confirm(shopA.token, first, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(200);
    expect(await audits()).toEqual([]);

    const second = await claimedRecovery(j, 1, destination);
    expect((await confirm(shopA.token, second, { lasyncro_unit_id: j.heldIds[1] })).status).toBe(200);
    expect(await audits()).toEqual([{ source_exception_id: second, quantity: 2, status: 'open' }]);

    const s = await snapshot(j);
    expect(s.outcomes.map((o: any) => o.outcome)).toEqual(['recovered', 'recovered']);
    expect(recoveryCredits(s)).toHaveLength(2);
    expect(s.truth.find((t: any) => t.location_code === destination)?.on_hand_quantity).toBe(2);
  });
});

describe('S4-5 I3 — tenant isolation', () => {
  it('T1 — another shop cannot assign, claim or confirm a recovery Stow; zero side effects', async () => {
    const j = await heldJob(shopA, 1);
    const destination = await shopA.bin('storage');
    const stowId = await reStow(j, 0);
    const foreignBin = await shopB.bin('storage');
    const before = await snapshot(j);
    expect((await setLocation(shopB.token, stowId, foreignBin)).status).toBe(404);
    expect((await setLocation(shopB.token, stowId, destination)).status).toBe(404);
    expect((await claim(shopB.token, stowId)).status).not.toBe(200);
    expect((await confirm(shopB.token, stowId, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(404);
    expect(await snapshot(j)).toEqual(before);
  });
});
