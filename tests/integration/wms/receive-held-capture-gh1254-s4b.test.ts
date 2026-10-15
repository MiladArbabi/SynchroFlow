/**
 * GH-1254 / S4-B — ATOMIC HELD-UNIT CAPTURE — RED regression contract.
 *
 * Ratified direction (GH-1254 S4-B contract/architecture rounds):
 *   - Recoverable product defects / packaging damage reported in grouped
 *     Receive reconciliation become HELD units: one LSU and one recovery task
 *     per physical unit, on a separate held-unit source anchor (never the
 *     Receive line anchor of accepted stock).
 *   - Held units never enter sellable inventory: no movement, truth, Stow,
 *     pick, pack or credit. Healthy accepted units continue to Stow.
 *   - Explicit tenant and warehouse ownership; no Problem Bin custody is
 *     inferred during capture (problem_bin_location stays NULL).
 *   - Missing, ordinary discrepancy and non-recoverable rejection never create
 *     recovery tasks.
 *   - Existing draft hashes and replay semantics are preserved; exact replay is
 *     stable; conflicting or concurrent finalization cannot duplicate
 *     identities or tasks.
 *   - OFF by default. With the gate OFF the existing S3 refusal is unchanged;
 *     held recovery tasks stay invisible on every Problem Center read surface
 *     until S4-F certification.
 *   - One additive migration (0213); rollback fails closed while held
 *     evidence exists.
 *
 * PROVISIONAL INTERFACE. Table, column, enum, flag, payload and error-code
 * spellings below are the S4-B design's engineering names, not product
 * decisions. They all live in the S4B adapter so a ratified spelling changes
 * one place only.
 *
 * RED READING. Until S4-B is implemented, every held fixture fails at the
 * grouped finalization with the existing S3 refusal
 * ("Recoverable-held disposition requires S4 atomic capture") or, where a
 * test reaches the schema first, with a missing relation/column. Those are
 * the expected RED reasons. Cases marked [PROTECTS EXISTING] assert behaviour
 * that is already correct and must stay GREEN.
 *
 * Every mutation goes through real routes (createApp + supertest) against the
 * disposable synchroflow_test_* database. Direct SQL is used only for
 * DB-invariant proofs, as the restricted runtime role (withTenant) inside
 * always-rolled-back transactions, or as the migration role for migration
 * contracts. Fixtures follow the GH-1241 S3-B suite.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { resolveBarcode } from 'api-src/services/wms/barcodeResolution.service';
import { issueTestToken } from '../../unit/helpers/auth';
import knexLib, { Knex } from 'knex';

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-15';
/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

// ── PROVISIONAL S4-B adapter (engineering names; change spelling here only) ──
const S4B = {
  /** OFF-by-default gate, read at call time. */
  flag: 'RECEIVE_HELD_CAPTURE_ENABLED',
  /** Marker on a grouped new_exceptions entry that reports recoverable units. */
  recoverable: { recovery: 'recoverable' } as const,
  captures: 'receive_held_captures',
  unitAnchor: 'receive_held_capture_id',
  heldStatus: 'held',
  heldSource: 'receive_held_recoverable',
  heldRole: 'held_recoverable',
  taskUnit: 'source_lasyncro_unit_id',
  taskCapture: 'receive_held_capture_id',
  taskWarehouse: 'warehouse_id',
  finalizationHeld: 'quantity_held_recoverable',
  stowRefusalCode: 'STOW_HELD_UNIT_REFUSED',
  migrationFile: /^\d{14}_0213_receive_held_unit_capture\.ts$/,
  rollbackBlocked: /RECEIVE_HELD_CAPTURE_ROLLBACK_BLOCKED/,
  /** Existing S3 refusal text (receiveJob.service.ts:442) — preserved when OFF. */
  offRefusal: /Recoverable-held disposition requires S4 atomic capture/,
};

const NUMERIC_LSU = /^LSU-\d{10}$/;
const ORIGINAL_FLAG = process.env[S4B.flag];

function setHeldCapture(on: boolean) {
  if (on) process.env[S4B.flag] = 'true';
  else delete process.env[S4B.flag];
}

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env[S4B.flag];
  else process.env[S4B.flag] = ORIGINAL_FLAG;
});

// ── provisioning (GH-1241 S3-B precedent) ───────────────────────────────────

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

interface Shop { shopId: number; userId: number; token: string; rootLocationCode: string }

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs4b-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S4B${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/S4B${nonce}`,
          title: `GH1254 S4-B held fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1254-S4B-${nonce}`,
                  barcode: EXTERNAL_BARCODE,
                  image: null,
                  inventoryItem: { id: `gid://shopify/InventoryItem/S4B${nonce}`, unitCost: { amount: '4.00' } },
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

interface PoLine { poLineItemId: string; variantId: string; ordered: number }
interface PoFixture { shop: Shop; supplierId: number; poId: string; lines: PoLine[] }

async function shippedMultiLinePo(shop: Shop, quantities: number[]): Promise<PoFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const variantIds: string[] = [];
  for (let i = 0; i < quantities.length; i += 1) variantIds.push(await seedMappedVariant(shop.shopId));
  return withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1254 S4-B supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    const lines: PoLine[] = [];
    for (let i = 0; i < quantities.length; i += 1) {
      const [poLine] = await trx('purchase_order_line_items')
        .insert({
          po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantIds[i],
          description: `GH1254 S4-B line ${i + 1}`, quantity_ordered: quantities[i], unit_cost_cents: 400,
        })
        .returning('id');
      lines.push({ poLineItemId: poLine.id as string, variantId: variantIds[i], ordered: quantities[i] });
    }
    return { shop, supplierId: Number(supplier.id), poId: po.id as string, lines };
  });
}

interface JobLine { receiveJobLineId: string; poLineItemId: string; variantId: string; expected: number }
interface JobFixture { po: PoFixture; receiveJobId: string; lines: JobLine[] }

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function openJob(po: PoFixture): Promise<JobFixture> {
  const created = await request(app)
    .post(`/api/v1/suppliers/purchase-orders/${po.poId}/receive-jobs`)
    .set(auth(po.shop.token))
    .send({ assigned_operator_id: po.shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  const claimed = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(po.shop.token)).send({});
  expect(claimed.status).toBe(200);
  const rows = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_job_lines').where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .select('receive_job_line_id', 'po_line_item_id', 'lasyncro_variant_id', 'quantity_expected'));
  const lines = po.lines.map((pl) => {
    const row = rows.find((r: any) => r.po_line_item_id === pl.poLineItemId);
    expect(row).toBeTruthy();
    return {
      receiveJobLineId: row.receive_job_line_id as string,
      poLineItemId: pl.poLineItemId,
      variantId: row.lasyncro_variant_id as string,
      expected: Number(row.quantity_expected),
    };
  });
  return { po, receiveJobId, lines };
}

async function confirmCount(j: JobFixture, line: JobLine, quantity: number) {
  const res = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${line.receiveJobLineId}/confirm-count`)
    .set(auth(j.po.shop.token))
    .send({ quantity_confirmed: quantity, device_event_id: crypto.randomUUID() });
  expect(res.status).toBe(200);
}

function httpClose(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.po.shop.token))
    .send({ actual_delivery_date: DELIVERY_DATE });
}

// ── grouped reconciliation (S3-B routes) ────────────────────────────────────

interface NewException {
  exception_type: string;
  quantity_affected: number;
  accounting_role?: string;
  notes?: string;
  recovery?: string;
}

interface Disposition {
  accepted: number;
  rejected: number;
  missing: number;
  deferred: number;
  held?: number;
  newExceptions?: NewException[];
  existingExceptionIds?: string[];
}

type GroupedLineInput = [JobLine, Disposition];

function groupedLines(entries: GroupedLineInput[]) {
  return entries.map(([line, d]) => ({
    receive_job_line_id: line.receiveJobLineId,
    quantity_accepted: d.accepted,
    quantity_rejected: d.rejected,
    quantity_missing: d.missing,
    quantity_deferred: d.deferred,
    ...(d.held !== undefined ? { quantity_held_recoverable: d.held } : {}),
    new_exceptions: d.newExceptions ?? [],
    existing_exception_ids: d.existingExceptionIds ?? [],
  }));
}

function httpDraft(j: JobFixture, baseRevisionId: string | null, entries: GroupedLineInput[]) {
  return request(app)
    .put(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/reconciliation/draft`)
    .set(auth(j.po.shop.token))
    .send({ base_revision_id: baseRevisionId, device_event_id: crypto.randomUUID(), lines: groupedLines(entries) });
}

