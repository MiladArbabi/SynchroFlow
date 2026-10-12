/**
 * GH-1241 / S3-A1 — UNCOUNTED INVENTORY SAFETY — RED regression gate.
 *
 * Ratified S3 contract (GH-1241 R1/R3): a Receive line has distinct states —
 *   1. not physically counted;
 *   2. operator explicitly confirmed physical count = 0;
 *   3. operator explicitly confirmed physical count = N.
 * Neither the untouched optimistic GET projection (sellable = expected − shortfall
 * exceptions) nor an automatically initialized provisional 0 (Start Receive)
 * proves physical counting, so neither may authorize accepted units.
 *
 * Ratified evidence (migration 0209): receive_job_lines.quantity_count_confirmed
 * + count_confirmed_by/_at + count_confirmation_event_id, written only by
 *   POST /receive-jobs/:jobId/lines/:lineId/confirm-count { quantity_confirmed, device_event_id }.
 * Inspection requires accepted == the persisted confirmed count. These are NOT
 * evidence and are exercised as such:
 *   - untouched:        quantity_sellable_provisional NULL, reconciliation_started_at NULL
 *   - auto-seeded zero: PATCH /progress { quantity_sellable_provisional: 0 }
 *                       (the exact Start Receive request, GH-1085 R30)
 *   - reconcile marker: PATCH /progress { ..., reconciliation_required: true }
 * A draft that changes the counted quantity voids the confirmation.
 *
 * Every mutation goes through the real routes (createApp + supertest) against
 * the disposable synchroflow_test_* database (`npm run test:integration`).
 * Fixtures follow the GH-1245 / GH-1111 Receive suites.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { issueTestToken } from '../../unit/helpers/auth';
import knexLib, { Knex } from 'knex';
import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import * as migration0209 from
  '../../../apps/backend/migrations/20261012150000_0209_receive_line_count_confirmation';

const app = createApp();
jest.setTimeout(240000);

/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the GH-1245 / GH-1243 / GH-1085 suites) ───

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

interface Shop {
  shopId: number;
  userId: number;
  token: string;
  rootLocationCode: string;
}

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs3a1-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId, tier: 'scale' });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  return { shopId, userId, token, rootLocationCode: `WH-${shopId}-ROOT` };
}

/** A second, legitimate operator of the same shop (GH-1111 membership shape). */
async function addOperator(shop: Shop): Promise<{ userId: number; token: string }> {
  const userId = await withTenant(shop.shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.shopId,
        email: `receive-s3a1-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
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

// ── fixtures ────────────────────────────────────────────────────────────────

async function seedMappedVariant(shopId: number, externalBarcode: string | null): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S3A1${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/S3A1${nonce}`,
          title: `GH1241 S3-A1 uncounted fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1241-S3A1-${nonce}`,
                  barcode: externalBarcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/S3A1${nonce}`,
                    unitCost: { amount: '4.00' },
                  },
                },
              },
            ],
          },
        },
      },
    ]));

  const mapping = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_variant_id: externalVariantId })
      .first('lasyncro_variant_id'));
  expect(mapping?.lasyncro_variant_id).toBeTruthy();
  return mapping!.lasyncro_variant_id as string;
}

interface JobFixture {
  shop: Shop;
  lasyncroVariantId: string;
  poId: string;
  poLineItemId: string;
  receiveJobId: string;
  receiveJobLineId: string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * supplier → single-line shipped PO (expected 10) → real create route → real
 * claim (GH-1111). Leaves the line untouched: no progress, no exception.
 */
async function openV2Job(shop: Shop, quantityOrdered = 10): Promise<JobFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const lasyncroVariantId = await seedMappedVariant(shop.shopId, EXTERNAL_BARCODE);

  const { poId, poLineItemId } = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1241 S3-A1 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: po.id,
        shop_id: shop.shopId,
        lasyncro_variant_id: lasyncroVariantId,
        description: 'GH1241 S3-A1 uncounted line',
        quantity_ordered: quantityOrdered,
        unit_cost_cents: 400,
      })
      .returning('id');
    return { poId: po.id as string, poLineItemId: poLine.id as string };
  });

  const created = await request(app)
    .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
    .set(auth(shop.token))
    .send({ assigned_operator_id: shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;

  const claimed = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(shop.token))
    .send({});
  expect(claimed.status).toBe(200);

  const line = await withTenant(shop.shopId, (trx) =>
    trx('receive_job_lines')
      .where({ shop_id: shop.shopId, receive_job_id: receiveJobId })
      .first('receive_job_line_id'));
  expect(line?.receive_job_line_id).toBeTruthy();

  const job = await withTenant(shop.shopId, (trx) =>
    trx('receive_jobs').where({ shop_id: shop.shopId, receive_job_id: receiveJobId })
      .first('delivery_accounting_version'));
  expect(Number(job?.delivery_accounting_version)).toBe(2);

  return {
    shop,
    lasyncroVariantId,
    poId,
    poLineItemId,
    receiveJobId,
    receiveJobLineId: line!.receive_job_line_id as string,
  };
}

// ── real route calls ────────────────────────────────────────────────────────

function httpProgress(j: JobFixture, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.receiveJobLineId}/progress`)
    .set(auth(j.shop.token))
    .send(body);
}

