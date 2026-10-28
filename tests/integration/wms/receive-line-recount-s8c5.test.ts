/**
 * S8-C5 — RECEIVE PER-LINE RECOUNT (migration 0223) — regression gate R1–R9.
 *
 * Ratified contract (SF-RECEIVE-S8C5-RECOVERY-WORKSHOP-009, C2): before
 * inspection, POST /receive-jobs/:jobId/lines/:lineId/recount { device_event_id }
 * atomically supersedes (never deletes) every active shortfall allocation on
 * the line, resets its later-delivery quantity, and voids the count
 * confirmation and reconciliation marker. The provisional count is kept; the
 * next confirm-count re-establishes evidence. Overage approvals, non-accounting
 * problems and other lines are untouched. A Recount event is consumed once.
 *
 * Every mutation goes through the real routes (createApp + supertest) against
 * the disposable synchroflow_test_* database (`npm run test:integration`).
 * Fixtures follow the GH-1241 S3-A1 suite.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { recountReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';
import knexLib, { Knex } from 'knex';
import * as migration0223 from
  '../../../apps/backend/migrations/20261027120000_0223_receive_line_recount_supersession';

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

// ── provisioning (same pattern as the GH-1241 S3-A1 suite) ──────────────────

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
}

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvrecount-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
  return { shopId, userId, token };
}

/** A second, legitimate operator of the same shop (GH-1111 membership shape). */
async function addOperator(shop: Shop): Promise<{ userId: number; token: string }> {
  const userId = await withTenant(shop.shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.shopId,
        email: `receive-recount-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
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

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/RCNT${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/RCNT${nonce}`,
          title: `S8-C5 recount fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `S8C5-RCNT-${nonce}`,
                  barcode: EXTERNAL_BARCODE,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/RCNT${nonce}`,
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
  supplierId: number;
  poId: string;
  receiveJobId: string;
  receiveJobLineId: string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** supplier → single-line shipped PO (expected 10) → real create route → real claim. */
async function openV2Job(shop: Shop, quantityOrdered = 10): Promise<JobFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const lasyncroVariantId = await seedMappedVariant(shop.shopId);

  const { poId, supplierId } = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S8-C5 recount supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id,
      shop_id: shop.shopId,
      lasyncro_variant_id: lasyncroVariantId,
      description: 'S8-C5 recount line',
      quantity_ordered: quantityOrdered,
      unit_cost_cents: 400,
    });
    return { poId: po.id as string, supplierId: Number(supplier.id) };
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
  return { shop, lasyncroVariantId, supplierId, poId, receiveJobId, receiveJobLineId: line!.receive_job_line_id as string };
}

// ── real route calls ────────────────────────────────────────────────────────

function httpProgress(j: JobFixture, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.receiveJobLineId}/progress`)
    .set(auth(j.shop.token))
    .send(body);
}

function httpConfirmCount(j: JobFixture, quantity: number) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.receiveJobLineId}/confirm-count`)
    .set(auth(j.shop.token))
    .send({ quantity_confirmed: quantity, device_event_id: crypto.randomUUID() });
}

/** The exact body the web reconciliation sends for a shortfall allocation. */
function httpReportShortfall(j: JobFixture, type: 'defect' | 'missing_item', quantity: number) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
    .set(auth(j.shop.token))
    .send({
      lasyncro_variant_id: j.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      exception_type: type,
      quantity_affected: quantity,
      accounting_role: 'shortfall',
      notes: `${quantity} ${type} during receive`,
      device_event_id: crypto.randomUUID(),
    });
}

/** A non-accounting problem report (Report problem never sends accounting_role). */
function httpReportBarcodeMismatch(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
    .set(auth(j.shop.token))
    .send({
      lasyncro_variant_id: j.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      exception_type: 'barcode_mismatch',
      quantity_affected: 1,
      notes: 'scanned 0000000000000',
      device_event_id: crypto.randomUUID(),
    });
}

