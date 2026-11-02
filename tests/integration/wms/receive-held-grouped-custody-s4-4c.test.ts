// S8-C5 / S4-4C — grouped recoverable capture → labels → problem-bin scan →
// custody → close, through the public Receive routes (contract
// SF-RECEIVE-S8C5-S4-CONTRACT-026; D1–D5 approved in SF-RECEIVE-S4-4C-IMPLEMENT-002).
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { issueTestToken } from '../../unit/helpers/auth';

/**
 *   G1  grouped draft + finalize with Repairable damage (defect) and Repairable
 *       packaging (packaging_damage) beside non-recoverable Damaged: exact
 *       accounting; one held LSU and one Problem Center task per held unit;
 *       explicit dispositions; no stock effect.
 *   G2  GET read model: reported_problems[].disposition and lines[].held_units
 *       (LSU, label acknowledgement, location, placement) follow server state;
 *       another shop sees neither.
 *   R1  problem-bin resolution: barcode and typed location code resolve to the
 *       Floor Planning location; unknown, foreign, inactive, pickable, non-bin
 *       and non-problem zones are refused; the resolver writes nothing; another
 *       shop and a non-owner are refused.
 *   E2E resolved bin → custody per LSU (replay, conflict) → GET placed → close
 *       refused until every held LSU is placed → close credits accepted only.
 *   D4  per-line held capture stays blocked with 409 on inspect and exception.
 *
 * Commits held units, custody events and closed Receives: runs only in the
 * isolated held-unit CI step, never with the migration rollback suites.
 */

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-29';
/** A real GTIN: accepted stock is ready without LSU acknowledgement, isolating held labels. */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the S4-3B suite) ─────────────────────────

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

interface Bins {
  problemBarcode: string;
  problem: string; problemB: string; inactive: string; pick: string; nonBin: string;
  receive: string; pack: string; quarantine: string;
}
interface Shop { shopId: number; userId: number; token: string; bins: Bins }

/**
 * Problem, inactive, pickable, non-bin and other non-pickable zone bins
 * (receive, pack, quarantine) under the shop's default warehouse.
 */
async function seedBins(shopId: number): Promise<Bins> {
  const nonce = crypto.randomBytes(3).toString('hex');
  const bins: Bins = {
    problemBarcode: `S44C-BC-${shopId}-${nonce}`,
    problem: `S44C-PROB-${shopId}-${nonce}-A`,
    problemB: `S44C-PROB-${shopId}-${nonce}-B`,
    inactive: `S44C-PROB-${shopId}-${nonce}-X`,
    pick: `S44C-PICK-${shopId}-${nonce}`,
    nonBin: `S44C-SHELF-${shopId}-${nonce}`,
    receive: `S44C-RCV-${shopId}-${nonce}`,
    pack: `S44C-PACK-${shopId}-${nonce}`,
    quarantine: `S44C-QUAR-${shopId}-${nonce}`,
  };
  await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    expect(warehouse).toBeTruthy();
    const loc = (location_code: string, fields: Record<string, unknown>) => ({
      shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code,
      parent_location_code: warehouse.root_location_code, active: true, ...fields,
    });
    await trx('warehouse_locations').insert([
      loc(bins.problem, { type: 'bin', zone_type: 'problem', barcode: bins.problemBarcode }),
      loc(bins.problemB, { type: 'bin', zone_type: 'problem' }),
      loc(bins.inactive, { type: 'bin', zone_type: 'problem', active: false }),
      loc(bins.pick, { type: 'bin', zone_type: 'pick' }),
      loc(bins.nonBin, { type: 'shelf', zone_type: 'problem' }),
      loc(bins.receive, { type: 'bin', zone_type: 'receive' }),
      loc(bins.pack, { type: 'bin', zone_type: 'pack' }),
      loc(bins.quarantine, { type: 'bin', zone_type: 'quarantine' }),
    ]);
  });
  return bins;
}

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs44c-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
  return { shopId, userId, token, bins: await seedBins(shopId) };
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S44B${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/S44B${nonce}`,
        title: `S4-4C custody fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-4C-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/S44B${nonce}`, unitCost: { amount: '4.00' } },
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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A second, legitimate operator of the shop (GH-1241 S3-B pattern). */
async function addOperator(shop: Shop): Promise<{ userId: number; token: string }> {
  const userId = await withTenant(shop.shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.shopId,
        email: `receive-s44c-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'operator',
        role: 'operator',
      })
      .returning('id');
    await trx('shop_memberships').insert({
      shop_id: shop.shopId, user_id: row.id, role: 'operator', revoked_at: null,
    });
    return row.id as number;
  });
  return {
    userId,
    token: issueTestToken({ userId, shopId: shop.shopId, tier: 'scale', roles: ['operator'] }),
  };
}

