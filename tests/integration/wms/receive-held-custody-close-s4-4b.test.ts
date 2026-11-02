// S8-C5 / S4-4B — held LSU → problem bin custody → Receive close
// (contract SF-RECEIVE-S8C5-S4-CONTRACT-026; 0226 certified in S4-4A).
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { inspectReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { placeHeldUnitInProblemBin } from 'api-src/services/wms/receiveHeldCustody.service';
import { issueTestToken } from '../../unit/helpers/auth';

/**
 * Held capture stays service-layer only (public capture keeps its 409), so
 * held units are captured with inspectReceiveJobLine as sf_app, exactly as the
 * S4-3B suite does. Custody and close then go through the real routes.
 *
 *   P1  placement: 201, event + unit location + held_placed_at + task bin in one
 *       write; the S4-3B task is reused, never duplicated; unit stays 'held'.
 *   P2  same-event replay → 200 with the recorded placement, no new writes;
 *       conflicting replay (other bin / other unit) → 409, no side effects.
 *   P3  concurrent placements: two events for one unit → one 201, one 409;
 *       one event sent twice concurrently → one 201, one 200 replay.
 *   P4  invalid bins (unknown, foreign shop, inactive, pickable, non-bin, and
 *       non-problem zones receive / pack / quarantine) and an unacknowledged
 *       label → 409, nothing written; relocation of a placed unit → 409.
 *   P5  authorization + tenant isolation: no token 401; another shop 404 and
 *       sees nothing; forged identity 403; same-shop non-owner 409
 *       JOB_CLAIMED_BY_OTHER; nothing written.
 *   P6  atomic rollback: a placement whose transaction aborts leaves nothing.
 *   C1  close refused while held labels are unacknowledged or any held LSU is
 *       not in custody; nothing is credited.
 *   C2  close after full custody: credits, PO receipt and Stow only for accepted
 *       units; held units stay held in the bin; held tasks stay open.
 *
 * Commits held units, custody events and tasks: runs only in the isolated
 * held-unit CI step, never with the 0224 / 0225 / 0226 rollback suites.
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
    problem: `S44B-PROB-${shopId}-${nonce}-A`,
    problemB: `S44B-PROB-${shopId}-${nonce}-B`,
    inactive: `S44B-PROB-${shopId}-${nonce}-X`,
    pick: `S44B-PICK-${shopId}-${nonce}`,
    nonBin: `S44B-SHELF-${shopId}-${nonce}`,
    receive: `S44B-RCV-${shopId}-${nonce}`,
    pack: `S44B-PACK-${shopId}-${nonce}`,
    quarantine: `S44B-QUAR-${shopId}-${nonce}`,
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
      loc(bins.problem, { type: 'bin', zone_type: 'problem' }),
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
  const shopDomain = `rcvs44b-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
        title: `S4-4B custody fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-4B-${nonce}`,
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
        email: `receive-s44b-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
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
 * held capture as sf_app: `accepted` accepted, `held` recoverable held (defect).
 */
async function openHeldJob(shop: Shop, accepted: number, held: number): Promise<Job> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const expected = accepted + held;
  const variantId = await seedMappedVariant(shop.shopId);
  const poId = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-4B supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-4B held line', quantity_ordered: expected, unit_cost_cents: 400,
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
  const lineId = line.receive_job_line_id as string;

  const count = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
    .set(auth(shop.token)).send({ quantity_confirmed: accepted, device_event_id: crypto.randomUUID() });
  expect(count.status).toBe(200);

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
  const heldIds = await withTenant(shop.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: shop.shopId, receive_job_line_id: lineId, status: 'held' })
      .orderBy('receive_sequence').pluck('lasyncro_unit_id'));
  expect(heldIds).toHaveLength(held);
  return { shop, receiveJobId, lineId, variantId, poId, heldIds };
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