function httpRecount(j: JobFixture, deviceEventId: string = crypto.randomUUID(), token: string = j.shop.token, lineId = j.receiveJobLineId) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${lineId}/recount`)
    .set(auth(token))
    .send({ device_event_id: deviceEventId });
}

function httpInspect(j: JobFixture, d: { accepted: number; rejected: number; missing: number; deferred: number }) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
    .set(auth(j.shop.token))
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

function httpClose(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.shop.token))
    .send({ actual_delivery_date: '2026-10-27' });
}

async function fetchLine(j: JobFixture) {
  const response = await request(app)
    .get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`)
    .set(auth(j.shop.token));
  expect(response.status).toBe(200);
  const line = response.body.lines.find((candidate: any) => candidate.receive_job_line_id === j.receiveJobLineId);
  expect(line).toBeTruthy();
  return line;
}

/** Counted 6 of 10, then allocated: defect 2, missing 1, later delivery 1 (operator really has 8). */
async function miscountedWithAllocations(j: JobFixture) {
  expect((await httpProgress(j, { quantity_sellable_provisional: 6 })).status).toBe(200);
  expect((await httpConfirmCount(j, 6)).status).toBe(200);
  expect((await httpProgress(j, { quantity_sellable_provisional: 6, reconciliation_required: true })).status).toBe(200);
  expect((await httpReportShortfall(j, 'defect', 2)).status).toBe(201);
  expect((await httpReportShortfall(j, 'missing_item', 1)).status).toBe(201);
  expect((await httpProgress(j, { quantity_sellable_provisional: 6, reconciliation_required: true, quantity_deferred: 1 })).status).toBe(200);
}

/** Fixture-scoped evidence snapshot (never global counts). */
async function state(j: JobFixture) {
  return withTenant(j.shop.shopId, async (trx) => {
    const line = await trx('receive_job_lines')
      .where({ shop_id: j.shop.shopId, receive_job_line_id: j.receiveJobLineId })
      .first('quantity_sellable_provisional', 'quantity_count_confirmed', 'count_confirmation_event_id',
        'quantity_deferred', 'reconciliation_started_at', 'inspection_complete', 'quantity_accepted');
    const exceptions = await trx('receive_exceptions')
      .where({ shop_id: j.shop.shopId, receive_job_line_id: j.receiveJobLineId })
      .orderBy('raised_at', 'asc')
      .select('receive_exception_id', 'exception_type', 'quantity_affected', 'accounting_role',
        'superseded_at', 'superseded_by', 'superseded_by_recount_event_id');
    const events = await trx('receive_line_recount_events')
      .where({ shop_id: j.shop.shopId, receive_job_line_id: j.receiveJobLineId })
      .select('event_id', 'superseded_count', 'previous_quantity_count_confirmed', 'previous_quantity_deferred',
        'previous_quantity_sellable_provisional', 'recounted_by');
    const alert = await trx('alerts')
      .where({ shop_id: j.shop.shopId, alert_key: `wms:receive:exception:${j.receiveJobId}:${j.lasyncroVariantId}` })
      .first('is_active');
    const movements = await trx('inventory_movements')
      .where({ shop_id: j.shop.shopId, reference_type: 'receive_job', reference_id: j.receiveJobId })
      .select('movement_type', 'quantity_delta');
    const supplier = await trx('suppliers').where({ shop_id: j.shop.shopId, id: j.supplierId }).first('defect_rate');
    return { line, exceptions, events, alertActive: alert?.is_active ?? null, movements, defectRate: supplier?.defect_rate ?? null };
  });
}

const active = (rows: any[]) => rows.filter((e) => e.superseded_at == null);

// ── R1–R9 ───────────────────────────────────────────────────────────────────

