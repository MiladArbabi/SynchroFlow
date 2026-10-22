/**
 * GH-1245 / RECEIVE-OUTSTANDING-01 (S2 of GH-1241) — RED regression gate.
 *
 * Ratified contract: GH-1245 comments #6108640765 (revised S2 technical
 * contract) and #6108677052 (100-unit worked example), plus Q1–Q5 of GH-1241.
 *
 *   - A Receive line is finalized with an explicit per-delivery disposition:
 *     accepted + physically rejected + missing + deferred = quantity_expected
 *     (+ explicitly approved overage). Physically delivered = accepted +
 *     rejected + held. Held recovery is S4 and must fail closed in S2.
 *   - Only `deferred` is still scheduled to arrive. Committed/pending inbound is
 *     the deferred remainder, not ordered − accepted.
 *   - Missing is supplier shortage evidence; deferred is not an exception.
 *     Neither fabricates LSU identities, stock credit, Stow work or Problem
 *     Center tasks.
 *   - A final delivery with documented discrepancies finalizes the PO
 *     (status 'received') with zero pending inbound.
 *   - Inherited: GH-1243 exactly-once ledger/truth/Stow, GH-1085 barcode
 *     readiness, tenant isolation.
 *
 * S2 REQUEST/STORAGE SHAPE ASSUMED HERE (from the ratified contract; exact
 * names and refusal status codes are for engineering-lead ratification):
 *   POST /receive-jobs/:jobId/inspect  { quantity_accepted, quantity_rejected,
 *     quantity_missing, quantity_deferred[, quantity_held_recoverable] }
 *   POST /receive-jobs/:jobId/exception  { ..., device_event_id } (replay key)
 *   receive_jobs.delivery_accounting_version = 2 for jobs created after S2
 *   receive_job_lines.quantity_delivered / quantity_missing / quantity_deferred
 *     / quantity_held_recoverable
 *   purchase_order_line_items.quantity_pending_delivery
 * Refusals are asserted as a client-error class (4xx) plus zero writes; the
 * exact code is not frozen here.
 *
 * Every mutation goes through the real routes (createApp + supertest) against
 * the disposable synchroflow_test_* database (`npm run test:integration`).
 * Fixtures follow the GH-1243 / GH-1085 Receive suites. Concurrency cases use
 * a test-held row lock and pg_stat_activity proof of overlap — no sleeps, no
 * production instrumentation.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { getCommittedInboundQty } from 'api-src/services/purchasing/purchasingEvidence';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-11';
/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the GH-1243 / GH-1085 Receive suites) ─────

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
  const shopDomain = `rcv1245-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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

// ── fixtures ────────────────────────────────────────────────────────────────

async function seedMappedVariant(shopId: number, externalBarcode: string | null): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/1245R${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/1245R${nonce}`,
          title: `GH1245 receive outstanding fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1245-RCV-${nonce}`,
                  barcode: externalBarcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/1245R${nonce}`,
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

interface PoFixture {
  shop: Shop;
  lasyncroVariantId: string;
  supplierId: number;
  poId: string;
  poLineItemId: string;
  quantityOrdered: number;
}

/** supplier → single-line PO already marked arrived ('shipped'), as the merchant leaves it. */
async function shippedPo(
  shop: Shop,
  quantityOrdered: number,
  externalBarcode: string | null = EXTERNAL_BARCODE
): Promise<PoFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const lasyncroVariantId = await seedMappedVariant(shop.shopId, externalBarcode);

  return withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1245 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: po.id,
        shop_id: shop.shopId,
        lasyncro_variant_id: lasyncroVariantId,
        description: 'GH1245 receive outstanding line',
        quantity_ordered: quantityOrdered,
        unit_cost_cents: 400,
      })
      .returning('id');
    return {
      shop,
      lasyncroVariantId,
      supplierId: Number(supplier.id),
      poId: po.id as string,
      poLineItemId: poLine.id as string,
      quantityOrdered,
    };
  });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Real dispatcher create route; the shop owner self-assigns (GH-1109). */
function httpCreateJob(po: PoFixture, token: string = po.shop.token) {
  return request(app)
    .post(`/api/v1/suppliers/purchase-orders/${po.poId}/receive-jobs`)
    .set(auth(token))
    .send({ assigned_operator_id: po.shop.userId });
}

interface JobFixture {
  po: PoFixture;
  receiveJobId: string;
  receiveJobLineId: string;
}

async function lineIdFor(po: PoFixture, receiveJobId: string): Promise<string> {
  const line = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_job_lines')
      .where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .first('receive_job_line_id'));
  expect(line?.receive_job_line_id).toBeTruthy();
  return line!.receive_job_line_id as string;
}

async function claim(po: PoFixture, receiveJobId: string) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(po.shop.token))
    .send({});
}

/** Created through the real route and claimed (GH-1111) — ready for execution. */
async function openJob(po: PoFixture): Promise<JobFixture> {
  const created = await httpCreateJob(po);
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  expect((await claim(po, receiveJobId)).status).toBe(200);
  return { po, receiveJobId, receiveJobLineId: await lineIdFor(po, receiveJobId) };
}

interface Disposition {
  accepted: number;
  rejected: number;
  missing: number;
  deferred: number;
  held?: number;
}

/** GH-1241 S3-A1 — the operator's persisted physical count (real route). */
function httpConfirmCount(j: JobFixture, quantity: number) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.receiveJobLineId}/confirm-count`)
    .set(auth(j.po.shop.token))
    .send({ quantity_confirmed: quantity, device_event_id: crypto.randomUUID() });
}

/**
 * The operator's Finish Count: confirm the counted (accepted) quantity, then
 * inspect with the S2 explicit disposition body. GH-1241 S3-A1 refuses
 * inspection without a persisted confirmed count.
 */
async function httpInspect(j: JobFixture, d: Disposition) {
  const confirmed = await httpConfirmCount(j, d.accepted);
  if (confirmed.status !== 200) return confirmed;
  return httpInspectOnly(j, d);
}

/** Real inspect route with the S2 explicit disposition body. */
function httpInspectOnly(j: JobFixture, d: Disposition) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
    .set(auth(j.po.shop.token))
    .send({
      lasyncro_variant_id: j.po.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      quantity_accepted: d.accepted,
      quantity_rejected: d.rejected,
      quantity_missing: d.missing,
      quantity_deferred: d.deferred,
      ...(d.held !== undefined ? { quantity_held_recoverable: d.held } : {}),
    });
}

function httpReport(
  j: JobFixture,
  body: {
    exception_type: string;
    quantity_affected: number;
    notes?: string;
    accounting_role?: string;
    device_event_id?: string;
  },
  token: string = j.po.shop.token
) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/exception`)
    .set(auth(token))
    .send({
      lasyncro_variant_id: j.po.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      notes: body.notes ?? `GH1245 ${body.exception_type}`,
      ...body,
    });
}

