/**
 * GH-1241 / S3-C — S3C-M4 GROUPED CLOSE / LABELS / STOW — acceptance gate.
 *
 * Certifies the grouped Receive journey after S3-B finalization through the
 * existing readiness gate, Receive close and Stow handoff, on the real routes
 * (createApp + supertest) against the disposable synchroflow_test_* database
 * (`npm run test:integration`). Close is the only stock-side writer: accepted
 * units only are credited, once; Stow receives exactly the accepted quantity;
 * missing evidence is preserved; deferred stays pending on the PO; barcode-less
 * stock stays close-gated until its LSU labels are acknowledged; preexisting
 * defect evidence is referenced, never duplicated; overlapping closes yield one
 * receipt.
 *
 * Preservation contracts (unchanged, separately GREEN): GH-1243 close safety,
 * GH-1085 barcode readiness, GH-1245 outstanding delivery, GH-1241 S3-B.
 *
 * Harness: provisioning, fixtures, routes, grouped helpers, effects and overlap
 * instrumentation are reproduced from receive-grouped-reconciliation-gh1241-
 * s3b.test.ts (variant barcode parameterised for barcode-less stock). Every
 * mutation goes through the real routes; concurrency uses a test-held PO row
 * lock and pg_stat_activity proof of overlap — no sleeps.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-13';
/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the GH-1245 / GH-1241 S3-A1 suites) ───────

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
  const shopDomain = `rcvm4-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
        email: `receive-s3b-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
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

async function seedMappedVariant(shopId: number, barcode: string | null = EXTERNAL_BARCODE): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S3B${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/S3B${nonce}`,
          title: `GH1241 S3-B grouped fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1241-S3B-${nonce}`,
                  barcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/S3B${nonce}`,
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

interface PoLine { poLineItemId: string; variantId: string; ordered: number }
interface PoFixture { shop: Shop; supplierId: number; poId: string; lines: PoLine[] }

/** supplier → multi-line PO already marked arrived ('shipped'), one variant per line. */
async function shippedMultiLinePo(shop: Shop, quantities: number[], barcode: string | null = EXTERNAL_BARCODE): Promise<PoFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const variantIds: string[] = [];
  for (let i = 0; i < quantities.length; i += 1) variantIds.push(await seedMappedVariant(shop.shopId, barcode));

  return withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1241 S3-B supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    const lines: PoLine[] = [];
    for (let i = 0; i < quantities.length; i += 1) {
      const [poLine] = await trx('purchase_order_line_items')
        .insert({
          po_id: po.id,
          shop_id: shop.shopId,
          lasyncro_variant_id: variantIds[i],
          description: `GH1241 S3-B grouped line ${i + 1}`,
          quantity_ordered: quantities[i],
          unit_cost_cents: 400,
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

async function jobLines(po: PoFixture, receiveJobId: string): Promise<JobLine[]> {
  const rows = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_job_lines')
      .where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .select('receive_job_line_id', 'po_line_item_id', 'lasyncro_variant_id', 'quantity_expected'));
  // Ordered like the PO fixture so tests can address lines by index.
  return po.lines.map((pl) => {
    const row = rows.find((r: any) => r.po_line_item_id === pl.poLineItemId);
    expect(row).toBeTruthy();
    return {
      receiveJobLineId: row.receive_job_line_id as string,
      poLineItemId: pl.poLineItemId,
      variantId: row.lasyncro_variant_id as string,
      expected: Number(row.quantity_expected),
    };
  });
}

/** Real dispatcher create route (owner self-assigns, GH-1109) + real claim (GH-1111). */
async function openJob(po: PoFixture): Promise<JobFixture> {
  const created = await request(app)
    .post(`/api/v1/suppliers/purchase-orders/${po.poId}/receive-jobs`)
    .set(auth(po.shop.token))
    .send({ assigned_operator_id: po.shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  const claimed = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(po.shop.token))
    .send({});
  expect(claimed.status).toBe(200);
  const job = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_jobs').where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .first('delivery_accounting_version'));
  expect(Number(job?.delivery_accounting_version)).toBe(2);
  return { po, receiveJobId, lines: await jobLines(po, receiveJobId) };
}

/** Seed the historical v1 shape directly (GH-1245 B1 legacy precedent); never relabel a v2 job. */
async function legacyV1Job(po: PoFixture): Promise<JobFixture> {
  expect(po.lines).toHaveLength(1);
  const receiveJobId = await withTenant(po.shop.shopId, async (trx) => {
    const [job] = await trx('receive_jobs').insert({
      shop_id: po.shop.shopId, po_id: po.poId, assigned_operator_id: po.shop.userId,
      status: 'pending', total_variants: 1, total_units: po.lines[0].ordered,
      // Omit 0208 columns: the migrated historical default must remain v1.
    }).returning('receive_job_id');
    await trx('receive_job_lines').insert({
      shop_id: po.shop.shopId, receive_job_id: job.receive_job_id,
      po_line_item_id: po.lines[0].poLineItemId, lasyncro_variant_id: po.lines[0].variantId,
      quantity_expected: po.lines[0].ordered,
    });
    return job.receive_job_id as string;
  });
  const claimed = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(po.shop.token))
    .send({});
  expect(claimed.status).toBe(200);
  const job = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_jobs').where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .first('delivery_accounting_version'));
  expect(Number(job?.delivery_accounting_version)).toBe(1);
  return { po, receiveJobId, lines: await jobLines(po, receiveJobId) };
}

// ── existing real routes (S3-A1 / GH-1245 / GH-1243) ────────────────────────

function httpConfirmCount(
  j: JobFixture, line: JobLine, quantity: number,
  deviceEventId: string = crypto.randomUUID(), token: string = j.po.shop.token
) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${line.receiveJobLineId}/confirm-count`)
    .set(auth(token))
    .send({ quantity_confirmed: quantity, device_event_id: deviceEventId });
}

async function confirmCount(j: JobFixture, line: JobLine, quantity: number) {
  const res = await httpConfirmCount(j, line, quantity);
  expect(res.status).toBe(200);
}

function httpProgress(j: JobFixture, line: JobLine, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${line.receiveJobLineId}/progress`)
    .set(auth(j.po.shop.token))
    .send(body);
}