describe('S8-C5 — per-line Recount supersedes shortfall allocations before inspection', () => {
  let shop: Shop;
  let other: Shop;

  beforeAll(async () => {
    shop = await provisionFt2Shop('main');
    other = await provisionFt2Shop('other');
  });

  it('R1/R7/R9 — recount after defect + missing + later allocations; corrected count inspects and closes with one correct credit; superseded defect leaves supplier metrics; alert clears', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const before = await state(j);
    expect(active(before.exceptions).map((e) => [e.exception_type, e.quantity_affected])).toEqual([['defect', 2], ['missing_item', 1]]);
    expect(Number(before.line.quantity_deferred)).toBe(1);
    expect(before.alertActive).toBe(true);

    const eventId = crypto.randomUUID();
    const recount = await httpRecount(j, eventId);
    expect(recount.status).toBe(200);
    expect(recount.body).toEqual(expect.objectContaining({ recount_event_id: eventId, replayed: false, quantity_sellable_provisional: 6, quantity_count_confirmed: null }));
    expect(recount.body.superseded_exception_ids).toHaveLength(2);
    expect(recount.body.reconciliation).toEqual(expect.objectContaining({ sellable: 6, accounted: 0, unaccounted: 4 }));

    const after = await state(j);
    // History survives: rows kept, superseded with provenance.
    expect(after.exceptions).toHaveLength(2);
    expect(after.exceptions.every((e) => e.superseded_at != null && e.superseded_by_recount_event_id === eventId && e.superseded_by === shop.userId)).toBe(true);
    expect({
      provisional: Number(after.line.quantity_sellable_provisional),
      confirmed: after.line.quantity_count_confirmed,
      confirmationEvent: after.line.count_confirmation_event_id,
      deferred: Number(after.line.quantity_deferred),
      reconciliationStarted: after.line.reconciliation_started_at,
      inspected: after.line.inspection_complete,
    }).toEqual({ provisional: 6, confirmed: null, confirmationEvent: null, deferred: 0, reconciliationStarted: null, inspected: false });
    expect(after.events).toEqual([expect.objectContaining({
      event_id: eventId, superseded_count: 2, previous_quantity_count_confirmed: 6, previous_quantity_deferred: 1,
      previous_quantity_sellable_provisional: 6, recounted_by: shop.userId,
    })]);
    expect(after.alertActive).toBe(false);

    // GET projection: superseded allocations are not accounting evidence nor reported problems.
    const projected = await fetchLine(j);
    expect(projected.reconciliation.allocations).toEqual([]);
    expect(projected.reported_problems).toEqual([]);

    // Corrected count 8 → fresh missing 2 → inspection succeeds; SELLABLE + ACCOUNTED = EXPECTED.
    expect((await httpProgress(j, { quantity_sellable_provisional: 8 })).status).toBe(200);
    expect((await httpConfirmCount(j, 8)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 8, reconciliation_required: true })).status).toBe(200);
    expect((await httpReportShortfall(j, 'missing_item', 2)).status).toBe(201);
    expect((await httpInspect(j, { accepted: 8, rejected: 0, missing: 2, deferred: 0 })).status).toBe(200);
    expect((await httpClose(j)).status).toBe(200);

    const closed = await state(j);
    expect(closed.movements).toEqual([{ movement_type: 'inbound_purchase', quantity_delta: 8 }]);
    expect(Number(closed.line.quantity_accepted)).toBe(8);
    // Only the superseded defect existed: defect_rate is 0, not 2/8.
    expect(Number(closed.defectRate)).toBe(0);
  });

  it('R1b — non-accounting problems survive a Recount and keep the owner alert active', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    expect((await httpReportBarcodeMismatch(j)).status).toBe(201);
    expect((await httpRecount(j)).status).toBe(200);
    const after = await state(j);
    expect(active(after.exceptions).map((e) => e.exception_type)).toEqual(['barcode_mismatch']);
    expect(after.alertActive).toBe(true);
  });

  it('R2 — superseded missing_item no longer binds inspection (the stuck-line case unblocks)', async () => {
    const j = await openV2Job(shop);
    expect((await httpProgress(j, { quantity_sellable_provisional: 6 })).status).toBe(200);
    expect((await httpConfirmCount(j, 6)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 6, reconciliation_required: true })).status).toBe(200);
    expect((await httpReportShortfall(j, 'missing_item', 4)).status).toBe(201);
    // Without Recount the corrected count can never inspect: canonical missing 4 is permanent.
    expect((await httpProgress(j, { quantity_sellable_provisional: 8 })).status).toBe(200);
    expect((await httpConfirmCount(j, 8)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 8, rejected: 0, missing: 4, deferred: 0 })).status).toBe(409);
    expect((await httpInspect(j, { accepted: 8, rejected: 0, missing: 2, deferred: 0 })).status).toBe(409);

    expect((await httpRecount(j)).status).toBe(200);
    expect((await httpConfirmCount(j, 8)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 8, reconciliation_required: true })).status).toBe(200);
    expect((await httpReportShortfall(j, 'missing_item', 2)).status).toBe(201);
    expect((await httpInspect(j, { accepted: 8, rejected: 0, missing: 2, deferred: 0 })).status).toBe(200);
  });

  it('R3 — refused with zero side effects after inspection, after close, and for a grouped Receive', async () => {
    // inspected line
    const inspected = await openV2Job(shop);
    expect((await httpProgress(inspected, { quantity_sellable_provisional: 10 })).status).toBe(200);
    expect((await httpConfirmCount(inspected, 10)).status).toBe(200);
    expect((await httpInspect(inspected, { accepted: 10, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    const atInspect = await state(inspected);
    const r1 = await httpRecount(inspected);
    expect([r1.status, r1.body.code]).toEqual([409, 'RECEIVE_LINE_ALREADY_INSPECTED']);
    expect(await state(inspected)).toEqual(atInspect);

    // closed job
    expect((await httpClose(inspected)).status).toBe(200);
    const atClose = await state(inspected);
    const r2 = await httpRecount(inspected);
    expect([r2.status, r2.body.code]).toEqual([409, 'RECEIVE_JOB_TERMINAL']);
    expect(await state(inspected)).toEqual(atClose);

    // grouped draft exists
    const grouped = await openV2Job(shop);
    const draft = await request(app)
      .put(`/api/v1/suppliers/receive-jobs/${grouped.receiveJobId}/reconciliation/draft`)
      .set(auth(shop.token))
      .send({
        base_revision_id: null,
        device_event_id: crypto.randomUUID(),
        lines: [{ receive_job_line_id: grouped.receiveJobLineId, quantity_accepted: 10, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0 }],
      });
    expect(draft.status).toBe(200);
    const atDraft = await state(grouped);
    const r3 = await httpRecount(grouped);
    expect([r3.status, r3.body.code]).toEqual([409, 'RECEIVE_RECOUNT_GROUPED']);
    expect(await state(grouped)).toEqual(atDraft);
  });

  it('R4 — a non-owner operator is refused and another tenant cannot see the job; nothing changes', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const before = await state(j);
    const intruder = await addOperator(shop);
    expect((await httpRecount(j, crypto.randomUUID(), intruder.token)).status).toBe(403);
    expect([403, 404]).toContain((await httpRecount(j, crypto.randomUUID(), other.token)).status);
    expect(await state(j)).toEqual(before);
    // Tenant RLS on the event table.
    expect(await withTenant(other.shopId, (trx) => trx('receive_line_recount_events').where({ receive_job_line_id: j.receiveJobLineId }))).toEqual([]);
  });

  it('R5 — an exact replay is a no-op even after new allocations; a reused event on another line fails closed', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const eventId = crypto.randomUUID();
    expect((await httpRecount(j, eventId)).status).toBe(200);
    expect((await httpConfirmCount(j, 6)).status).toBe(200);
    expect((await httpProgress(j, { quantity_sellable_provisional: 6, reconciliation_required: true })).status).toBe(200);
    expect((await httpReportShortfall(j, 'defect', 4)).status).toBe(201);
    const beforeReplay = await state(j);

    const replay = await httpRecount(j, eventId);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.superseded_exception_ids).toHaveLength(2);
    expect(await state(j)).toEqual(beforeReplay);
    expect(active(beforeReplay.exceptions).map((e) => [e.exception_type, e.quantity_affected])).toEqual([['defect', 4]]);

    const k = await openV2Job(shop);
    const conflict = await httpRecount(k, eventId);
    expect([conflict.status, conflict.body.code]).toEqual([409, 'RECEIVE_RECOUNT_REPLAY_CONFLICT']);
  });

  it('R6 — concurrent Recounts serialize: one supersede set; a concurrent same-event retry applies once', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const [a, b] = await Promise.all([httpRecount(j), httpRecount(j)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const counts = [a.body.superseded_exception_ids.length, b.body.superseded_exception_ids.length].sort();
    expect(counts).toEqual([0, 2]);
    const after = await state(j);
    expect(new Set(after.exceptions.map((e) => e.superseded_by_recount_event_id)).size).toBe(1);
    expect(after.events.map((e) => e.superseded_count).sort()).toEqual([0, 2]);

    const k = await openV2Job(shop);
    await miscountedWithAllocations(k);
    const eventId = crypto.randomUUID();
    const [c, d] = await Promise.all([httpRecount(k, eventId), httpRecount(k, eventId)]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect([c.body.replayed, d.body.replayed].sort()).toEqual([false, true]);
    expect((await state(k)).events).toHaveLength(1);
  });

  it('R8 — a failure inside the transaction rolls back every Recount write', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const before = await state(j);
    const sentinel = new Error('__inject_failure__');
    await expect(withTenant(shop.shopId, async (trx) => {
      await recountReceiveJobLine(trx, {
        shopId: shop.shopId, receiveJobId: j.receiveJobId, receiveJobLineId: j.receiveJobLineId,
        recountEventId: crypto.randomUUID(), recountedBy: shop.userId,
      });
      throw sentinel;
    })).rejects.toBe(sentinel);
    expect(await state(j)).toEqual(before);
  });

  it('R10 — after a Recount, grouped reconciliation finalizes on fresh evidence; a superseded allocation is never accepted as active', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const recount = await httpRecount(j);
    expect(recount.status).toBe(200);
    const superseded = (recount.body.superseded_exception_ids as string[]).map((id) => id.toLowerCase()).sort();
    expect(superseded).toHaveLength(2);
    expect((await httpProgress(j, { quantity_sellable_provisional: 8 })).status).toBe(200);
    expect((await httpConfirmCount(j, 8)).status).toBe(200);

    const groupedLine = (existing: string[]) => ({
      receive_job_line_id: j.receiveJobLineId,
      quantity_accepted: 8,
      quantity_rejected: 0,
      quantity_missing: 2,
      quantity_deferred: 0,
      new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
      existing_exception_ids: existing,
    });
    const draft = (base: string | null, existing: string[]) => request(app)
      .put(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/reconciliation/draft`)
      .set(auth(shop.token))
      .send({ base_revision_id: base, device_event_id: crypto.randomUUID(), lines: [groupedLine(existing)] });
    const finalize = (revision: string, existing: string[]) => request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/reconciliation/finalize`)
      .set(auth(shop.token))
      .send({ current_revision_id: revision, device_event_id: crypto.randomUUID(), lines: [groupedLine(existing)] });

    // A client still referencing superseded evidence is refused and writes nothing.
    const stale = await draft(null, superseded);
    expect(stale.status).toBe(200);
    const atStale = await state(j);
    const refused = await finalize(stale.body.revision_id, superseded);
    expect([refused.status, refused.body.code]).toEqual([409, 'RECEIVE_RECONCILIATION_EVIDENCE_UNKNOWN']);
    expect(await state(j)).toEqual(atStale);

    // Referencing only active evidence (none), finalize and Close succeed.
    const fresh = await draft(stale.body.revision_id, []);
    expect(fresh.status).toBe(200);
    expect((await finalize(fresh.body.revision_id, [])).status).toBe(200);
    expect((await httpClose(j)).status).toBe(200);

    const closed = await state(j);
    expect(closed.movements).toEqual([{ movement_type: 'inbound_purchase', quantity_delta: 8 }]);
    expect(Number(closed.line.quantity_accepted)).toBe(8);
    // History kept: both superseded rows survive beside the one fresh missing allocation.
    expect(closed.exceptions.filter((e) => e.superseded_at != null).map((e) => String(e.receive_exception_id).toLowerCase()).sort()).toEqual(superseded);
    expect(active(closed.exceptions).map((e) => [e.exception_type, e.quantity_affected])).toEqual([['missing_item', 2]]);
    expect(Number(closed.defectRate)).toBe(0);
  });

  it('R11 — an overage approval kept by a Recount only bounds the re-confirmed count; it never credits more than that count', async () => {
    const j = await openV2Job(shop);
    expect((await httpProgress(j, { quantity_sellable_provisional: 12 })).status).toBe(200);
    expect((await httpConfirmCount(j, 12)).status).toBe(200);
    const approval = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
      .set(auth(shop.token))
      .send({
        lasyncro_variant_id: j.lasyncroVariantId,
        receive_job_line_id: j.receiveJobLineId,
        exception_type: 'extra_item',
        quantity_affected: 2,
        accounting_role: 'overage',
        notes: '2 extra accepted',
        device_event_id: crypto.randomUUID(),
      });
    expect(approval.status).toBe(201);

    const recount = await httpRecount(j);
    expect(recount.status).toBe(200);
    expect(recount.body.superseded_exception_ids).toEqual([]);
    const afterRecount = await state(j);
    expect(active(afterRecount.exceptions).map((e) => [e.exception_type, e.accounting_role, e.quantity_affected])).toEqual([['extra_item', 'overage', 2]]);
    expect(afterRecount.line.quantity_count_confirmed).toBeNull();

    // Re-confirmed above the kept approval: refused, nothing inspected.
    expect((await httpConfirmCount(j, 13)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 13, rejected: 0, missing: 0, deferred: 0 })).status).toBe(409);
    expect((await state(j)).line.inspection_complete).toBe(false);

    // The stale pre-Recount quantity cannot be accepted once 11 is re-confirmed.
    expect((await httpConfirmCount(j, 11)).status).toBe(200);
    expect((await httpInspect(j, { accepted: 12, rejected: 0, missing: 0, deferred: 0 })).status).toBe(409);

    // Within the approval: credits exactly the re-confirmed count.
    expect((await httpInspect(j, { accepted: 11, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    expect((await httpClose(j)).status).toBe(200);
    const closed = await state(j);
    expect(closed.movements).toEqual([{ movement_type: 'inbound_purchase', quantity_delta: 11 }]);
    expect(Number(closed.line.quantity_accepted)).toBe(11);
  });
});

// ── migration 0223: runtime authority, append-only history, reversibility ──

describe('S8-C5 — migration 0223 enforces supersession-only mutation for the runtime role', () => {
  let migrationDb: Knex;
  let shop: Shop;

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
    shop = await provisionFt2Shop('m0223');
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

  /** Actor + exception seeded by the migration role: sf_app is never assumed to INSERT users. */
  async function actorProvenanceFixture(trx: Knex.Transaction, j: JobFixture) {
    const [actor] = await trx('users')
      .insert({ shop_id: shop.shopId, email: `s8c5-actor-${crypto.randomUUID()}@example.test`, password_hash: 'x', role: 'operator' })
      .returning('id');
    const [row] = await trx('receive_exceptions')
      .insert({
        shop_id: shop.shopId, receive_job_id: j.receiveJobId, receive_job_line_id: j.receiveJobLineId,
        lasyncro_variant_id: j.lasyncroVariantId, exception_type: 'barcode_mismatch', quantity_affected: 1,
        raised_by: actor.id, raised_at: new Date(),
      })
      .returning('receive_exception_id');
    return { exceptionId: row.receive_exception_id as string, actorId: actor.id as number };
  }

  /** The rest of this transaction runs as the runtime role (session_user = sf_app). */
  async function asRuntimeRole(trx: Knex.Transaction) {
    await trx.raw('SET LOCAL SESSION AUTHORIZATION sf_app');
    await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shop.shopId)]);
    const who = await trx.raw('SELECT session_user AS s, current_user AS u');
    expect(who.rows[0]).toEqual({ s: 'sf_app', u: 'sf_app' });
  }

  async function privileges(trx: Knex.Transaction | Knex, table: string) {
    const r = await trx.raw(
      `SELECT has_table_privilege('sf_app', ?, 'SELECT') AS select,
              has_table_privilege('sf_app', ?, 'INSERT') AS insert,
              has_table_privilege('sf_app', ?, 'UPDATE') AS update,
              has_table_privilege('sf_app', ?, 'DELETE') AS delete,
              has_table_privilege('sf_app', ?, 'TRUNCATE') AS truncate`,
      [table, table, table, table, table],
    );
    return r.rows[0];
  }

  it('M1 — sf_app may only supersede once; other updates, deletes and history writes are refused; RLS isolates events', async () => {
    const runtime = await withTenant(shop.shopId, (trx) => trx.raw('SELECT current_user AS u, session_user AS s'));
    expect(runtime.rows[0]).toEqual({ u: 'sf_app', s: 'sf_app' });
    expect(await privileges(migrationDb, 'receive_exceptions')).toEqual({ select: true, insert: true, update: true, delete: false, truncate: false });
    expect(await privileges(migrationDb, 'receive_line_recount_events')).toEqual({ select: true, insert: true, update: false, delete: false, truncate: false });

    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    const [defect] = (await state(j)).exceptions;
    const rowOf = () => withTenant(shop.shopId, (trx) => trx('receive_exceptions').where({ receive_exception_id: defect.receive_exception_id }).first());
    const original = await rowOf();

    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_exceptions').where({ receive_exception_id: defect.receive_exception_id }).update({ quantity_affected: 1 })))
      .rejects.toThrow(/receive_exceptions evidence is immutable/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_exceptions').where({ receive_exception_id: defect.receive_exception_id }).del()))
      .rejects.toThrow(/permission denied/);
    expect(await rowOf()).toEqual(original);

    const eventId = crypto.randomUUID();
    expect((await httpRecount(j, eventId)).status).toBe(200);
    const superseded = await rowOf();
    // A superseded row cannot be re-superseded or reactivated.
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_exceptions').where({ receive_exception_id: defect.receive_exception_id })
        .update({ superseded_at: null, superseded_by: null, superseded_by_recount_event_id: null })))
      .rejects.toThrow(/receive_exceptions evidence is immutable|receive_exceptions_supersession_valid/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_exceptions').where({ receive_exception_id: defect.receive_exception_id }).update({ notes: 'rewritten' })))
      .rejects.toThrow(/receive_exceptions evidence is immutable/);
    expect(await rowOf()).toEqual(superseded);

    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_line_recount_events').where({ event_id: eventId }).update({ superseded_count: 9 })))
      .rejects.toThrow(/permission denied/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_line_recount_events').where({ event_id: eventId }).del()))
      .rejects.toThrow(/permission denied/);

    const other = await provisionFt2Shop('m0223x');
    expect(await withTenant(other.shopId, (trx) => trx('receive_line_recount_events').where({ event_id: eventId }))).toEqual([]);
    await expect(withTenant(other.shopId, (trx) =>
      trx('receive_line_recount_events').insert({
        shop_id: shop.shopId, event_id: crypto.randomUUID(), receive_job_id: j.receiveJobId,
        receive_job_line_id: j.receiveJobLineId, superseded_count: 0,
      }))).rejects.toThrow(/row-level security/);

    // Actor provenance: a direct runtime NULL is refused; only the users
    // ON DELETE SET NULL action may clear it. Rolled back: nothing persists.
    await inRolledBackTransaction(async (trx) => {
      const { exceptionId, actorId } = await actorProvenanceFixture(trx, j);
      await asRuntimeRole(trx);
      const direct = await inSavepoint(trx, (sp) =>
        sp('receive_exceptions').where({ receive_exception_id: exceptionId }).update({ raised_by: null }));
      expect(String((direct as any).error?.message)).toMatch(/receive_exceptions evidence is immutable/);
      expect((await trx('receive_exceptions').where({ receive_exception_id: exceptionId }).first('raised_by')).raised_by).toBe(actorId);

      expect(await inSavepoint(trx, (sp) => sp('users').where({ id: actorId }).del())).toEqual({ ok: true });
      expect((await trx('receive_exceptions').where({ receive_exception_id: exceptionId }).first('raised_by')).raised_by).toBeNull();
    });

    // RUN-019: sf_app cannot create an object that could nest an UPDATE and
    // forge pg_trigger_depth(): no TEMP, no persistent schema/database CREATE.
    await expect(withTenant(shop.shopId, (trx) => trx.raw('CREATE TEMP TABLE s8c5_forge (x int)')))
      .rejects.toThrow(/permission denied to create temporary tables/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx.raw(`CREATE FUNCTION public.s8c5_forge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`)))
      .rejects.toThrow(/permission denied for schema public/);
    await expect(withTenant(shop.shopId, (trx) => trx.raw('CREATE SCHEMA s8c5_forge')))
      .rejects.toThrow(/permission denied for database/);
    const authority = await migrationDb.raw(
      `SELECT has_database_privilege('sf_app', current_database(), 'TEMPORARY') AS temp,
              has_database_privilege('sf_app', current_database(), 'CREATE') AS create,
              (SELECT count(*)::int FROM pg_namespace n WHERE has_schema_privilege('sf_app', n.oid, 'CREATE')) AS schemas,
              receive_exception_provenance_boundary_intact() AS intact`);
    expect(authority.rows[0]).toEqual({ temp: false, create: false, schemas: 0, intact: true });

    const guards = await migrationDb.raw(
      `SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class
        WHERE relname IN ('receive_exceptions', 'receive_line_recount_events') ORDER BY relname`);
    expect(guards.rows).toEqual([
      { relname: 'receive_exceptions', rls: true, forced: true },
      { relname: 'receive_line_recount_events', rls: true, forced: true },
    ]);
  });

  it('M1b — a privilege regrant after migration makes the provenance exception fail closed (rolled back)', async () => {
    const j = await openV2Job(shop);
    await inRolledBackTransaction(async (trx) => {
      const { exceptionId, actorId } = await actorProvenanceFixture(trx, j);
      const db = (await trx.raw('SELECT current_database() AS db')).rows[0].db;
      await trx.raw('GRANT TEMPORARY ON DATABASE ?? TO sf_app', [db]);
      expect((await trx.raw('SELECT receive_exception_provenance_boundary_intact() AS intact')).rows[0].intact).toBe(false);

      await asRuntimeRole(trx);
      const refused = await inSavepoint(trx, (sp) => sp('users').where({ id: actorId }).del());
      expect(refused.ok).toBe(false);
      expect(String((refused as any).error?.message)).toMatch(/RECEIVE_PROVENANCE_AUTHORITY_INVALID/);
      expect((await trx('receive_exceptions').where({ receive_exception_id: exceptionId }).first('raised_by')).raised_by).toBe(actorId);
    });
    const after = await migrationDb.raw(`SELECT has_database_privilege('sf_app', current_database(), 'TEMPORARY') AS temp`);
    expect(after.rows[0].temp).toBe(false);
  });

  it('M2 — DOWN refuses while Recount evidence exists; with none it reverses and UP re-applies (rolled back)', async () => {
    const j = await openV2Job(shop);
    await miscountedWithAllocations(j);
    expect((await httpRecount(j)).status).toBe(200);

    await inRolledBackTransaction(async (trx) => {
      const refused = await inSavepoint(trx, (sp) => migration0223.down(sp));
      expect(refused.ok).toBe(false);
      expect(String((refused as any).error?.message)).toMatch(/RECEIVE_RECOUNT_ROLLBACK_BLOCKED/);
    });

    await inRolledBackTransaction(async (trx) => {
      // Emulate "no Recount evidence" inside the rolled-back transaction only.
      await trx.raw(`SET LOCAL row_security = off`);
      await trx.raw(`ALTER TABLE receive_line_recount_events DISABLE TRIGGER USER`);
      await trx.raw(`UPDATE receive_exceptions SET superseded_at = NULL, superseded_by = NULL, superseded_by_recount_event_id = NULL WHERE superseded_at IS NOT NULL`);
      await trx.raw(`DELETE FROM receive_line_recount_events`);
      await trx.raw(`ALTER TABLE receive_line_recount_events ENABLE TRIGGER USER`);
      const exceptionsBefore = await trx('receive_exceptions').count('* as n').first();

      expect(await inSavepoint(trx, (sp) => migration0223.down(sp))).toEqual({ ok: true });
      const gone = await trx.raw(`SELECT to_regclass('receive_line_recount_events') AS t,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receive_exceptions' AND column_name = 'superseded_at') AS col`);
      expect(gone.rows[0]).toEqual({ t: null, col: false });
      expect(await trx('receive_exceptions').count('* as n').first()).toEqual(exceptionsBefore);
      // Security is monotonic: rollback never re-grants DELETE.
      expect((await privileges(trx, 'receive_exceptions')).delete).toBe(false);

      expect(await inSavepoint(trx, (sp) => migration0223.up(sp))).toEqual({ ok: true });
      const back = await trx.raw(`SELECT to_regclass('receive_line_recount_events') IS NOT NULL AS t`);
      expect(back.rows[0].t).toBe(true);
    });
  });
});