/** The exact body the web reconciliation sends for a missing allocation. */
function httpReportMissing(j: JobFixture, quantity: number) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
    .set(auth(j.shop.token))
    .send({
      lasyncro_variant_id: j.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      exception_type: 'missing_item',
      quantity_affected: quantity,
      accounting_role: 'shortfall',
      notes: `${quantity} missing item during receive`,
      device_event_id: crypto.randomUUID(),
    });
}

function httpInspect(
  j: JobFixture,
  d: { accepted: number; rejected: number; missing: number; deferred: number },
  token: string = j.shop.token
) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
    .set(auth(token))
    .send({
      lasyncro_variant_id: j.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      quantity_accepted: d.accepted,
      quantity_rejected: d.rejected,
      quantity_missing: d.missing,
      quantity_deferred: d.deferred,
      device_event_id: crypto.randomUUID(),
    });
}

async function fetchLine(j: JobFixture) {
  const response = await request(app)
    .get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`)
    .set(auth(j.shop.token));
  expect(response.status).toBe(200);
  const line = response.body.lines.find(
    (candidate: any) => candidate.receive_job_line_id === j.receiveJobLineId
  );
  expect(line).toBeTruthy();
  return line;
}

function httpConfirmCount(
  j: JobFixture,
  quantity: number,
  deviceEventId: string = crypto.randomUUID(),
  token: string = j.shop.token
) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.receiveJobLineId}/confirm-count`)
    .set(auth(token))
    .send({ quantity_confirmed: quantity, device_event_id: deviceEventId });
}

function httpClose(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.shop.token))
    .send({ actual_delivery_date: '2026-10-12' });
}

/** The persisted operator count-confirmation evidence of one line. */
async function countEvidence(j: JobFixture) {
  const row = await withTenant(j.shop.shopId, (trx) =>
    trx('receive_job_lines')
      .where({ shop_id: j.shop.shopId, receive_job_line_id: j.receiveJobLineId })
      .first('quantity_count_confirmed', 'count_confirmed_by', 'count_confirmed_at', 'count_confirmation_event_id'));
  return {
    quantity: row?.quantity_count_confirmed == null ? null : Number(row.quantity_count_confirmed),
    by: row?.count_confirmed_by == null ? null : Number(row.count_confirmed_by),
    at: row?.count_confirmed_at ?? null,
    eventId: row?.count_confirmation_event_id ?? null,
  };
}

const NO_EVIDENCE = { quantity: null, by: null, at: null, eventId: null };

// ── persisted effects, scoped to one fixture ────────────────────────────────

async function effects(j: JobFixture) {
  const { shopId } = j.shop;
  return withTenant(shopId, async (trx) => {
    const line = await trx('receive_job_lines')
      .where({ shop_id: shopId, receive_job_line_id: j.receiveJobLineId })
      .first('inspection_complete', 'quantity_accepted', 'quantity_rejected', 'quantity_missing',
        'quantity_deferred', 'quantity_delivered', 'quantity_sellable_provisional', 'reconciliation_started_at');
    const job = await trx('receive_jobs')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .first('status', 'units_inspected', 'units_accepted', 'units_rejected');
    const poLine = await trx('purchase_order_line_items')
      .where({ shop_id: shopId, id: j.poLineItemId })
      .first('quantity_received', 'quantity_pending_delivery');
    const units = await trx('inventory_units')
      .where({ shop_id: shopId, receive_job_line_id: j.receiveJobLineId })
      .count<{ count: string }>('* as count').first();
    const movements = await trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: j.lasyncroVariantId })
      .count<{ count: string }>('* as count').first();
    const truth = await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: j.lasyncroVariantId })
      .sum<{ sum: string | null }>('on_hand_quantity as sum').first();
    const stow = await trx('stow_tasks')
      .where({ shop_id: shopId, lasyncro_variant_id: j.lasyncroVariantId })
      .count<{ count: string }>('* as count').first();
    const inspectAudits = await trx('operator_audit_log')
      .where({ shop_id: shopId, action_type: 'receive_inspect', entity_id: j.receiveJobId })
      .count<{ count: string }>('* as count').first();
    const exceptions = await trx('receive_exceptions')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .orderBy('raised_at', 'asc')
      .select('exception_type', 'quantity_affected', 'accounting_role');

    return {
      inspectionComplete: Boolean(line?.inspection_complete),
      lineAccepted: Number(line?.quantity_accepted ?? 0),
      lineDelivered: line?.quantity_delivered == null ? null : Number(line.quantity_delivered),
      jobStatus: job?.status ?? null,
      unitsInspected: Number(job?.units_inspected ?? 0),
      unitsAccepted: Number(job?.units_accepted ?? 0),
      quantityReceived: Number(poLine?.quantity_received ?? 0),
      lsuCount: Number(units?.count ?? 0),
      inventoryMovementCount: Number(movements?.count ?? 0),
      truthOnHand: Number(truth?.sum ?? 0),
      stowTaskCount: Number(stow?.count ?? 0),
      inspectAuditCount: Number(inspectAudits?.count ?? 0),
      exceptions: exceptions.map((e: any) => ({
        type: e.exception_type,
        quantity: Number(e.quantity_affected),
        role: e.accounting_role,
      })),
    };
  });
}

/** Unfinalized line with zero accepted-stock consequences. */
function uncreditedLine(exceptions: Array<{ type: string; quantity: number; role: string | null }>) {
  return {
    inspectionComplete: false,
    lineAccepted: 0,
    lineDelivered: null,
    jobStatus: 'in_progress',
    unitsInspected: 0,
    unitsAccepted: 0,
    quantityReceived: 0,
    lsuCount: 0,
    inventoryMovementCount: 0,
    truthOnHand: 0,
    stowTaskCount: 0,
    inspectAuditCount: 0,
    exceptions,
  };
}