function httpFinalize(
  j: JobFixture, currentRevisionId: string | null, entries: GroupedLineInput[],
  deviceEventId: string = crypto.randomUUID()
) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/reconciliation/finalize`)
    .set(auth(j.po.shop.token))
    .send({ current_revision_id: currentRevisionId, device_event_id: deviceEventId, lines: groupedLines(entries) });
}

async function currentRevisionOf(j: JobFixture): Promise<string | null> {
  const res = await request(app)
    .get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/reconciliation`)
    .set(auth(j.po.shop.token));
  return res.status === 200 ? (res.body.current_revision_id ?? null) : null;
}

async function attemptGroup(j: JobFixture, entries: GroupedLineInput[], deviceEventId: string = crypto.randomUUID()) {
  const draft = await httpDraft(j, await currentRevisionOf(j), entries);
  if (draft.status < 200 || draft.status >= 300) return { response: draft, revisionId: null as string | null };
  const revision = draft.body.revision_id as string;
  return { response: await httpFinalize(j, revision, entries, deviceEventId), revisionId: revision };
}

async function finalizeGroup(j: JobFixture, entries: GroupedLineInput[], deviceEventId?: string) {
  const attempt = await attemptGroup(j, entries, deviceEventId);
  console.info('[S4B_FINALIZE]', attempt.response.status, JSON.stringify(attempt.response.body));
  expect({ status: attempt.response.status, body: attempt.response.body })
    .toEqual({ status: 200, body: expect.objectContaining({ status: 'finalized', reconciliation_id: expect.any(String) }) });
  return { response: attempt.response, revisionId: attempt.revisionId! };
}

function expectSemanticRefusal(res: request.Response, status?: number) {
  if (status !== undefined) expect(res.status).toBe(status);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(typeof (res.body?.code ?? res.body?.error)).toBe('string');
}

// ── the canonical held fixture: 1 accepted + 2 held + 1 missing ─────────────

const HEALTHY: Disposition = { accepted: 10, rejected: 0, missing: 0, deferred: 0 };
/** Line A, expected 4: 1 good unit counted, 1 recoverable defect, 1 recoverable packaging damage, 1 missing. */
const HELD_LINE: Disposition = {
  accepted: 1, rejected: 0, missing: 1, deferred: 0, held: 2,
  newExceptions: [
    { exception_type: 'defect', quantity_affected: 1, ...S4B.recoverable },
    { exception_type: 'packaging_damage', quantity_affected: 1, ...S4B.recoverable },
    { exception_type: 'missing_item', quantity_affected: 1 },
  ],
};

interface HeldJob {
  j: JobFixture;
  heldLine: JobLine;
  healthyLine: JobLine;
  group: GroupedLineInput[];
  eventId: string;
  revisionId: string;
  reconciliationId: string;
}

/** A claimed v2 job (lines 4 and 10) with confirmed good counts; not yet finalized. */
async function heldReadyJob(shop: Shop) {
  const j = await openJob(await shippedMultiLinePo(shop, [4, 10]));
  const [heldLine, healthyLine] = j.lines;
  await confirmCount(j, heldLine, 1);
  await confirmCount(j, healthyLine, 10);
  const group: GroupedLineInput[] = [[heldLine, HELD_LINE], [healthyLine, HEALTHY]];
  return { j, heldLine, healthyLine, group };
}

/** Gate ON → finalize the canonical held group. */
async function heldJob(shop: Shop): Promise<HeldJob> {
  const ready = await heldReadyJob(shop);
  setHeldCapture(true);
  const eventId = crypto.randomUUID();
  const { response, revisionId } = await finalizeGroup(ready.j, ready.group, eventId);
  return { ...ready, eventId, revisionId, reconciliationId: response.body.reconciliation_id as string };
}

async function defaultWarehouseId(shopId: number): Promise<string> {
  const row = await withTenant(shopId, (trx) =>
    trx('warehouses').where({ shop_id: shopId, is_default: true, active: true }).first('warehouse_id'));
  expect(row?.warehouse_id).toBeTruthy();
  return row!.warehouse_id as string;
}

/** Held-capture evidence of one job, scoped to the fixture. */
async function heldState(j: JobFixture) {
  const { shopId } = j.po.shop;
  const lineIds = j.lines.map((l) => l.receiveJobLineId);
  return withTenant(shopId, async (trx) => {
    const captures = await trx(S4B.captures)
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .orderBy('receive_exception_id')
      .select('*');
    const captureIds = captures.map((c: any) => c.held_capture_id as string);
    const heldUnits = captureIds.length === 0 ? [] : await trx('inventory_units')
      .where({ shop_id: shopId }).whereIn(S4B.unitAnchor, captureIds)
      .orderBy('lasyncro_unit_id')
      .select('id', 'lasyncro_unit_id', 'lasyncro_variant_id', 'receive_job_line_id', 'recount_line_id',
        S4B.unitAnchor, 'receive_sequence', 'status', 'source', 'current_location_code');
    const heldLsus = heldUnits.map((u: any) => u.lasyncro_unit_id as string);
    const tasks = heldLsus.length === 0 ? [] : await trx('problem_center_tasks')
      .where({ shop_id: shopId }).whereIn(S4B.taskUnit, heldLsus)
      .orderBy(S4B.taskUnit)
      .select('problem_task_id', 'status', 'source', 'source_exception_id', 'lasyncro_variant_id', 'quantity',
        'exception_type', 'problem_bin_location', S4B.taskUnit, S4B.taskCapture, S4B.taskWarehouse);
    const acceptedUnits = await trx('inventory_units')
      .where({ shop_id: shopId }).whereIn('receive_job_line_id', lineIds)
      .select('lasyncro_unit_id', 'receive_job_line_id', 'status', 'current_location_code');
    const exceptions = await trx('receive_exceptions')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .select('receive_exception_id', 'receive_job_line_id', 'exception_type', 'quantity_affected',
        'accounting_role', 'resolved');
    const finalLines = await trx('receive_reconciliation_finalization_lines')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .select('receive_job_line_id', 'quantity_accepted', 'quantity_rejected', 'quantity_missing',
        'quantity_deferred', S4B.finalizationHeld);
    return { captures, heldUnits, heldLsus, tasks, acceptedUnits, exceptions, finalLines };
  });
}

/** Stock-side consequences for a set of variants (existing tables only). */
async function stockEffects(shopId: number, variantIds: string[], unitIds: string[] = []) {
  return withTenant(shopId, async (trx) => {
    const truth = await trx('inventory_truth').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .orderBy(['lasyncro_variant_id', 'location_code'])
      .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity', 'available_quantity', 'reserved_quantity');
    const movements = await trx('inventory_movements').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .orderBy('lasyncro_inventory_movement_id')
      .select('lasyncro_inventory_movement_id', 'lasyncro_variant_id', 'movement_type', 'quantity_delta', 'location_code', 'reference_id');
    const stow = await trx('stow_tasks').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .orderBy('stow_task_id').select('stow_task_id', 'status', 'quantity', 'quantity_placed', 'trigger');
    const units = await trx('inventory_units').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .orderBy('lasyncro_unit_id').select('lasyncro_unit_id', 'status', 'current_location_code');
    const problems = await trx('problem_center_tasks').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .orderBy('problem_task_id').select('problem_task_id', 'status', 'source', 'quantity');
    const unitMovements = unitIds.length === 0 ? [] : movements.filter((m: any) => unitIds.includes(m.reference_id));
    return { truth, movements, stow, units, problems, unitMovements };
  });
}

