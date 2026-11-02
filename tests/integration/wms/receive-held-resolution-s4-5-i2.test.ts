// S8-C5 / S4-5 I2 — Problem Center resolution of held Receive units
// (contract SF-RECEIVE-S8C5-S4-CONTRACT-026 + Addenda A1–A3; 0227 certified in I1).
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { inspectReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';

/**
 * Fixtures follow the S4-4B suite: held capture as sf_app (public capture keeps
 * its 409), then labels, custody and close through the real routes. Resolution
 * goes through POST /wms/problem-center/:taskId/resolve (auth, FT2, capability,
 * wms:problem:resolve).
 *
 *   R1  re_stow: exactly one pending receive_recovery Stow; task stays open;
 *       unit stays held in custody; zero movement / truth / outcome event.
 *   R2  re_stow replay → 200 replayed, same Stow; disposal while that Stow is
 *       live → 409 RECEIVE_RECOVERY_STOW_ACTIVE, nothing written.
 *   D1  discard / write_off: one 'discarded' event at the custody bin, unit
 *       'discarded' in place, task 'resolved'; zero movement / truth / Stow.
 *   D2  disposal replay → 200 replayed; any other decision afterwards → 409.
 *   E1  ineligible: Receive not closed, unsupported actions → 409, nothing written.
 *   C1  real concurrent transactions: re_stow vs discard on one task → exactly
 *       one decision; duplicate re_stow → one Stow; duplicate discard → one event.
 *   C3  lock order: a resolution blocks on a held inventory_units row lock
 *       (observed in pg_stat_activity) and decides only after the holder commits.
 *   C4  two disposals with different device events, released together from one
 *       unit lock (both observed waiting) → exactly one outcome, one 409.
 *   C5  discard vs write_off released the same way → exactly one terminal outcome.
 *   F1  a device_event_id owned by another task's outcome → 409
 *       DEVICE_EVENT_ID_CONFLICT, no SQL detail, nothing written.
 *   A1  unauthenticated 401, operator 403, other shop 404 and sees nothing.
 *
 * Commits held units, custody, recovery Stows and outcome events: runs only in
 * the isolated held-unit CI step, never with the 0224–0227 rollback suites.
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

// ── provisioning (S4-4B pattern) ───────────────────────────────────────────

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

interface Shop { shopId: number; userId: number; token: string; problemBin: string }

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs45i2-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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

  const problemBin = `S45I2-PROB-${shopId}-${crypto.randomBytes(3).toString('hex')}`;
  await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code: problemBin,
      parent_location_code: warehouse.root_location_code, active: true, type: 'bin', zone_type: 'problem',
    });
  });
  return { shopId, userId, token, problemBin };
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S45I2${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/S45I2${nonce}`,
        title: `S4-5 I2 resolution fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-5-I2-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/S45I2${nonce}`, unitCost: { amount: '4.00' } },
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
        email: `receive-s45i2-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
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

interface Job { shop: Shop; receiveJobId: string; lineId: string; variantId: string; heldIds: string[]; taskIds: string[] }

/** `held` recoverable (defect) units captured, labelled and placed; closed when `closeIt`. */
async function heldJob(shop: Shop, held: number, closeIt = true): Promise<Job> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const accepted = 1;
  const variantId = await seedMappedVariant(shop.shopId);
  const poId = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-5 I2 supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-5 I2 held line', quantity_ordered: accepted + held, unit_cost_cents: 400,
    });
    return po.id as string;
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
  const heldIds: string[] = await withTenant(shop.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: shop.shopId, receive_job_line_id: lineId, status: 'held' })
      .orderBy('receive_sequence').pluck('lasyncro_unit_id'));
  expect(heldIds).toHaveLength(held);

  expect((await request(app).post(`/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  for (const unitId of heldIds) {
    const placed = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/held-units/${unitId}/custody`)
      .set(auth(shop.token)).send({ location_code: shop.problemBin, device_event_id: crypto.randomUUID() });
    expect(placed.status).toBe(201);
  }
  if (closeIt) {
    const closed = await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/close`)
      .set(auth(shop.token)).send({ actual_delivery_date: DELIVERY_DATE });
    expect(closed.status).toBe(200);
  }
  const taskIds: string[] = [];
  for (const unitId of heldIds) {
    const t = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId, source: 'receive', lasyncro_unit_id: unitId })
        .first('problem_task_id'));
    taskIds.push(t.problem_task_id as string);
  }
  return { shop, receiveJobId, lineId, variantId, heldIds, taskIds };
}

function resolve(j: Job, taskIndex: number, action: string, extra: Record<string, unknown> = {}, token = j.shop.token) {
  return request(app).post(`/api/v1/wms/problem-center/${j.taskIds[taskIndex]}/resolve`)
    .set(auth(token)).send({ resolution_action: action, ...extra });
}

/** Everything a resolution could touch, scoped to this fixture. */
async function snapshot(j: Job) {
  return withTenant(j.shop.shopId, async (trx) => ({
    units: await trx('inventory_units').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .orderBy('receive_sequence').select('lasyncro_unit_id', 'status', 'current_location_code', trx.raw('held_placed_at IS NOT NULL AS placed')),
    tasks: await trx('problem_center_tasks').whereIn('problem_task_id', j.taskIds).orderBy('lasyncro_unit_id')
      .select('problem_task_id', 'lasyncro_unit_id', 'status', 'resolution_action', 'problem_bin_location'),
    recoveryStows: await trx('stow_tasks').where({ shop_id: j.shop.shopId, trigger: 'receive_recovery' })
      .whereIn('source_task_id', j.taskIds).orderBy('source_task_id')
      .select('stow_task_id', 'source_task_id', 'status', 'quantity', 'location_code', 'lasyncro_variant_id'),
    outcomes: await trx('receive_held_recovery_events').where({ shop_id: j.shop.shopId }).whereIn('lasyncro_unit_id', j.heldIds)
      .orderBy('lasyncro_unit_id').select('device_event_id', 'lasyncro_unit_id', 'problem_task_id', 'outcome', 'stow_task_id', 'location_code'),
    movements: await trx('inventory_movements').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .orderBy('lasyncro_inventory_movement_id').select('movement_type', 'quantity_delta', 'location_code'),
    truth: await trx('inventory_truth').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId })
      .orderBy('location_code').select('location_code', 'on_hand_quantity', 'available_quantity'),
  }));
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const unitOf = (s: Snap, id: string) => s.units.find((u: any) => u.lasyncro_unit_id === id);
const taskOf = (s: Snap, id: string) => s.tasks.find((t: any) => t.problem_task_id === id);

let shopA: Shop;
let shopB: Shop;

beforeAll(async () => {
  shopA = await provisionFt2Shop('a');
  shopB = await provisionFt2Shop('b');
});

afterAll(async () => {
  await db.destroy();
});

describe('S4-5 I2 — recovery decision (re_stow)', () => {
  it('R1 — creates exactly one pending receive_recovery Stow, keeps the task open and credits nothing', async () => {
    const j = await heldJob(shopA, 1);
    const before = await snapshot(j);
    expect(before.recoveryStows).toEqual([]);

    const res = await resolve(j, 0, 're_stow');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ problem_task_id: j.taskIds[0], resolution_action: 're_stow', resolved: false, replayed: false });

    const after = await snapshot(j);
    expect(after.recoveryStows).toEqual([{
      stow_task_id: res.body.stow_task_id, source_task_id: j.taskIds[0], status: 'pending',
      quantity: 1, location_code: null, lasyncro_variant_id: j.variantId,
    }]);
    expect(taskOf(after, j.taskIds[0])).toEqual(taskOf(before, j.taskIds[0]));
    expect(unitOf(after, j.heldIds[0])).toEqual({ lasyncro_unit_id: j.heldIds[0], status: 'held', current_location_code: shopA.problemBin, placed: true });
    // Zero inventory credit: no movement, truth or outcome is written by the decision.
    expect(after.movements).toEqual(before.movements);
    expect(after.truth).toEqual(before.truth);
    expect(after.outcomes).toEqual([]);
  });

  it('R2 — replay returns the same Stow; disposal while the recovery Stow is live is refused with no side effects', async () => {
    const j = await heldJob(shopA, 1);
    const first = await resolve(j, 0, 're_stow');
    expect(first.status).toBe(200);
    const afterFirst = await snapshot(j);

    const replay = await resolve(j, 0, 're_stow');
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, stow_task_id: first.body.stow_task_id });
    expect(await snapshot(j)).toEqual(afterFirst);

    for (const action of ['discard', 'write_off']) {
      const refused = await resolve(j, 0, action);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('RECEIVE_RECOVERY_STOW_ACTIVE');
      expect(await snapshot(j)).toEqual(afterFirst);
    }
  });
});

describe('S4-5 I2 — disposal (discard / write_off)', () => {
  it.each(['discard', 'write_off'])('D1 — %s records one outcome, disposes the unit in place, resolves the task; no stock effect', async (action) => {
    const j = await heldJob(shopA, 1);
    const before = await snapshot(j);

    const res = await resolve(j, 0, action, { resolution_notes: 'beyond repair' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resolution_action: action, status: 'resolved', resolved: true, replayed: false });

    const after = await snapshot(j);
    expect(after.outcomes).toEqual([{
      device_event_id: res.body.device_event_id, lasyncro_unit_id: j.heldIds[0], problem_task_id: j.taskIds[0],
      outcome: 'discarded', stow_task_id: null, location_code: shopA.problemBin,
    }]);
    expect(unitOf(after, j.heldIds[0])).toEqual({ lasyncro_unit_id: j.heldIds[0], status: 'discarded', current_location_code: shopA.problemBin, placed: true });
    expect(taskOf(after, j.taskIds[0])).toMatchObject({ status: 'resolved', resolution_action: action });
    expect(after.movements).toEqual(before.movements);
    expect(after.truth).toEqual(before.truth);
    expect(after.recoveryStows).toEqual([]);
  });

  it('D2 — disposal replay is idempotent; any other decision afterwards is refused with no side effects', async () => {
    const j = await heldJob(shopA, 1);
    const eventId = crypto.randomUUID();
    expect((await resolve(j, 0, 'discard', { device_event_id: eventId })).status).toBe(200);
    const disposed = await snapshot(j);

    const replay = await resolve(j, 0, 'discard', { device_event_id: eventId });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, device_event_id: eventId });
    expect(await snapshot(j)).toEqual(disposed);

    const refusals = {
      otherEvent: await resolve(j, 0, 'discard', { device_event_id: crypto.randomUUID() }),
      writeOff: await resolve(j, 0, 'write_off'),
      reStow: await resolve(j, 0, 're_stow'),
    };
    expect(Object.fromEntries(Object.entries(refusals).map(([k, r]) => [k, r.status]))).toEqual({
      otherEvent: 409, writeOff: 409, reStow: 409,
    });
    expect(await snapshot(j)).toEqual(disposed);
  });
});

describe('S4-5 I2 — eligibility', () => {
  it('E1 — Receive not closed and unsupported actions are refused before any write', async () => {
    const open = await heldJob(shopA, 1, false);
    const before = await snapshot(open);
    for (const action of ['re_stow', 'discard']) {
      const res = await resolve(open, 0, action);
      expect(`${res.status} ${res.body.code} ${res.body.reason}`).toBe('409 RECEIVE_RECOVERY_NOT_ELIGIBLE receive_not_closed');
    }
    expect(await snapshot(open)).toEqual(before);

    const j = await heldJob(shopA, 1);
    const closed = await snapshot(j);
    for (const action of ['quarantine', 'find_replacement']) {
      const res = await resolve(j, 0, action);
      expect(`${res.status} ${res.body.code}`).toBe('409 RESOLUTION_NOT_ELIGIBLE');
    }
    const badEvent = await resolve(j, 0, 'discard', { device_event_id: 'not-a-uuid' });
    expect(badEvent.status).toBe(400);
    expect(await snapshot(j)).toEqual(closed);
  });
});

describe('S4-5 I2 — concurrency (real concurrent transactions)', () => {
  it('C1 — re_stow vs discard on one task: exactly one decision wins, never both', async () => {
    const j = await heldJob(shopA, 3);
    for (let i = 0; i < j.taskIds.length; i += 1) {
      const [reStow, discard] = await Promise.all([resolve(j, i, 're_stow'), resolve(j, i, 'discard')]);
      expect([reStow.status, discard.status].sort()).toEqual([200, 409]);

      const s = await snapshot(j);
      const stows = s.recoveryStows.filter((r: any) => r.source_task_id === j.taskIds[i]);
      const outcomes = s.outcomes.filter((o: any) => o.problem_task_id === j.taskIds[i]);
      if (reStow.status === 200) {
        expect(discard.body.code).toBe('RECEIVE_RECOVERY_STOW_ACTIVE');
        expect([stows.length, outcomes.length, unitOf(s, j.heldIds[i]).status, taskOf(s, j.taskIds[i]).status])
          .toEqual([1, 0, 'held', 'open']);
      } else {
        expect([stows.length, outcomes.length, unitOf(s, j.heldIds[i]).status, taskOf(s, j.taskIds[i]).status])
          .toEqual([0, 1, 'discarded', 'resolved']);
      }
    }
    const final = await snapshot(j);
    expect(final.movements.filter((m: any) => m.location_code === shopA.problemBin)).toEqual([]);
    expect(final.truth.filter((t: any) => t.location_code === shopA.problemBin)).toEqual([]);
  });

  it('C2 — duplicate concurrent decisions: two re_stow → one Stow; two discards with one event → one outcome', async () => {
    const j = await heldJob(shopA, 2);
    const reStows = await Promise.all([resolve(j, 0, 're_stow'), resolve(j, 0, 're_stow')]);
    expect(reStows.map((r) => r.status)).toEqual([200, 200]);
    expect(reStows.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect(new Set(reStows.map((r) => r.body.stow_task_id)).size).toBe(1);

    const eventId = crypto.randomUUID();
    const discards = await Promise.all([
      resolve(j, 1, 'discard', { device_event_id: eventId }),
      resolve(j, 1, 'discard', { device_event_id: eventId }),
    ]);
    expect(discards.map((r) => r.status)).toEqual([200, 200]);
    expect(discards.map((r) => r.body.replayed).sort()).toEqual([false, true]);

    const s = await snapshot(j);
    expect(s.recoveryStows.filter((r: any) => r.source_task_id === j.taskIds[0])).toHaveLength(1);
    expect(s.outcomes).toEqual([expect.objectContaining({ problem_task_id: j.taskIds[1], device_event_id: eventId, outcome: 'discarded' })]);
  });
});

describe('S4-5 I2 — lock order (A1 D.T4)', () => {
  it('C3 — a resolution waits on the unit row lock and decides only after the holder commits', async () => {
    const j = await heldJob(shopA, 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const holding = new Promise<void>((r) => { locked = r; });

    const holder = withTenant(shopA.shopId, async (trx) => {
      await trx('inventory_units').where({ shop_id: shopA.shopId, lasyncro_unit_id: j.heldIds[0] }).forUpdate().first('status');
      locked();
      await gate;
    });
    await holding;

    const pending = resolve(j, 0, 'discard').then((r) => r);
    let waiting = 0;
    for (let i = 0; i < 100 && waiting === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const row = await withTenant(shopA.shopId, (trx) => trx.raw(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE '%inventory_units%' AND query ILIKE '%for update%'`));
      waiting = row.rows[0].n;
    }
    expect(waiting).toBe(1);
    // While blocked on the unit lock, nothing has been decided.
    const blocked = await snapshot(j);
    expect(blocked.outcomes).toEqual([]);
    expect(unitOf(blocked, j.heldIds[0]).status).toBe('held');

    release();
    await holder;
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await snapshot(j)).outcomes).toHaveLength(1);
  });
});