interface Job { shop: Shop; receiveJobId: string; lineId: string; variantId: string; poId: string; heldIds: string[] }

/**
 * shipped single-line PO → real create + claim + confirm-count routes, then
 * grouped held capture through the PUBLIC draft + finalize routes (S4-4C D3).
 */
async function openPo(shop: Shop, expected: number) {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const variantId = await seedMappedVariant(shop.shopId);
  const poId = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-4C supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-4C held line', quantity_ordered: expected, unit_cost_cents: 400,
    });
    return po.id as string;
  });
  const created = await request(app)
    .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
    .set(auth(shop.token)).send({ assigned_operator_id: shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  const claimed = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`).set(auth(shop.token)).send({});
  expect(claimed.status).toBe(200);
  const line = await withTenant(shop.shopId, (trx) =>
    trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_id: receiveJobId })
      .first('receive_job_line_id'));
  return { receiveJobId, lineId: line.receive_job_line_id as string, variantId, poId };
}

interface Classification { accepted: number; damaged?: number; repairableDamage?: number; repairablePackaging?: number }

/** The grouped review payload the S4-4C UI sends for one line. */
function groupedLine(lineId: string, c: Classification) {
  const damaged = c.damaged ?? 0;
  const product = c.repairableDamage ?? 0;
  const packaging = c.repairablePackaging ?? 0;
  return {
    receive_job_line_id: lineId,
    quantity_accepted: c.accepted,
    quantity_rejected: damaged,
    quantity_missing: 0,
    quantity_deferred: 0,
    quantity_held_recoverable: product + packaging,
    new_exceptions: [
      ...(damaged > 0 ? [{ exception_type: 'defect', quantity_affected: damaged, accounting_role: 'shortfall', notes: null }] : []),
      ...(product > 0 ? [{ exception_type: 'defect', quantity_affected: product, accounting_role: null, disposition: 'recoverable_held', notes: null }] : []),
      ...(packaging > 0 ? [{ exception_type: 'packaging_damage', quantity_affected: packaging, accounting_role: null, disposition: 'recoverable_held', notes: null }] : []),
    ],
    existing_exception_ids: [],
  };
}

async function draftAndFinalize(shop: Shop, receiveJobId: string, lines: unknown[]) {
  const base = `/api/v1/suppliers/receive-jobs/${receiveJobId}`;
  const draft = await request(app).put(`${base}/reconciliation/draft`).set(auth(shop.token))
    .send({ base_revision_id: null, device_event_id: crypto.randomUUID(), lines });
  if (draft.status !== 200) return { draft, finalize: null };
  const finalize = await request(app).post(`${base}/reconciliation/finalize`).set(auth(shop.token))
    .send({ current_revision_id: draft.body.revision_id, device_event_id: crypto.randomUUID(), lines });
  return { draft, finalize };
}

async function openHeldJob(shop: Shop, c: Classification): Promise<Job> {
  const expected = c.accepted + (c.damaged ?? 0) + (c.repairableDamage ?? 0) + (c.repairablePackaging ?? 0);
  const { receiveJobId, lineId, variantId, poId } = await openPo(shop, expected);
  const count = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
    .set(auth(shop.token)).send({ quantity_confirmed: c.accepted, device_event_id: crypto.randomUUID() });
  expect(count.status).toBe(200);
  const { draft, finalize } = await draftAndFinalize(shop, receiveJobId, [groupedLine(lineId, c)]);
  expect(draft.status).toBe(200);
  expect(finalize?.status).toBe(200);
  const heldIds = await withTenant(shop.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: shop.shopId, receive_job_line_id: lineId, status: 'held' })
      .orderBy('receive_sequence').pluck('lasyncro_unit_id'));
  return { shop, receiveJobId, lineId, variantId, poId, heldIds };
}

function getJob(j: Job, token = j.shop.token) {
  return request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`).set(auth(token));
}