/** Runs each attempt in its own savepoint as the restricted runtime role; everything rolls back. */
async function sqlOutcomes(
  shopId: number,
  setup: (trx: Knex.Transaction) => Promise<Record<string, unknown>>,
  attempts: Record<string, (trx: Knex.Transaction, ctx: Record<string, any>) => Promise<unknown>>,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const sentinel = new Error('__rollback__');
  try {
    await withTenant(shopId, async (trx) => {
      const ctx = await setup(trx);
      // Every attempt's savepoint is rolled back, success included, so attempts stay independent.
      const attemptDone = new Error('__attempt_done__');
      for (const [name, attempt] of Object.entries(attempts)) {
        results[name] = await trx.transaction(async (sp) => { await attempt(sp, ctx); throw attemptDone; })
          .then(() => 'ok', (err: any) => (err === attemptDone ? 'ok' : String(err?.code ?? err?.message)));
      }
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
  return results;
}

// ── 1. atomic grouped capture ───────────────────────────────────────────────

describe('GH-1254 S4-B — 1. atomic grouped held-unit capture (RED)', () => {
  it('C1 — 1 accepted + 2 held + 1 missing finalizes atomically: exactly 2 held LSUs and 2 recovery tasks on a separate anchor; missing creates neither', async () => {
    const shop = await provisionFt2Shop('c1');
    const h = await heldJob(shop);
    const warehouseId = await defaultWarehouseId(shop.shopId);
    const s = await heldState(h.j);

    // Accounting: delivered includes held; the finalization line is balanced with held.
    const line = await withTenant(shop.shopId, (trx) =>
      trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_line_id: h.heldLine.receiveJobLineId })
        .first('inspection_complete', 'quantity_accepted', 'quantity_rejected', 'quantity_missing',
          'quantity_deferred', 'quantity_held_recoverable', 'quantity_delivered', 'quantity_count_confirmed'));
    expect({
      done: line.inspection_complete, accepted: Number(line.quantity_accepted), rejected: Number(line.quantity_rejected),
      missing: Number(line.quantity_missing), deferred: Number(line.quantity_deferred),
      held: Number(line.quantity_held_recoverable), delivered: Number(line.quantity_delivered),
      counted: Number(line.quantity_count_confirmed),
    }).toEqual({ done: true, accepted: 1, rejected: 0, missing: 1, deferred: 0, held: 2, delivered: 3, counted: 1 });
    expect(Number(s.finalLines.find((l: any) => l.receive_job_line_id === h.heldLine.receiveJobLineId)?.[S4B.finalizationHeld]))
      .toBe(2);

    // Evidence: recoverable rows carry the held role, stay unresolved (supplier history); missing stays shortfall.
    const heldEvidence = s.exceptions.filter((e: any) => e.accounting_role === S4B.heldRole);
    expect(heldEvidence.map((e: any) => [e.exception_type, Number(e.quantity_affected), e.resolved]).sort())
      .toEqual([['defect', 1, false], ['packaging_damage', 1, false]]);
    const missing = s.exceptions.filter((e: any) => e.exception_type === 'missing_item');
    expect(missing.map((e: any) => [Number(e.quantity_affected), e.accounting_role])).toEqual([[1, 'shortfall']]);

    // Captures: one per recoverable exception, bound to this reconciliation, line, variant and warehouse.
    expect(s.captures).toHaveLength(2);
    for (const c of s.captures) {
      expect(c).toEqual(expect.objectContaining({
        shop_id: shop.shopId,
        reconciliation_id: h.reconciliationId,
        receive_job_id: h.j.receiveJobId,
        receive_job_line_id: h.heldLine.receiveJobLineId,
        lasyncro_variant_id: h.heldLine.variantId,
        warehouse_id: warehouseId,
        quantity_held: 1,
      }));
      expect(heldEvidence.map((e: any) => e.receive_exception_id)).toContain(c.receive_exception_id);
    }

    // Held units: exactly 2, separate anchor, numeric GH-1255 identity, held, unlocated, never 'received'.
    expect(s.heldUnits).toHaveLength(2);
    expect(new Set(s.heldLsus).size).toBe(2);
    for (const u of s.heldUnits) {
      expect(u.lasyncro_unit_id).toMatch(NUMERIC_LSU);
      expect(u).toEqual(expect.objectContaining({
        lasyncro_variant_id: h.heldLine.variantId,
        receive_job_line_id: null,
        recount_line_id: null,
        receive_sequence: 1,
        status: S4B.heldStatus,
        source: S4B.heldSource,
        current_location_code: null,
      }));
    }

    // Accepted identity is unchanged: 1 + 10 line-anchored 'received' units, disjoint from held LSUs.
    const acceptedHeldLine = s.acceptedUnits.filter((u: any) => u.receive_job_line_id === h.heldLine.receiveJobLineId);
    const acceptedHealthy = s.acceptedUnits.filter((u: any) => u.receive_job_line_id === h.healthyLine.receiveJobLineId);
    expect([acceptedHeldLine.length, acceptedHealthy.length]).toEqual([1, 10]);
    expect(s.acceptedUnits.every((u: any) => u.status === 'received')).toBe(true);
    expect(s.acceptedUnits.some((u: any) => s.heldLsus.includes(u.lasyncro_unit_id))).toBe(false);

    // Tasks: exactly one per held LSU, bound to unit + capture + warehouse + exception; no custody inferred.
    expect(s.tasks).toHaveLength(2);
    for (const t of s.tasks) {
      const unit = s.heldUnits.find((u: any) => u.lasyncro_unit_id === t[S4B.taskUnit]);
      const capture = s.captures.find((c: any) => c.held_capture_id === unit?.[S4B.unitAnchor]);
      expect(unit).toBeTruthy();
      expect(capture).toBeTruthy();
      expect(t).toEqual(expect.objectContaining({
        status: 'open',
        source: 'receive',
        quantity: 1,
        problem_bin_location: null,
        lasyncro_variant_id: h.heldLine.variantId,
        source_exception_id: capture.receive_exception_id,
        exception_type: capture.exception_type,
        [S4B.taskCapture]: capture.held_capture_id,
        [S4B.taskWarehouse]: warehouseId,
      }));
    }
    // Missing and the healthy line create no recovery task at all.
    const allTasks = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId })
        .whereIn('lasyncro_variant_id', h.j.lines.map((l) => l.variantId)).select('problem_task_id'));
    expect(allTasks).toHaveLength(2);

    // Nothing reaches stock before close.
    const stock = await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId));
    expect({ truth: stock.truth.length, movements: stock.movements.length, stow: stock.stow.length })
      .toEqual({ truth: 0, movements: 0, stow: 0 });
  });

  it('C2 — only recoverable product/packaging defects qualify: recovery on missing, unmatched held quantity and per-line held refuse with zero writes; non-recoverable rejection creates no task', async () => {
    const shop = await provisionFt2Shop('c2');
    setHeldCapture(true);

    // (a) recovery on missing_item, (b) held ≠ recoverable evidence — refused, nothing minted.
    const a = await heldReadyJob(shop);
    const variants = a.j.lines.map((l) => l.variantId);
    const before = await stockEffects(shop.shopId, variants);
    const recoverableMissing = await attemptGroup(a.j, [[a.heldLine, {
      accepted: 1, rejected: 0, missing: 1, deferred: 0, held: 2,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 2, ...S4B.recoverable },
        { exception_type: 'missing_item', quantity_affected: 1, ...S4B.recoverable },
      ],
    }], [a.healthyLine, HEALTHY]]);
    expectSemanticRefusal(recoverableMissing.response);
    const unmatched = await attemptGroup(a.j, [[a.heldLine, {
      accepted: 1, rejected: 0, missing: 1, deferred: 0, held: 2,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 1, ...S4B.recoverable },
        { exception_type: 'missing_item', quantity_affected: 1 },
      ],
    }], [a.healthyLine, HEALTHY]]);
    expectSemanticRefusal(unmatched.response);
    // (c) the per-line HTTP inspect never accepts held, even with the gate ON.
    const perLine = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${a.j.receiveJobId}/inspect`)
      .set(auth(shop.token))
      .send({
        lasyncro_variant_id: a.heldLine.variantId, receive_job_line_id: a.heldLine.receiveJobLineId,
        quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 1,
        quantity_held_recoverable: 2, device_event_id: crypto.randomUUID(),
      });
    expectSemanticRefusal(perLine, 409);
    expect(await stockEffects(shop.shopId, variants)).toEqual(before);
    expect((await heldState(a.j)).captures).toHaveLength(0);

    // (d) a non-recoverable rejected defect beside a recoverable one: exactly one task, for the recoverable unit.
    const b = await heldReadyJob(shop);
    await finalizeGroup(b.j, [[b.heldLine, {
      accepted: 1, rejected: 1, missing: 1, deferred: 0, held: 1,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 1 },
        { exception_type: 'packaging_damage', quantity_affected: 1, ...S4B.recoverable },
        { exception_type: 'missing_item', quantity_affected: 1 },
      ],
    }], [b.healthyLine, HEALTHY]]);
    const s = await heldState(b.j);
    expect({ captures: s.captures.length, units: s.heldUnits.length, tasks: s.tasks.length })
      .toEqual({ captures: 1, units: 1, tasks: 1 });
    expect(s.tasks[0].exception_type).toBe('packaging_damage');
    const rejected = s.exceptions.find((e: any) => e.exception_type === 'defect');
    expect(rejected?.accounting_role).toBe('shortfall');
  });

  it('C3 — held defect and held packaging damage are never shortfall; ordinary rejected and missing evidence still is (persisted rows and the Receive job projection)', async () => {
    const shop = await provisionFt2Shop('c3');
    const j = await openJob(await shippedMultiLinePo(shop, [5, 10]));
    const [line, healthy] = j.lines;
    await confirmCount(j, line, 1);
    await confirmCount(j, healthy, 10);
    setHeldCapture(true);
    // Expected 5 = 1 accepted + 1 rejected (non-recoverable) + 2 held + 1 missing.
    await finalizeGroup(j, [[line, {
      accepted: 1, rejected: 1, missing: 1, deferred: 0, held: 2,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 1 },
        { exception_type: 'defect', quantity_affected: 1, ...S4B.recoverable },
        { exception_type: 'packaging_damage', quantity_affected: 1, ...S4B.recoverable },
        { exception_type: 'missing_item', quantity_affected: 1 },
      ],
    }], [healthy, HEALTHY]]);

    // Persisted accounting: held rows never count toward shortfall; ordinary rows still do.
    const persisted = await withTenant(shop.shopId, (trx) =>
      trx('receive_exceptions').where({ shop_id: shop.shopId, receive_job_line_id: line.receiveJobLineId })
        .select('receive_exception_id', 'exception_type', 'accounting_role', 'counts_toward_shortfall'));
    const shape = (rows: any[]) => rows
      .map((r) => [r.exception_type, r.accounting_role, Boolean(r.counts_toward_shortfall)].join('|')).sort();
    expect(shape(persisted)).toEqual([
      'defect|held_recoverable|false',
      'defect|shortfall|true',
      'missing_item|shortfall|true',
      'packaging_damage|held_recoverable|false',
    ]);

    // Receive job projection (GET /receive-jobs/:jobId): the same classification,
    // and accounted shortfall is exactly the ordinary rejected + missing evidence.
    const detail = await request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`).set(auth(shop.token));
    expect(detail.status).toBe(200);
    const projected = (detail.body.lines as any[]).find((l) => l.receive_job_line_id === line.receiveJobLineId);
    const allocations = (projected.reconciliation.allocations as any[]).filter((a) => a.receive_exception_id);
    expect(shape(allocations)).toEqual(shape(persisted));
    console.info('[S4B_C3_PROJECTION]', JSON.stringify({
      expected: projected.reconciliation.expected, sellable: projected.reconciliation.sellable,
      accounted: projected.reconciliation.accounted, unaccounted: projected.reconciliation.unaccounted,
    }));
    expect(projected.reconciliation.accounted).toBe(2);
  });
});