/**
 * Real overlap: hold the unit row lock, start both requests, wait until both
 * are blocked on that lock inside their own transactions, then release.
 */
async function raceOnUnitLock(j: Job, unitIndex: number, start: () => Promise<request.Response>[]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const holding = new Promise<void>((r) => { locked = r; });
  const holder = withTenant(j.shop.shopId, async (trx) => {
    await trx('inventory_units').where({ shop_id: j.shop.shopId, lasyncro_unit_id: j.heldIds[unitIndex] }).forUpdate().first('status');
    locked();
    await gate;
  });
  await holding;

  const pending = Promise.all(start());
  let waiting = 0;
  for (let i = 0; i < 100 && waiting < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const row = await withTenant(j.shop.shopId, (trx) => trx.raw(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE '%inventory_units%' AND query ILIKE '%for update%'`));
    waiting = row.rows[0].n;
  }
  release();
  await holder;
  const results = await pending;
  return { waiting, results };
}

describe('S4-5 I2 — concurrent disposal (A1 G.2)', () => {
  async function expectOneDisposal(j: Job, before: Snap, results: request.Response[], eventIds: string[]) {
    const won = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status !== 200);
    expect(won).toHaveLength(1);
    expect(lost.map((r) => `${r.status} ${r.body.error}`)).toEqual(['409 Task already resolved']);
    expect(won[0].body).toMatchObject({ status: 'resolved', resolved: true, replayed: false });

    const s = await snapshot(j);
    expect(s.outcomes).toEqual([{
      device_event_id: won[0].body.device_event_id, lasyncro_unit_id: j.heldIds[0], problem_task_id: j.taskIds[0],
      outcome: 'discarded', stow_task_id: null, location_code: j.shop.problemBin,
    }]);
    expect(eventIds).toContain(won[0].body.device_event_id);
    expect(unitOf(s, j.heldIds[0])).toEqual({ lasyncro_unit_id: j.heldIds[0], status: 'discarded', current_location_code: j.shop.problemBin, placed: true });
    expect(taskOf(s, j.taskIds[0])).toMatchObject({ status: 'resolved', resolution_action: won[0].body.resolution_action });
    expect(s.recoveryStows).toEqual([]);
    expect(s.movements).toEqual(before.movements);
    expect(s.truth).toEqual(before.truth);

    const foreign = await withTenant(shopB.shopId, (trx) =>
      trx('receive_held_recovery_events').whereIn('device_event_id', eventIds).select('device_event_id'));
    expect(foreign).toEqual([]);
  }

  it('C4 — two disposals with different device events: exactly one outcome, the other refused', async () => {
    const j = await heldJob(shopA, 1);
    const before = await snapshot(j);
    const eventIds = [crypto.randomUUID(), crypto.randomUUID()];
    const { waiting, results } = await raceOnUnitLock(j, 0, () =>
      eventIds.map((id) => resolve(j, 0, 'discard', { device_event_id: id })));
    expect(waiting).toBe(2);
    await expectOneDisposal(j, before, results, eventIds);
  });

  it('C5 — discard vs write_off: exactly one terminal outcome', async () => {
    const j = await heldJob(shopA, 1);
    const before = await snapshot(j);
    const eventIds = [crypto.randomUUID(), crypto.randomUUID()];
    const { waiting, results } = await raceOnUnitLock(j, 0, () => [
      resolve(j, 0, 'discard', { device_event_id: eventIds[0] }),
      resolve(j, 0, 'write_off', { device_event_id: eventIds[1] }),
    ]);
    expect(waiting).toBe(2);
    await expectOneDisposal(j, before, results, eventIds);
  });
});

describe('S4-5 I2 — device event identity', () => {
  it('F1 — a device_event_id owned by another task is refused with 409 and writes nothing', async () => {
    const j = await heldJob(shopA, 2);
    const eventId = crypto.randomUUID();
    expect((await resolve(j, 0, 'discard', { device_event_id: eventId })).status).toBe(200);
    const owned = await snapshot(j);

    for (const action of ['discard', 'write_off']) {
      const res = await resolve(j, 1, action, { device_event_id: eventId });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'device_event_id is already used by another resolution',
        code: 'DEVICE_EVENT_ID_CONFLICT',
        reason: 'device_event_id_in_use',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|constraint|pkey|receive_held_recovery_events|insert into/i);
      // The owning outcome, its unit and task, and the colliding task are all unchanged.
      expect(await snapshot(j)).toEqual(owned);
    }
    expect(unitOf(owned, j.heldIds[1]).status).toBe('held');
    expect(taskOf(owned, j.taskIds[1]).status).toBe('open');

    // The replay key is per shop: another tenant may use the same device event.
    const other = await heldJob(shopB, 1);
    expect((await resolve(other, 0, 'discard', { device_event_id: eventId })).status).toBe(200);
    expect(await snapshot(j)).toEqual(owned);
  });
});

describe('S4-5 I2 — authorization and tenant isolation', () => {
  it('A1 — unauthenticated, operator and other-shop requests are refused with zero side effects', async () => {
    const j = await heldJob(shopA, 1);
    const before = await snapshot(j);

    const anonymous = await request(app).post(`/api/v1/wms/problem-center/${j.taskIds[0]}/resolve`)
      .send({ resolution_action: 're_stow' });
    expect(anonymous.status).toBe(401);

    const operator = await resolve(j, 0, 'discard', {}, await addOperator(shopA));
    expect(operator.status).toBe(403);

    for (const action of ['re_stow', 'discard']) {
      expect((await resolve(j, 0, action, {}, shopB.token)).status).toBe(404);
    }
    const foreignView = await withTenant(shopB.shopId, async (trx) => ({
      tasks: await trx('problem_center_tasks').whereIn('problem_task_id', j.taskIds).select('problem_task_id'),
      stows: await trx('stow_tasks').whereIn('source_task_id', j.taskIds).select('stow_task_id'),
      outcomes: await trx('receive_held_recovery_events').whereIn('lasyncro_unit_id', j.heldIds).select('device_event_id'),
    }));
    expect(foreignView).toEqual({ tasks: [], stows: [], outcomes: [] });
    expect(await snapshot(j)).toEqual(before);

    // Positive control: the owner's decision succeeds on the same task.
    expect((await resolve(j, 0, 're_stow')).status).toBe(200);
  });
});