function httpClose(j: JobFixture) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.po.shop.token))
    .send({ actual_delivery_date: DELIVERY_DATE });
}

// ── state readers (shop/PO/variant scoped) ──────────────────────────────────

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Every consequence these contracts assert on, scoped to one PO fixture. */
async function poState(po: PoFixture) {
  const { shopId } = po.shop;
  return withTenant(shopId, async (trx) => {
    const poLine = await trx('purchase_order_line_items')
      .where({ shop_id: shopId, id: po.poLineItemId })
      .first('*');
    const poRow = await trx('purchase_orders')
      .where({ shop_id: shopId, id: po.poId })
      .first('status');
    const supplier = await trx('suppliers')
      .where({ shop_id: shopId, id: po.supplierId })
      .first('total_pos');
    const jobs = await trx('receive_jobs')
      .where({ shop_id: shopId, po_id: po.poId })
      .orderBy('created_at', 'asc')
      .select('*');
    const jobIds = jobs.map((job: any) => job.receive_job_id as string);
    const lines = jobIds.length === 0 ? [] : await trx('receive_job_lines')
      .where({ shop_id: shopId })
      .whereIn('receive_job_id', jobIds)
      .select('*');
    const lineIds = lines.map((line: any) => line.receive_job_line_id as string);
    const exceptions = jobIds.length === 0 ? [] : await trx('receive_exceptions')
      .where({ shop_id: shopId })
      .whereIn('receive_job_id', jobIds)
      .orderBy('raised_at', 'asc')
      .select('receive_exception_id', 'receive_job_id', 'exception_type', 'quantity_affected');
    const inboundMovements = await trx('inventory_movements')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: po.lasyncroVariantId,
        reference_type: 'receive_job',
        movement_type: 'inbound_purchase',
      })
      .select('reference_id', 'quantity_delta');
    const rootLedger = await trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, location_code: po.shop.rootLocationCode })
      .sum<{ sum: string | null }>('quantity_delta as sum')
      .first();
    const rootTruth = await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, location_code: po.shop.rootLocationCode })
      .first('on_hand_quantity');
    const stowTasks = await trx('stow_tasks')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, trigger: 'inbound_stock' })
      .select('quantity', 'receive_job_line_id');
    const units = lineIds.length === 0 ? [] : await trx('inventory_units')
      .where({ shop_id: shopId })
      .whereIn('receive_job_line_id', lineIds)
      .select('receive_job_line_id', 'lasyncro_unit_id');
    const problemCenterTasks = await trx('problem_center_tasks')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId })
      .count<{ count: string }>('* as count')
      .first();
    const inspectAudits = jobIds.length === 0 ? { count: '0' } : await trx('operator_audit_log')
      .where({ shop_id: shopId, action_type: 'receive_inspect' })
      .whereIn('entity_id', jobIds)
      .count<{ count: string }>('* as count')
      .first();
    const committedInbound = await getCommittedInboundQty(trx, shopId, po.lasyncroVariantId);

    const onHand = rootTruth ? Number(rootTruth.on_hand_quantity) : 0;
    return {
      poStatus: poRow?.status ?? null,
      quantityOrdered: numOrNull(poLine?.quantity_ordered),
      quantityReceived: numOrNull(poLine?.quantity_received),
      quantityPendingDelivery: numOrNull(poLine?.quantity_pending_delivery),
      committedInbound: Number(committedInbound),
      supplierTotalPos: Number(supplier?.total_pos ?? 0),
      jobs,
      lines,
      exceptions: exceptions.map((e: any) => ({
        receiveJobId: e.receive_job_id,
        type: e.exception_type,
        quantity: Number(e.quantity_affected),
        id: e.receive_exception_id,
      })),
      inboundMovements: inboundMovements.map((m: any) => ({ referenceId: m.reference_id, quantity: Number(m.quantity_delta) })),
      inboundQuantity: inboundMovements.reduce((s: number, m: any) => s + Number(m.quantity_delta), 0),
      rootOnHand: onHand,
      /** INV-LEDGER-BYPASS-16: truth must always be reproduced by the ledger. */
      truthMinusLedger: onHand - Number(rootLedger?.sum ?? 0),
      stowTaskCount: stowTasks.length,
      stowQuantity: stowTasks.reduce((s: number, t: any) => s + Number(t.quantity), 0),
      unitCount: units.length,
      problemCenterTaskCount: Number(problemCenterTasks?.count ?? 0),
      inspectAuditCount: Number((inspectAudits as any)?.count ?? 0),
    };
  });
}

type PoState = Awaited<ReturnType<typeof poState>>;

function jobOf(s: PoState, receiveJobId: string): any {
  return s.jobs.find((job: any) => job.receive_job_id === receiveJobId) ?? null;
}

function lineOf(s: PoState, receiveJobLineId: string): any {
  return s.lines.find((line: any) => line.receive_job_line_id === receiveJobLineId) ?? null;
}

/** The persisted per-delivery disposition of one Receive line. */
function dispositionOf(s: PoState, receiveJobLineId: string) {
  const line = lineOf(s, receiveJobLineId);
  return {
    inspectionComplete: Boolean(line?.inspection_complete),
    expected: numOrNull(line?.quantity_expected),
    delivered: numOrNull(line?.quantity_delivered),
    accepted: numOrNull(line?.quantity_accepted),
    rejected: numOrNull(line?.quantity_rejected),
    missing: numOrNull(line?.quantity_missing),
    deferred: numOrNull(line?.quantity_deferred),
    held: numOrNull(line?.quantity_held_recoverable),
  };
}