const MISSING_TWO = [{ type: 'missing_item', quantity: 2, role: 'shortfall' }];

// ── overlap instrumentation (GH-1245 precedent; test-only) ──────────────────

interface LockWaiter { pid: number; blockers: number[]; query: string }

function blockedBehindGate(pid: number, gatePid: number, waiters: LockWaiter[]): boolean {
  const byPid = new Map(waiters.map((w) => [w.pid, w]));
  const seen = new Set<number>();
  const queue = [...(byPid.get(pid)?.blockers ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next === gatePid) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(byPid.get(next)?.blockers ?? []));
  }
  return false;
}

/** Bounded poll until `expected` backends are lock-waiting behind the test-held gate. */
async function waitForGateWaiters(shopId: number, gatePid: number, expected: number, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last: LockWaiter[] = [];
  while (Date.now() < deadline) {
    const result = await withTenant(shopId, (trx) => trx.raw(`
      SELECT pid, pg_blocking_pids(pid) AS blockers, left(query, 160) AS query
        FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`));
    const waiting: LockWaiter[] = (result.rows as any[]).map((r) => ({
      pid: Number(r.pid), blockers: (r.blockers ?? []).map(Number), query: String(r.query),
    }));
    last = waiting.filter((w) => blockedBehindGate(w.pid, gatePid, waiting));
    if (last.length >= expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`OVERLAP_NOT_ESTABLISHED: expected ${expected} lock waiters, observed ${last.length} (${JSON.stringify(last)})`);
}

/** Holds `SELECT … FOR UPDATE` on the given purchase orders in one transaction until released. */
function holdPoLocks(shopId: number, poIds: string[]) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reportPid!: (pid: number) => void;
  const pidKnown = new Promise<number>((resolve) => { reportPid = resolve; });
  const done = withTenant(shopId, async (trx) => {
    const locked = await trx('purchase_orders').where({ shop_id: shopId }).whereIn('id', poIds).forUpdate();
    expect(locked).toHaveLength(poIds.length);
    const pid = await trx.raw('SELECT pg_backend_pid() AS pid');
    reportPid(Number(pid.rows[0].pid));
    await released;
  });
  return { pidKnown, release, done };
}

async function consumedEvents(j: JobFixture) {
  return withTenant(j.shop.shopId, (trx) =>
    trx('receive_count_confirmation_events')
      .where({ shop_id: j.shop.shopId, receive_job_line_id: j.receiveJobLineId })
      .orderBy('confirmed_at', 'asc')
      .select('event_id', 'quantity_confirmed'));
}

// ── contracts ───────────────────────────────────────────────────────────────