// ── 2. identity and provenance ──────────────────────────────────────────────

describe('GH-1254 S4-B — 2. identity and provenance (RED)', () => {
  it('I1 — capture provenance: reconciliation, job, line, created exception, held role, variant and warehouse are FK-bound', async () => {
    const shop = await provisionFt2Shop('i1');
    const other = await provisionFt2Shop('i1x');
    const a = await heldJob(shop);
    const b = await heldJob(shop);
    const foreignWarehouse = await defaultWarehouseId(other.shopId);
    const warehouseId = await defaultWarehouseId(shop.shopId);
    const [l1, l2] = a.j.lines;

    const outcomes = await sqlOutcomes(shop.shopId, async () => ({}), (() => {
      /** Fresh held-role exception + 'created' link on A/l1, then the capture under test. */
      const capture = (over: Record<string, unknown> = {}, exception: Record<string, unknown> = {}, linkKind = 'created') =>
        async (trx: Knex.Transaction) => {
          const [e] = await trx('receive_exceptions').insert({
            shop_id: shop.shopId, receive_job_id: a.j.receiveJobId, receive_job_line_id: l1.receiveJobLineId,
            lasyncro_variant_id: l1.variantId, exception_type: 'defect', quantity_affected: 1,
            accounting_role: S4B.heldRole, counts_toward_shortfall: false, raised_by: shop.userId,
            raised_at: new Date(), notes: 'S4-B I1', ...exception,
          }).returning('receive_exception_id');
          await trx('receive_reconciliation_exception_links').insert({
            shop_id: shop.shopId, receive_exception_id: e.receive_exception_id,
            reconciliation_id: a.reconciliationId, receive_job_line_id: l1.receiveJobLineId, link_kind: linkKind,
          });
          await trx(S4B.captures).insert({
            shop_id: shop.shopId, reconciliation_id: a.reconciliationId, receive_job_id: a.j.receiveJobId,
            receive_job_line_id: l1.receiveJobLineId, receive_exception_id: e.receive_exception_id,
            lasyncro_variant_id: l1.variantId, exception_type: 'defect', warehouse_id: warehouseId,
            quantity_held: 1, ...over,
          });
        };
      return {
        valid: capture(),
        otherLine: capture({ receive_job_line_id: l2.receiveJobLineId, lasyncro_variant_id: l2.variantId }),
        otherReconciliation: capture({ reconciliation_id: b.reconciliationId }),
        otherJob: capture({ receive_job_id: b.j.receiveJobId }),
        referencedLink: capture({}, {}, 'referenced'),
        notHeldRole: capture({}, { accounting_role: 'shortfall' }),
        otherVariant: capture({ lasyncro_variant_id: l2.variantId }),
        foreignWarehouse: capture({ warehouse_id: foreignWarehouse }),
        ineligibleType: capture({ exception_type: 'missing_item' }, { exception_type: 'missing_item' }),
        duplicateException: async (trx: Knex.Transaction) => {
          const s = await trx(S4B.captures).where({ shop_id: shop.shopId, receive_job_id: a.j.receiveJobId }).first('*');
          const { held_capture_id: _id, created_at: _at, ...row } = s;
          await trx(S4B.captures).insert(row);
        },
      };
    })());

    expect(outcomes).toEqual({
      valid: 'ok',
      otherLine: '23503',
      otherReconciliation: '23503',
      otherJob: '23503',
      referencedLink: '23503',
      notHeldRole: '23503',
      otherVariant: '23503',
      foreignWarehouse: '23503',
      ineligibleType: expect.stringMatching(/^(23514|23503)$/),
      duplicateException: '23505',
    });
  });

  it('I2 — unit and task provenance: LSU ↔ capture ↔ variant ↔ warehouse ↔ exception; one task per LSU; partial or custody-bearing links refused; evidence immutable', async () => {
    const shop = await provisionFt2Shop('i2');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    expect(s.tasks).toHaveLength(2);
    const [u1, u2] = s.heldUnits;
    const c1 = s.captures.find((c: any) => c.held_capture_id === u1[S4B.unitAnchor]);
    const c2 = s.captures.find((c: any) => c.held_capture_id === u2[S4B.unitAnchor]);
    const warehouseId = await defaultWarehouseId(shop.shopId);
    const otherVariant = h.healthyLine.variantId;
    const lsu = () => `LSU-T${crypto.randomBytes(5).toString('hex')}`.slice(0, 20);

    const task = (over: Record<string, unknown>) => (trx: Knex.Transaction) =>
      trx('problem_center_tasks').insert({
        shop_id: shop.shopId, status: 'open', source: 'receive', source_exception_id: c1.receive_exception_id,
        lasyncro_variant_id: h.heldLine.variantId, quantity: 1, exception_type: c1.exception_type,
        problem_bin_location: null,
        [S4B.taskUnit]: u1.lasyncro_unit_id, [S4B.taskCapture]: c1.held_capture_id, [S4B.taskWarehouse]: warehouseId,
        ...over,
      });
    const unit = (over: Record<string, unknown>) => (trx: Knex.Transaction) =>
      trx('inventory_units').insert({
        lasyncro_unit_id: lsu(), shop_id: shop.shopId, lasyncro_variant_id: h.heldLine.variantId,
        receive_job_line_id: null, [S4B.unitAnchor]: c1.held_capture_id, receive_sequence: 99,
        source: S4B.heldSource, status: S4B.heldStatus, reprint_count: 0, ...over,
      });

    const outcomes = await sqlOutcomes(shop.shopId, async (trx) => {
      // u1's real task is removed inside this rolled-back transaction so each task
      // attempt below is judged by its own FK/CHECK, not by the one-task-per-LSU index.
      expect(await trx('problem_center_tasks').where({ shop_id: shop.shopId, [S4B.taskUnit]: u1.lasyncro_unit_id }).del())
        .toBe(1);
      const [wh] = await trx('warehouses').insert({
        shop_id: shop.shopId, name: `S4B second ${crypto.randomUUID()}`,
        root_location_code: `S4B-ROOT-${crypto.randomBytes(3).toString('hex')}`, is_default: false, active: true,
      }).returning('warehouse_id');
      return { secondWarehouse: wh.warehouse_id };
    }, {
      validTask: task({}),
      duplicateTask: async (trx) => { await task({})(trx); await task({})(trx); },
      unitOfOtherCapture: task({ [S4B.taskCapture]: c2.held_capture_id, source_exception_id: c2.receive_exception_id }),
      taskOtherVariant: task({ lasyncro_variant_id: otherVariant }),
      taskOtherWarehouse: (trx, ctx) => task({ [S4B.taskWarehouse]: ctx.secondWarehouse })(trx),
      taskOtherException: task({ source_exception_id: c2.receive_exception_id }),
      partialLink: task({ [S4B.taskCapture]: null, [S4B.taskWarehouse]: null }),
      custodyInferred: task({ problem_bin_location: 'PROB-BIN-1' }),
      notSingleUnit: task({ quantity: 2 }),
      unitOtherVariant: unit({ lasyncro_variant_id: otherVariant }),
      unitBornReceived: unit({ status: 'received' }),
      unitTwoAnchors: unit({ receive_job_line_id: h.heldLine.receiveJobLineId }),
      unitDuplicateSequence: unit({ receive_sequence: 1 }),
      unitAnchorCleared: (trx) => trx('inventory_units').where({ shop_id: shop.shopId, id: u1.id }).update({ [S4B.unitAnchor]: null }),
      captureRewritten: (trx) => trx(S4B.captures).where({ shop_id: shop.shopId, held_capture_id: c1.held_capture_id }).update({ quantity_held: 5 }),
      captureDeleted: (trx) => trx(S4B.captures).where({ shop_id: shop.shopId, held_capture_id: c1.held_capture_id }).del(),
    });

    expect(outcomes).toEqual({
      validTask: 'ok',
      duplicateTask: '23505',
      unitOfOtherCapture: '23503',
      taskOtherVariant: '23503',
      taskOtherWarehouse: '23503',
      taskOtherException: '23503',
      partialLink: '23514',
      custodyInferred: '23514',
      notSingleUnit: '23514',
      unitOtherVariant: '23503',
      unitBornReceived: '23514',
      unitTwoAnchors: '23514',
      unitDuplicateSequence: '23505',
      unitAnchorCleared: '23514',
      captureRewritten: expect.stringMatching(/append-only|P0001|42501/),
      captureDeleted: expect.stringMatching(/append-only|P0001|42501/),
    });
  });

  it('I3 — tenant isolation: another tenant can neither read nor write held captures, units or tasks', async () => {
    const shop = await provisionFt2Shop('i3');
    const other = await provisionFt2Shop('i3x');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    expect(s.tasks).toHaveLength(2);

    const seen = await withTenant(other.shopId, async (trx) => ({
      captures: await trx(S4B.captures).whereIn('held_capture_id', s.captures.map((c: any) => c.held_capture_id)),
      units: await trx('inventory_units').whereIn('lasyncro_unit_id', s.heldLsus),
      tasks: await trx('problem_center_tasks').whereIn(S4B.taskUnit, s.heldLsus),
    }));
    expect(seen).toEqual({ captures: [], units: [], tasks: [] });

    const c = s.captures[0];
    const { held_capture_id: _id, created_at: _at, ...row } = c;
    await expect(withTenant(other.shopId, (trx) => trx(S4B.captures).insert(row)))
      .rejects.toThrow(/row-level security/);
  });
});