interface NewException {
  exception_type: string;
  quantity_affected: number;
  accounting_role?: string;
  notes?: string;
}

/** Existing per-line exception route (pre-grouped canonical evidence). */
function httpReport(j: JobFixture, line: JobLine, body: NewException) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
    .set(auth(j.po.shop.token))
    .send({
      lasyncro_variant_id: line.variantId,
      receive_job_line_id: line.receiveJobLineId,
      notes: body.notes ?? `GH1241 S3-B ${body.exception_type}`,
      device_event_id: crypto.randomUUID(),
      ...body,
    });
}

async function report(j: JobFixture, line: JobLine, body: NewException): Promise<string> {
  const res = await httpReport(j, line, body);
  expect(res.status).toBe(201);
  return res.body.receive_exception_id as string;
}

interface Disposition {
  accepted: number;
  rejected: number;
  missing: number;
  deferred: number;
  held?: number;
  /** New discrepancy evidence reported inside the grouped operation. */
  newExceptions?: NewException[];
  /** Preexisting canonical exception evidence this allocation reuses. */
  existingExceptionIds?: string[];
}

/** Existing per-line Finish (S2 explicit disposition body). */
function httpInspectLine(j: JobFixture, line: JobLine, d: Disposition, deviceEventId: string = crypto.randomUUID()) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
    .set(auth(j.po.shop.token))
    .send({
      lasyncro_variant_id: line.variantId,
      receive_job_line_id: line.receiveJobLineId,
      quantity_accepted: d.accepted,
      quantity_rejected: d.rejected,
      quantity_missing: d.missing,
      quantity_deferred: d.deferred,
      device_event_id: deviceEventId,
    });
}

function httpClose(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.po.shop.token))
    .send({ actual_delivery_date: DELIVERY_DATE });
}