/** Only the writes an inspect is allowed to make — for zero-partial-write proofs. */
function inspectWrites(s: PoState, j: JobFixture) {
  const job = jobOf(s, j.receiveJobId);
  return {
    disposition: dispositionOf(s, j.receiveJobLineId),
    jobStatus: job?.status ?? null,
    unitsInspected: numOrNull(job?.units_inspected),
    unitsAccepted: numOrNull(job?.units_accepted),
    unitsRejected: numOrNull(job?.units_rejected),
    unitCount: s.unitCount,
    inspectAuditCount: s.inspectAuditCount,
    inboundQuantity: s.inboundQuantity,
    quantityReceived: s.quantityReceived,
  };
}

function isClientError(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500;
}

// ── overlap instrumentation (test-only; production code untouched) ──────────

interface LockWaiter {
  pid: number;
  blockers: number[];
  query: string;
}

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

/**
 * Bounded poll until `expected` backends are lock-waiting behind the
 * test-held gate (directly or through another waiter). Returns early when
 * `stop()` is true. Throws OVERLAP_NOT_ESTABLISHED only when `required`.
 */
async function waitForGateWaiters(
  shopId: number,
  gatePid: number,
  expected: number,
  stop: () => boolean,
  required = true,
  timeoutMs = 20000
): Promise<LockWaiter[]> {
  const deadline = Date.now() + timeoutMs;
  let last: LockWaiter[] = [];
  while (Date.now() < deadline) {
    const result = await withTenant(shopId, (trx) =>
      trx.raw(`
        SELECT pid,
               pg_blocking_pids(pid) AS blockers,
               left(query, 160)      AS query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
      `));
    const waiting: LockWaiter[] = (result.rows as any[]).map((r) => ({
      pid: Number(r.pid),
      blockers: (r.blockers ?? []).map(Number),
      query: String(r.query),
    }));
    last = waiting.filter((w) => blockedBehindGate(w.pid, gatePid, waiting));
    if (last.length >= expected) return last;
    if (stop()) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!required) return last;
  throw new Error(
    `OVERLAP_NOT_ESTABLISHED: expected ${expected} requests lock-waiting behind the gate, ` +
    `observed ${last.length} (${JSON.stringify(last)})`
  );
}