function resolveBin(j: Job, scanned: string, token = j.shop.token) {
  return request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/problem-bins/resolve`)
    .query({ scanned_value: scanned }).set(auth(token));
}

async function acknowledgeLabels(j: Job) {
  const res = await request(app)
    .post(`/api/v1/wms/receive-job-lines/${j.lineId}/unit-labels/printed`).set(auth(j.shop.token)).send({});
  expect(res.status).toBe(200);
}

function place(j: Job, unitId: string, locationCode: string, deviceEventId = crypto.randomUUID(), token = j.shop.token) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/held-units/${unitId}/custody`)
    .set(auth(token)).send({ location_code: locationCode, device_event_id: deviceEventId });
}

function close(j: Job) {
  return request(app).post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.shop.token)).send({ actual_delivery_date: DELIVERY_DATE });
}

/** Everything the custody / close contract cares about, scoped to this fixture. */
async function snapshot(j: Job) {
  return withTenant(j.shop.shopId, async (trx) => {
    const units = await trx('inventory_units').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .orderBy('receive_sequence')
      .select('lasyncro_unit_id', 'status', 'current_location_code', trx.raw('held_placed_at IS NOT NULL AS placed'));
    const tasks = await trx('problem_center_tasks')
      .where({ shop_id: j.shop.shopId, source: 'receive', lasyncro_variant_id: j.variantId })
      .orderBy('lasyncro_unit_id').select('problem_task_id', 'lasyncro_unit_id', 'problem_bin_location', 'status');
    const events = await trx('receive_held_custody_events').where({ shop_id: j.shop.shopId })
      .whereIn('lasyncro_unit_id', j.heldIds).orderBy('lasyncro_unit_id')
      .select('device_event_id', 'lasyncro_unit_id', 'problem_task_id', 'location_code', 'placed_by');
    const movements = await trx('inventory_movements').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .select('movement_type', 'quantity_delta', 'location_code');
    const truth = await trx('inventory_truth').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .select('location_code', 'on_hand_quantity', 'available_quantity');
    const stow = await trx('stow_tasks').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .select('trigger', 'quantity');
    const job = await trx('receive_jobs').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).first('status');
    const poLine = await trx('purchase_order_line_items').where({ shop_id: j.shop.shopId, po_id: j.poId })
      .first('quantity_received');
    return {
      units,
      held: units.filter((u: any) => u.status === 'held'),
      tasks,
      events,
      movements,
      truth,
      stow,
      jobStatus: job.status as string,
      quantityReceived: Number(poLine.quantity_received),
    };
  });
}

/** Nothing custody- or stock-bearing changed between two snapshots. */
function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  expect(after.units).toEqual(before.units);
  expect(after.tasks).toEqual(before.tasks);
  expect(after.events).toEqual(before.events);
  expect(after.movements).toEqual(before.movements);
  expect(after.truth).toEqual(before.truth);
  expect(after.stow).toEqual(before.stow);
  expect(after.jobStatus).toBe(before.jobStatus);
}

let shopA: Shop;
let shopB: Shop;