// ── 3. inventory isolation ──────────────────────────────────────────────────

describe('GH-1254 S4-B — 3. held units cannot be credited, picked, packed or stowed (RED)', () => {
  it('X1 — a held LSU is refused explicitly on every Stow trigger before any write, with zero consequential side effects', async () => {
    const shop = await provisionFt2Shop('x1');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    const heldLsu = s.heldLsus[0];
    expect(heldLsu).toMatch(NUMERIC_LSU);
    const variantId = h.heldLine.variantId;
    const warehouseId = await defaultWarehouseId(shop.shopId);
    const binCode = `S4B-BIN-${crypto.randomBytes(3).toString('hex')}`;

    const taskIds = await withTenant(shop.shopId, async (trx) => {
      await trx('warehouse_locations').insert({
        shop_id: shop.shopId, warehouse_id: warehouseId, location_code: binCode, type: 'bin',
        parent_location_code: shop.rootLocationCode, active: true, zone_type: 'pick',
      });
      const [sourceProblem] = await trx('problem_center_tasks').insert({
        shop_id: shop.shopId, status: 'open', source: 'returns', lasyncro_variant_id: variantId, quantity: 1,
        exception_type: 'repackaging_required', problem_bin_location: 'S4B-PROB-SRC',
      }).returning('problem_task_id');
      const base = {
        shop_id: shop.shopId, lasyncro_variant_id: variantId, quantity: 1, location_code: binCode,
        status: 'in_progress', claimed_by: shop.userId, claimed_at: new Date(),
      };
      const ids: Record<string, string> = {};
      for (const [name, extra] of Object.entries({
        inbound_stock: { trigger: 'inbound_stock', receive_job_line_id: h.heldLine.receiveJobLineId, po_id: h.j.po.poId },
        return_restock: { trigger: 'return_restock' },
        order_cancelled_mid_pick: { trigger: 'order_cancelled_mid_pick', source_task_id: sourceProblem.problem_task_id },
        problem_center: { trigger: 'problem_center', source_task_id: sourceProblem.problem_task_id },
      })) {
        const [row] = await trx('stow_tasks').insert({ ...base, ...extra }).returning('stow_task_id');
        ids[name] = row.stow_task_id as string;
      }
      return ids;
    });

    const unitIds = s.heldUnits.map((u: any) => u.id as string);
    const before = await stockEffects(shop.shopId, [variantId], unitIds);
    const results: Record<string, [number, unknown]> = {};
    for (const [name, taskId] of Object.entries(taskIds)) {
      const res = await request(app)
        .post(`/api/v1/wms/stow-tasks/${taskId}/confirm`)
        .set(auth(shop.token))
        .send({ lasyncro_unit_id: heldLsu, quantity_placed: 1 });
      results[name] = [res.status, res.body?.code ?? null];
    }
    console.info('[S4B_X1_STOW]', JSON.stringify(results));
    expect(results).toEqual({
      inbound_stock: [409, S4B.stowRefusalCode],
      return_restock: [409, S4B.stowRefusalCode],
      order_cancelled_mid_pick: [409, S4B.stowRefusalCode],
      problem_center: [409, S4B.stowRefusalCode],
    });
    const after = await stockEffects(shop.shopId, [variantId], unitIds);
    expect(after).toEqual(before);
    expect(after.unitMovements).toEqual([]);
    expect((await heldState(h.j)).heldUnits).toEqual(s.heldUnits);
  });

  it('X2 — the database refuses every pick/pack/stow/ship/locate transition of a held unit; selection paths never offer one', async () => {
    const shop = await provisionFt2Shop('x2');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    const heldLsu = s.heldLsus[0];
    const where = { shop_id: shop.shopId, lasyncro_unit_id: heldLsu };

    // Writer-equivalent statements of pickScan.service.ts:614-620, packScan.service.ts:203-205,
    // stow.service.ts:766-773 and shipConfirmation.service.ts:107-111.
    const outcomes = await sqlOutcomes(shop.shopId, async () => ({}), {
      pick: (trx) => trx('inventory_units').where(where).update({ status: 'picked', current_location_code: null }),
      pack: (trx) => trx('inventory_units').where(where).update({ status: 'packed' }),
      stow: (trx) => trx('inventory_units').where(where).update({ status: 'stowed', current_location_code: 'S4B-BIN' }),
      ship: (trx) => trx('inventory_units').where(where).update({ status: 'shipped' }),
      locate: (trx) => trx('inventory_units').where(where).update({ current_location_code: 'S4B-BIN' }),
    });
    expect(outcomes).toEqual({ pick: '23514', pack: '23514', stow: '23514', ship: '23514', locate: '23514' });

    // Variant-level resolution (Stow/Pick fallbacks) never surfaces a held unit; an exact scan reports it as held.
    const sku = await withTenant(shop.shopId, (trx) =>
      trx('variants').where({ shop_id: shop.shopId, lasyncro_variant_id: h.heldLine.variantId }).first('sku'));
    const byVariant = await withTenant(shop.shopId, (trx) => resolveBarcode(trx, shop.shopId, sku.sku));
    expect(byVariant?.lasyncro_variant_id).toBe(h.heldLine.variantId);
    expect(s.heldLsus).not.toContain(byVariant?.lasyncro_unit_id);
    const exact = await withTenant(shop.shopId, (trx) => resolveBarcode(trx, shop.shopId, heldLsu));
    expect(exact?.unit_status).toBe(S4B.heldStatus);
  });
});