/** Holds `SELECT … FOR UPDATE` on one row in its own transaction until released. */
function holdRowLock(shopId: number, table: string, where: Record<string, unknown>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reportPid!: (pid: number) => void;
  const pidKnown = new Promise<number>((resolve) => { reportPid = resolve; });
  const done = withTenant(shopId, async (trx) => {
    const locked = await trx(table).where(where).forUpdate().first();
    expect(locked).toBeTruthy();
    const pid = await trx.raw('SELECT pg_backend_pid() AS pid');
    reportPid(Number(pid.rows[0].pid));
    await released;
  });
  return { pidKnown, release, done };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('GH-1245 Receive delivery-scoped accounting (S2)', () => {
  // ── 1. FINAL DELIVERY WITH DISCREPANCIES ────────────────────────────────

  it('R1 — final delivery PO100: 90 accepted, 5 rejected, 5 missing, 0 deferred finalizes with stock 90 and zero pending inbound', async () => {
    const shop = await provisionFt2Shop('final');
    const po = await shippedPo(shop, 100);
    const j = await openJob(po);
    const before = await poState(po);

    const missing = await httpReport(j, {
      exception_type: 'missing_item', quantity_affected: 5, accounting_role: 'shortfall',
      device_event_id: crypto.randomUUID(),
    });
    const damaged = await httpReport(j, {
      exception_type: 'defect', quantity_affected: 5, device_event_id: crypto.randomUUID(),
    });
    const inspected = await httpInspect(j, { accepted: 90, rejected: 5, missing: 5, deferred: 0 });
    const closed = await httpClose(j);
    const after = await poState(po);

    console.info('[GH1245_R1_EVIDENCE]', JSON.stringify({
      inspect: { status: inspected.status, body: inspected.body },
      close: { status: closed.status, body: closed.body },
    }));

    expect({
      reportStatuses: [missing.status, damaged.status],
      inspectStatus: inspected.status,
      closeStatus: closed.status,
      poStatus: after.poStatus,
      quantityReceived: after.quantityReceived,
      quantityPendingDelivery: after.quantityPendingDelivery,
      committedInbound: after.committedInbound,
      supplierTotalPosDelta: after.supplierTotalPos - before.supplierTotalPos,
      jobDeliveryAccountingVersion: numOrNull(jobOf(after, j.receiveJobId)?.delivery_accounting_version),
      jobActualDeliveryDate: dateOnly(jobOf(after, j.receiveJobId)?.actual_delivery_date),
      disposition: dispositionOf(after, j.receiveJobLineId),
      supplierEvidence: after.exceptions.map((e) => ({ type: e.type, quantity: e.quantity })),
      inboundMovements: after.inboundMovements.map((m) => m.quantity),
      rootOnHand: after.rootOnHand,
      truthMinusLedger: after.truthMinusLedger,
      stowTaskCount: after.stowTaskCount,
      stowQuantity: after.stowQuantity,
      problemCenterTaskCount: after.problemCenterTaskCount,
    }).toEqual({
      reportStatuses: [201, 201],
      inspectStatus: 200,
      closeStatus: 200,
      poStatus: 'received',
      quantityReceived: 90,
      quantityPendingDelivery: 0,
      committedInbound: 0,
      supplierTotalPosDelta: 1,
      jobDeliveryAccountingVersion: 2,
      jobActualDeliveryDate: DELIVERY_DATE,
      disposition: {
        inspectionComplete: true,
        expected: 100,
        delivered: 95,
        accepted: 90,
        rejected: 5,
        missing: 5,
        deferred: 0,
        held: 0,
      },
      supplierEvidence: [
        { type: 'missing_item', quantity: 5 },
        { type: 'defect', quantity: 5 },
      ],
      inboundMovements: [90],
      rootOnHand: 90,
      truthMinusLedger: 0,
      stowTaskCount: 1,
      stowQuantity: 90,
      problemCenterTaskCount: 0,
    });
  });

  // ── 2. PARTIAL DELIVERY + NEXT JOB ──────────────────────────────────────

  it('R2 — partial PO10: 4 accepted, 2 rejected, 4 deferred leaves pending 4 (not 6); the next job reconciles only the outstanding 4', async () => {
    const shop = await provisionFt2Shop('partial');
    const po = await shippedPo(shop, 10);
    const job1 = await openJob(po);
    const before = await poState(po);

    const damaged = await httpReport(job1, {
      exception_type: 'defect', quantity_affected: 2, device_event_id: crypto.randomUUID(),
    });
    const inspect1 = await httpInspect(job1, { accepted: 4, rejected: 2, missing: 0, deferred: 4 });
    const close1 = await httpClose(job1);
    const afterFirst = await poState(po);

    // Delivery 2 — only attempted once delivery 1 is closed.
    const create2 = await httpCreateJob(po);
    let job2: JobFixture | null = null;
    let job2Line: ReturnType<typeof dispositionOf> | null = null;
    let job2Version: number | null = null;
    let inspect2Status: number | null = null;
    let close2Status: number | null = null;
    if (create2.status === 201) {
      const receiveJobId = create2.body.receive_job_id as string;
      job2 = { po, receiveJobId, receiveJobLineId: await lineIdFor(po, receiveJobId) };
      const created = await poState(po);
      job2Line = dispositionOf(created, job2.receiveJobLineId);
      job2Version = numOrNull(jobOf(created, receiveJobId)?.delivery_accounting_version);
      expect((await claim(po, receiveJobId)).status).toBe(200);
      inspect2Status = (await httpInspect(job2, { accepted: 4, rejected: 0, missing: 0, deferred: 0 })).status;
      close2Status = (await httpClose(job2)).status;
    }
    const afterSecond = await poState(po);

    console.info('[GH1245_R2_EVIDENCE]', JSON.stringify({
      inspect1: { status: inspect1.status, body: inspect1.body },
      close1: { status: close1.status, body: close1.body },
      create2: { status: create2.status, body: create2.body },
    }));

    expect({
      firstDelivery: {
        reportStatus: damaged.status,
        inspectStatus: inspect1.status,
        closeStatus: close1.status,
        poStatus: afterFirst.poStatus,
        quantityReceived: afterFirst.quantityReceived,
        quantityPendingDelivery: afterFirst.quantityPendingDelivery,
        committedInbound: afterFirst.committedInbound,
        disposition: dispositionOf(afterFirst, job1.receiveJobLineId),
        missingExceptions: afterFirst.exceptions.filter((e) => e.type === 'missing_item').length,
        inboundMovements: afterFirst.inboundMovements.map((m) => m.quantity),
        stowQuantity: afterFirst.stowQuantity,
        problemCenterTaskCount: afterFirst.problemCenterTaskCount,
        supplierTotalPosDelta: afterFirst.supplierTotalPos - before.supplierTotalPos,
      },
      secondDelivery: {
        createStatus: create2.status,
        deliveryAccountingVersion: job2Version,
        expectedCeiling: job2Line?.expected ?? null,
        inspectStatus: inspect2Status,
        closeStatus: close2Status,
        poStatus: afterSecond.poStatus,
        quantityReceived: afterSecond.quantityReceived,
        quantityPendingDelivery: afterSecond.quantityPendingDelivery,
        committedInbound: afterSecond.committedInbound,
        distinctReceiptJobs: new Set(afterSecond.inboundMovements.map((m) => m.referenceId)).size,
        inboundQuantity: afterSecond.inboundQuantity,
        truthMinusLedger: afterSecond.truthMinusLedger,
        problemCenterTaskCount: afterSecond.problemCenterTaskCount,
        supplierTotalPosDelta: afterSecond.supplierTotalPos - before.supplierTotalPos,
      },
    }).toEqual({
      firstDelivery: {
        reportStatus: 201,
        inspectStatus: 200,
        closeStatus: 200,
        poStatus: 'partially_received',
        quantityReceived: 4,
        quantityPendingDelivery: 4,
        committedInbound: 4,
        disposition: {
          inspectionComplete: true,
          expected: 10,
          delivered: 6,
          accepted: 4,
          rejected: 2,
          missing: 0,
          deferred: 4,
          held: 0,
        },
        missingExceptions: 0,
        inboundMovements: [4],
        stowQuantity: 4,
        problemCenterTaskCount: 0,
        supplierTotalPosDelta: 0,
      },
      secondDelivery: {
        createStatus: 201,
        deliveryAccountingVersion: 2,
        expectedCeiling: 4,
        inspectStatus: 200,
        closeStatus: 200,
        poStatus: 'received',
        quantityReceived: 8,
        quantityPendingDelivery: 0,
        committedInbound: 0,
        distinctReceiptJobs: 2,
        inboundQuantity: 8,
        truthMinusLedger: 0,
        problemCenterTaskCount: 0,
        supplierTotalPosDelta: 1,
      },
    });
  });

  // ── 3. NO FABRICATION FOR ABSENT GOODS ──────────────────────────────────

  it('R3 — a final all-missing delivery finalizes with no LSU, stock, Stow or Problem Center work and zero inbound', async () => {
    const shop = await provisionFt2Shop('allmissing');
    const po = await shippedPo(shop, 10);
    const j = await openJob(po);

    const missing = await httpReport(j, {
      exception_type: 'missing_item', quantity_affected: 10, accounting_role: 'shortfall',
      device_event_id: crypto.randomUUID(),
    });
    const inspected = await httpInspect(j, { accepted: 0, rejected: 0, missing: 10, deferred: 0 });
    const closed = await httpClose(j);
    const after = await poState(po);

    expect({
      reportStatus: missing.status,
      inspectStatus: inspected.status,
      closeStatus: closed.status,
      poStatus: after.poStatus,
      quantityPendingDelivery: after.quantityPendingDelivery,
      committedInbound: after.committedInbound,
      disposition: dispositionOf(after, j.receiveJobLineId),
      quantityReceived: after.quantityReceived,
      unitCount: after.unitCount,
      inboundMovementCount: after.inboundMovements.length,
      rootOnHand: after.rootOnHand,
      stowTaskCount: after.stowTaskCount,
      problemCenterTaskCount: after.problemCenterTaskCount,
    }).toEqual({
      reportStatus: 201,
      inspectStatus: 200,
      closeStatus: 200,
      poStatus: 'received',
      quantityPendingDelivery: 0,
      committedInbound: 0,
      disposition: {
        inspectionComplete: true,
        expected: 10,
        delivered: 0,
        accepted: 0,
        rejected: 0,
        missing: 10,
        deferred: 0,
        held: 0,
      },
      quantityReceived: 0,
      unitCount: 0,
      inboundMovementCount: 0,
      rootOnHand: 0,
      stowTaskCount: 0,
      problemCenterTaskCount: 0,
    });
  });

  // ── 4. RECOVERABLE-HELD FAILS CLOSED UNTIL S4 ───────────────────────────

  it('R4 — a nonzero held-recoverable disposition is refused with zero partial writes', async () => {
    const shop = await provisionFt2Shop('held');
    const po = await shippedPo(shop, 10);
    const j = await openJob(po);

    // The damaged-but-recoverable unit is a supplier-quality incident (evidence).
    const evidence = await httpReport(j, {
      exception_type: 'defect', quantity_affected: 1, device_event_id: crypto.randomUUID(),
    });
    expect(evidence.status).toBe(201);
    const before = await poState(po);

    const res = await httpInspect(j, { accepted: 9, rejected: 0, missing: 0, deferred: 0, held: 1 });
    const after = await poState(po);
    console.info('[GH1245_R4_STATUS]', res.status, JSON.stringify(res.body));

    expect({
      refusedAsClientError: isClientError(res.status),
      writes: inspectWrites(after, j),
    }).toEqual({
      refusedAsClientError: true,
      writes: inspectWrites(before, j),
    });
  });

  // ── 5. CONCURRENCY / INTEGRITY ──────────────────────────────────────────

  it('R5 — two overlapping job creations for the same PO yield one 201, one 409 and exactly one active job', async () => {
    const shop = await provisionFt2Shop('createrace');
    const po = await shippedPo(shop, 10);

    // Test-held barrier on the PO row: any create path that locks it, or that
    // inserts a receive_jobs row referencing it (FK KEY SHARE), waits here.
    const gate = holdRowLock(shop.shopId, 'purchase_orders', { shop_id: shop.shopId, id: po.poId });
    const gatePid = await gate.pidKnown;

    let settled = 0;
    const track = (r: request.Response) => { settled += 1; return r; };
    const createA = httpCreateJob(po).then(track);
    const createB = httpCreateJob(po).then(track);

    let waiters: LockWaiter[];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 2, () => settled > 0);
    } finally {
      gate.release();
    }
    await gate.done;
    const [a, b] = await Promise.all([createA, createB]);
    const after = await poState(po);

    console.info('[GH1245_R5_EVIDENCE]', JSON.stringify({
      gatePid, waiters,
      responses: [{ status: a.status, body: a.body }, { status: b.status, body: b.body }],
    }));

    expect(waiters.length).toBe(2);
    expect({
      statuses: [a.status, b.status].sort(),
      activeJobs: after.jobs.filter((job: any) => !['closed', 'cancelled'].includes(job.status)).length,
    }).toEqual({
      statuses: [201, 409],
      activeJobs: 1,
    });
  });

  it('R6 — a create overlapping an in-flight close is refused, and the create after the close reconciles only the deferred remainder', async () => {
    const shop = await provisionFt2Shop('closerace');
    const po = await shippedPo(shop, 10);
    const job1 = await openJob(po);
    const inspect1 = await httpInspect(job1, { accepted: 6, rejected: 0, missing: 0, deferred: 4 });

    // Barrier on job 1: its close waits behind the test-held job row lock.
    const gate = holdRowLock(shop.shopId, 'receive_jobs', { shop_id: shop.shopId, receive_job_id: job1.receiveJobId });
    const gatePid = await gate.pidKnown;

    let closeSettled = false;
    const close1 = httpClose(job1).then((r) => { closeSettled = true; return r; });
    let createSettled = false;
    let createDuringClose: request.Response | null = null;
    let waiters: LockWaiter[] = [];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 1, () => closeSettled);
      const pendingCreate = httpCreateJob(po).then((r) => { createSettled = true; createDuringClose = r; return r; });
      // Either the create answers while the close is still in flight, or it
      // becomes a second waiter behind the same gate — never a hang.
      await waitForGateWaiters(shop.shopId, gatePid, 2, () => createSettled, false);
      void pendingCreate;
    } finally {
      gate.release();
    }
    await gate.done;
    const closed = await close1;
    while (!createSettled) await new Promise((resolve) => setTimeout(resolve, 25));
    const during = createDuringClose as request.Response | null;

    const createAfter = await httpCreateJob(po);
    let ceilingAfter: number | null = null;
    if (createAfter.status === 201) {
      const s = await poState(po);
      ceilingAfter = dispositionOf(s, await lineIdFor(po, createAfter.body.receive_job_id)).expected;
    }

    console.info('[GH1245_R6_EVIDENCE]', JSON.stringify({
      gatePid, waiters,
      inspect1: { status: inspect1.status, body: inspect1.body },
      close: { status: closed.status, body: closed.body },
      createDuringClose: during ? { status: during.status, body: during.body } : null,
      createAfter: { status: createAfter.status, body: createAfter.body },
    }));

    expect(waiters.length).toBeGreaterThanOrEqual(1);
    expect({
      inspectStatus: inspect1.status,
      closeStatus: closed.status,
      createDuringCloseStatus: during?.status ?? null,
      createAfterStatus: createAfter.status,
      ceilingAfter,
    }).toEqual({
      inspectStatus: 200,
      closeStatus: 200,
      createDuringCloseStatus: 409,
      createAfterStatus: 201,
      ceilingAfter: 4,
    });
  });

  it('R7 — replays: a repeated create returns the existing job; a replayed exception (same device_event_id) is recorded once', async () => {
    const shop = await provisionFt2Shop('replay');
    const po = await shippedPo(shop, 10);
    const j = await openJob(po);

    const createReplay = await httpCreateJob(po);

    const eventId = crypto.randomUUID();
    const first = await httpReport(j, {
      exception_type: 'missing_item', quantity_affected: 3, accounting_role: 'shortfall', device_event_id: eventId,
    });
    const replay = await httpReport(j, {
      exception_type: 'missing_item', quantity_affected: 3, accounting_role: 'shortfall', device_event_id: eventId,
    });
    const after = await poState(po);

    expect({
      createReplayStatus: createReplay.status,
      createReplayJobId: createReplay.body.receive_job_id,
      firstStatus: first.status,
      replaySucceeded: replay.status >= 200 && replay.status < 300,
      replayReturnsOriginalId: replay.body.receive_exception_id === first.body.receive_exception_id,
      missingExceptionRows: after.exceptions.filter((e) => e.type === 'missing_item').length,
      missingQuantity: after.exceptions
        .filter((e) => e.type === 'missing_item')
        .reduce((s, e) => s + e.quantity, 0),
    }).toEqual({
      createReplayStatus: 409,
      createReplayJobId: j.receiveJobId,
      firstStatus: 201,
      replaySucceeded: true,
      replayReturnsOriginalId: true,
      missingExceptionRows: 1,
      missingQuantity: 3,
    });
  });

  it('R8 — two overlapping inspections of one line yield one 200, one 409 and counters/LSUs/audit exactly once', async () => {
    const shop = await provisionFt2Shop('inspectrace');
    const po = await shippedPo(shop, 3);
    const j = await openJob(po);
    // GH-1241 S3-A1: the count is confirmed once, before the race, so the
    // overlap below stays between the two inspections themselves.
    expect((await httpConfirmCount(j, 3)).status).toBe(200);

    const gate = holdRowLock(shop.shopId, 'receive_job_lines', {
      shop_id: shop.shopId, receive_job_line_id: j.receiveJobLineId,
    });
    const gatePid = await gate.pidKnown;

    let settled = 0;
    const track = (r: request.Response) => { settled += 1; return r; };
    const inspectA = httpInspectOnly(j, { accepted: 3, rejected: 0, missing: 0, deferred: 0 }).then(track);
    const inspectB = httpInspectOnly(j, { accepted: 3, rejected: 0, missing: 0, deferred: 0 }).then(track);

    let waiters: LockWaiter[];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 2, () => settled > 0);
    } finally {
      gate.release();
    }
    await gate.done;
    const [a, b] = await Promise.all([inspectA, inspectB]);
    const after = await poState(po);
    const job = jobOf(after, j.receiveJobId);

    console.info('[GH1245_R8_EVIDENCE]', JSON.stringify({
      gatePid, waiters,
      responses: [{ status: a.status, body: a.body }, { status: b.status, body: b.body }],
    }));

    expect(waiters.length).toBe(2);
    expect({
      statuses: [a.status, b.status].sort(),
      unitsInspected: numOrNull(job?.units_inspected),
      unitsAccepted: numOrNull(job?.units_accepted),
      unitCount: after.unitCount,
      inspectAuditCount: after.inspectAuditCount,
    }).toEqual({
      statuses: [200, 409],
      unitsInspected: 3,
      unitsAccepted: 3,
      unitCount: 3,
      inspectAuditCount: 1,
    });
  });

  it('R9 — overage is bounded by approved extra quantity against PHYSICALLY delivered units, with zero writes on refusal', async () => {
    const shop = await provisionFt2Shop('overage');

    // (a) Expected 4, approval for 1 extra, 6 physically delivered (4 accepted + 2 rejected).
    const poA = await shippedPo(shop, 4);
    const jA = await openJob(poA);
    expect((await httpReport(jA, {
      exception_type: 'extra_item', quantity_affected: 1, accounting_role: 'overage',
      device_event_id: crypto.randomUUID(),
    })).status).toBe(201);
    const beforeA = await poState(poA);
    const resA = await httpInspect(jA, { accepted: 4, rejected: 2, missing: 0, deferred: 0 });
    const afterA = await poState(poA);

    // (b) Expected 4, approval for 1 extra, 6 accepted.
    const poB = await shippedPo(shop, 4);
    const jB = await openJob(poB);
    expect((await httpReport(jB, {
      exception_type: 'extra_item', quantity_affected: 1, accounting_role: 'overage',
      device_event_id: crypto.randomUUID(),
    })).status).toBe(201);
    const beforeB = await poState(poB);
    const resB = await httpInspect(jB, { accepted: 6, rejected: 0, missing: 0, deferred: 0 });
    const afterB = await poState(poB);

    console.info('[GH1245_R9_STATUS]', JSON.stringify({
      a: { status: resA.status, body: resA.body },
      b: { status: resB.status, body: resB.body },
    }));

    expect({
      physicalOverDelivery: { refused: isClientError(resA.status), writes: inspectWrites(afterA, jA) },
      acceptedOverDelivery: { refused: isClientError(resB.status), writes: inspectWrites(afterB, jB) },
    }).toEqual({
      physicalOverDelivery: { refused: true, writes: inspectWrites(beforeA, jA) },
      acceptedOverDelivery: { refused: true, writes: inspectWrites(beforeB, jB) },
    });
  });

  it('R10 — legacy accounting bypasses fail closed: direct PO receive, manual received status, cancel with an active job', async () => {
    const shop = await provisionFt2Shop('bypass');

    // (a) Ledger-less legacy direct receive.
    const poA = await shippedPo(shop, 5);
    const beforeA = await poState(poA);
    const legacy = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poA.poId}/receive`)
      .set(auth(shop.token))
      .send({ line_items: [{ line_item_id: poA.poLineItemId, quantity_received: 3 }] });
    const afterA = await poState(poA);

    // (b) Manual 'received' is a server-derived Receive outcome, not a merchant edit.
    const poB = await shippedPo(shop, 5);
    const beforeB = await poState(poB);
    const manualReceived = await request(app)
      .patch(`/api/v1/suppliers/purchase-orders/${poB.poId}/status`)
      .set(auth(shop.token))
      .send({ status: 'received' });
    const afterB = await poState(poB);

    // (c) Cancelling a PO under an active Receive job.
    const poC = await shippedPo(shop, 5);
    await openJob(poC);
    const beforeC = await poState(poC);
    const cancelActive = await request(app)
      .patch(`/api/v1/suppliers/purchase-orders/${poC.poId}/status`)
      .set(auth(shop.token))
      .send({ status: 'cancelled' });
    const afterC = await poState(poC);

    const ledger = (s: PoState) => ({
      poStatus: s.poStatus,
      quantityReceived: s.quantityReceived,
      supplierTotalPos: s.supplierTotalPos,
      inboundQuantity: s.inboundQuantity,
    });

    expect({
      legacyReceive: { refused: isClientError(legacy.status), state: ledger(afterA) },
      manualReceived: { refused: isClientError(manualReceived.status), state: ledger(afterB) },
      cancelActive: { refused: isClientError(cancelActive.status), state: ledger(afterC) },
    }).toEqual({
      legacyReceive: { refused: true, state: ledger(beforeA) },
      manualReceived: { refused: true, state: ledger(beforeB) },
      cancelActive: { refused: true, state: ledger(beforeC) },
    });
  });

  it('R11 — an ambiguous legacy-client inspect (rejected = whole shortfall, no disposition) fails closed with zero writes', async () => {
    const shop = await provisionFt2Shop('legacyclient');
    const po = await shippedPo(shop, 10);
    const j = await openJob(po);
    // GH-1241 S3-A1: the count is confirmed, so the refusal is about the
    // ambiguous payload, not about a missing count.
    expect((await httpConfirmCount(j, 6)).status).toBe(200);
    const before = await poState(po);

    // The pre-S2 web/mobile shape: shortfall folded into quantity_rejected.
    const res = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
      .set(auth(shop.token))
      .send({
        lasyncro_variant_id: po.lasyncroVariantId,
        receive_job_line_id: j.receiveJobLineId,
        quantity_accepted: 6,
        quantity_rejected: 4,
      });
    const after = await poState(po);
    console.info('[GH1245_R11_STATUS]', res.status, JSON.stringify(res.body));

    expect({ refused: isClientError(res.status), writes: inspectWrites(after, j) })
      .toEqual({ refused: true, writes: inspectWrites(before, j) });
  });

  it('R12 — another shop cannot create, inspect or report against this PO/job (404, zero writes) — control', async () => {
    const shop = await provisionFt2Shop('owner');
    const po = await shippedPo(shop, 10);
    const j = await openJob(po);
    const foreign = await provisionFt2Shop('foreign');
    expect(foreign.shopId).not.toBe(shop.shopId);
    const before = await poState(po);

    const create = await httpCreateJob(po, foreign.token);
    const inspect = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
      .set(auth(foreign.token))
      .send({
        lasyncro_variant_id: po.lasyncroVariantId,
        receive_job_line_id: j.receiveJobLineId,
        quantity_accepted: 10, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
      });
    const report = await httpReport(j, {
      exception_type: 'missing_item', quantity_affected: 1, accounting_role: 'shortfall',
    }, foreign.token);
    // Foreign calls to the legacy direct-receive and PATCH status routes are
    // deliberately not made here: both handlers answer 404 inside the
    // transaction and then write a second response, which under Express 4 is
    // an unhandled rejection in this harness, not a behavioural signal.
    const after = await poState(po);

    const stripVolatile = (s: PoState) => ({
      ...s,
      jobs: s.jobs.map((job: any) => ({ id: job.receive_job_id, status: job.status })),
      lines: s.lines.map((line: any) => dispositionOf(s, line.receive_job_line_id)),
    });

    expect({
      statuses: [create.status, inspect.status, report.status],
      state: stripVolatile(after),
    }).toEqual({
      statuses: [404, 404, 404],
      state: stripVolatile(before),
    });
  });

  // ── 6. INHERITED: GH-1085 barcode readiness on a partial delivery ───────

  it('R13 — a barcode-less partial delivery mints LSUs for accepted units only and stays close-gated until labels are acknowledged', async () => {
    const shop = await provisionFt2Shop('barcodeless');
    const po = await shippedPo(shop, 5, null);
    const j = await openJob(po);

    const inspected = await httpInspect(j, { accepted: 3, rejected: 0, missing: 0, deferred: 2 });
    const afterInspect = await poState(po);
    const gatedClose = await httpClose(j);
    const afterGated = await poState(po);

    const ack = await request(app)
      .post(`/api/v1/wms/receive-job-lines/${j.receiveJobLineId}/unit-labels/printed`)
      .set(auth(shop.token))
      .send({});
    const closed = await httpClose(j);
    const after = await poState(po);

    expect({
      inspectStatus: inspected.status,
      lsuCountAfterInspect: afterInspect.unitCount,
      jobStatusAfterInspect: jobOf(afterInspect, j.receiveJobId)?.status ?? null,
      gatedCloseRefused: gatedClose.status >= 400,
      gatedCloseInbound: afterGated.inboundQuantity,
      ackStatus: ack.status,
      closeStatus: closed.status,
      inboundQuantity: after.inboundQuantity,
      lsuCountFinal: after.unitCount,
      quantityPendingDelivery: after.quantityPendingDelivery,
      committedInbound: after.committedInbound,
      poStatus: after.poStatus,
    }).toEqual({
      inspectStatus: 200,
      lsuCountAfterInspect: 3,
      jobStatusAfterInspect: 'barcode_assignment',
      gatedCloseRefused: true,
      gatedCloseInbound: 0,
      ackStatus: 200,
      closeStatus: 200,
      inboundQuantity: 3,
      lsuCountFinal: 3,
      quantityPendingDelivery: 2,
      committedInbound: 2,
      poStatus: 'partially_received',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WS-UX-01 S1 — PO cancellation authority. Once Receive activity exists
// (any job, any status, or any received quantity) an ordinary cancel must be
// refused with zero consequential writes; legacy ambiguous history fails closed.

describe('WS-UX-01 S1 PO cancellation authority', () => {
  function httpCancel(po: PoFixture, token: string = po.shop.token) {
    return request(app)
      .patch(`/api/v1/suppliers/purchase-orders/${po.poId}/status`)
      .set(auth(token))
      .send({ status: 'cancelled' });
  }

  /** Every write a cancel may make, plus the Receive history it must not destroy. */
  async function cancelState(po: PoFixture) {
    const s = await poState(po);
    const { shopId } = po.shop;
    return withTenant(shopId, async (trx) => {
      const poRow = await trx('purchase_orders').where({ shop_id: shopId, id: po.poId })
        .first('status', 'updated_at', 'actual_delivery_date');
      const snapshot = await trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('scheduled_at');
      return {
        poStatus: poRow?.status ?? null,
        poUpdatedAt: poRow?.updated_at ? new Date(poRow.updated_at).toISOString() : null,
        actualDeliveryDate: dateOnly(poRow?.actual_delivery_date),
        snapshotScheduledAt: snapshot?.scheduled_at ? new Date(snapshot.scheduled_at).toISOString() : null,
        quantityReceived: s.quantityReceived,
        supplierTotalPos: s.supplierTotalPos,
        inboundQuantity: s.inboundQuantity,
        jobs: s.jobs.map((job: any) => ({ id: job.receive_job_id, status: job.status })),
      };
    });
  }

  /** Legacy history written before the S2 accounting path (fixture-only insert). */
  async function insertLegacyJob(po: PoFixture, row: Record<string, unknown>) {
    await withTenant(po.shop.shopId, (trx) =>
      trx('receive_jobs').insert({ shop_id: po.shop.shopId, po_id: po.poId, ...row }));
  }

  it('C1–C6/C10 — cancel is refused (409, zero writes) once any Receive history or received quantity exists', async () => {
    const shop = await provisionFt2Shop('cancelauth');

    // C1 active Receive job.
    const active = await shippedPo(shop, 5);
    await openJob(active);

    // C2 partial Receive: closed delivery with a deferred remainder.
    const partial = await shippedPo(shop, 10);
    const partialJob = await openJob(partial);
    expect((await httpInspect(partialJob, { accepted: 4, rejected: 0, missing: 0, deferred: 6 })).status).toBe(200);
    expect((await httpClose(partialJob)).status).toBe(200);

    // C3 closed Receive with accepted units (final delivery).
    const accepted = await shippedPo(shop, 5);
    const acceptedJob = await openJob(accepted);
    expect((await httpInspect(acceptedJob, { accepted: 5, rejected: 0, missing: 0, deferred: 0 })).status).toBe(200);
    expect((await httpClose(acceptedJob)).status).toBe(200);

    // C4 closed legacy v1 job, zero accepted.
    const legacyClosed = await shippedPo(shop, 5);
    await insertLegacyJob(legacyClosed, {
      status: 'closed', delivery_accounting_version: 1, units_accepted: 0,
      started_at: new Date(), closed_at: new Date(),
    });

    // C5 historical cancelled job that never started.
    const historicalCancelled = await shippedPo(shop, 5);
    await insertLegacyJob(historicalCancelled, {
      status: 'cancelled', delivery_accounting_version: 1, started_at: null,
    });

    // C6 positive received quantity without any Receive job.
    const receivedNoJob = await shippedPo(shop, 5);
    await withTenant(shop.shopId, (trx) =>
      trx('purchase_order_line_items')
        .where({ shop_id: shop.shopId, id: receivedNoJob.poLineItemId })
        .update({ quantity_received: 2 }));

    const cases = { active, partial, accepted, legacyClosed, historicalCancelled, receivedNoJob };
    const observed: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [name, po] of Object.entries(cases)) {
      const before = await cancelState(po);
      const res = await httpCancel(po);
      const after = await cancelState(po);
      console.info('[WSUX01_S1_CANCEL]', name, res.status, JSON.stringify(res.body));
      observed[name] = { status: res.status, state: after };
      expected[name] = { status: 409, state: before };
    }

    expect(observed).toEqual(expected);
  });

  it('C7–C8 — draft and shipped POs without Receive history remain cancellable', async () => {
    const shop = await provisionFt2Shop('cancelok');
    const draft = await shippedPo(shop, 5);
    await withTenant(shop.shopId, (trx) =>
      trx('purchase_orders').where({ shop_id: shop.shopId, id: draft.poId }).update({ status: 'draft' }));
    const shipped = await shippedPo(shop, 5);

    const draftRes = await httpCancel(draft);
    const shippedRes = await httpCancel(shipped);
    const [draftAfter, shippedAfter] = [await cancelState(draft), await cancelState(shipped)];

    expect({
      draft: { status: draftRes.status, poStatus: draftAfter.poStatus, jobs: draftAfter.jobs },
      shipped: { status: shippedRes.status, poStatus: shippedAfter.poStatus, jobs: shippedAfter.jobs },
    }).toEqual({
      draft: { status: 200, poStatus: 'cancelled', jobs: [] },
      shipped: { status: 200, poStatus: 'cancelled', jobs: [] },
    });
  });

  it('C9 — overlapping Receive create and cancel never yield a cancelled PO with Receive history', async () => {
    const shop = await provisionFt2Shop('cancelrace');
    const po = await shippedPo(shop, 5);

    const gate = holdRowLock(shop.shopId, 'purchase_orders', { shop_id: shop.shopId, id: po.poId });
    const gatePid = await gate.pidKnown;

    let settled = 0;
    const track = (r: request.Response) => { settled += 1; return r; };
    const create = httpCreateJob(po).then(track);
    const cancel = httpCancel(po).then(track);

    let waiters: LockWaiter[];
    try {
      waiters = await waitForGateWaiters(shop.shopId, gatePid, 2, () => settled > 0);
    } finally {
      gate.release();
    }
    await gate.done;
    const [created, cancelled] = await Promise.all([create, cancel]);
    const after = await cancelState(po);

    console.info('[WSUX01_S1_RACE]', JSON.stringify({
      gatePid, waiters,
      create: { status: created.status, body: created.body },
      cancel: { status: cancelled.status, body: cancelled.body },
      after,
    }));

    expect(waiters.length).toBe(2);
    const createWon = created.status === 201;
    expect({
      successes: [created.status, cancelled.status].filter((s) => s >= 200 && s < 300).length,
      loserStatus: createWon ? cancelled.status : created.status,
      poStatus: after.poStatus,
      jobCount: after.jobs.length,
    }).toEqual({
      successes: 1,
      loserStatus: 409,
      poStatus: createWon ? 'shipped' : 'cancelled',
      jobCount: createWon ? 1 : 0,
    });
  });

  it('C11 — another shop cannot cancel this PO (404, zero writes)', async () => {
    const shop = await provisionFt2Shop('cancelowner');
    const po = await shippedPo(shop, 5);
    const foreign = await provisionFt2Shop('cancelforeign');
    expect(foreign.shopId).not.toBe(shop.shopId);
    const before = await cancelState(po);

    const res = await httpCancel(po, foreign.token);
    const after = await cancelState(po);

    expect({ status: res.status, state: after }).toEqual({ status: 404, state: before });
  });
});