describe('GH-1241 S3-A1 — uncounted inventory safety', () => {
  it('A1 — an untouched line (count never confirmed) cannot finalize 8 accepted units from the optimistic projection', async () => {
    const shop = await provisionFt2Shop('a1');
    const j = await openV2Job(shop, 10);

    const report = await httpReportMissing(j, 2);
    expect(report.status).toBe(201);

    // Precondition evidence: the canonical projection presents 8 as sellable
    // although nothing was physically counted.
    const projected = await fetchLine(j);
    console.info('[S3A1_A1_PROJECTION]', JSON.stringify({
      quantity_sellable_provisional: projected.quantity_sellable_provisional,
      reconciliation_started_at: projected.reconciliation_started_at,
      reconciliation: projected.reconciliation,
    }));
    expect(projected.quantity_sellable_provisional).toBeNull();
    expect(projected.reconciliation_started_at).toBeNull();
    expect(projected.reconciliation).toEqual(expect.objectContaining({
      expected: 10, sellable: 8, accounted: 2, unaccounted: 0,
    }));

    const inspect = await httpInspect(j, { accepted: 8, rejected: 0, missing: 2, deferred: 0 });
    console.info('[S3A1_A1_INSPECT_RESPONSE]', inspect.status, JSON.stringify(inspect.body));
    const after = await effects(j);
    console.info('[S3A1_A1_EFFECTS]', JSON.stringify(after));

    expect(inspect.status).toBeGreaterThanOrEqual(400);
    expect(inspect.status).toBeLessThan(500);
    expect(inspect.body.code).toBe('RECEIVE_COUNT_NOT_CONFIRMED');
    expect(after).toEqual(uncreditedLine(MISSING_TWO));
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);
  });

  it('A2 — an automatically seeded provisional 0 (Start Receive) is not a confirmed count and cannot finalize 8 accepted units', async () => {
    const shop = await provisionFt2Shop('a2');
    const j = await openV2Job(shop, 10);

    // Exact Start Receive request body (GH-1085 R30).
    const seeded = await httpProgress(j, { quantity_sellable_provisional: 0 });
    expect(seeded.status).toBe(200);
    const report = await httpReportMissing(j, 2);
    expect(report.status).toBe(201);

    const inspect = await httpInspect(j, { accepted: 8, rejected: 0, missing: 2, deferred: 0 });
    console.info('[S3A1_A2_INSPECT_RESPONSE]', inspect.status, JSON.stringify(inspect.body));
    const after = await effects(j);
    console.info('[S3A1_A2_EFFECTS]', JSON.stringify(after));

    expect(inspect.status).toBeGreaterThanOrEqual(400);
    expect(inspect.status).toBeLessThan(500);
    expect(inspect.body.code).toBe('RECEIVE_COUNT_NOT_CONFIRMED');
    expect(after).toEqual(uncreditedLine(MISSING_TWO));
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);
  });

  it('C1 — untouched, auto-seeded zero and the reconcile marker are never evidence; only confirm-count records a confirmed zero; no draft credits stock', async () => {
    const shop = await provisionFt2Shop('c1');
    const untouched = await openV2Job(shop, 10);
    const autoSeeded = await openV2Job(shop, 10);
    const marker = await openV2Job(shop, 10);
    const confirmedZero = await openV2Job(shop, 10);
    const confirmedSeven = await openV2Job(shop, 10);

    expect((await httpProgress(autoSeeded, { quantity_sellable_provisional: 0 })).status).toBe(200);
    expect((await httpProgress(marker, {
      quantity_sellable_provisional: 0, reconciliation_required: true,
    })).status).toBe(200);
    const confirmed = await httpConfirmCount(confirmedZero, 0);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual(expect.objectContaining({ quantity_count_confirmed: 0 }));
    expect((await httpConfirmCount(confirmedSeven, 7)).status).toBe(200);

    const shape = async (j: JobFixture) => {
      const line = await fetchLine(j);
      return {
        provisional: line.quantity_sellable_provisional == null ? null : Number(line.quantity_sellable_provisional),
        reconciliationStarted: line.reconciliation_started_at != null,
        confirmed: line.quantity_count_confirmed == null ? null : Number(line.quantity_count_confirmed),
        countState: line.count_state,
        basis: line.reconciliation.sellable_basis,
        sellable: line.reconciliation.sellable,
        unaccounted: line.reconciliation.unaccounted,
      };
    };
    expect({
      untouched: await shape(untouched),
      autoSeeded: await shape(autoSeeded),
      marker: await shape(marker),
      confirmedZero: await shape(confirmedZero),
      confirmedSeven: await shape(confirmedSeven),
    }).toEqual({
      // The untouched projection still reports sellable = expected (GH-1085 B21),
      // but is explicitly labelled as an uncounted projection, never a count.
      untouched: { provisional: null, reconciliationStarted: false, confirmed: null, countState: 'not_counted', basis: 'uncounted_projection', sellable: 10, unaccounted: 0 },
      autoSeeded: { provisional: 0, reconciliationStarted: false, confirmed: null, countState: 'not_counted', basis: 'unconfirmed_draft', sellable: 0, unaccounted: 10 },
      marker: { provisional: 0, reconciliationStarted: true, confirmed: null, countState: 'not_counted', basis: 'unconfirmed_draft', sellable: 0, unaccounted: 10 },
      confirmedZero: { provisional: 0, reconciliationStarted: false, confirmed: 0, countState: 'confirmed', basis: 'confirmed_count', sellable: 0, unaccounted: 10 },
      confirmedSeven: { provisional: 7, reconciliationStarted: false, confirmed: 7, countState: 'confirmed', basis: 'confirmed_count', sellable: 7, unaccounted: 3 },
    });

    const evidence = await countEvidence(confirmedZero);
    expect(evidence).toEqual({ quantity: 0, by: shop.userId, at: expect.anything(), eventId: expect.any(String) });
    for (const j of [untouched, autoSeeded, marker, confirmedZero, confirmedSeven]) {
      expect(await effects(j)).toEqual(uncreditedLine([]));
    }
  });

  it('C2 — an explicitly confirmed zero enters reconciliation and finalizes with zero stock credit (control)', async () => {
    const shop = await provisionFt2Shop('c2');
    const j = await openV2Job(shop, 10);

    expect((await httpConfirmCount(j, 0)).status).toBe(200);
    expect((await httpProgress(j, {
      quantity_sellable_provisional: 0, reconciliation_required: true,
    })).status).toBe(200);
    expect((await httpReportMissing(j, 10)).status).toBe(201);

    const inspect = await httpInspect(j, { accepted: 0, rejected: 0, missing: 10, deferred: 0 });
    expect(inspect.status).toBe(200);

    expect(await effects(j)).toEqual({
      ...uncreditedLine([{ type: 'missing_item', quantity: 10, role: 'shortfall' }]),
      inspectionComplete: true,
      lineDelivered: 0,
      inspectAuditCount: 1,
      // Post-inspection job status is owned by GH-1085 barcode readiness, not this contract.
      jobStatus: expect.any(String),
    });
    // The metadata-only reconcile marker kept the confirmation.
    expect((await countEvidence(j)).quantity).toBe(0);
  });

  it('C3 — an operator who does not own the claimed Receive cannot confirm a count or finalize the line (control)', async () => {
    const shop = await provisionFt2Shop('c3');
    const j = await openV2Job(shop, 10);
    const intruder = await addOperator(shop);

    const confirm = await httpConfirmCount(j, 10, crypto.randomUUID(), intruder.token);
    expect(confirm.status).toBe(409);
    expect(confirm.body).toEqual(expect.objectContaining({ error: 'JOB_CLAIMED_BY_OTHER' }));
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);

    expect((await httpConfirmCount(j, 10)).status).toBe(200);
    const inspect = await httpInspect(j, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }, intruder.token);
    expect(inspect.status).toBe(409);
    expect(inspect.body).toEqual(expect.objectContaining({ error: 'JOB_CLAIMED_BY_OTHER' }));

    expect(await effects(j)).toEqual(uncreditedLine([]));
  });

  it('C4 — a confirmed full count finalizes, closes and credits stock exactly once (control)', async () => {
    const shop = await provisionFt2Shop('c4');
    const j = await openV2Job(shop, 10);

    expect((await httpConfirmCount(j, 10)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 10, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    expect((await httpClose(j)).status).toBe(200);

    const after = await effects(j);
    expect({
      inspectionComplete: after.inspectionComplete, lineAccepted: after.lineAccepted,
      jobStatus: after.jobStatus, quantityReceived: after.quantityReceived, lsuCount: after.lsuCount,
      inventoryMovementCount: after.inventoryMovementCount, truthOnHand: after.truthOnHand,
      stowTaskCount: after.stowTaskCount, inspectAuditCount: after.inspectAuditCount,
    }).toEqual({
      inspectionComplete: true, lineAccepted: 10, jobStatus: 'closed', quantityReceived: 10, lsuCount: 10,
      inventoryMovementCount: 1, truthOnHand: 10, stowTaskCount: 1, inspectAuditCount: 1,
    });
    // Historical evidence survives finalization, and a terminal job's count cannot change.
    const evidence = await countEvidence(j);
    expect(evidence.quantity).toBe(10);
    const late = await httpConfirmCount(j, 9);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('RECEIVE_JOB_TERMINAL');
    expect(await countEvidence(j)).toEqual(evidence);
  });

  it('C5 — a count-changing draft voids the confirmation under the line lock; a metadata-only draft never fabricates or voids it', async () => {
    const shop = await provisionFt2Shop('c5');
    const j = await openV2Job(shop, 10);

    expect((await httpConfirmCount(j, 10)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 9 })).status).toBe(200);
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);

    const stale = await httpInspect(j, { accepted: 10, rejected: 0, missing: 0, deferred: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('RECEIVE_COUNT_NOT_CONFIRMED');
    expect(await effects(j)).toEqual(uncreditedLine([]));

    // A draft alone (even with the reconcile marker and deferral) creates nothing.
    expect((await httpProgress(j, {
      quantity_sellable_provisional: 8, reconciliation_required: true, quantity_deferred: 2,
    })).status).toBe(200);
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);

    // Re-confirmed; a same-quantity metadata update keeps the evidence.
    expect((await httpConfirmCount(j, 8)).status).toBe(200);
    const confirmed = await countEvidence(j);
    expect((await httpProgress(j, {
      quantity_sellable_provisional: 8, reconciliation_required: true, quantity_deferred: 2,
    })).status).toBe(200);
    expect(await countEvidence(j)).toEqual(confirmed);

    const inspect = await httpInspect(j, { accepted: 8, rejected: 0, missing: 0, deferred: 2 });
    expect(inspect.status).toBe(200);
    expect((await effects(j)).lsuCount).toBe(8);
  });

  it('C6 — confirmation replay is a no-op, conflicting replay and count mismatch fail closed, and inspect replay has no double effects', async () => {
    const shop = await provisionFt2Shop('c6');
    const j = await openV2Job(shop, 10);
    const eventId = crypto.randomUUID();

    const first = await httpConfirmCount(j, 8, eventId);
    expect(first.status).toBe(200);
    const evidence = await countEvidence(j);
    const replay = await httpConfirmCount(j, 8, eventId);
    expect(replay.status).toBe(200);
    expect(await countEvidence(j)).toEqual(evidence);

    const conflict = await httpConfirmCount(j, 7, eventId);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    expect(await countEvidence(j)).toEqual(evidence);

    expect((await httpReportMissing(j, 2)).status).toBe(201);
    // Balanced accounting (7 + 1 + 2 = 10) but accepted differs from the confirmed 8: refused.
    const mismatch = await httpInspect(j, { accepted: 7, rejected: 1, missing: 2, deferred: 0 });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('RECEIVE_COUNT_MISMATCH');
    expect(await effects(j)).toEqual(uncreditedLine(MISSING_TWO));

    const inspectEvent = crypto.randomUUID();
    const send = () => request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
      .set(auth(j.shop.token))
      .send({
        lasyncro_variant_id: j.lasyncroVariantId, receive_job_line_id: j.receiveJobLineId,
        quantity_accepted: 8, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
        device_event_id: inspectEvent,
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const after = await effects(j);
    expect({ lsu: after.lsuCount, audits: after.inspectAuditCount, unitsAccepted: after.unitsAccepted })
      .toEqual({ lsu: 8, audits: 1, unitsAccepted: 8 });
  });

  it('C7 — the count of an inspected line cannot change', async () => {
    const shop = await provisionFt2Shop('c7');
    const j = await openV2Job(shop, 10);

    expect((await httpConfirmCount(j, 10)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 10, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    const evidence = await countEvidence(j);

    const recount = await httpConfirmCount(j, 9);
    expect(recount.status).toBe(409);
    expect(recount.body.code).toBe('RECEIVE_LINE_ALREADY_INSPECTED');
    expect(await countEvidence(j)).toEqual(evidence);
  });
  it('C8 — an invalidated or superseded confirmation event can never restore evidence; consumed events are append-only', async () => {
    const shop = await provisionFt2Shop('c8');
    const j = await openV2Job(shop, 10);
    const eventE = crypto.randomUUID();

    expect((await httpConfirmCount(j, 8, eventE)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 7 })).status).toBe(200);
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);

    // Retrying E with its original quantity must not resurrect the voided count.
    const retry = await httpConfirmCount(j, 8, eventE);
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);
    const stale = await httpInspect(j, { accepted: 8, rejected: 0, missing: 0, deferred: 2 });
    expect(stale.status).toBe(409);
    expect(await effects(j)).toEqual(uncreditedLine([]));

    const eventF = crypto.randomUUID();
    expect((await httpConfirmCount(j, 7, eventF)).status).toBe(200);
    const active = await countEvidence(j);
    expect(active).toEqual(expect.objectContaining({ quantity: 7, eventId: eventF }));

    const retryAgain = await httpConfirmCount(j, 8, eventE);
    expect(retryAgain.status).toBe(409);
    expect(retryAgain.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    expect(await countEvidence(j)).toEqual(active);
    // F stays a safe replay while it is the active confirmation.
    expect((await httpConfirmCount(j, 7, eventF)).status).toBe(200);
    expect(await countEvidence(j)).toEqual(active);

    expect(await consumedEvents(j)).toEqual([
      { event_id: eventE, quantity_confirmed: 8 },
      { event_id: eventF, quantity_confirmed: 7 },
    ]);
    // The consumed-event history cannot be rewritten or erased by the runtime role.
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shop.shopId, event_id: eventE }).update({ quantity_confirmed: 7 })))
      .rejects.toThrow(/append-only|permission denied/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shop.shopId, event_id: eventE }).del()))
      .rejects.toThrow(/append-only|permission denied/);
    expect(await effects(j)).toEqual(uncreditedLine([]));
  });

  it('C9 — a confirmation event consumed on one line cannot confirm another line', async () => {
    const shop = await provisionFt2Shop('c9');
    const a = await openV2Job(shop, 10);
    const b = await openV2Job(shop, 10);
    const eventE = crypto.randomUUID();

    expect((await httpConfirmCount(a, 10, eventE)).status).toBe(200);
    const reuse = await httpConfirmCount(b, 10, eventE);
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    expect(await countEvidence(b)).toEqual(NO_EVIDENCE);
    expect(await consumedEvents(b)).toEqual([]);

    const inspect = await httpInspect(b, { accepted: 10, rejected: 0, missing: 0, deferred: 0 });
    expect(inspect.status).toBe(409);
    expect(await effects(b)).toEqual(uncreditedLine([]));
  });

  it('C10 — overlapping confirmations reusing one event: exactly one wins on the same line and across purchase orders', async () => {
    const shop = await provisionFt2Shop('c10');
    const same = await openV2Job(shop, 10);
    const otherA = await openV2Job(shop, 10);
    const otherB = await openV2Job(shop, 10);

    // (a) Same line, same event, conflicting quantities, both blocked behind the PO gate.
    const eventE = crypto.randomUUID();
    const gateA = holdPoLocks(shop.shopId, [same.poId]);
    const gateAPid = await gateA.pidKnown;
    const raceA = [httpConfirmCount(same, 6, eventE), httpConfirmCount(same, 7, eventE)].map((r) => r.then((x) => x));
    let waitersA: LockWaiter[];
    try {
      waitersA = await waitForGateWaiters(shop.shopId, gateAPid, 2);
    } finally {
      gateA.release();
    }
    await gateA.done;
    const resultsA = await Promise.all(raceA);
    expect(waitersA.length).toBe(2);
    expect(resultsA.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(resultsA.find((r) => r.status === 409)!.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    const winner = resultsA.find((r) => r.status === 200)!.body.quantity_count_confirmed;
    expect(await consumedEvents(same)).toEqual([{ event_id: eventE, quantity_confirmed: winner }]);
    expect((await countEvidence(same)).quantity).toBe(winner);

    // (b) Different purchase orders (independent PO locks), one event: the durable record admits one.
    const eventG = crypto.randomUUID();
    const gateB = holdPoLocks(shop.shopId, [otherA.poId, otherB.poId]);
    const gateBPid = await gateB.pidKnown;
    const raceB = [httpConfirmCount(otherA, 10, eventG), httpConfirmCount(otherB, 10, eventG)].map((r) => r.then((x) => x));
    let waitersB: LockWaiter[];
    try {
      waitersB = await waitForGateWaiters(shop.shopId, gateBPid, 2);
    } finally {
      gateB.release();
    }
    await gateB.done;
    const resultsB = await Promise.all(raceB);
    expect(waitersB.length).toBe(2);
    expect(resultsB.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(resultsB.find((r) => r.status === 409)!.body.code).toBe('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT');
    const evidence = [await countEvidence(otherA), await countEvidence(otherB)];
    expect(evidence.filter((e) => e.eventId === eventG)).toHaveLength(1);
    expect(evidence.filter((e) => e.eventId === null)).toHaveLength(1);
    for (const j of [same, otherA, otherB]) expect(await effects(j)).toEqual(uncreditedLine([]));
  });

  it('C12 — a persisted overage draft plus overage approval without a confirmed count cannot finalize; reconfirmation can', async () => {
    const shop = await provisionFt2Shop('c12');
    const j = await openV2Job(shop, 10);

    expect((await httpProgress(j, { quantity_sellable_provisional: 11 })).status).toBe(200);
    const approval = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
      .set(auth(shop.token))
      .send({
        lasyncro_variant_id: j.lasyncroVariantId, receive_job_line_id: j.receiveJobLineId,
        exception_type: 'extra_item', accounting_role: 'overage', quantity_affected: 1,
        notes: 'Accepted 1 extra unit', device_event_id: crypto.randomUUID(),
      });
    expect(approval.status).toBe(201);

    const projected = await fetchLine(j);
    expect({
      countState: projected.count_state, basis: projected.reconciliation.sellable_basis,
      overageApproved: projected.reconciliation.overage_approved,
    }).toEqual({ countState: 'not_counted', basis: 'unconfirmed_draft', overageApproved: true });

    const refused = await httpInspect(j, { accepted: 11, rejected: 0, missing: 0, deferred: 0 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RECEIVE_COUNT_NOT_CONFIRMED');
    const overage = [{ type: 'extra_item', quantity: 1, role: 'overage' }];
    expect(await effects(j)).toEqual(uncreditedLine(overage));
    expect(await countEvidence(j)).toEqual(NO_EVIDENCE);

    // Explicit Finish Count reconfirmation preserves the valid approved overage.
    expect((await httpConfirmCount(j, 11)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 11, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    expect((await effects(j)).lsuCount).toBe(11);
  });

  // G3 — consumed-event lineage is bound to the line by BOTH shop_id and
  // receive_job_line_id, so even the runtime role inside a valid tenant
  // context cannot record count evidence against another tenant's line.
  it('C13 — a confirmation event cannot reference another tenant\'s Receive line', async () => {
    const shopA = await provisionFt2Shop('c13a');
    const shopB = await provisionFt2Shop('c13b');
    const lineB = await openV2Job(shopB, 10);
    const eventId = crypto.randomUUID();

    const crossTenant = withTenant(shopA.shopId, (trx) =>
      trx('receive_count_confirmation_events').insert({
        shop_id: shopA.shopId, event_id: eventId,
        receive_job_line_id: lineB.receiveJobLineId, quantity_confirmed: 10, confirmed_by: shopA.userId,
      }));
    await expect(crossTenant).rejects.toThrow(/violates foreign key constraint/);

    expect(await withTenant(shopA.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shopA.shopId, event_id: eventId }))).toEqual([]);
    expect(await consumedEvents(lineB)).toEqual([]);
    expect(await countEvidence(lineB)).toEqual(NO_EVIDENCE);

    // Control: the owning tenant's real route still records the same event.
    expect((await httpConfirmCount(lineB, 10, eventId)).status).toBe(200);
    expect(await consumedEvents(lineB)).toEqual([{ event_id: eventId, quantity_confirmed: 10 }]);
  });
});

// ── migration 0209 rollback safety (precedent: 0208 migration-safety suite) ──
//
// Each scenario opens its OWN migration-role transaction, invokes the REAL
// 0209 migration source inside a savepoint, asserts, then ALWAYS rolls back.

const COLUMNS_0209 = [
  'receive_job_lines.count_confirmation_event_id',
  'receive_job_lines.count_confirmed_at',
  'receive_job_lines.count_confirmed_by',
  'receive_job_lines.quantity_count_confirmed',
];

describe('GH-1241 S3-A1 — migration 0209 never destroys persisted count evidence', () => {
  let migrationDb: Knex;
  let migrationShopId: number;

  beforeAll(async () => {
    expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
    migrationDb = knexLib({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGMIGRATION_USER,
        password: process.env.PGMIGRATION_PASSWORD,
        database: process.env.PGDATABASE,
      },
      pool: { min: 0, max: 2 },
    });
    migrationShopId = await systemTransaction(async (trx) => {
      const id = await createTenantShop(trx, `gh1241-0209-${crypto.randomBytes(6).toString('hex')}`);
      await setTenantContext(trx, id);
      return id;
    });
  });

  afterAll(async () => {
    if (migrationDb) await migrationDb.destroy();
  });

  async function inRolledBackTransaction(body: (trx: Knex.Transaction) => Promise<void>) {
    const sentinel = new Error('__rollback__');
    try {
      await migrationDb.transaction(async (trx) => { await body(trx); throw sentinel; });
    } catch (err) {
      if (err !== sentinel) throw err;
    }
  }

  function inSavepoint(trx: Knex.Transaction, body: (sp: Knex.Transaction) => Promise<void>) {
    return trx.transaction(body).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  }

  async function schema0209(trx: Knex.Transaction) {
    const columns = await trx.raw(
      `SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name || '.' || column_name = ANY(?::text[]) ORDER BY 1`,
      [COLUMNS_0209],
    );
    const index = await trx.raw(`SELECT 1 FROM pg_indexes WHERE indexname = 'receive_count_confirmation_event_unique'`);
    const check = await trx.raw(`SELECT 1 FROM pg_constraint WHERE conname = 'receive_count_confirmation_valid'`);
    const eventTable = await trx.raw(
      `SELECT (SELECT count(*) FROM pg_class WHERE relname = 'receive_count_confirmation_events' AND relkind = 'r') AS tables,
              (SELECT count(*) FROM pg_trigger WHERE tgname IN ('receive_count_confirmation_events_no_update', 'receive_count_confirmation_events_no_delete')) AS triggers,
              (SELECT count(*) FROM pg_proc WHERE proname = 'prevent_receive_count_confirmation_event_mutation') AS functions`,
    );
    const fk = await trx.raw(
      `SELECT c.confdeltype AS on_delete FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND r.relname = 'users' AND t.relname = 'receive_job_lines' AND a.attname = 'count_confirmed_by'`,
    );
    const lineage = await trx.raw(
      `SELECT array_to_string(ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord), ',') AS columns,
              c.confdeltype AS on_delete
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_class r ON r.oid = c.confrelid
        WHERE c.contype = 'f' AND t.relname = 'receive_count_confirmation_events' AND r.relname = 'receive_job_lines'`,
    );
    const lineUnique = await trx.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = 'receive_job_lines_shop_line_unique' AND contype = 'u'`,
    );
    return {
      columns: columns.rows.map((r: any) => r.name),
      lineage: lineage.rows.map((r: any) => `${r.columns}:${r.on_delete}`),
      lineUnique: lineUnique.rows.length,
      index: index.rows.length,
      check: check.rows.length,
      confirmedByOnDelete: fk.rows[0]?.on_delete ?? null,
      eventLog: {
        tables: Number(eventTable.rows[0].tables),
        triggers: Number(eventTable.rows[0].triggers),
        functions: Number(eventTable.rows[0].functions),
      },
    };
  }

  const HEAD = { columns: COLUMNS_0209, lineage: ['shop_id,receive_job_line_id:r'], lineUnique: 1, index: 1, check: 1, confirmedByOnDelete: 'n', eventLog: { tables: 1, triggers: 2, functions: 1 } };
  const PRE_0209 = { columns: [], lineage: [], lineUnique: 0, index: 0, check: 0, confirmedByOnDelete: null, eventLog: { tables: 0, triggers: 0, functions: 0 } };

  async function withoutPersistedEvidence(trx: Knex.Transaction) {
    await trx.raw(`SET LOCAL row_security = off`);
    await trx.raw(`
      UPDATE receive_job_lines
         SET quantity_count_confirmed = NULL, count_confirmed_by = NULL,
             count_confirmed_at = NULL, count_confirmation_event_id = NULL
       WHERE quantity_count_confirmed IS NOT NULL OR count_confirmed_by IS NOT NULL
          OR count_confirmed_at IS NOT NULL OR count_confirmation_event_id IS NOT NULL`);
    // Consumed-event history is append-only; it is removed ONLY inside this
    // always-rolled-back migration-role transaction, by the table owner.
    await trx.raw(`
      ALTER TABLE receive_count_confirmation_events DISABLE TRIGGER receive_count_confirmation_events_no_delete;
      DELETE FROM receive_count_confirmation_events;
      ALTER TABLE receive_count_confirmation_events ENABLE TRIGGER receive_count_confirmation_events_no_delete;`);
  }

  it('M1 — without persisted evidence DOWN → UP round-trips; head keeps SET NULL provenance', async () => {
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0209(trx)).toEqual(HEAD);
      await withoutPersistedEvidence(trx);
      expect(await inSavepoint(trx, (sp) => migration0209.down(sp))).toEqual({ ok: true });
      expect(await schema0209(trx)).toEqual(PRE_0209);
      expect(await inSavepoint(trx, (sp) => migration0209.up(sp))).toEqual({ ok: true });
      expect(await schema0209(trx)).toEqual(HEAD);
    });
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0209(trx)).toEqual(HEAD);
    });
  });

  it('M2 — DOWN refuses while confirmed-count evidence exists, leaving schema and evidence unchanged', async () => {
    await inRolledBackTransaction(async (trx) => {
      await withoutPersistedEvidence(trx);
      await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(migrationShopId)]);
      const [supplier] = await trx('suppliers')
        .insert({ shop_id: migrationShopId, name: `GH1241 0209 ${crypto.randomUUID()}` }).returning('id');
      const [po] = await trx('purchase_orders')
        .insert({ shop_id: migrationShopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
      const [poLine] = await trx('purchase_order_line_items')
        .insert({ po_id: po.id, shop_id: migrationShopId, description: 'GH1241 0209 line', quantity_ordered: 3, unit_cost_cents: 100 })
        .returning('id');
      const [job] = await trx('receive_jobs')
        .insert({ shop_id: migrationShopId, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2 })
        .returning('receive_job_id');
      const eventId = crypto.randomUUID();
      const [line] = await trx('receive_job_lines')
        .insert({
          shop_id: migrationShopId, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id,
          quantity_expected: 3, quantity_count_confirmed: 3, count_confirmed_at: new Date(),
          count_confirmation_event_id: eventId,
        })
        .returning('receive_job_line_id');
      const read = () => trx('receive_job_lines').where({ receive_job_line_id: line.receive_job_line_id })
        .first('quantity_count_confirmed', 'count_confirmation_event_id');
      const before = await read();

      const outcome = await inSavepoint(trx, (sp) => migration0209.down(sp));
      expect(outcome.ok).toBe(false);
      expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_COUNT_CONFIRMATION_ROLLBACK_BLOCKED/);
      expect(await schema0209(trx)).toEqual(HEAD);
      expect(await read()).toEqual(before);

      // Consumed-event history alone (active confirmation already voided) still blocks DOWN.
      await trx('receive_count_confirmation_events').insert({
        shop_id: migrationShopId, event_id: eventId, receive_job_line_id: line.receive_job_line_id, quantity_confirmed: 3,
      });
      await trx('receive_job_lines').where({ receive_job_line_id: line.receive_job_line_id }).update({
        quantity_count_confirmed: null, count_confirmed_at: null, count_confirmation_event_id: null,
      });
      const historyOnly = await inSavepoint(trx, (sp) => migration0209.down(sp));
      expect(historyOnly.ok).toBe(false);
      expect(String((historyOnly as any).error?.message)).toMatch(/RECEIVE_COUNT_CONFIRMATION_ROLLBACK_BLOCKED/);
      expect(await schema0209(trx)).toEqual(HEAD);
    });
  });
});
