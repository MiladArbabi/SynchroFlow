/**
 * GH-1241 / S3-B — GROUPED RECEIVE RECONCILIATION — RED regression gate.
 *
 * Ratified contract: GH-1241 R1/R2/R3, Q1–Q5, the S3-B ratification comment
 * #6142113950 (finalization boundary) and the RED review #6142461568
 * (test-contract corrections).
 *
 *   - The S3-A1 confirmed physical count is the sole accepted-quantity basis.
 *   - One job-scoped grouped reconciliation finalizes every applicable line
 *     atomically. Per line:
 *       accepted + physically_rejected + missing + deferred
 *         = expected + explicitly approved overage
 *     New missing / rejected discrepancy evidence is reported inside the
 *     grouped operation and becomes canonical exception evidence in the SAME
 *     transaction as the final inspections. Preexisting canonical evidence is
 *     referenced, never double-reported. Deferred is a later delivery (no
 *     supplier failure, no stock). `other` / `wrong_quantity` never infer
 *     accounting. Overage approval is only the persisted extra_item /
 *     accounting_role='overage' evidence. Recoverable held units fail closed
 *     until S4.
 *   - Drafts are append-only superseding revisions; they mint no canonical
 *     exceptions, count evidence, LSUs or stock. Finalization binds to the
 *     CURRENT revision; a stale revision is refused.
 *   - Successful finalization is immutable, even before Receive close: no
 *     draft, subsequent/competing finalization or per-line accounting writer
 *     may rewrite it, and each refuses with a client error (never a 500).
 *   - Same event + same canonical (line-order independent) payload replays the
 *     original durable outcome; a conflicting replay is refused.
 *   - Zero-outstanding lines are excluded from active reconciliation: no
 *     invented count, inspection or LSU; close handles them; history is kept.
 *   - Permissions: GET inherits receive-job:read + tenant isolation (not job
 *     ownership); draft/finalize inherit receive-job:inspect, Receive job
 *     ownership and the purchasing.core capability.
 *   - Additive: existing v2 per-line clients stay operable until S3-C / S5.
 *
 * PROVISIONAL INTERFACE. Route names, request fields and response fields are
 * engineering assumptions, not product decisions. All of them live in the
 * GROUPED adapter below so a ratified spelling changes one place only.
 *
 * RED READING. The grouped routes do not exist yet; a missing route answers
 * with the Express default 404 and an empty body. Every refusal here must be
 * SEMANTIC — a 4xx with a machine-readable `code`/`error` — so a missing
 * route can never satisfy a refusal assertion, and every refusal case also has
 * a positive control on the same fixture. A 404 proves missing implementation
 * only — not atomicity, idempotency, concurrency or inventory safety.
 *
 * Every mutation goes through the real routes (createApp + supertest) against
 * the disposable synchroflow_test_* database (`npm run test:integration`).
 * Fixtures follow the GH-1245 / GH-1241 S3-A1 / GH-1243 Receive suites. The
 * concurrency case uses a test-held row lock and pg_stat_activity proof of
 * overlap — no sleeps, no production instrumentation.
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
import * as migration0210 from
  '../../../apps/backend/migrations/20261013150000_0210_receive_grouped_reconciliation';
import * as migration0209 from
  '../../../apps/backend/migrations/20261012150000_0209_receive_line_count_confirmation';
import * as migration0211 from
  '../../../apps/backend/migrations/20261013160000_0211_receive_count_confirmation_events_privileges';

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
  const shopDomain = `rcvs3b-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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

async function seedMappedVariant(shopId: number): Promise<string> {
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
                  barcode: EXTERNAL_BARCODE,
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
async function shippedMultiLinePo(shop: Shop, quantities: number[]): Promise<PoFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const variantIds: string[] = [];
  for (let i = 0; i < quantities.length; i += 1) variantIds.push(await seedMappedVariant(shop.shopId));

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

// ── baseline positive controls (existing behaviour; must stay GREEN) ────────

describe('GH-1241 S3-B — baseline controls (existing S3-A1 / GH-1245 behaviour)', () => {
  it('P1 — an existing v2 per-line client still confirms, inspects and closes a multi-line job without any grouped call', async () => {
    const shop = await provisionFt2Shop('p1');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 6]));
    const [l1, l2] = j.lines;

    await confirmCount(j, l1, 10);
    expect((await httpInspectLine(j, l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    await confirmCount(j, l2, 4);
    expect((await httpInspectLine(j, l2, { accepted: 4, rejected: 0, missing: 0, deferred: 2 })).status).toBe(200);
    expect((await httpClose(j)).status).toBe(200);

    const after = await jobEffects(j);
    expect({
      jobStatus: after.jobStatus,
      inbound: after.inboundQuantity,
      truth: after.truthOnHand,
      pending: after.poLines.map((p) => p.pending),
      lsu: after.lines.map((l) => l.lsuCount),
    }).toEqual({ jobStatus: 'closed', inbound: 14, truth: 14, pending: [0, 2], lsu: [10, 4] });
  });

  it('P2 — the inherited S3-A1 guard still refuses a per-line finish without a confirmed count, with zero writes', async () => {
    const shop = await provisionFt2Shop('p2');
    const j = await openJob(await shippedMultiLinePo(shop, [10]));
    const before = await jobEffects(j);

    const res = await httpInspectLine(j, j.lines[0], { accepted: 10, rejected: 0, missing: 0, deferred: 0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECEIVE_COUNT_NOT_CONFIRMED');
    expect(await jobEffects(j)).toEqual(before);
  });
});

// ── RED contracts ───────────────────────────────────────────────────────────

describe('GH-1241 S3-B — grouped Receive reconciliation (RED)', () => {
  it('B1 — a multi-line group reports NEW missing/rejected evidence and finalizes atomically; stock is credited only at close', async () => {
    const shop = await provisionFt2Shop('b1');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 6, 4]));
    const [l1, l2, l3] = j.lines;

    // Healthy units counted first across the job (S3-A1 evidence). No discrepancy is pre-reported.
    await confirmCount(j, l1, 8);
    await confirmCount(j, l2, 5);
    await confirmCount(j, l3, 1);

    const d1: Disposition = {
      accepted: 8, rejected: 0, missing: 2, deferred: 0,
      newExceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
    };
    const d2: Disposition = {
      accepted: 5, rejected: 1, missing: 0, deferred: 0,
      newExceptions: [{ exception_type: 'defect', quantity_affected: 1 }],
    };
    const d3: Disposition = { accepted: 1, rejected: 0, missing: 0, deferred: 3 };
    const group: GroupedLineInput[] = [[l1, d1], [l2, d2], [l3, d3]];

    const before = await jobEffects(j);
    expect(before.exceptions).toEqual([]);
    expectNoStockCredit(before);

    const { response: finalized } = await finalizeGroup(j, group);

    const after = await jobEffects(j);
    expectFinalLine(after, 0, d1);
    expectFinalLine(after, 1, d2);
    expectFinalLine(after, 2, d3);
    expect({ unitsAccepted: after.unitsAccepted, unitsRejected: after.unitsRejected }).toEqual({ unitsAccepted: 14, unitsRejected: 1 });
    // The grouped evidence became canonical exceptions exactly once, with line/variant lineage.
    expect(after.exceptions).toHaveLength(2);
    expect(evidenceOf(after, l1)).toEqual([evidence(l1, 'missing_item', 2)]);
    expect(evidenceOf(after, l2)).toEqual([evidence(l2, 'defect', 1)]);
    expect(evidenceOf(after, l3)).toEqual([]);
    expect(canonicalMissing(after, l1)).toBe(after.lines[0].missing);
    // Not credited prematurely: finalization is not receipt. Missing/deferred create no Problem Center work.
    expectNoStockCredit(after);
    expect([after.lines[0].problemCenterTasks, after.lines[2].problemCenterTasks]).toEqual([0, 0]);

    // Durable grouped evidence agrees with the final inspections.
    const read = await readReconciliation(j);
    expect(read.status).toBe(GROUPED.finalizedStatus);
    expect(read.finalization?.reconciliation_id).toBe(finalized.body.reconciliation_id);
    expect(allocationsOf(read.finalization?.lines)).toEqual(allocationsOf(groupedLines(group)));

    // Close credits exactly the accepted units, once; deferred stays pending.
    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    expect({
      jobStatus: closed.jobStatus,
      inbound: closed.inboundQuantity,
      truth: closed.truthOnHand,
      pending: closed.poLines.map((p) => p.pending),
      exceptions: closed.exceptions,
    }).toEqual({ jobStatus: 'closed', inbound: 14, truth: 14, pending: [0, 0, 3], exceptions: after.exceptions });
  });

  it('B2 — a late invalid allocation refuses the whole group: no earlier exception, inspection, LSU or alert persists', async () => {
    const shop = await provisionFt2Shop('b2');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10, 10]));
    const [l1, l2, l3] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 9);
    await confirmCount(j, l3, 7);
    const valid1: Disposition = { accepted: 10, rejected: 0, missing: 0, deferred: 0 };
    const valid2: Disposition = {
      accepted: 9, rejected: 0, missing: 1, deferred: 0,
      newExceptions: [{ exception_type: 'missing_item', quantity_affected: 1, accounting_role: 'shortfall' }],
    };
    const before = await jobEffects(j);
    expect(before.exceptions).toEqual([]);

    // l3 is last and leaves 3 units unaccounted (7 + 0 + 0 + 0 ≠ 10).
    const refused = await attemptGroup(j, [[l1, valid1], [l2, valid2], [l3, { accepted: 7, rejected: 0, missing: 0, deferred: 0 }]]);
    console.info('[S3B_B2_REFUSED]', refused.response.status, JSON.stringify(refused.response.body));
    expectSemanticRefusal(refused.response);
    expect(await jobEffects(j)).toEqual(before);
    expect((await readReconciliation(j)).finalization ?? null).toBeNull();

    // Control: correcting only the late line finalizes the same group, with l2's evidence once.
    await finalizeGroup(j, [[l1, valid1], [l2, valid2], [l3, { accepted: 7, rejected: 0, missing: 0, deferred: 3 }]]);
    const after = await jobEffects(j);
    expect(after.lines.map((l) => l.inspectionComplete)).toEqual([true, true, true]);
    expect(evidenceOf(after, l2)).toEqual([evidence(l2, 'missing_item', 1)]);
    expect(after.exceptions).toHaveLength(1);
  });

  it('B3 — finalization of the current revision: exact replay returns the original durable result, reordered lines are equivalent, a conflicting replay is refused', async () => {
    const shop = await provisionFt2Shop('b3');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 8);
    const eventId = crypto.randomUUID();
    const payload: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, {
        accepted: 8, rejected: 0, missing: 2, deferred: 0,
        newExceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
      }],
    ];

    const { response: first, revisionId: rev } = await finalizeGroup(j, payload, eventId);
    const settled = await jobEffects(j);
    const settledRead = await readReconciliation(j);

    const replay = await httpFinalize(j, rev, payload, eventId);
    expect(replay.status).toBe(200);
    expect(replay.body.reconciliation_id).toBe(first.body.reconciliation_id);
    const reordered = await httpFinalize(j, rev, [payload[1], payload[0]], eventId);
    expect(reordered.status).toBe(200);
    expect(reordered.body.reconciliation_id).toBe(first.body.reconciliation_id);
    // No duplicated inspection, exception evidence, LSU or alert.
    expect(await jobEffects(j)).toEqual(settled);

    const conflict = await httpFinalize(j, rev, [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, { accepted: 8, rejected: 0, missing: 0, deferred: 2 }],
    ], eventId);
    expectSemanticRefusal(conflict, 409);
    expect(await jobEffects(j)).toEqual(settled);
    expect(await readReconciliation(j)).toEqual(settledRead);
  });

  it('B4 — two overlapping finalizations of the current revision behind a PO row-lock barrier: exactly one wins, no duplicate effects, no deadlock', async () => {
    const shop = await provisionFt2Shop('b4');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 8);
    const group: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, {
        accepted: 8, rejected: 2, missing: 0, deferred: 0,
        newExceptions: [{ exception_type: 'defect', quantity_affected: 2 }],
      }],
    ];
    const rev = revisionId(await httpDraft(j, null, group));

    const gate = holdPoLock(shop.shopId, j.po.poId);
    const gatePid = await gate.pidKnown;
    const race = [httpFinalize(j, rev, group), httpFinalize(j, rev, group)].map((r) => r.then((x) => x));
    let waiters: LockWaiter[];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 2);
    } finally {
      gate.release();
    }
    await gate.done;
    const results = await Promise.all(race);
    console.info('[S3B_B4_RACE]', JSON.stringify({
      waiters: waiters.map((w) => w.query), results: results.map((r) => [r.status, r.body]),
    }));

    expect(waiters.length).toBe(2);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expectSemanticRefusal(results.find((r) => r.status === 409)!, 409);

    const after = await jobEffects(j);
    expectFinalLine(after, 0, group[0][1]);
    expectFinalLine(after, 1, group[1][1]);
    expect({ unitsAccepted: after.unitsAccepted, unitsRejected: after.unitsRejected }).toEqual({ unitsAccepted: 18, unitsRejected: 2 });
    expect(evidenceOf(after, l2)).toEqual([evidence(l2, 'defect', 2)]);
    expect(after.exceptions).toHaveLength(1);
    expectNoStockCredit(after);
  });

  it('B5 — draft A superseded by B: drafts mint nothing, A stays traceable, a stale A can neither overwrite B nor finalize; current B finalizes', async () => {
    const shop = await provisionFt2Shop('b5');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 8);
    const before = await jobEffects(j);

    const linesA: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, {
        accepted: 8, rejected: 0, missing: 2, deferred: 0,
        newExceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
      }],
    ];
    const linesB: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, {
        accepted: 8, rejected: 2, missing: 0, deferred: 0,
        newExceptions: [{ exception_type: 'defect', quantity_affected: 2 }],
      }],
    ];
    const revA = revisionId(await httpDraft(j, null, linesA));
    const revB = revisionId(await httpDraft(j, revA, linesB));
    expect(revB).not.toBe(revA);

    const read = await readReconciliation(j);
    expect(read.current_revision_id).toBe(revB);
    const byId = (id: string) => (read.revisions ?? []).find((r: any) => r.revision_id === id);
    expect(byId(revA)?.status).toBe(GROUPED.revisionStatus.superseded);
    expect(allocationsOf(byId(revA)?.lines)).toEqual(allocationsOf(groupedLines(linesA)));
    expect(byId(revB)?.status).toBe(GROUPED.revisionStatus.current);
    expect(allocationsOf(byId(revB)?.lines)).toEqual(allocationsOf(groupedLines(linesB)));
    // Drafts mint no canonical exceptions, inspections, LSUs, stock or count evidence.
    expect(await jobEffects(j)).toEqual(before);

    // A stale client still based on A cannot overwrite B …
    const staleDraft = await httpDraft(j, revA, [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, { accepted: 8, rejected: 0, missing: 0, deferred: 2 }],
    ]);
    expectSemanticRefusal(staleDraft, 409);
    expect(await readReconciliation(j)).toEqual(read);
    // … nor silently finalize A.
    const staleFinalize = await httpFinalize(j, revA, linesA);
    expectSemanticRefusal(staleFinalize, 409);
    expect(await jobEffects(j)).toEqual(before);
    expect(await readReconciliation(j)).toEqual(read);

    // The current revision finalizes; only B's evidence becomes canonical.
    const finalized = await httpFinalize(j, revB, linesB);
    expect(finalized.status).toBe(200);
    const after = await jobEffects(j);
    expectFinalLine(after, 1, linesB[1][1]);
    expect(evidenceOf(after, l2)).toEqual([evidence(l2, 'defect', 2)]);
    expect(after.exceptions).toHaveLength(1);
    expect((await readReconciliation(j)).finalization?.revision_id).toBe(revB);
  });

  it('B6 — after finalization (before close) drafts, subsequent finalization and every per-line accounting writer refuse with client errors and change nothing', async () => {
    const shop = await provisionFt2Shop('b6');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 8);
    const group: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, { accepted: 8, rejected: 0, missing: 0, deferred: 2 }],
    ];
    const { revisionId: rev } = await finalizeGroup(j, group);
    const settled = await jobEffects(j);
    const settledRead = await readReconciliation(j);
    expect(settled.jobStatus).not.toBe('closed');

    const amended: GroupedLineInput[] = [
      [l1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
      [l2, { accepted: 8, rejected: 2, missing: 0, deferred: 0, newExceptions: [{ exception_type: 'defect', quantity_affected: 2 }] }],
    ];
    expectSemanticRefusal(await httpDraft(j, rev, amended), 409);
    expectSemanticRefusal(await httpFinalize(j, rev, group), 409);

    // Ordinary per-line accounting writers: refused as a client error, never an internal 500.
    const recount = await httpConfirmCount(j, l2, 9);
    const reinspect = await httpInspectLine(j, l2, { accepted: 8, rejected: 2, missing: 0, deferred: 0 });
    const redraft = await httpProgress(j, l2, { quantity_sellable_provisional: 9 });
    const reallocate = await httpReport(j, l2, { exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' });
    console.info('[S3B_B6_PER_LINE]', JSON.stringify([recount, reinspect, redraft, reallocate].map((r) => [r.status, r.body])));
    for (const res of [recount, reinspect, redraft, reallocate]) expectSemanticRefusal(res);

    expect(await jobEffects(j)).toEqual(settled);
    expect(await readReconciliation(j)).toEqual(settledRead);
  });

  it('B7 — explicit accounting: preexisting evidence reused once, rejected ≠ missing, deferred, approved overage; unapproved overage, over-allocation, mismatch and double-report fail uncapped', async () => {
    const shop = await provisionFt2Shop('b7');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10, 10, 10]));
    const [l1, l2, l3, l4] = j.lines;
    await confirmCount(j, l1, 8);
    await confirmCount(j, l2, 6);
    await confirmCount(j, l3, 4);
    await confirmCount(j, l4, 11);
    // Compatibility: canonical missing evidence already reported on the per-line path.
    const preexistingMissing = await report(j, l1, { exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' });

    const d1: Disposition = { accepted: 8, rejected: 0, missing: 2, deferred: 0, existingExceptionIds: [preexistingMissing] };
    // Physically rejected (delivered, damaged) and missing (never delivered) stay distinct.
    const d2: Disposition = {
      accepted: 6, rejected: 2, missing: 2, deferred: 0,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 2 },
        { exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' },
      ],
    };
    const d3: Disposition = { accepted: 4, rejected: 0, missing: 0, deferred: 6 };
    const d4: Disposition = { accepted: 11, rejected: 0, missing: 0, deferred: 0 };

    // (a) Overage without persisted approval fails.
    let before = await jobEffects(j);
    expectSemanticRefusal((await attemptGroup(j, [[l1, d1], [l2, d2], [l3, d3], [l4, d4]])).response);
    expect(await jobEffects(j)).toEqual(before);

    await report(j, l4, { exception_type: 'extra_item', quantity_affected: 1, accounting_role: 'overage', notes: 'Accepted 1 extra unit' });
    before = await jobEffects(j);

    // (b) Over-allocation (4 + 7 > 10, no approval on l3) fails instead of being capped.
    expectSemanticRefusal((await attemptGroup(j, [[l1, d1], [l2, d2], [l3, { ...d3, deferred: 7 }], [l4, d4]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // (c) Balanced arithmetic (6 + 1 + 3 = 10) but missing 3 ≠ its evidence 2 fails.
    expectSemanticRefusal((await attemptGroup(j, [[l1, d1], [l2, {
      accepted: 6, rejected: 1, missing: 3, deferred: 0,
      newExceptions: [
        { exception_type: 'defect', quantity_affected: 1 },
        { exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' },
      ],
    }], [l3, d3], [l4, d4]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // (d) Re-reporting already-recorded missing units (2 existing + 2 new for missing 2) fails.
    expectSemanticRefusal((await attemptGroup(j, [[l1, {
      ...d1, newExceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
    }], [l2, d2], [l3, d3], [l4, d4]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // (e) The explicit, approved group finalizes exactly as submitted.
    await finalizeGroup(j, [[l1, d1], [l2, d2], [l3, d3], [l4, d4]]);
    const after = await jobEffects(j);
    expectFinalLine(after, 0, d1);
    expectFinalLine(after, 1, d2);
    expectFinalLine(after, 2, d3);
    expectFinalLine(after, 3, d4);
    // Preexisting evidence reused, not duplicated.
    expect(after.exceptions.filter((e) => e.lineId === l1.receiveJobLineId).map((e) => e.id)).toEqual([preexistingMissing]);
    expect(canonicalMissing(after, l1)).toBe(2);
    expect(evidenceOf(after, l2)).toEqual([evidence(l2, 'defect', 2), evidence(l2, 'missing_item', 2)]);
    expect(canonicalMissing(after, l2)).toBe(after.lines[1].missing);
    // Deferred is a later delivery: no supplier evidence, no stock, no Problem Center work.
    expect(evidenceOf(after, l3)).toEqual([]);
    expect([after.lines[0].problemCenterTasks, after.lines[2].problemCenterTasks]).toEqual([0, 0]);
    expectNoStockCredit(after);

    expect((await httpClose(j)).status).toBe(200);
    const closed = await jobEffects(j);
    expect({
      inbound: closed.inboundQuantity,
      truth: closed.truthOnHand,
      pending: closed.poLines.map((p) => p.pending),
      poFinal: closed.poStatus === 'received',
    }).toEqual({ inbound: 29, truth: 29, pending: [0, 0, 6, 0], poFinal: false });
  });

  it('B8 — unconfirmed counts, count mismatch, ambiguous other/wrong_quantity records and nonzero recoverable-held units fail closed', async () => {
    const shop = await provisionFt2Shop('b8');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10, 10]));
    const [l1, l2, l3] = j.lines;
    await confirmCount(j, l2, 10);
    await confirmCount(j, l3, 8);
    // Ambiguous records the per-line projection would count toward shortfall; never accounting.
    await report(j, l3, { exception_type: 'wrong_quantity', quantity_affected: 2 });
    await report(j, l3, { exception_type: 'other', quantity_affected: 2, notes: 'box looked light' });
    const full: Disposition = { accepted: 10, rejected: 0, missing: 0, deferred: 0 };
    const l3Deferred: Disposition = { accepted: 8, rejected: 0, missing: 0, deferred: 2 };
    let before = await jobEffects(j);

    // (a) l1 was never physically confirmed.
    expectSemanticRefusal((await attemptGroup(j, [[l1, full], [l2, full], [l3, l3Deferred]])).response);
    expect(await jobEffects(j)).toEqual(before);

    await confirmCount(j, l1, 10);
    before = await jobEffects(j);

    // (b) Accounting inferred from other/wrong_quantity: unbalanced, or claimed as missing.
    expectSemanticRefusal((await attemptGroup(j, [[l1, full], [l2, full], [l3, { accepted: 8, rejected: 0, missing: 0, deferred: 0 }]])).response);
    expect(await jobEffects(j)).toEqual(before);
    expectSemanticRefusal((await attemptGroup(j, [[l1, full], [l2, full], [l3, { accepted: 8, rejected: 0, missing: 2, deferred: 0 }]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // (c) Recoverable-held physical units stay outside S3-B until S4.
    expectSemanticRefusal((await attemptGroup(j, [[l1, { ...full, accepted: 9, held: 1 }], [l2, full], [l3, l3Deferred]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // (d) Balanced but accepted ≠ the confirmed physical count (9 vs 10).
    expectSemanticRefusal((await attemptGroup(j, [[l1, full], [l2, { accepted: 9, rejected: 0, missing: 0, deferred: 1 }], [l3, l3Deferred]])).response);
    expect(await jobEffects(j)).toEqual(before);

    // Control: the explicit, confirmed, held-free group finalizes.
    await finalizeGroup(j, [[l1, full], [l2, full], [l3, l3Deferred]]);
    const after = await jobEffects(j);
    expect(after.lines.map((l) => l.held)).toEqual([0, 0, 0]);
    // The ambiguous records stayed incidents; nothing was converted into missing evidence.
    expect(canonicalMissing(after, l3)).toBe(0);
  });

  it('B9 — GET inherits read + tenant isolation; draft/finalize inherit inspect, ownership and capability; denials persist nothing', async () => {
    const shop = await provisionFt2Shop('b9');
    const other = await provisionFt2Shop('b9x');
    const j = await openJob(await shippedMultiLinePo(shop, [10, 10]));
    const [l1, l2] = j.lines;
    await confirmCount(j, l1, 10);
    await confirmCount(j, l2, 10);
    const full: Disposition = { accepted: 10, rejected: 0, missing: 0, deferred: 0 };
    const group: GroupedLineInput[] = [[l1, full], [l2, full]];
    const before = await jobEffects(j);

    // Cross-tenant: the inherited owner middleware answers 404 RECEIVE_JOB_NOT_FOUND
    // (an unregistered route's default 404 has no such body); the read is a semantic 404.
    for (const res of [
      await httpDraft(j, null, group, other.token),
      await httpFinalize(j, null, group, crypto.randomUUID(), other.token),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RECEIVE_JOB_NOT_FOUND');
    }
    expectSemanticRefusal(await httpReadReconciliation(j, other.token), 404);
    expect(await jobEffects(j)).toEqual(before);

    // A legitimate operator of the shop who does not own the claimed job may read, not write.
    const intruder = await addOperator(shop);
    expect((await httpReadReconciliation(j, intruder.token)).status).toBe(200);
    for (const res of [
      await httpDraft(j, null, group, intruder.token),
      await httpFinalize(j, null, group, crypto.randomUUID(), intruder.token),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('JOB_CLAIMED_BY_OTHER');
    }
    expect(await jobEffects(j)).toEqual(before);

    // Capability: purchasing.core requires Growth; the current authoritative tier decides (GH-1136).
    const original = await withTenant(shop.shopId, (trx) =>
      trx('shop_subscriptions').where({ shop_id: shop.shopId }).first('tier'));
    expect(original?.tier).toBeTruthy();
    const setTier = async (tier: string) => {
      const updated = await withTenant(shop.shopId, (trx) =>
        trx('shop_subscriptions').where({ shop_id: shop.shopId }).update({ tier }));
      expect(updated).toBe(1);
    };
    await setTier('core');
    try {
      for (const res of [
        await httpDraft(j, null, group),
        await httpFinalize(j, null, group),
        await httpReadReconciliation(j),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('COMMERCIAL_ACCESS_DENIED');
      }
    } finally {
      await setTier(original!.tier);
    }
    expect(await jobEffects(j)).toEqual(before);

    // Control: the owning, entitled operator finalizes the same group.
    await finalizeGroup(j, group);
  });

  it('B10 — zero-outstanding lines stay excluded: no invented count, inspection or LSU; close handles them; history kept; legacy unknowns never fabricated', async () => {
    const shop = await provisionFt2Shop('b10');
    const po = await shippedMultiLinePo(shop, [5, 10]);

    // Delivery 1 (existing per-line path): line 1 complete, line 2 entirely later.
    const first = await openJob(po);
    await confirmCount(first, first.lines[0], 5);
    expect((await httpInspectLine(first, first.lines[0], { accepted: 5, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    await confirmCount(first, first.lines[1], 0);
    expect((await httpInspectLine(first, first.lines[1], { accepted: 0, rejected: 0, missing: 0, deferred: 10 })).status).toBe(200);
    expect((await httpClose(first)).status).toBe(200);
    const history = await jobEffects(first);

    // Delivery 2: line 1 has zero outstanding.
    const second = await openJob(po);
    const [z, l2] = second.lines;
    expect([z.expected, l2.expected]).toEqual([0, 10]);
    await confirmCount(second, l2, 10);

    const read = await readReconciliation(second);
    expect((read.lines ?? []).map((l: any) => l.receive_job_line_id)).toEqual([l2.receiveJobLineId]);

    // Allocating anything to the zero-outstanding line is refused.
    const before = await jobEffects(second);
    expectSemanticRefusal((await attemptGroup(second, [
      [z, { accepted: 0, rejected: 0, missing: 0, deferred: 1 }],
      [l2, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }],
    ])).response);
    expect(await jobEffects(second)).toEqual(before);

    await finalizeGroup(second, [[l2, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }]]);
    const after = await jobEffects(second);
    expectFinalLine(after, 1, { accepted: 10, rejected: 0, missing: 0, deferred: 0 });
    // Excluded, not auto-inspected: no physical count, inspection provenance or LSU was invented.
    expect({
      countConfirmed: after.lines[0].countConfirmed,
      countEventId: after.lines[0].countEventId,
      inspectionComplete: after.lines[0].inspectionComplete,
      inspectedBy: after.lines[0].inspectedBy,
      lsuCount: after.lines[0].lsuCount,
      accounted: [after.lines[0].accepted ?? 0, after.lines[0].rejected ?? 0, after.lines[0].missing ?? 0, after.lines[0].deferred ?? 0],
    }).toEqual({ countConfirmed: null, countEventId: null, inspectionComplete: false, inspectedBy: null, lsuCount: 0, accounted: [0, 0, 0, 0] });
    expect(evidenceOf(after, z)).toEqual([]);

    // Close (and its readiness gate) handles the excluded line safely.
    expect((await httpClose(second)).status).toBe(200);
    const closed = await jobEffects(second);
    expect({ jobStatus: closed.jobStatus, inbound: closed.inboundQuantity, pending: closed.poLines.map((p) => p.pending) })
      .toEqual({ jobStatus: 'closed', inbound: 15, pending: [0, 0] });
    expect(closed.lines[0]).toEqual(after.lines[0]);
    // Delivery-1 provenance is untouched.
    expect((await jobEffects(first)).lines).toEqual(history.lines);

    // Genuine v1 job: unknown legacy delivery accounting is never fabricated.
    const legacyPo = await shippedMultiLinePo(shop, [3]);
    const legacy = await legacyV1Job(legacyPo);
    await confirmCount(legacy, legacy.lines[0], 2);
    const legacyBefore = await jobEffects(legacy);
    const legacyAttempt = await attemptGroup(legacy, [[legacy.lines[0], { accepted: 2, rejected: 0, missing: 0, deferred: 1 }]]);
    console.info('[S3B_B10_LEGACY]', legacyAttempt.response.status, JSON.stringify(legacyAttempt.response.body));
    expectSemanticRefusal(legacyAttempt.response, 409);
    const legacyAfter = await jobEffects(legacy);
    expect(legacyAfter).toEqual(legacyBefore);
    expect(legacyAfter.lines[0]).toEqual(expect.objectContaining({ delivered: null, missing: null, deferred: null, held: null }));
  });

  // GH-1241 S3-C audit: an expected-zero line is excluded from grouped
  // finalization, close and readiness. If it already holds accepted physical
  // stock (per-line inspection with approved overage), excluding it would
  // leave minted LSUs with no receipt, movement, truth or Stow credit.
  it('S3C-E0 — grouped finalization refuses an excluded expected-zero line containing accepted physical stock', async () => {
    const shop = await provisionFt2Shop('s3ce0');
    const po = await shippedMultiLinePo(shop, [5, 10]);

    // Delivery 1 (existing per-line path, as B10): line A complete, line B entirely later.
    const first = await openJob(po);
    await confirmCount(first, first.lines[0], 5);
    expect((await httpInspectLine(first, first.lines[0], { accepted: 5, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    await confirmCount(first, first.lines[1], 0);
    expect((await httpInspectLine(first, first.lines[1], { accepted: 0, rejected: 0, missing: 0, deferred: 10 })).status).toBe(200);
    expect((await httpClose(first)).status).toBe(200);

    // Delivery 2: line A has zero outstanding, yet one extra unit physically arrives.
    const second = await openJob(po);
    const [a, b] = second.lines;
    expect([a.expected, b.expected]).toEqual([0, 10]);
    await report(second, a, { exception_type: 'extra_item', quantity_affected: 1, accounting_role: 'overage', notes: 'Accepted 1 extra unit' });
    await confirmCount(second, a, 1);
    expect((await httpInspectLine(second, a, { accepted: 1, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    await confirmCount(second, b, 10);

    // A. Line A really holds accepted, counted, inspected physical stock.
    const before = await jobEffects(second);
    expect(before.lines[0]).toEqual(expect.objectContaining({
      expected: 0, countConfirmed: 1, inspectionComplete: true, accepted: 1, lsuCount: 1,
    }));

    // B. Grouped finalization over only the applicable line B is refused.
    const attempt = await attemptGroup(second, [[b, { accepted: 10, rejected: 0, missing: 0, deferred: 0 }]]);
    console.info('[S3C_E0_FINALIZE]', attempt.response.status, JSON.stringify(attempt.response.body));
    expectSemanticRefusal(attempt.response, 409);
    expect(attempt.response.body.code).toBe('RECEIVE_RECONCILIATION_LINE_ALREADY_FINISHED');

    // C. No grouped finalization is persisted.
    expect((await readReconciliation(second)).finalization ?? null).toBeNull();

    // D + E. No new inspection, LSU, exception, movement, truth, PO receipt or
    // Stow effect, and line A's persisted evidence is unchanged.
    expect(await jobEffects(second)).toEqual(before);
  });
});

// ── migration 0210 safety (precedent: S3-A1 0209 / GH-1245 0208 suites) ──────
//
// Each scenario opens its OWN migration-role transaction, invokes the REAL
// 0210 migration source inside a savepoint, asserts, then ALWAYS rolls back.

const TABLES_0210 = [
  'receive_reconciliation_exception_links',
  'receive_reconciliation_finalization_lines',
  'receive_reconciliation_finalizations',
  'receive_reconciliation_revisions',
];

describe('GH-1241 S3-B — migration 0210 is tenant-isolated, append-only and never destroys grouped evidence', () => {
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

  async function schema0210(trx: Knex.Transaction) {
    const tables = await trx.raw(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              has_table_privilege('sf_app', c.oid, 'SELECT') AS can_select,
              has_table_privilege('sf_app', c.oid, 'INSERT') AS can_insert,
              has_table_privilege('sf_app', c.oid, 'UPDATE') AS can_update,
              has_table_privilege('sf_app', c.oid, 'DELETE') AS can_delete,
              has_table_privilege('sf_app', c.oid, 'TRUNCATE') AS can_truncate,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers
         FROM pg_class c WHERE c.relkind = 'r' AND c.relname = ANY(?::text[]) ORDER BY c.relname`,
      [TABLES_0210],
    );
    const constraints = await trx.raw(
      `SELECT conname FROM pg_constraint WHERE conname = ANY(?::text[]) ORDER BY conname`,
      [['receive_jobs_shop_job_unique', 'receive_exceptions_shop_exception_unique', 'receive_job_lines_shop_job_line_unique']],
    );
    return {
      tables: tables.rows.map((r: any) => ({
        name: r.relname, rls: r.rls, forced: r.forced, policies: r.policies, triggers: r.triggers,
        grants: { select: r.can_select, insert: r.can_insert, update: r.can_update, delete: r.can_delete, truncate: r.can_truncate },
      })),
      constraints: constraints.rows.map((r: any) => r.conname),
    };
  }

  const HEAD = {
    tables: TABLES_0210.map((name) => ({
      name, rls: true, forced: true, policies: 1, triggers: 2,
      grants: { select: true, insert: true, update: false, delete: false, truncate: false },
    })),
    constraints: ['receive_exceptions_shop_exception_unique', 'receive_job_lines_shop_job_line_unique', 'receive_jobs_shop_job_unique'],
  };
  const PRE_0210 = { tables: [], constraints: [] };

  async function withoutPersistedEvidence(trx: Knex.Transaction) {
    await trx.raw(`SET LOCAL row_security = off`);
    // Grouped evidence is append-only; it is removed ONLY inside this
    // always-rolled-back migration-role transaction, by the table owner.
    for (const table of TABLES_0210) {
      await trx.raw(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_no_delete`);
      await trx.raw(`DELETE FROM ${table}`);
      await trx.raw(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_no_delete`);
    }
  }

  /** Real route evidence: a draft revision on a claimed v2 job. */
  async function seedRevision() {
    const shop = await provisionFt2Shop('m0210');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    await confirmCount(j, j.lines[0], 3);
    const rev = revisionId(await httpDraft(j, null, [[j.lines[0], { accepted: 3, rejected: 0, missing: 0, deferred: 0 }]]));
    return { shop, j, rev };
  }

  it('M1 — head schema is FORCE-RLS, SELECT/INSERT-only for sf_app and append-only; without evidence DOWN → UP round-trips', async () => {
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0210(trx)).toEqual(HEAD);
      await withoutPersistedEvidence(trx);
      expect(await inSavepoint(trx, (sp) => migration0210.down(sp))).toEqual({ ok: true });
      expect(await schema0210(trx)).toEqual(PRE_0210);
      expect(await inSavepoint(trx, (sp) => migration0210.up(sp))).toEqual({ ok: true });
      expect(await schema0210(trx)).toEqual(HEAD);
    });
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0210(trx)).toEqual(HEAD);
    });
  });

  it('M2 — DOWN refuses while grouped evidence exists, leaving schema and evidence unchanged', async () => {
    const { shop, rev } = await seedRevision();
    await inRolledBackTransaction(async (trx) => {
      const read = () => trx.raw(`SET LOCAL row_security = off`)
        .then(() => trx('receive_reconciliation_revisions').where({ shop_id: shop.shopId, revision_id: rev }).first('revision_id', 'payload_hash'));
      const before = await read();
      expect(before?.revision_id).toBe(rev);
      const outcome = await inSavepoint(trx, (sp) => migration0210.down(sp));
      expect(outcome.ok).toBe(false);
      expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_GROUPED_RECONCILIATION_ROLLBACK_BLOCKED/);
      expect(await schema0210(trx)).toEqual(HEAD);
      expect(await read()).toEqual(before);
    });
  });

  it('M3 — the runtime role can neither rewrite grouped evidence nor write it into another tenant', async () => {
    const { shop, j, rev } = await seedRevision();
    const other = await provisionFt2Shop('m0210x');

    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_reconciliation_revisions').where({ shop_id: shop.shopId, revision_id: rev }).update({ payload_hash: 'forged' })))
      .rejects.toThrow(/append-only|permission denied/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_reconciliation_revisions').where({ shop_id: shop.shopId, revision_id: rev }).del()))
      .rejects.toThrow(/append-only|permission denied/);

    // Another tenant's context cannot insert a revision for this shop's job, nor see it.
    await expect(withTenant(other.shopId, (trx) =>
      trx('receive_reconciliation_revisions').insert({
        shop_id: shop.shopId, receive_job_id: j.receiveJobId, revision_number: 2, base_revision_id: rev,
        device_event_id: crypto.randomUUID(), payload: '[]', payload_hash: 'x',
      }))).rejects.toThrow(/row-level security/);
    expect(await withTenant(other.shopId, (trx) =>
      trx('receive_reconciliation_revisions').where({ revision_id: rev }))).toEqual([]);
  });
  // ── 0211: least privilege for 0209's append-only count-confirmation history ──

  const LEAST = { select: true, insert: true, update: false, delete: false, truncate: false };

  async function eventPrivileges(trx: Knex.Transaction | Knex, role = 'sf_app') {
    const r = await trx.raw(
      `SELECT has_table_privilege(?, 'receive_count_confirmation_events', 'SELECT') AS select,
              has_table_privilege(?, 'receive_count_confirmation_events', 'INSERT') AS insert,
              has_table_privilege(?, 'receive_count_confirmation_events', 'UPDATE') AS update,
              has_table_privilege(?, 'receive_count_confirmation_events', 'DELETE') AS delete,
              has_table_privilege(?, 'receive_count_confirmation_events', 'TRUNCATE') AS truncate`,
      [role, role, role, role, role],
    );
    return r.rows[0];
  }

  async function eventTableGuards(trx: Knex.Transaction) {
    const r = await trx.raw(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgenabled = 'O') AS triggers
         FROM pg_class c WHERE c.relname = 'receive_count_confirmation_events'`,
    );
    return r.rows[0];
  }

  it('M4 — a freshly created 0209 table carries excess UPDATE/DELETE; 0211 removes them and its rollback never restores them; ordering 0209 < 0210 < 0211', async () => {
    const order = await migrationDb('knex_migrations').orderBy('id', 'asc').pluck('name');
    const at = (prefix: string) => order.findIndex((n: string) => n.startsWith(prefix));
    expect(at('20261012150000_0209_')).toBeGreaterThanOrEqual(0);
    expect(at('20261012150000_0209_')).toBeLessThan(at('20261013150000_0210_'));
    expect(at('20261013150000_0210_')).toBeLessThan(at('20261013160000_0211_'));

    await inRolledBackTransaction(async (trx) => {
      expect(await eventPrivileges(trx)).toEqual(LEAST);
      const guards = await eventTableGuards(trx);
      expect(guards).toEqual({ rls: true, forced: true, policies: 1, triggers: 2 });

      // Reconstruct the genuine pre-0211 state: 0209 recreated under the migration role's default ACL.
      await trx.raw(`SET LOCAL row_security = off`);
      await trx.raw(`
        UPDATE receive_job_lines
           SET quantity_count_confirmed = NULL, count_confirmed_by = NULL,
               count_confirmed_at = NULL, count_confirmation_event_id = NULL
         WHERE quantity_count_confirmed IS NOT NULL OR count_confirmation_event_id IS NOT NULL`);
      await trx.raw(`
        ALTER TABLE receive_count_confirmation_events DISABLE TRIGGER receive_count_confirmation_events_no_delete;
        DELETE FROM receive_count_confirmation_events;
        ALTER TABLE receive_count_confirmation_events ENABLE TRIGGER receive_count_confirmation_events_no_delete;`);
      expect(await inSavepoint(trx, (sp) => migration0209.down(sp))).toEqual({ ok: true });
      expect(await inSavepoint(trx, (sp) => migration0209.up(sp))).toEqual({ ok: true });
      expect(await eventPrivileges(trx)).toEqual({ ...LEAST, update: true, delete: true });

      expect(await inSavepoint(trx, (sp) => migration0211.up(sp))).toEqual({ ok: true });
      expect(await eventPrivileges(trx)).toEqual(LEAST);
      expect(await eventTableGuards(trx)).toEqual(guards);

      // Security is monotonic: rolling 0211 back keeps least privilege.
      expect(await inSavepoint(trx, (sp) => migration0211.down(sp))).toEqual({ ok: true });
      expect(await eventPrivileges(trx)).toEqual(LEAST);
      expect(await eventTableGuards(trx)).toEqual(guards);
    });
    await inRolledBackTransaction(async (trx) => {
      expect(await eventPrivileges(trx)).toEqual(LEAST);
    });
  });

  it('M5 — at head the runtime role still confirms and reads counts, cannot UPDATE/DELETE history, stays tenant-isolated, and 0211 leaves evidence unchanged', async () => {
    const shop = await provisionFt2Shop('m0211');
    const other = await provisionFt2Shop('m0211x');
    const j = await openJob(await shippedMultiLinePo(shop, [3]));
    const line = j.lines[0];
    const eventId = crypto.randomUUID();
    expect((await httpConfirmCount(j, line, 3, eventId)).status).toBe(200);

    // Effective privileges, as the runtime role itself.
    expect(await withTenant(shop.shopId, (trx) => eventPrivileges(trx, 'sf_app'))).toEqual(LEAST);
    const runtime = await withTenant(shop.shopId, (trx) => trx.raw('SELECT current_user AS u'));
    expect(runtime.rows[0].u).toBe('sf_app');

    const history = () => withTenant(shop.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shop.shopId, receive_job_line_id: line.receiveJobLineId })
        .select('event_id', 'quantity_confirmed', 'confirmed_by', 'confirmed_at'));
    const before = await history();
    expect(before.map((e: any) => [e.event_id, e.quantity_confirmed])).toEqual([[eventId, 3]]);

    // Refused by privilege now, not only by the row trigger.
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shop.shopId, event_id: eventId }).update({ quantity_confirmed: 2 })))
      .rejects.toThrow(/permission denied/);
    await expect(withTenant(shop.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ shop_id: shop.shopId, event_id: eventId }).del()))
      .rejects.toThrow(/permission denied/);

    // Tenant RLS: another tenant neither sees nor writes this shop's history.
    expect(await withTenant(other.shopId, (trx) =>
      trx('receive_count_confirmation_events').where({ event_id: eventId }))).toEqual([]);
    await expect(withTenant(other.shopId, (trx) =>
      trx('receive_count_confirmation_events').insert({
        shop_id: shop.shopId, event_id: crypto.randomUUID(), receive_job_line_id: line.receiveJobLineId, quantity_confirmed: 1,
      }))).rejects.toThrow(/row-level security/);

    // Re-applying or rolling back 0211 never touches evidence.
    await inRolledBackTransaction(async (trx) => {
      await trx.raw(`SET LOCAL row_security = off`);
      const rows = () => trx('receive_count_confirmation_events').orderBy(['shop_id', 'event_id']).select('*');
      const all = await rows();
      expect(await inSavepoint(trx, (sp) => migration0211.up(sp))).toEqual({ ok: true });
      expect(await rows()).toEqual(all);
      expect(await inSavepoint(trx, (sp) => migration0211.down(sp))).toEqual({ ok: true });
      expect(await rows()).toEqual(all);
    });
    expect(await history()).toEqual(before);
  });
});