// ── PROVISIONAL grouped reconciliation adapter (NOT ratified) ───────────────
//
// Engineering assumptions; change spelling here only.
//   PUT  /receive-jobs/:jobId/reconciliation/draft
//        { base_revision_id: string | null, device_event_id, lines: GroupedLine[] }
//        → 2xx { revision_id }            (append-only; supersedes base)
//   POST /receive-jobs/:jobId/reconciliation/finalize
//        { current_revision_id, device_event_id, lines: GroupedLine[] }
//        → 200 { reconciliation_id, status: 'finalized' }
//        lines must equal the current revision's lines (canonical, order-free).
//   GET  /receive-jobs/:jobId/reconciliation
//        → 200 { status, current_revision_id,
//                revisions: [{ revision_id, status, lines }],
//                lines: [{ receive_job_line_id, ... }]   (active applicable lines only),
//                finalization: { reconciliation_id, revision_id, lines } | null }
//   GroupedLine = { receive_job_line_id, quantity_accepted, quantity_rejected,
//                   quantity_missing, quantity_deferred[, quantity_held_recoverable],
//                   new_exceptions: [{ exception_type, quantity_affected, accounting_role?, notes? }],
//                   existing_exception_ids: string[] }
// Overage approval is never a payload field: only persisted extra_item /
// accounting_role='overage' evidence authorizes it.

const GROUPED = {
  draftPath: (jobId: string) => `/api/v1/suppliers/receive-jobs/${jobId}/reconciliation/draft`,
  finalizePath: (jobId: string) => `/api/v1/suppliers/receive-jobs/${jobId}/reconciliation/finalize`,
  readPath: (jobId: string) => `/api/v1/suppliers/receive-jobs/${jobId}/reconciliation`,
  revisionStatus: { current: 'current', superseded: 'superseded' },
  finalizedStatus: 'finalized',
};

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

function httpDraft(
  j: JobFixture, baseRevisionId: string | null, entries: GroupedLineInput[], token: string = j.po.shop.token
) {
  return request(app)
    .put(GROUPED.draftPath(j.receiveJobId))
    .set(auth(token))
    .send({ base_revision_id: baseRevisionId, device_event_id: crypto.randomUUID(), lines: groupedLines(entries) });
}

function httpFinalize(
  j: JobFixture, currentRevisionId: string | null, entries: GroupedLineInput[],
  deviceEventId: string = crypto.randomUUID(), token: string = j.po.shop.token
) {
  return request(app)
    .post(GROUPED.finalizePath(j.receiveJobId))
    .set(auth(token))
    .send({ current_revision_id: currentRevisionId, device_event_id: deviceEventId, lines: groupedLines(entries) });
}

function httpReadReconciliation(j: JobFixture, token: string = j.po.shop.token) {
  return request(app).get(GROUPED.readPath(j.receiveJobId)).set(auth(token));
}

async function readReconciliation(j: JobFixture) {
  const res = await httpReadReconciliation(j);
  expect(res.status).toBe(200);
  return res.body;
}

function revisionId(res: request.Response): string {
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  expect(typeof res.body.revision_id).toBe('string');
  return res.body.revision_id as string;
}

/** The job's current draft revision, or null when none exists (or the read is unavailable). */
async function currentRevisionOf(j: JobFixture): Promise<string | null> {
  const res = await httpReadReconciliation(j);
  return res.status === 200 ? (res.body.current_revision_id ?? null) : null;
}

/**
 * The operator's grouped Finish: amend the current draft revision, then
 * finalize that exact revision. Returns the first refusal (draft or finalize).
 */
async function attemptGroup(j: JobFixture, entries: GroupedLineInput[], deviceEventId: string = crypto.randomUUID()) {
  const draft = await httpDraft(j, await currentRevisionOf(j), entries);
  if (draft.status < 200 || draft.status >= 300) return { response: draft, revisionId: null as string | null };
  const revision = draft.body.revision_id as string;
  return { response: await httpFinalize(j, revision, entries, deviceEventId), revisionId: revision };
}

async function finalizeGroup(j: JobFixture, entries: GroupedLineInput[], deviceEventId?: string) {
  const attempt = await attemptGroup(j, entries, deviceEventId);
  console.info('[S3B_FINALIZE]', attempt.response.status, JSON.stringify(attempt.response.body));
  expect(attempt.response.status).toBe(200);
  expect(attempt.response.body.status).toBe(GROUPED.finalizedStatus);
  expect(typeof attempt.response.body.reconciliation_id).toBe('string');
  return { response: attempt.response, revisionId: attempt.revisionId! };
}

/**
 * A semantic refusal: client error with a machine-readable code. An
 * unregistered route's default 404 (empty body) can never satisfy this.
 */