// ── 4. idempotency / concurrency ────────────────────────────────────────────

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

function holdPoLock(shopId: number, poId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reportPid!: (pid: number) => void;
  const pidKnown = new Promise<number>((resolve) => { reportPid = resolve; });
  const done = withTenant(shopId, async (trx) => {
    const locked = await trx('purchase_orders').where({ shop_id: shopId, id: poId }).forUpdate();
    expect(locked).toHaveLength(1);
    const pid = await trx.raw('SELECT pg_backend_pid() AS pid');
    reportPid(Number(pid.rows[0].pid));
    await released;
  });
  return { pidKnown, release, done };
}

describe('GH-1254 S4-B — 4. idempotency and concurrency', () => {
  it('R1 — exact replay returns the original result with identical identities; a conflicting replay or second finalization is refused; replay stays stable after the gate is turned OFF (RED)', async () => {
    const shop = await provisionFt2Shop('r1');
    const h = await heldJob(shop);
    const settled = await heldState(h.j);
    const stock = await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId));

    const replay = await httpFinalize(h.j, h.revisionId, h.group, h.eventId);
    expect([replay.status, replay.body.reconciliation_id]).toEqual([200, h.reconciliationId]);
    const reordered = await httpFinalize(h.j, h.revisionId, [h.group[1], h.group[0]], h.eventId);
    expect([reordered.status, reordered.body.reconciliation_id]).toEqual([200, h.reconciliationId]);

    const conflict = await httpFinalize(h.j, h.revisionId, [[h.heldLine, {
      ...HELD_LINE, accepted: 1, missing: 0, deferred: 1,
      newExceptions: HELD_LINE.newExceptions!.filter((e) => e.exception_type !== 'missing_item'),
    }], [h.healthyLine, HEALTHY]], h.eventId);
    expectSemanticRefusal(conflict, 409);
    const second = await httpFinalize(h.j, h.revisionId, h.group, crypto.randomUUID());
    expectSemanticRefusal(second, 409);

    setHeldCapture(false);
    const replayOff = await httpFinalize(h.j, h.revisionId, h.group, h.eventId);
    expect([replayOff.status, replayOff.body.reconciliation_id]).toEqual([200, h.reconciliationId]);

    expect(await heldState(h.j)).toEqual(settled);
    expect(await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId))).toEqual(stock);
  });

  it('R2 — two overlapping held finalizations behind a PO row-lock barrier: exactly one wins; exactly 2 held LSUs and 2 tasks; no deadlock (RED)', async () => {
    const shop = await provisionFt2Shop('r2');
    const ready = await heldReadyJob(shop);
    setHeldCapture(true);
    const draft = await httpDraft(ready.j, null, ready.group);
    expect(draft.status).toBe(200);
    const rev = draft.body.revision_id as string;

    const gate = holdPoLock(shop.shopId, ready.j.po.poId);
    const gatePid = await gate.pidKnown;
    const race = [httpFinalize(ready.j, rev, ready.group), httpFinalize(ready.j, rev, ready.group)].map((r) => r.then((x) => x));
    let waiters: LockWaiter[];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 2);
    } finally {
      gate.release();
    }
    await gate.done;
    const results = await Promise.all(race);
    console.info('[S4B_R2_RACE]', JSON.stringify({ waiters: waiters.map((w) => w.query), results: results.map((r) => [r.status, r.body]) }));

    expect(waiters.length).toBe(2);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expectSemanticRefusal(results.find((r) => r.status === 409)!, 409);
    const s = await heldState(ready.j);
    expect({ captures: s.captures.length, units: s.heldUnits.length, distinct: new Set(s.heldLsus).size, tasks: s.tasks.length })
      .toEqual({ captures: 2, units: 2, distinct: 2, tasks: 2 });
  });

  it('R3 [PROTECTS EXISTING] — a draft without recovery evidence keeps the existing canonical payload hash', async () => {
    const shop = await provisionFt2Shop('r3');
    const ready = await heldReadyJob(shop);
    const entries: GroupedLineInput[] = [[ready.heldLine, {
      accepted: 1, rejected: 0, missing: 1, deferred: 2,
      newExceptions: [{ exception_type: 'missing_item', quantity_affected: 1 }],
    }], [ready.healthyLine, HEALTHY]];
    const draft = await httpDraft(ready.j, null, entries);
    expect(draft.status).toBe(200);
    const stored = await withTenant(shop.shopId, (trx) =>
      trx('receive_reconciliation_revisions').where({ shop_id: shop.shopId, revision_id: draft.body.revision_id })
        .first('payload_hash'));
    // The S3-B canonical form (receiveReconciliation.service.ts:79-145), recomputed independently.
    const canonical = entries
      .map(([line, d]) => ({
        receive_job_line_id: line.receiveJobLineId.toLowerCase(),
        quantity_accepted: d.accepted,
        quantity_rejected: d.rejected,
        quantity_missing: d.missing,
        quantity_deferred: d.deferred,
        quantity_held_recoverable: d.held ?? 0,
        new_exceptions: (d.newExceptions ?? [])
          .map((e) => ({
            exception_type: e.exception_type,
            quantity_affected: e.quantity_affected,
            accounting_role: e.accounting_role ?? (['missing_item', 'defect', 'wrong_item', 'wrong_variant'].includes(e.exception_type) ? 'shortfall' : null),
            notes: e.notes ?? null,
          }))
          .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
        existing_exception_ids: [...(d.existingExceptionIds ?? [])].map((x) => x.toLowerCase()).sort(),
      }))
      .sort((x, y) => x.receive_job_line_id.localeCompare(y.receive_job_line_id));
    expect(stored?.payload_hash).toBe(crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'));
  });
});

// ── 5. Receive Close ────────────────────────────────────────────────────────