describe('S4-4B held custody and Receive close', () => {
  it('P1 — placement writes event, unit location, held_placed_at and the existing task bin; no new task', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    await acknowledgeLabels(j);
    const before = await snapshot(j);
    expect(before.tasks).toHaveLength(2);

    const eventId = crypto.randomUUID();
    const res = await place(j, j.heldIds[0], shopA.bins.problem, eventId);
    expect(res.status).toBe(201);
    const task = before.tasks.find((t: any) => t.lasyncro_unit_id === j.heldIds[0]);
    expect(res.body).toEqual(expect.objectContaining({
      device_event_id: eventId, lasyncro_unit_id: j.heldIds[0], problem_task_id: task.problem_task_id,
      location_code: shopA.bins.problem, replayed: false,
    }));

    const after = await snapshot(j);
    expect(after.events).toEqual([{
      device_event_id: eventId, lasyncro_unit_id: j.heldIds[0], problem_task_id: task.problem_task_id,
      location_code: shopA.bins.problem, placed_by: shopA.userId,
    }]);
    expect(after.held.find((u: any) => u.lasyncro_unit_id === j.heldIds[0]))
      .toEqual(expect.objectContaining({ status: 'held', current_location_code: shopA.bins.problem, placed: true }));
    expect(after.held.find((u: any) => u.lasyncro_unit_id === j.heldIds[1]))
      .toEqual(expect.objectContaining({ current_location_code: null, placed: false }));
    // Same two tasks, one now binned; still open.
    expect(after.tasks.map((t: any) => t.problem_task_id)).toEqual(before.tasks.map((t: any) => t.problem_task_id));
    expect(after.tasks.find((t: any) => t.problem_task_id === task.problem_task_id))
      .toEqual(expect.objectContaining({ problem_bin_location: shopA.bins.problem, status: 'open' }));
    // Held stock stays non-sellable: no movement, truth or Stow.
    expect(after.movements).toEqual([]);
    expect(after.truth).toEqual([]);
    expect(after.stow).toEqual([]);
  });

  it('P2 — identical replay returns the recorded placement; conflicting replay is 409 with no side effects', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    await acknowledgeLabels(j);
    const eventId = crypto.randomUUID();
    const first = await place(j, j.heldIds[0], shopA.bins.problem, eventId);
    expect(first.status).toBe(201);
    const recorded = await snapshot(j);

    const replay = await place(j, j.heldIds[0], shopA.bins.problem, eventId);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expectUnchanged(recorded, await snapshot(j));

    const otherBin = await place(j, j.heldIds[0], shopA.bins.problemB, eventId);
    const otherUnit = await place(j, j.heldIds[1], shopA.bins.problem, eventId);
    for (const res of [otherBin, otherUnit]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RECEIVE_HELD_CUSTODY_REPLAY_CONFLICT');
    }
    expectUnchanged(recorded, await snapshot(j));
  });

  it('P3 — concurrent placements: one unit, two events → one placement; one event twice → one placement + replay', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    await acknowledgeLabels(j);

    const raced = await Promise.all([
      place(j, j.heldIds[0], shopA.bins.problem),
      place(j, j.heldIds[0], shopA.bins.problemB),
    ]);
    expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(raced.find((r) => r.status === 409)!.body.code).toBe('RECEIVE_HELD_UNIT_ALREADY_PLACED');

    const eventId = crypto.randomUUID();
    const twice = await Promise.all([
      place(j, j.heldIds[1], shopA.bins.problem, eventId),
      place(j, j.heldIds[1], shopA.bins.problem, eventId),
    ]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 201]);

    const s = await snapshot(j);
    expect(s.events).toHaveLength(2);
    expect(new Set(s.events.map((e: any) => e.lasyncro_unit_id))).toEqual(new Set(j.heldIds));
    expect(s.tasks).toHaveLength(2);
    expect(s.held.every((u: any) => u.placed)).toBe(true);
  });

  it('P4 — invalid bins, unacknowledged labels and relocation are refused with no side effects', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    const unlabelled = await snapshot(j);
    const noLabel = await place(j, j.heldIds[0], shopA.bins.problem);
    expect(noLabel.status).toBe(409);
    expect(noLabel.body.code).toBe('RECEIVE_HELD_LABEL_REQUIRED');
    expectUnchanged(unlabelled, await snapshot(j));

    await acknowledgeLabels(j);
    const labelled = await snapshot(j);
    const refusals = {
      unknown: await place(j, j.heldIds[0], `S44B-NOWHERE-${crypto.randomBytes(3).toString('hex')}`),
      foreign: await place(j, j.heldIds[0], shopB.bins.problem),
      inactive: await place(j, j.heldIds[0], shopA.bins.inactive),
      pickable: await place(j, j.heldIds[0], shopA.bins.pick),
      nonBin: await place(j, j.heldIds[0], shopA.bins.nonBin),
      receiveZone: await place(j, j.heldIds[0], shopA.bins.receive),
      packZone: await place(j, j.heldIds[0], shopA.bins.pack),
      quarantineZone: await place(j, j.heldIds[0], shopA.bins.quarantine),
      acceptedUnit: await place(j, labelled.units.find((u: any) => u.status !== 'held').lasyncro_unit_id, shopA.bins.problem),
    };
    expect(Object.fromEntries(Object.entries(refusals).map(([k, r]) => [k, `${r.status} ${r.body.code}`]))).toEqual({
      unknown: '409 RECEIVE_PROBLEM_BIN_INVALID',
      foreign: '409 RECEIVE_PROBLEM_BIN_INVALID',
      inactive: '409 RECEIVE_PROBLEM_BIN_INVALID',
      pickable: '409 RECEIVE_PROBLEM_BIN_INVALID',
      nonBin: '409 RECEIVE_PROBLEM_BIN_INVALID',
      receiveZone: '409 RECEIVE_PROBLEM_BIN_INVALID',
      packZone: '409 RECEIVE_PROBLEM_BIN_INVALID',
      quarantineZone: '409 RECEIVE_PROBLEM_BIN_INVALID',
      acceptedUnit: '409 RECEIVE_HELD_UNIT_NOT_HELD',
    });
    expectUnchanged(labelled, await snapshot(j));

    expect((await place(j, j.heldIds[0], shopA.bins.problem)).status).toBe(201);
    const placed = await snapshot(j);
    const relocate = await place(j, j.heldIds[0], shopA.bins.problemB);
    expect(relocate.status).toBe(409);
    expect(relocate.body.code).toBe('RECEIVE_HELD_UNIT_ALREADY_PLACED');
    expectUnchanged(placed, await snapshot(j));
  });

  it('P5 — authorization and tenant isolation: unauthenticated, other shop and non-owner are refused', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    await acknowledgeLabels(j);
    const before = await snapshot(j);

    const anonymous = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/held-units/${j.heldIds[0]}/custody`)
      .send({ location_code: shopA.bins.problem, device_event_id: crypto.randomUUID() });
    expect(anonymous.status).toBe(401);

    const crossTenant = await place(j, j.heldIds[0], shopB.bins.problem, crypto.randomUUID(), shopB.token);
    expect(crossTenant.status).toBe(404);

    // A forged identity (shop B's user claiming shop A) fails authoritative
    // membership in authenticateToken (AUTH-ADMISSION-01) before any route logic.
    const forged = issueTestToken({ userId: shopB.userId, shopId: shopA.shopId, tier: 'scale' });
    const forgedRes = await place(j, j.heldIds[0], shopA.bins.problem, crypto.randomUUID(), forged);
    expect(forgedRes.status).toBe(403);
    expect(forgedRes.body.error).toBe('Shop context mismatch.');

    // A legitimate operator of the same shop who does not own the claimed job:
    // the inherited owner middleware refuses (GH-1241 S3-B precedent).
    const intruder = await addOperator(shopA);
    const nonOwner = await place(j, j.heldIds[0], shopA.bins.problem, crypto.randomUUID(), intruder.token);
    expect(nonOwner.status).toBe(409);
    expect(nonOwner.body.error).toBe('JOB_CLAIMED_BY_OTHER');

    // Service-level: shop B cannot place shop A's unit even with A's identifiers.
    await expect(withTenant(shopB.shopId, (trx) => placeHeldUnitInProblemBin(trx, {
      shopId: shopB.shopId, receiveJobId: j.receiveJobId, lasyncroUnitId: j.heldIds[0],
      locationCode: shopB.bins.problem, deviceEventId: crypto.randomUUID(), placedBy: shopB.userId,
    }))).rejects.toMatchObject({ statusCode: 404 });

    const foreignView = await withTenant(shopB.shopId, async (trx) => ({
      events: await trx('receive_held_custody_events').whereIn('lasyncro_unit_id', j.heldIds).select('device_event_id'),
      units: await trx('inventory_units').whereIn('lasyncro_unit_id', j.heldIds).select('lasyncro_unit_id'),
    }));
    expect(foreignView).toEqual({ events: [], units: [] });
    expectUnchanged(before, await snapshot(j));

    // Positive control: the owner can place, and only the owner shop sees it.
    expect((await place(j, j.heldIds[0], shopA.bins.problem)).status).toBe(201);
    expect((await snapshot(j)).events).toHaveLength(1);
  });

  it('P6 — atomic: a placement whose transaction aborts leaves no event, location or task bin', async () => {
    const j = await openHeldJob(shopA, 1, 1);
    await acknowledgeLabels(j);
    const before = await snapshot(j);
    const abort = new Error('__abort_after_placement__');

    await expect(withTenant(shopA.shopId, async (trx) => {
      const placed = await placeHeldUnitInProblemBin(trx, {
        shopId: shopA.shopId, receiveJobId: j.receiveJobId, lasyncroUnitId: j.heldIds[0],
        locationCode: shopA.bins.problem, deviceEventId: crypto.randomUUID(), placedBy: shopA.userId,
      });
      expect(placed.replayed).toBe(false);
      throw abort;
    })).rejects.toBe(abort);

    expectUnchanged(before, await snapshot(j));
  });

  it('C1 — close is refused while held labels are unacknowledged or any held LSU lacks custody; nothing credited', async () => {
    const j = await openHeldJob(shopA, 1, 2);
    const start = await snapshot(j);

    const unlabelled = await close(j);
    expect(unlabelled.status).toBe(409);
    expect(unlabelled.body.code).toBe('RECEIVE_BARCODE_READINESS_REQUIRED');
    expectUnchanged(start, await snapshot(j));

    await acknowledgeLabels(j);
    const uncustodied = await close(j);
    expect(uncustodied.status).toBe(409);
    expect(uncustodied.body.code).toBe('RECEIVE_HELD_CUSTODY_REQUIRED');

    expect((await place(j, j.heldIds[0], shopA.bins.problem)).status).toBe(201);
    const partial = await snapshot(j);
    const halfCustodied = await close(j);
    expect(halfCustodied.status).toBe(409);
    expect(halfCustodied.body.code).toBe('RECEIVE_HELD_CUSTODY_REQUIRED');
    expectUnchanged(partial, await snapshot(j));
    expect(partial.movements).toEqual([]);
    expect(partial.quantityReceived).toBe(0);
  });

  it('C2 — close after full custody credits and stows only accepted units; held stay held in the bin, tasks open', async () => {
    const j = await openHeldJob(shopA, 3, 2);
    await acknowledgeLabels(j);
    expect((await place(j, j.heldIds[0], shopA.bins.problem)).status).toBe(201);
    expect((await place(j, j.heldIds[1], shopA.bins.problemB)).status).toBe(201);

    const closed = await close(j);
    expect(closed.status).toBe(200);

    const s = await snapshot(j);
    expect(s.jobStatus).toBe('closed');
    // Inventory credit, PO receipt and Stow: accepted units only.
    expect(s.movements).toEqual([expect.objectContaining({ movement_type: 'inbound_purchase', quantity_delta: 3 })]);
    expect(s.truth.reduce((n: number, t: any) => n + Number(t.on_hand_quantity), 0)).toBe(3);
    expect(s.truth.map((t: any) => t.location_code)).not.toEqual(expect.arrayContaining([shopA.bins.problem, shopA.bins.problemB]));
    expect(s.quantityReceived).toBe(3);
    expect(s.stow).toEqual([{ trigger: 'inbound_stock', quantity: 3 }]);
    // Held units: still held, still in custody, tasks still open (S4-5 resolves them).
    expect(s.held.map((u: any) => [u.lasyncro_unit_id, u.current_location_code, u.placed]))
      .toEqual([[j.heldIds[0], shopA.bins.problem, true], [j.heldIds[1], shopA.bins.problemB, true]]);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasks.every((t: any) => t.status === 'open')).toBe(true);

    // Identical custody replay after close still returns the recorded placement.
    const replayEvent = s.events.find((e: any) => e.lasyncro_unit_id === j.heldIds[0]).device_event_id;
    const replay = await place(j, j.heldIds[0], shopA.bins.problem, replayEvent);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
  });
});