function expectSemanticRefusal(res: request.Response, status?: number) {
  if (status !== undefined) expect(res.status).toBe(status);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(typeof (res.body?.code ?? res.body?.error)).toBe('string');
}

/** Normalized persisted allocation of a grouped payload, order-insensitive. */
function allocationsOf(lines: any[]) {
  return [...(lines ?? [])]
    .map((l: any) => ({
      receive_job_line_id: l.receive_job_line_id,
      quantity_accepted: Number(l.quantity_accepted),
      quantity_rejected: Number(l.quantity_rejected),
      quantity_missing: Number(l.quantity_missing),
      quantity_deferred: Number(l.quantity_deferred),
    }))
    .sort((a, b) => String(a.receive_job_line_id).localeCompare(String(b.receive_job_line_id)));
}

// ── persisted effects, scoped to one job fixture ────────────────────────────

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Every consequence these contracts assert on, scoped to one Receive job and its variants. */
async function jobEffects(j: JobFixture) {
  const { shopId } = j.po.shop;
  const variantIds = j.po.lines.map((l) => l.variantId);
  const lineIds = j.lines.map((l) => l.receiveJobLineId);
  return withTenant(shopId, async (trx) => {
    const lines = await trx('receive_job_lines')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .select('receive_job_line_id', 'inspection_complete', 'inspected_by', 'quantity_expected', 'quantity_accepted',
        'quantity_rejected', 'quantity_missing', 'quantity_deferred', 'quantity_delivered',
        'quantity_held_recoverable', 'quantity_count_confirmed', 'count_confirmation_event_id',
        'quantity_sellable_provisional');
    const job = await trx('receive_jobs')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .first('status', 'units_accepted', 'units_rejected');
    const poLines = await trx('purchase_order_line_items')
      .where({ shop_id: shopId, po_id: j.po.poId })
      .select('id', 'quantity_received', 'quantity_pending_delivery');
    const poRow = await trx('purchase_orders').where({ shop_id: shopId, id: j.po.poId }).first('status');
    const exceptions = await trx('receive_exceptions')
      .where({ shop_id: shopId, receive_job_id: j.receiveJobId })
      .select('receive_exception_id', 'receive_job_line_id', 'lasyncro_variant_id', 'exception_type',
        'quantity_affected', 'accounting_role');
    const units = await trx('inventory_units')
      .where({ shop_id: shopId }).whereIn('receive_job_line_id', lineIds)
      .select('receive_job_line_id', 'lasyncro_unit_id');
    const movements = await trx('inventory_movements')
      .where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .select('lasyncro_variant_id', 'movement_type', 'quantity_delta');
    const truth = await trx('inventory_truth')
      .where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .sum<{ sum: string | null }>('on_hand_quantity as sum').first();
    const stow = await trx('stow_tasks')
      .where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .count<{ count: string }>('* as count').first();
    const alerts = await trx('alerts')
      .where({ shop_id: shopId, alert_type: 'wms_receive_exception' })
      .count<{ count: string }>('* as count').first();
    const problems = await trx('problem_center_tasks')
      .where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .select('lasyncro_variant_id');

    const byLine = (id: string) => lines.find((l: any) => l.receive_job_line_id === id);
    return {
      lines: j.lines.map((jl) => {
        const l = byLine(jl.receiveJobLineId);
        return {
          inspectionComplete: Boolean(l?.inspection_complete),
          inspectedBy: numOrNull(l?.inspected_by),
          expected: numOrNull(l?.quantity_expected),
          accepted: numOrNull(l?.quantity_accepted),
          rejected: numOrNull(l?.quantity_rejected),
          missing: numOrNull(l?.quantity_missing),
          deferred: numOrNull(l?.quantity_deferred),
          delivered: numOrNull(l?.quantity_delivered),
          held: numOrNull(l?.quantity_held_recoverable),
          countConfirmed: numOrNull(l?.quantity_count_confirmed),
          countEventId: l?.count_confirmation_event_id ?? null,
          provisional: numOrNull(l?.quantity_sellable_provisional),
          lsuCount: units.filter((u: any) => u.receive_job_line_id === jl.receiveJobLineId).length,
          problemCenterTasks: problems.filter((p: any) => p.lasyncro_variant_id === jl.variantId).length,
        };
      }),
      jobStatus: job?.status ?? null,
      unitsAccepted: Number(job?.units_accepted ?? 0),
      unitsRejected: Number(job?.units_rejected ?? 0),
      poStatus: poRow?.status ?? null,
      poLines: j.po.lines.map((pl) => {
        const row = poLines.find((r: any) => r.id === pl.poLineItemId);
        return { received: numOrNull(row?.quantity_received), pending: numOrNull(row?.quantity_pending_delivery) };
      }),
      exceptions: exceptions
        .map((e: any) => ({
          id: e.receive_exception_id as string,
          lineId: e.receive_job_line_id as string,
          variantId: e.lasyncro_variant_id as string,
          type: e.exception_type as string,
          quantity: Number(e.quantity_affected),
          role: (e.accounting_role ?? null) as string | null,
        }))
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
      movementCount: movements.length,
      inboundQuantity: movements
        .filter((m: any) => m.movement_type === 'inbound_purchase')
        .reduce((s: number, m: any) => s + Number(m.quantity_delta), 0),
      truthOnHand: Number(truth?.sum ?? 0),
      stowTaskCount: Number(stow?.count ?? 0),
      receiveExceptionAlertCount: Number(alerts?.count ?? 0),
    };
  });
}