describe('GH-1254 S4-B — 5. Receive Close credits accepted units only (RED)', () => {
  it('Z1 — Close (gate already OFF) credits and stows accepted units only; held units, captures and tasks persist untouched', async () => {
    const shop = await provisionFt2Shop('z1');
    const h = await heldJob(shop);
    const held = await heldState(h.j);
    const unitIds = held.heldUnits.map((u: any) => u.id as string);

    // RELEASE-CONTINUITY-01: turning the gate OFF never strands a held-finalized job.
    setHeldCapture(false);
    const closed = await httpClose(h.j);
    console.info('[S4B_Z1_CLOSE]', closed.status, JSON.stringify(closed.body));
    expect(closed.status).toBe(200);

    const stock = await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId), unitIds);
    const inbound = (variantId: string) => stock.movements
      .filter((m: any) => m.movement_type === 'inbound_purchase' && m.lasyncro_variant_id === variantId)
      .reduce((n: number, m: any) => n + Number(m.quantity_delta), 0);
    expect([inbound(h.heldLine.variantId), inbound(h.healthyLine.variantId)]).toEqual([1, 10]);
    const onHand = (variantId: string) => stock.truth
      .filter((t: any) => t.lasyncro_variant_id === variantId)
      .reduce((n: number, t: any) => n + Number(t.on_hand_quantity), 0);
    expect([onHand(h.heldLine.variantId), onHand(h.healthyLine.variantId)]).toEqual([1, 10]);
    expect(stock.stow.map((t: any) => [t.trigger, Number(t.quantity)]).sort())
      .toEqual([['inbound_stock', 1], ['inbound_stock', 10]]);
    expect(stock.unitMovements).toEqual([]);

    const po = await withTenant(shop.shopId, (trx) =>
      trx('purchase_order_line_items').where({ shop_id: shop.shopId, po_id: h.j.po.poId })
        .select('id', 'quantity_received', 'quantity_pending_delivery'));
    const poLine = (id: string) => po.find((r: any) => r.id === id);
    expect([
      [Number(poLine(h.heldLine.poLineItemId).quantity_received), Number(poLine(h.heldLine.poLineItemId).quantity_pending_delivery)],
      [Number(poLine(h.healthyLine.poLineItemId).quantity_received), Number(poLine(h.healthyLine.poLineItemId).quantity_pending_delivery)],
    ]).toEqual([[1, 0], [10, 0]]);

    // Held obligations persist independently of the closed Receive.
    const after = await heldState(h.j);
    expect({ captures: after.captures, heldUnits: after.heldUnits, tasks: after.tasks })
      .toEqual({ captures: held.captures, heldUnits: held.heldUnits, tasks: held.tasks });
    expect(after.exceptions.filter((e: any) => e.accounting_role === S4B.heldRole).every((e: any) => e.resolved === false))
      .toBe(true);
  });
});

// ── 6. feature gate ─────────────────────────────────────────────────────────

describe('GH-1254 S4-B — 6. OFF by default; hidden until S4-F', () => {
  it('G1 [PROTECTS EXISTING] — gate OFF: a count-consistent held group keeps the existing S3 refusal with zero side effects', async () => {
    const shop = await provisionFt2Shop('g1');
    setHeldCapture(false);
    const ready = await heldReadyJob(shop);
    const variants = ready.j.lines.map((l) => l.variantId);
    const before = await stockEffects(shop.shopId, variants);
    const lineBefore = await withTenant(shop.shopId, (trx) =>
      trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_id: ready.j.receiveJobId })
        .orderBy('receive_job_line_id').select('receive_job_line_id', 'inspection_complete', 'quantity_held_recoverable'));

    const attempt = await attemptGroup(ready.j, ready.group);
    expect(attempt.response.status).toBe(409);
    expect(String(attempt.response.body?.error)).toMatch(S4B.offRefusal);

    expect(await stockEffects(shop.shopId, variants)).toEqual(before);
    expect(await withTenant(shop.shopId, (trx) =>
      trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_id: ready.j.receiveJobId })
        .orderBy('receive_job_line_id').select('receive_job_line_id', 'inspection_complete', 'quantity_held_recoverable')))
      .toEqual(lineBefore);
    const finalization = await withTenant(shop.shopId, (trx) =>
      trx('receive_reconciliation_finalizations').where({ shop_id: shop.shopId, receive_job_id: ready.j.receiveJobId }).first());
    expect(finalization).toBeUndefined();
  });

  it('G2 — held recovery tasks are invisible on every Problem Center read surface (list, resolve, replacement) while ordinary tasks stay visible (RED)', async () => {
    const shop = await provisionFt2Shop('g2');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    expect(s.tasks).toHaveLength(2);
    const heldTaskId = s.tasks[0].problem_task_id as string;
    const [ordinary] = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').insert({
        shop_id: shop.shopId, status: 'open', source: 'returns', lasyncro_variant_id: h.healthyLine.variantId,
        quantity: 1, exception_type: 'repackaging_required', problem_bin_location: 'S4B-PROB-G2',
      }).returning('problem_task_id'));
    const tasksBefore = await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId));

    const list = await request(app).get('/api/v1/wms/problem-center').set(auth(shop.token));
    expect(list.status).toBe(200);
    const listed = (list.body.problem_tasks as any[]).map((t) => t.problem_task_id);
    expect(listed).toContain(ordinary.problem_task_id);
    for (const t of s.tasks) expect(listed).not.toContain(t.problem_task_id);

    const resolve = await request(app).post(`/api/v1/wms/problem-center/${heldTaskId}/resolve`)
      .set(auth(shop.token)).send({ resolution_action: 'discard', resolution_notes: 'S4-B G2' });
    expect(resolve.status).toBe(404);

    // Indistinguishable from an unknown task id (existing replacement-finder behaviour for unknown ids).
    const unknown = await request(app).get(`/api/v1/wms/problem-center/${crypto.randomUUID()}/replacement`).set(auth(shop.token));
    const replacement = await request(app).get(`/api/v1/wms/problem-center/${heldTaskId}/replacement`).set(auth(shop.token));
    expect([replacement.status, replacement.body]).toEqual([unknown.status, unknown.body]);
    const control = await request(app).get(`/api/v1/wms/problem-center/${ordinary.problem_task_id}/replacement`).set(auth(shop.token));
    expect(control.status).toBe(200);

    expect(await stockEffects(shop.shopId, h.j.lines.map((l) => l.variantId))).toEqual(tasksBefore);
    expect((await heldState(h.j)).tasks).toEqual(s.tasks);
  });

  it('G3 — gate ON leaves held-free accepted flows unchanged: same LSUs, Close, Stow; no capture or task (RED until the schema exists)', async () => {
    const shop = await provisionFt2Shop('g3');
    setHeldCapture(true);
    const j = await openJob(await shippedMultiLinePo(shop, [10, 6]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 4);
    await finalizeGroup(j, [[l1, HEALTHY], [l2, {
      accepted: 4, rejected: 0, missing: 2, deferred: 0,
      newExceptions: [{ exception_type: 'missing_item', quantity_affected: 2 }],
    }]]);
    expect((await httpClose(j)).status).toBe(200);
    const s = await heldState(j);
    expect({ captures: s.captures.length, held: s.heldUnits.length, accepted: s.acceptedUnits.length })
      .toEqual({ captures: 0, held: 0, accepted: 14 });
    const stock = await stockEffects(shop.shopId, j.lines.map((l) => l.variantId));
    expect(stock.stow.map((t: any) => Number(t.quantity)).sort((a: number, b: number) => a - b)).toEqual([4, 10]);
    expect(stock.problems).toEqual([]);
  });
});

// ── 7. schema migration contract ────────────────────────────────────────────