beforeAll(async () => {
  shopA = await provisionFt2Shop('a');
  shopB = await provisionFt2Shop('b');
});

afterAll(async () => {
  await db.destroy();
});

describe('S4-4C grouped recoverable capture, problem-bin scan, custody and close', () => {
  it('G1 — grouped Repairable damage / Repairable packaging / Damaged: exact accounting, one LSU and one task per held unit', async () => {
    const j = await openHeldJob(shopA, { accepted: 2, damaged: 1, repairableDamage: 2, repairablePackaging: 1 });

    const s = await snapshot(j);
    expect(j.heldIds).toHaveLength(3);
    expect(new Set(j.heldIds).size).toBe(3);
    expect(s.tasks).toHaveLength(3);
    expect(new Set(s.tasks.map((t: any) => t.lasyncro_unit_id))).toEqual(new Set(j.heldIds));
    expect(s.tasks.every((t: any) => t.problem_bin_location == null && t.status === 'open')).toBe(true);
    expect(s.events).toEqual([]);
    expect(s.movements).toEqual([]);
    expect(s.truth).toEqual([]);
    expect(s.stow).toEqual([]);

    const evidence = await withTenant(shopA.shopId, async (trx) => ({
      line: await trx('receive_job_lines').where({ shop_id: shopA.shopId, receive_job_line_id: j.lineId })
        .first('quantity_accepted', 'quantity_rejected', 'quantity_held_recoverable', 'quantity_delivered'),
      exceptions: await trx('receive_exceptions').where({ shop_id: shopA.shopId, receive_job_line_id: j.lineId })
        .whereNull('superseded_at').orderBy(['exception_type', 'disposition'])
        .select('exception_type', 'quantity_affected', 'accounting_role', 'disposition'),
    }));
    expect(evidence.line).toEqual({ quantity_accepted: 2, quantity_rejected: 1, quantity_held_recoverable: 3, quantity_delivered: 6 });
    expect(evidence.exceptions).toEqual([
      { exception_type: 'defect', quantity_affected: 2, accounting_role: null, disposition: 'recoverable_held' },
      { exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall', disposition: null },
      { exception_type: 'packaging_damage', quantity_affected: 1, accounting_role: null, disposition: 'recoverable_held' },
    ]);
  });

  it('G1b — grouped held that does not reconcile is refused with no held side effects', async () => {
    const { receiveJobId, lineId } = await openPo(shopA, 4);
    const count = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
      .set(auth(shopA.token)).send({ quantity_confirmed: 2, device_event_id: crypto.randomUUID() });
    expect(count.status).toBe(200);
    // held 3 against a shortfall of 2: the grouped balance cannot hold.
    const overHeld = { ...groupedLine(lineId, { accepted: 2, repairableDamage: 3 }) };
    const { draft, finalize } = await draftAndFinalize(shopA, receiveJobId, [overHeld]);
    expect([draft.status, finalize?.status ?? null]).not.toEqual([200, 200]);
    const held = await withTenant(shopA.shopId, async (trx) => ({
      units: await trx('inventory_units').where({ shop_id: shopA.shopId, receive_job_line_id: lineId, status: 'held' }).count('* as n').first(),
      tasks: await trx('problem_center_tasks').where({ shop_id: shopA.shopId, source: 'receive' })
        .whereIn('source_exception_id', trx('receive_exceptions').where({ receive_job_line_id: lineId }).select('receive_exception_id'))
        .count('* as n').first(),
    }));
    expect({ units: Number(held.units?.n), tasks: Number(held.tasks?.n) }).toEqual({ units: 0, tasks: 0 });
  });

  it('G2 — GET exposes disposition and held_units that follow labels and custody; another shop sees neither', async () => {
    const j = await openHeldJob(shopA, { accepted: 1, repairableDamage: 1, repairablePackaging: 1 });

    const fresh = await getJob(j);
    expect(fresh.status).toBe(200);
    const line = fresh.body.lines.find((l: any) => l.receive_job_line_id === j.lineId);
    expect(line.held_units).toEqual(j.heldIds.map((id) => ({ lasyncro_unit_id: id, label_acknowledged: false, location_code: null, placed: false })));
    expect(line.awaiting_label_ack).toBe(true);
    expect(line.reported_problems.map((p: any) => [p.exception_type, p.disposition]).sort())
      .toEqual([['defect', 'recoverable_held'], ['packaging_damage', 'recoverable_held']]);

    await acknowledgeLabels(j);
    expect((await place(j, j.heldIds[0], shopA.bins.problem)).status).toBe(201);
    const after = (await getJob(j)).body.lines.find((l: any) => l.receive_job_line_id === j.lineId);
    expect(after.awaiting_label_ack).toBe(false);
    expect(after.held_units).toEqual([
      { lasyncro_unit_id: j.heldIds[0], label_acknowledged: true, location_code: shopA.bins.problem, placed: true },
      { lasyncro_unit_id: j.heldIds[1], label_acknowledged: true, location_code: null, placed: false },
    ]);

    // Another shop cannot read this Receive at all.
    expect((await getJob(j, shopB.token)).status).toBe(404);
  });

  it('R1 — problem-bin resolution: barcode and location code resolve; every other location is refused; nothing written', async () => {
    const j = await openHeldJob(shopA, { accepted: 1, repairableDamage: 1 });
    const before = await snapshot(j);

    const byBarcode = await resolveBin(j, shopA.bins.problemBarcode);
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body).toEqual({ location_code: shopA.bins.problem, barcode: shopA.bins.problemBarcode });
    const byCode = await resolveBin(j, shopA.bins.problemB);
    expect(byCode.status).toBe(200);
    expect(byCode.body.location_code).toBe(shopA.bins.problemB);

    const refusals = {
      unknown: await resolveBin(j, `S44C-NOWHERE-${crypto.randomBytes(3).toString('hex')}`),
      foreign: await resolveBin(j, shopB.bins.problem),
      foreignBarcode: await resolveBin(j, shopB.bins.problemBarcode),
      inactive: await resolveBin(j, shopA.bins.inactive),
      pickable: await resolveBin(j, shopA.bins.pick),
      nonBin: await resolveBin(j, shopA.bins.nonBin),
      receiveZone: await resolveBin(j, shopA.bins.receive),
      packZone: await resolveBin(j, shopA.bins.pack),
      quarantineZone: await resolveBin(j, shopA.bins.quarantine),
    };
    expect(Object.fromEntries(Object.entries(refusals).map(([k, r]) => [k, `${r.status} ${r.body.code}`]))).toEqual(
      Object.fromEntries(Object.keys(refusals).map((k) => [k, '409 RECEIVE_PROBLEM_BIN_INVALID'])),
    );
    expect((await resolveBin(j, '   ')).status).toBe(400);

    // Authorization and isolation: same chain as placement.
    expect((await resolveBin(j, shopA.bins.problemBarcode, shopB.token)).status).toBe(404);
    const intruder = await addOperator(shopA);
    const nonOwner = await resolveBin(j, shopA.bins.problemBarcode, intruder.token);
    expect(nonOwner.status).toBe(409);
    expect(nonOwner.body.error).toBe('JOB_CLAIMED_BY_OTHER');
    const anonymous = await request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/problem-bins/resolve`)
      .query({ scanned_value: shopA.bins.problemBarcode });
    expect(anonymous.status).toBe(401);

    expectUnchanged(before, await snapshot(j));
  });

  it('E2E — resolved bin → custody per LSU (replay, conflict) → close refused until all placed → accepted-only credit', async () => {
    const j = await openHeldJob(shopA, { accepted: 3, damaged: 1, repairableDamage: 1, repairablePackaging: 1 });

    const blockedByLabels = await close(j);
    expect(blockedByLabels.status).toBe(409);
    expect(blockedByLabels.body.code).toBe('RECEIVE_BARCODE_READINESS_REQUIRED');

    await acknowledgeLabels(j);
    const bin = (await resolveBin(j, shopA.bins.problemBarcode)).body.location_code as string;
    expect(bin).toBe(shopA.bins.problem);

    const eventId = crypto.randomUUID();
    expect((await place(j, j.heldIds[0], bin, eventId)).status).toBe(201);
    // Interrupted request retried with the same event: the recorded placement.
    const retried = await place(j, j.heldIds[0], bin, eventId);
    expect(retried.status).toBe(200);
    expect(retried.body.replayed).toBe(true);
    // Duplicate scan of a placed LSU with a new event, and a reused event for another LSU.
    const duplicateScan = await place(j, j.heldIds[0], bin);
    expect([duplicateScan.status, duplicateScan.body.code]).toEqual([409, 'RECEIVE_HELD_UNIT_ALREADY_PLACED']);
    const reusedEvent = await place(j, j.heldIds[1], bin, eventId);
    expect([reusedEvent.status, reusedEvent.body.code]).toEqual([409, 'RECEIVE_HELD_CUSTODY_REPLAY_CONFLICT']);

    const halfway = await close(j);
    expect([halfway.status, halfway.body.code]).toEqual([409, 'RECEIVE_HELD_CUSTODY_REQUIRED']);
    expect((await snapshot(j)).movements).toEqual([]);

    expect((await place(j, j.heldIds[1], bin)).status).toBe(201);
    const ready = (await getJob(j)).body.lines.find((l: any) => l.receive_job_line_id === j.lineId);
    expect(ready.held_units.every((u: any) => u.placed && u.location_code === bin)).toBe(true);

    const closed = await close(j);
    expect(closed.status).toBe(200);
    const s = await snapshot(j);
    expect(s.jobStatus).toBe('closed');
    expect(s.movements).toEqual([expect.objectContaining({ movement_type: 'inbound_purchase', quantity_delta: 3 })]);
    expect(s.truth.reduce((n: number, t: any) => n + Number(t.on_hand_quantity), 0)).toBe(3);
    expect(s.quantityReceived).toBe(3);
    expect(s.stow).toEqual([{ trigger: 'inbound_stock', quantity: 3 }]);
    expect(s.held.every((u: any) => u.status === 'held' && u.current_location_code === bin && u.placed)).toBe(true);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasks.every((t: any) => t.status === 'open' && t.problem_bin_location === bin)).toBe(true);
  });

  it('D4 — per-line held capture stays blocked with 409 and persists nothing held', async () => {
    const { receiveJobId, lineId, variantId } = await openPo(shopA, 4);
    const count = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
      .set(auth(shopA.token)).send({ quantity_confirmed: 2, device_event_id: crypto.randomUUID() });
    expect(count.status).toBe(200);
    const base = `/api/v1/suppliers/receive-jobs/${receiveJobId}`;
    const report = await request(app).post(`${base}/exception`).set(auth(shopA.token)).send({
      lasyncro_variant_id: variantId, receive_job_line_id: lineId, exception_type: 'defect',
      quantity_affected: 2, disposition: 'recoverable_held', device_event_id: crypto.randomUUID(),
    });
    const inspect = await request(app).post(`${base}/inspect`).set(auth(shopA.token)).send({
      lasyncro_variant_id: variantId, receive_job_line_id: lineId, quantity_accepted: 2, quantity_rejected: 0,
      quantity_missing: 0, quantity_deferred: 0, quantity_held_recoverable: 2, device_event_id: crypto.randomUUID(),
    });
    for (const res of [report, inspect]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RECEIVE_RECOVERABLE_HELD_NOT_ENABLED');
    }
    const held = await withTenant(shopA.shopId, (trx) => trx('inventory_units')
      .where({ shop_id: shopA.shopId, receive_job_line_id: lineId }).count('* as n').first());
    expect(Number(held?.n)).toBe(0);
  });
});