type Effects = Awaited<ReturnType<typeof jobEffects>>;

/** Canonical exception evidence of one line, without generated ids/roles. */
function evidenceOf(s: Effects, line: JobLine) {
  return s.exceptions
    .filter((e) => e.lineId === line.receiveJobLineId)
    .map((e) => ({ lineId: e.lineId, variantId: e.variantId, type: e.type, quantity: e.quantity }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function evidence(line: JobLine, type: string, quantity: number) {
  return { lineId: line.receiveJobLineId, variantId: line.variantId, type, quantity };
}

/** Sum of canonical missing_item evidence for one line. */
function canonicalMissing(s: Effects, line: JobLine): number {
  return s.exceptions
    .filter((e) => e.lineId === line.receiveJobLineId && e.type === 'missing_item')
    .reduce((n, e) => n + e.quantity, 0);
}

/** Asserts a finalized line persisted exactly the explicit disposition (never capped). */
function expectFinalLine(s: Effects, index: number, d: Disposition) {
  expect(s.lines[index]).toEqual(expect.objectContaining({
    inspectionComplete: true,
    accepted: d.accepted,
    rejected: d.rejected,
    missing: d.missing,
    deferred: d.deferred,
    delivered: d.accepted + d.rejected,
    held: 0,
    // LSU identities exist only for accepted stock.
    lsuCount: d.accepted,
  }));
}

/** No stock-side consequence exists yet for these variants. */
function expectNoStockCredit(s: Effects) {
  expect({
    movementCount: s.movementCount,
    truthOnHand: s.truthOnHand,
    stowTaskCount: s.stowTaskCount,
    received: s.poLines.map((p) => p.received ?? 0),
  }).toEqual({
    movementCount: 0,
    truthOnHand: 0,
    stowTaskCount: 0,
    received: s.poLines.map(() => 0),
  });
}

// ── overlap instrumentation (GH-1245 / S3-A1 precedent; test-only) ──────────

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

/**
 * Holds `SELECT … FOR UPDATE` on the purchase order row — the first lock of the
 * ratified PO→job→line order — in one transaction until released.
 */
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

// ── M4 additions ────────────────────────────────────────────────────────────

/** Close-side consequences beyond jobEffects: Stow quantities, labelled LSUs, supplier defect rate, ledger rows. */
async function closeSide(j: JobFixture) {
  const { shopId } = j.po.shop;
  const variantIds = j.po.lines.map((l) => l.variantId);
  const lineIds = j.lines.map((l) => l.receiveJobLineId);
  return withTenant(shopId, async (trx) => {
    const stow = await trx('stow_tasks').where({ shop_id: shopId }).whereIn('lasyncro_variant_id', variantIds)
      .select('lasyncro_variant_id', 'quantity', 'trigger');
    const units = await trx('inventory_units').where({ shop_id: shopId }).whereIn('receive_job_line_id', lineIds)
      .select('receive_job_line_id', 'lasyncro_unit_id', 'label_printed_at');
    const inbound = await trx('inventory_movements').where({ shop_id: shopId, movement_type: 'inbound_purchase' })
      .whereIn('lasyncro_variant_id', variantIds).select('lasyncro_variant_id', 'quantity_delta', 'reference_id');
    const supplier = await trx('suppliers').where({ shop_id: shopId, id: j.po.supplierId }).first('defect_rate');
    return {
      stow: j.po.lines.map((pl) => stow.filter((s: any) => s.lasyncro_variant_id === pl.variantId)
        .map((s: any) => ({ quantity: Number(s.quantity), trigger: s.trigger }))),
      unitIds: units.map((u: any) => u.lasyncro_unit_id as string).sort(),
      labelled: units.filter((u: any) => u.label_printed_at != null).length,
      inbound: inbound.map((m: any) => ({ variantId: m.lasyncro_variant_id, quantity: Number(m.quantity_delta), reference: m.reference_id })),
      defectRate: supplier?.defect_rate == null ? null : Number(supplier.defect_rate),
    };
  });
}

function httpAcknowledgeLabels(j: JobFixture, line: JobLine) {
  return request(app)
    .post(`/api/v1/wms/receive-job-lines/${line.receiveJobLineId}/unit-labels/printed`)
    .set(auth(j.po.shop.token))
    .send({});
}

async function receiveJobStatus(j: JobFixture) {
  const row = await withTenant(j.po.shop.shopId, (trx) =>
    trx('receive_jobs').where({ shop_id: j.po.shop.shopId, receive_job_id: j.receiveJobId }).first('status'));
  return row?.status ?? null;
}

const missingItem = (quantity: number): NewException => ({ exception_type: 'missing_item', quantity_affected: quantity, accounting_role: 'shortfall' });

describe('GH-1241 S3C-M4 — grouped close, labels and Stow handoff', () => {
  it('A — PO-1006: expected 3, good 1, missing 2 → finalize → ready → close credits 1, one Stow task of 1, missing 2 preserved', async () => {
    const shop = await provisionFt2Shop('a');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    const [l] = j.lines;
    await confirmCount(j, l, 1);
    await finalizeGroup(j, [[l, { accepted: 1, rejected: 0, missing: 2, deferred: 0, newExceptions: [missingItem(2)] }]]);

    const finalized = await jobEffects(j);
    expect(await receiveJobStatus(j)).toBe('stow_ready');
    expectNoStockCredit(finalized);
    expect(finalized.lines[0].lsuCount).toBe(1);

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      jobStatus: closed.jobStatus,
      poStatus: closed.poStatus,
      poLine: closed.poLines[0],
      truth: closed.truthOnHand,
      inbound: side.inbound.map((m) => m.quantity),
      stow: side.stow[0],
      missingEvidence: evidenceOf(closed, l),
      problemCenterTasks: closed.lines[0].problemCenterTasks,
      lsus: side.unitIds.length,
    }).toEqual({
      jobStatus: 'closed',
      poStatus: 'received',
      poLine: { received: 1, pending: 0 },
      truth: 1,
      inbound: [1],
      stow: [{ quantity: 1, trigger: 'inbound_stock' }],
      missingEvidence: [evidence(l, 'missing_item', 2)],
      problemCenterTasks: 0,
      lsus: 1,
    });
  });

  it('B — barcode-less stock: close is refused with zero effects until every LSU label is acknowledged, then credits once', async () => {
    const shop = await provisionFt2Shop('b');
    const j = await openJob(await shippedMultiLinePo(shop, [2], null));
    const [l] = j.lines;
    await confirmCount(j, l, 2);
    await finalizeGroup(j, [[l, { accepted: 2, rejected: 0, missing: 0, deferred: 0 }]]);

    expect(await receiveJobStatus(j)).toBe('barcode_assignment');
    const held = await closeSide(j);
    expect({ lsus: held.unitIds.length, labelled: held.labelled }).toEqual({ lsus: 2, labelled: 0 });

    const before = await jobEffects(j);
    const refusal = await httpClose(j);
    console.info('[S3C_M4_B_UNREADY_CLOSE]', refusal.status, JSON.stringify(refusal.body));
    // Refused (GH-1243 C5a shape); the status classification is asserted separately in B-status.
    expect(refusal.status).toBeGreaterThanOrEqual(400);
    const refused = await jobEffects(j);
    expect(refused).toEqual(before);
    expectNoStockCredit(refused);

    expect((await httpAcknowledgeLabels(j, l)).status).toBe(200);
    expect(await receiveJobStatus(j)).toBe('stow_ready');

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      jobStatus: closed.jobStatus,
      truth: closed.truthOnHand,
      inbound: side.inbound.map((m) => m.quantity),
      stow: side.stow[0],
      // LSU identities stay the ones minted at finalization: traceable, never re-minted.
      unitIds: side.unitIds,
      labelled: side.labelled,
    }).toEqual({
      jobStatus: 'closed',
      truth: 2,
      inbound: [2],
      stow: [{ quantity: 2, trigger: 'inbound_stock' }],
      unitIds: held.unitIds,
      labelled: 2,
    });
  });

  it('B-status — a close refused for outstanding labels is a client refusal with a machine-readable reason, not a server error', async () => {
    const shop = await provisionFt2Shop('bs');
    const j = await openJob(await shippedMultiLinePo(shop, [1], null));
    const [l] = j.lines;
    await confirmCount(j, l, 1);
    await finalizeGroup(j, [[l, { accepted: 1, rejected: 0, missing: 0, deferred: 0 }]]);
    const before = await jobEffects(j);

    const refusal = await httpClose(j);
    console.info('[S3C_M4_B_STATUS]', refusal.status, JSON.stringify(refusal.body));
    expectSemanticRefusal(refusal, 409);
    expect({ status: refusal.status, code: refusal.body.code }).toEqual({ status: 409, code: 'RECEIVE_BARCODE_READINESS_REQUIRED' });
    // The existing readiness detail is preserved in the error text.
    expect(refusal.body.error).toMatch(/^RECEIVE_BARCODE_READINESS_REQUIRED: accepted units on job .* \[[0-9a-f-]+:labels_outstanding\(0\/1\)\]$/);
    expect(await jobEffects(j)).toEqual(before);
  });

  it('C — fully missing delivery: confirmed zero and explicit missing close with no stock, LSU or Stow task', async () => {
    const shop = await provisionFt2Shop('c');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    const [l] = j.lines;
    await confirmCount(j, l, 0);
    await finalizeGroup(j, [[l, { accepted: 0, rejected: 0, missing: 3, deferred: 0, newExceptions: [missingItem(3)] }]]);
    expect(await receiveJobStatus(j)).toBe('stow_ready');

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      jobStatus: closed.jobStatus,
      poStatus: closed.poStatus,
      poLine: closed.poLines[0],
      movements: closed.movementCount,
      truth: closed.truthOnHand,
      stowTasks: closed.stowTaskCount,
      lsus: side.unitIds.length,
      missingEvidence: evidenceOf(closed, l),
      problemCenterTasks: closed.lines[0].problemCenterTasks,
    }).toEqual({
      jobStatus: 'closed',
      // GH-1245 R3: a final all-missing delivery leaves nothing outstanding.
      poStatus: 'received',
      poLine: { received: 0, pending: 0 },
      movements: 0,
      truth: 0,
      stowTasks: 0,
      lsus: 0,
      missingEvidence: [evidence(l, 'missing_item', 3)],
      problemCenterTasks: 0,
    });
  });

  it('D — coming later: deferred units stay pending on the PO; only the good units are credited and stowed', async () => {
    const shop = await provisionFt2Shop('d');
    const j = await openJob(await shippedMultiLinePo(shop, [5]));
    const [l] = j.lines;
    await confirmCount(j, l, 2);
    await finalizeGroup(j, [[l, { accepted: 2, rejected: 0, missing: 0, deferred: 3 }]]);

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      poStatus: closed.poStatus,
      poLine: closed.poLines[0],
      truth: closed.truthOnHand,
      stow: side.stow[0],
      exceptions: closed.exceptions.length,
    }).toEqual({
      poStatus: 'partially_received',
      poLine: { received: 2, pending: 3 },
      truth: 2,
      stow: [{ quantity: 2, trigger: 'inbound_stock' }],
      exceptions: 0,
    });
  });

  it('E — damaged units are rejected beside the good count: one defect record, rejected accounted, only good units credited', async () => {
    const shop = await provisionFt2Shop('e');
    const j = await openJob(await shippedMultiLinePo(shop, [4]));
    const [l] = j.lines;
    await confirmCount(j, l, 2);
    await finalizeGroup(j, [[l, {
      accepted: 2, rejected: 1, missing: 1, deferred: 0,
      newExceptions: [{ exception_type: 'defect', quantity_affected: 1 }, missingItem(1)],
    }]]);

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      line: { accepted: closed.lines[0].accepted, rejected: closed.lines[0].rejected, missing: closed.lines[0].missing, delivered: closed.lines[0].delivered },
      unitsRejected: closed.unitsRejected,
      evidence: evidenceOf(closed, l),
      truth: closed.truthOnHand,
      stow: side.stow[0],
      // defective 1 / accepted 2.
      defectRate: side.defectRate,
      problemCenterTasks: closed.lines[0].problemCenterTasks,
    }).toEqual({
      line: { accepted: 2, rejected: 1, missing: 1, delivered: 3 },
      unitsRejected: 1,
      evidence: [evidence(l, 'defect', 1), evidence(l, 'missing_item', 1)],
      truth: 2,
      stow: [{ quantity: 2, trigger: 'inbound_stock' }],
      defectRate: 50,
      problemCenterTasks: 0,
    });
  });

  it('F — preexisting per-line defect evidence is referenced by the group: no duplicate record, no defect-rate inflation', async () => {
    const shop = await provisionFt2Shop('f');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    const [l] = j.lines;
    // An older client reported the damaged unit on the per-line path before the group finished.
    const defectId = await report(j, l, { exception_type: 'defect', quantity_affected: 1 });
    await confirmCount(j, l, 1);
    await finalizeGroup(j, [[l, {
      accepted: 1, rejected: 1, missing: 1, deferred: 0,
      newExceptions: [missingItem(1)], existingExceptionIds: [defectId],
    }]]);

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    const read = await readReconciliation(j);
    expect({
      defects: closed.exceptions.filter((e) => e.type === 'defect').map((e) => e.id),
      evidence: evidenceOf(closed, l),
      referenced: read.finalization?.lines?.[0]?.referenced_exception_ids,
      // defective 1 / accepted 1 — a duplicate would read 200.
      defectRate: side.defectRate,
      truth: closed.truthOnHand,
    }).toEqual({
      defects: [defectId],
      evidence: [evidence(l, 'defect', 1), evidence(l, 'missing_item', 1)],
      referenced: [defectId],
      defectRate: 100,
      truth: 1,
    });
  });

  it('G — two overlapping closes of a grouped-finalized job: one 200, one refusal, one receipt, one Stow task, LSUs unchanged', async () => {
    const shop = await provisionFt2Shop('g');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    const [l] = j.lines;
    await confirmCount(j, l, 3);
    await finalizeGroup(j, [[l, { accepted: 3, rejected: 0, missing: 0, deferred: 0 }]]);
    const finalized = await closeSide(j);

    const gate = holdPoLock(shop.shopId, j.po.poId);
    const gatePid = await gate.pidKnown;
    // supertest sends only once a handler is attached: dispatch both now.
    const closeA = httpClose(j).then((r) => r);
    const closeB = httpClose(j).then((r) => r);
    try {
      await waitForGateWaiters(shop.shopId, gatePid, 2);
    } finally {
      gate.release();
    }
    await gate.done;
    const responses = await Promise.all([closeA, closeB]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expectSemanticRefusal(responses.find((r) => r.status !== 200)!);
    const closed = await jobEffects(j);
    const side = await closeSide(j);
    expect({
      jobStatus: closed.jobStatus,
      inbound: side.inbound.map((m) => m.quantity),
      truth: closed.truthOnHand,
      stow: side.stow[0],
      poLine: closed.poLines[0],
      unitIds: side.unitIds,
    }).toEqual({
      jobStatus: 'closed',
      inbound: [3],
      truth: 3,
      stow: [{ quantity: 3, trigger: 'inbound_stock' }],
      poLine: { received: 3, pending: 0 },
      unitIds: finalized.unitIds,
    });
  });
});