describe('GH-1254 S4-B — 7. migration 0213 is additive and its rollback fails closed (RED)', () => {
  const MIGRATIONS_DIR = path.join(__dirname, '../../../apps/backend/migrations');
  let migrationDb: Knex;

  beforeAll(() => {
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
  });

  afterAll(async () => {
    if (migrationDb) await migrationDb.destroy();
  });

  function migration0213(): { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> } {
    const file = fs.readdirSync(MIGRATIONS_DIR).find((f) => S4B.migrationFile.test(f));
    expect({ migration0213: file ?? 'MISSING' }).toEqual({ migration0213: expect.stringMatching(S4B.migrationFile) });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(MIGRATIONS_DIR, file!));
  }

  async function inRolledBackTransaction(body: (trx: Knex.Transaction) => Promise<void>) {
    const sentinel = new Error('__rollback__');
    try {
      await migrationDb.transaction(async (trx) => { await body(trx); throw sentinel; });
    } catch (err) {
      if (err !== sentinel) throw err;
    }
  }

  function inSavepoint(trx: Knex.Transaction, body: (sp: Knex.Transaction) => Promise<void>) {
    return trx.transaction(body).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  }

  async function schema0213(trx: Knex.Transaction) {
    const table = await trx.raw(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              has_table_privilege('sf_app', c.oid, 'SELECT') AS can_select,
              has_table_privilege('sf_app', c.oid, 'INSERT') AS can_insert,
              has_table_privilege('sf_app', c.oid, 'UPDATE') AS can_update,
              has_table_privilege('sf_app', c.oid, 'DELETE') AS can_delete,
              has_table_privilege('sf_app', c.oid, 'TRUNCATE') AS can_truncate,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers
         FROM pg_class c WHERE c.relkind = 'r' AND c.relname = ?`, [S4B.captures]);
    const columns = await trx.raw(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN
          (('inventory_units', ?), ('problem_center_tasks', ?), ('problem_center_tasks', ?),
           ('problem_center_tasks', ?), ('receive_reconciliation_finalization_lines', ?))
        ORDER BY 1`,
      [S4B.unitAnchor, S4B.taskUnit, S4B.taskCapture, S4B.taskWarehouse, S4B.finalizationHeld]);
    return { capturesTable: table.rows[0] ?? null, columns: columns.rows.map((r: any) => r.col) };
  }

  const HEAD = {
    capturesTable: {
      rls: true, forced: true, policies: 1, triggers: 2,
      can_select: true, can_insert: true, can_update: false, can_delete: false, can_truncate: false,
    },
    columns: [
      `inventory_units.${S4B.unitAnchor}`,
      `problem_center_tasks.${S4B.taskCapture}`,
      `problem_center_tasks.${S4B.taskUnit}`,
      `problem_center_tasks.${S4B.taskWarehouse}`,
      `receive_reconciliation_finalization_lines.${S4B.finalizationHeld}`,
    ].sort(),
  };
  const PRE_0213 = { capturesTable: null, columns: [] };

  async function enumValues(trx: Knex.Transaction) {
    const r = await trx.raw(
      `SELECT t.typname || '.' || e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE (t.typname, e.enumlabel) IN (('inventory_unit_lifecycle_status', ?), ('inventory_unit_provenance', ?))
        ORDER BY 1`, [S4B.heldStatus, S4B.heldSource]);
    return r.rows.map((row: any) => row.v);
  }

  /** Removes only held evidence, inside an always-rolled-back migration-role transaction. */
  async function withoutHeldEvidence(trx: Knex.Transaction) {
    await trx.raw(`SET LOCAL row_security = off`);
    await trx.raw(`DELETE FROM problem_center_tasks WHERE ${S4B.taskUnit} IS NOT NULL`);
    await trx.raw(`DELETE FROM inventory_units WHERE ${S4B.unitAnchor} IS NOT NULL`);
    const held = await trx.raw(
      `SELECT DISTINCT reconciliation_id FROM receive_reconciliation_finalization_lines WHERE ${S4B.finalizationHeld} > 0`);
    const ids = held.rows.map((r: any) => r.reconciliation_id);
    for (const t of [S4B.captures, 'receive_reconciliation_exception_links', 'receive_reconciliation_finalization_lines', 'receive_reconciliation_finalizations']) {
      await trx.raw(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
      if (t === S4B.captures) await trx.raw(`DELETE FROM ${t}`);
      else await trx.raw(`DELETE FROM ${t} WHERE reconciliation_id = ANY(?::uuid[])`, [ids]);
      await trx.raw(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
    // Held moves to deferred so the existing 0208 coverage CHECK stays satisfied.
    await trx.raw(`UPDATE receive_job_lines
                      SET quantity_deferred = quantity_deferred + quantity_held_recoverable,
                          quantity_held_recoverable = 0, quantity_delivered = quantity_accepted + quantity_rejected
                    WHERE quantity_held_recoverable > 0`);
  }

  /** Pre-existing held-free evidence the migration must leave valid and unchanged. */
  async function seedHeldFreeEvidence() {
    const shop = await provisionFt2Shop('m0213');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    await confirmCount(j, j.lines[0], 3);
    await finalizeGroup(j, [[j.lines[0], { accepted: 3, rejected: 0, missing: 0, deferred: 0 }]]);
    expect((await httpClose(j)).status).toBe(200);
    const [task] = await withTenant(shop.shopId, (trx) => trx('problem_center_tasks').insert({
      shop_id: shop.shopId, status: 'open', source: 'returns', lasyncro_variant_id: j.lines[0].variantId,
      quantity: 1, exception_type: 'repackaging_required', problem_bin_location: 'S4B-PROB-M',
    }).returning('problem_task_id'));
    return { shop, j, taskId: task.problem_task_id as string };
  }

  async function heldFreeSnapshot(trx: Knex.Transaction, f: Awaited<ReturnType<typeof seedHeldFreeEvidence>>) {
    await trx.raw(`SET LOCAL row_security = off`);
    return {
      line: await trx('receive_job_lines').where({ receive_job_id: f.j.receiveJobId })
        .first('quantity_accepted', 'quantity_delivered', 'quantity_held_recoverable', 'inspection_complete'),
      finalLine: await trx('receive_reconciliation_finalization_lines').where({ receive_job_id: f.j.receiveJobId })
        .first('quantity_accepted', 'quantity_missing', 'quantity_deferred'),
      units: await trx('inventory_units').where({ receive_job_line_id: f.j.lines[0].receiveJobLineId })
        .orderBy('lasyncro_unit_id').select('lasyncro_unit_id', 'status', 'source'),
      task: await trx('problem_center_tasks').where({ problem_task_id: f.taskId })
        .first('status', 'source', 'problem_bin_location', 'quantity'),
    };
  }

  it('M1 — head schema: captures FORCE-RLS, SELECT/INSERT-only, append-only; without held evidence DOWN → UP round-trips over existing data unchanged', async () => {
    const m = migration0213();
    const f = await seedHeldFreeEvidence();
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0213(trx)).toEqual(HEAD);
      expect(await enumValues(trx)).toEqual([`inventory_unit_lifecycle_status.${S4B.heldStatus}`, `inventory_unit_provenance.${S4B.heldSource}`]);
      const before = await heldFreeSnapshot(trx, f);
      await withoutHeldEvidence(trx);
      expect(await inSavepoint(trx, (sp) => m.down(sp))).toEqual({ ok: true });
      expect(await schema0213(trx)).toEqual(PRE_0213);
      expect(await heldFreeSnapshot(trx, f)).toEqual(before);
      expect(await inSavepoint(trx, (sp) => m.up(sp))).toEqual({ ok: true });
      expect(await schema0213(trx)).toEqual(HEAD);
      expect(await heldFreeSnapshot(trx, f)).toEqual(before);
    });
  });

  it('M2 — DOWN refuses while held evidence exists, leaving schema and evidence unchanged', async () => {
    const m = migration0213();
    const shop = await provisionFt2Shop('m0213h');
    const h = await heldJob(shop);
    const s = await heldState(h.j);
    expect(s.heldUnits).toHaveLength(2);
    await inRolledBackTransaction(async (trx) => {
      const read = async () => {
        await trx.raw(`SET LOCAL row_security = off`);
        return trx('inventory_units').whereIn('lasyncro_unit_id', s.heldLsus).orderBy('lasyncro_unit_id')
          .select('lasyncro_unit_id', 'status');
      };
      const before = await read();
      const outcome = await inSavepoint(trx, (sp) => m.down(sp));
      expect(outcome.ok).toBe(false);
      expect(String((outcome as any).error?.message)).toMatch(S4B.rollbackBlocked);
      expect(await schema0213(trx)).toEqual(HEAD);
      expect(await read()).toEqual(before);
    });
  });
});
