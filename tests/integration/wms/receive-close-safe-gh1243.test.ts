/**
 * GH-1243 / RECEIVE-CLOSE-SAFE (S1 of GH-1241) — RED regression gate.
 *
 * Contract: one eligible Receive job closes AT MOST ONCE economically.
 * A close credits purchase_order_line_items.quantity_received, one
 * inbound_purchase movement at WH-{shop}-ROOT, the matching inventory_truth
 * increment and one inbound Stow task — once. A replayed or overlapping second
 * close is a deterministic 409 with no further effect, and an ignored
 * duplicate movement never authorizes another inventory_truth increment.
 *
 * Every close here goes through the real route
 * (POST /api/v1/suppliers/receive-jobs/:jobId/close → httpCloseReceiveJob →
 * closeReceiveJob) against the disposable synchroflow_test_* database
 * (`npm run test:integration`). Fixtures follow the GH-1085 Receive suite.
 *
 * CONCURRENCY METHOD — no arbitrary delays. closeReceiveJob reads the job
 * status without a lock, then makes its first write to the PO line
 * (purchase_order_line_items.quantity_received). The test holds a
 * SELECT … FOR UPDATE on exactly that PO line in its own transaction, fires
 * two close requests, and releases the lock only after pg_stat_activity
 * proves BOTH requests are lock-waiting behind it. Which statement each
 * waiter is blocked on is logged: at baseline both block on the PO-line
 * UPDATE, i.e. both already passed the status check. Production code is not
 * instrumented.
 */
import crypto from 'crypto';
import request from 'supertest';
import { v5 as uuidv5 } from 'uuid';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import {
  createReceiveJob,
  inspectReceiveJobLine,
  closeReceiveJob,
} from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

const DELIVERY_DATE = '2026-10-10';
/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the GH-1085 Receive suite) ────────────────

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

async function provisionFt2Shop(label: string) {
  const shopDomain = `rcs1243-${label}-${Date.now()}.myshopify.com`;
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
  const externalVariantId = `gid://shopify/ProductVariant/1243C${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/1243C${nonce}`,
          title: `GH1243 receive close fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1243-RCV-${nonce}`,
                  barcode: externalBarcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/1243C${nonce}`,
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

interface ReceiveFixture {
  shopId: number;
  userId: number;
  token: string;
  rootLocationCode: string;
  lasyncroVariantId: string;
  supplierId: number;
  poId: string;
  poLineItemId: string;
  receiveJobId: string;
  receiveJobLineId: string;
  quantityOrdered: number;
}

/** supplier → PO → PO line → receive job (real service) → claimed (real route). */
async function receiveFixture(opts: {
  externalBarcode: string | null;
  quantityOrdered: number;
}): Promise<ReceiveFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const shop = await provisionFt2Shop(crypto.randomUUID());
  const lasyncroVariantId = await seedMappedVariant(shop.shopId, opts.externalBarcode);

  const created = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1243 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'draft' })
      .returning('id');
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: po.id,
        shop_id: shop.shopId,
        lasyncro_variant_id: lasyncroVariantId,
        description: 'GH1243 receive close line',
        quantity_ordered: opts.quantityOrdered,
        unit_cost_cents: 400,
      })
      .returning('id');

    const jobId = await createReceiveJob(trx, {
      shopId: shop.shopId,
      poId: po.id,
      operatorId: shop.userId,
    });

    const jobLine = await trx('receive_job_lines')
      .where({ shop_id: shop.shopId, receive_job_id: jobId, lasyncro_variant_id: lasyncroVariantId })
      .first('receive_job_line_id');
    expect(jobLine?.receive_job_line_id).toBeTruthy();

    return {
      supplierId: Number(supplier.id),
      poId: po.id as string,
      poLineItemId: poLine.id as string,
      receiveJobId: jobId,
      receiveJobLineId: jobLine!.receive_job_line_id as string,
    };
  });

  // GH-1111: execution mutations require the assigned operator's claim.
  const claim = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${created.receiveJobId}/claim`)
    .set('Authorization', `Bearer ${shop.token}`)
    .send({});
  expect(claim.status).toBe(200);

  return {
    shopId: shop.shopId,
    userId: shop.userId,
    token: shop.token,
    rootLocationCode: shop.rootLocationCode,
    lasyncroVariantId,
    ...created,
    quantityOrdered: opts.quantityOrdered,
  };
}

/** Real inspection path. */
function inspect(f: ReceiveFixture, quantityAccepted: number, quantityRejected = 0) {
  return withTenant(f.shopId, (trx) =>
    inspectReceiveJobLine(trx, {
      shopId: f.shopId,
      receiveJobId: f.receiveJobId,
      lasyncroVariantId: null,
      receiveJobLineId: f.receiveJobLineId,
      quantityAccepted,
      quantityRejected,
      inspectedBy: f.userId,
    }));
}

/** Barcode-ready (external GTIN) job with every ordered unit inspected and accepted. */
async function readyFixture(quantity = 2): Promise<ReceiveFixture> {
  const f = await receiveFixture({ externalBarcode: EXTERNAL_BARCODE, quantityOrdered: quantity });
  await inspect(f, quantity);
  const job = await withTenant(f.shopId, (trx) =>
    trx('receive_jobs').where({ shop_id: f.shopId, receive_job_id: f.receiveJobId }).first('status'));
  expect(job?.status).toBe('stow_ready');
  return f;
}

/** Real close route. `null` omits actual_delivery_date from the body. */
function httpClose(f: ReceiveFixture, actualDeliveryDate: string | null = DELIVERY_DATE) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${f.receiveJobId}/close`)
    .set('Authorization', `Bearer ${f.token}`)
    .send(actualDeliveryDate === null ? {} : { actual_delivery_date: actualDeliveryDate });
}

/** Every consequence of a close, scoped to this fixture's shop/job/variant. */
async function closeEffects(f: ReceiveFixture) {
  return withTenant(f.shopId, async (trx) => {
    const job = await trx('receive_jobs')
      .where({ shop_id: f.shopId, receive_job_id: f.receiveJobId })
      .first('status', 'closed_at', 'units_accepted');
    const poLine = await trx('purchase_order_line_items')
      .where({ shop_id: f.shopId, id: f.poLineItemId })
      .first('quantity_ordered', 'quantity_received');
    const po = await trx('purchase_orders')
      .where({ shop_id: f.shopId, id: f.poId })
      .first('status', 'actual_delivery_date');
    const supplier = await trx('suppliers')
      .where({ shop_id: f.shopId, id: f.supplierId })
      .first('total_pos');
    const inboundMovements = await trx('inventory_movements')
      .where({
        shop_id: f.shopId,
        reference_type: 'receive_job',
        reference_id: f.receiveJobId,
        movement_type: 'inbound_purchase',
      })
      .select('lasyncro_variant_id', 'quantity_delta', 'location_code');
    const rootLedger = await trx('inventory_movements')
      .where({
        shop_id: f.shopId,
        lasyncro_variant_id: f.lasyncroVariantId,
        location_code: f.rootLocationCode,
      })
      .sum<{ sum: string | null }>('quantity_delta as sum')
      .first();
    const rootTruth = await trx('inventory_truth')
      .where({
        shop_id: f.shopId,
        lasyncro_variant_id: f.lasyncroVariantId,
        location_code: f.rootLocationCode,
      })
      .first('on_hand_quantity', 'available_quantity');
    const stowTasks = await trx('stow_tasks')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.lasyncroVariantId })
      .orderBy('created_at', 'asc')
      .select('stow_task_id', 'quantity', 'status', 'trigger', 'receive_job_line_id');
    const stowAlerts = await trx('alerts')
      .where({ shop_id: f.shopId, alert_type: 'wms_stow_pending', is_active: true })
      .whereIn('entity_id', stowTasks.map((t: any) => t.stow_task_id))
      .select('entity_id');
    const barcodePrintJobs = await trx('barcode_print_jobs')
      .where({ shop_id: f.shopId, receive_job_id: f.receiveJobId })
      .select('lasyncro_variant_id', 'quantity', 'status');
    const closeAudits = await trx('operator_audit_log')
      .where({ shop_id: f.shopId, action_type: 'receive_close', entity_id: f.receiveJobId })
      .count<{ count: string }>('* as count')
      .first();

    return {
      job,
      poLine,
      po,
      supplier,
      inboundMovements,
      rootLedgerSum: Number(rootLedger?.sum ?? 0),
      rootTruth,
      stowTasks,
      activeStowAlerts: stowAlerts.length,
      barcodePrintJobs,
      receiveCloseAudits: Number(closeAudits?.count ?? 0),
    };
  });
}

type CloseEffects = Awaited<ReturnType<typeof closeEffects>>;

/** The economic receipt, as one comparable object so a diff shows every field. */
function economicReceipt(s: CloseEffects) {
  const onHand = s.rootTruth ? Number(s.rootTruth.on_hand_quantity) : 0;
  return {
    jobStatus: s.job?.status,
    quantityReceived: Number(s.poLine?.quantity_received ?? 0),
    poStatus: s.po?.status,
    supplierTotalPos: Number(s.supplier?.total_pos ?? 0),
    inboundMovementCount: s.inboundMovements.length,
    inboundQuantity: s.inboundMovements.reduce((sum: number, m: any) => sum + Number(m.quantity_delta), 0),
    rootOnHand: onHand,
    rootAvailable: s.rootTruth ? Number(s.rootTruth.available_quantity) : 0,
    /** Truth not reproduced by the ledger. Must always be 0 (INV-LEDGER-BYPASS-16). */
    truthMinusLedger: onHand - s.rootLedgerSum,
    stowTaskCount: s.stowTasks.length,
    stowTaskQuantity: s.stowTasks.reduce((sum: number, t: any) => sum + Number(t.quantity), 0),
    activeStowAlerts: s.activeStowAlerts,
    barcodePrintJobCount: s.barcodePrintJobs.length,
  };
}

/** What exactly one close of a fully accepted N-unit, single-line PO must produce. */
function oneReceipt(quantity: number, totalPosBefore: number) {
  return {
    jobStatus: 'closed',
    quantityReceived: quantity,
    poStatus: 'received',
    supplierTotalPos: totalPosBefore + 1,
    inboundMovementCount: 1,
    inboundQuantity: quantity,
    rootOnHand: quantity,
    rootAvailable: quantity,
    truthMinusLedger: 0,
    stowTaskCount: 1,
    stowTaskQuantity: quantity,
    activeStowAlerts: 1,
    barcodePrintJobCount: 1,
  };
}

// ── overlap instrumentation (test-only; production code untouched) ──────────

interface LockWaiter {
  pid: number;
  blockers: number[];
  query: string;
}

/** True when `pid`'s chain of lock blockers leads to the test-held gate. */
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
 * Bounded poll for the condition "N backends are lock-waiting and every one of
 * them is blocked, directly or through another waiter, by the test-held gate".
 * The gate sits on a row closeReceiveJob writes, so a waiter is a close request
 * that is in flight while the other is uncommitted. Which lock each request
 * waits on is evidence, not a precondition. Not a timing assumption: it returns
 * as soon as PostgreSQL reports the waits and fails loudly if the overlap never
 * forms.
 */
async function waitForCloseLockWaiters(
  shopId: number,
  gatePid: number,
  expected: number,
  requestsSettled: () => boolean,
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
    if (requestsSettled()) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `OVERLAP_NOT_ESTABLISHED: expected ${expected} close requests lock-waiting behind the gate, ` +
    `observed ${last.length} (${JSON.stringify(last)})`
  );
}

// ── Q1 — normal close (passing control) ─────────────────────────────────────

describe('GH-1243 Receive close safety', () => {
  it('C1 — one barcode-ready close succeeds and produces exactly one receipt (control)', async () => {
    const f = await readyFixture(2);
    const before = await closeEffects(f);

    expect(economicReceipt(before)).toEqual(expect.objectContaining({
      quantityReceived: 0,
      inboundMovementCount: 0,
      rootOnHand: 0,
      stowTaskCount: 0,
    }));

    const res = await httpClose(f);
    expect(res.status).toBe(200);

    const after = await closeEffects(f);
    expect(economicReceipt(after)).toEqual(
      oneReceipt(2, Number(before.supplier?.total_pos ?? 0))
    );
    expect(after.inboundMovements).toEqual([
      expect.objectContaining({
        lasyncro_variant_id: f.lasyncroVariantId,
        quantity_delta: 2,
        location_code: f.rootLocationCode,
      }),
    ]);
    expect(after.stowTasks).toEqual([
      expect.objectContaining({
        quantity: 2,
        trigger: 'inbound_stock',
        receive_job_line_id: f.receiveJobLineId,
      }),
    ]);
  });

  // GH-1243 invariant 3: one close transition writes its audit consequence once.
  it('C1b — one close writes exactly one receive_close audit entry', async () => {
    const f = await readyFixture(2);

    const res = await httpClose(f);
    expect(res.status).toBe(200);

    const after = await closeEffects(f);
    expect(after.receiveCloseAudits).toBe(1);
  });

  // ── Q2 — sequential replay ────────────────────────────────────────────────

  it('C2 — closing an already-closed job is a deterministic 409 with zero additional effects', async () => {
    const f = await readyFixture(2);

    const first = await httpClose(f);
    expect(first.status).toBe(200);
    const afterFirst = await closeEffects(f);

    const replay = await httpClose(f);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toMatch(/already closed/i);

    expect(await closeEffects(f)).toEqual(afterFirst);
  });

  // ── Q3 + Q4 — concurrent close, ledger/stock consistency ─────────────────

  it('C3 — two overlapping close requests yield one 200, one 409 and exactly one economic receipt', async () => {
    const f = await readyFixture(2);
    const before = await closeEffects(f);

    let releaseGate!: () => void;
    const gateReleased = new Promise<void>((resolve) => { releaseGate = resolve; });
    let reportGatePid!: (pid: number) => void;
    const gatePidKnown = new Promise<number>((resolve) => { reportGatePid = resolve; });

    // Test-held barrier on the row closeReceiveJob writes first.
    const gate = withTenant(f.shopId, async (trx) => {
      const locked = await trx('purchase_order_line_items')
        .where({ shop_id: f.shopId, id: f.poLineItemId })
        .forUpdate()
        .first('id');
      expect(locked?.id).toBe(f.poLineItemId);
      const pid = await trx.raw('SELECT pg_backend_pid() AS pid');
      reportGatePid(Number(pid.rows[0].pid));
      await gateReleased;
    });

    const gatePid = await gatePidKnown;

    let settled = 0;
    const track = (r: request.Response) => { settled += 1; return r; };
    const closeA = httpClose(f).then(track);
    const closeB = httpClose(f).then(track);

    let waiters: LockWaiter[];
    try {
      waiters = await waitForCloseLockWaiters(f.shopId, gatePid, 2, () => settled > 0);
    } finally {
      releaseGate();
    }
    await gate;

    const [a, b] = await Promise.all([closeA, closeB]);
    const after = await closeEffects(f);

    const evidence = {
      gatePid,
      waiters,
      responses: [
        { status: a.status, body: a.body },
        { status: b.status, body: b.body },
      ],
      before: economicReceipt(before),
      after: economicReceipt(after),
      receiveCloseAudits: { before: before.receiveCloseAudits, after: after.receiveCloseAudits },
      stowTasks: after.stowTasks,
      inboundMovements: after.inboundMovements,
    };
    console.info('[GH1243_C3_EVIDENCE]', JSON.stringify(evidence, null, 2));

    // Overlap precondition: both close requests were in flight at once, each
    // lock-waiting behind the test-held gate on the PO line.
    expect(waiters.length).toBe(2);
    expect(waiters.some((w) => w.blockers.includes(gatePid))).toBe(true);

    // Invariant: exactly one economic receipt and one deterministic conflict.
    expect({
      statuses: [a.status, b.status].sort(),
      receipt: economicReceipt(after),
    }).toEqual({
      statuses: [200, 409],
      receipt: oneReceipt(2, Number(before.supplier?.total_pos ?? 0)),
    });
  });

  // ── Q5 — failure atomicity (existing fail-closed behaviour) ──────────────

  it('C5a — a barcode-unready close is refused with zero consequential writes', async () => {
    // Barcode-less stock whose LSU labels were never acknowledged (GH-1085 B3).
    const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
    await inspect(f, 2);
    const before = await closeEffects(f);
    expect(before.job?.status).toBe('barcode_assignment');

    const res = await httpClose(f);
    console.info('[GH1243_C5A_STATUS]', res.status, JSON.stringify(res.body));
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await closeEffects(f)).toEqual(before);
  });

  it('C5b — closing a job with an uninspected line is a 409 with zero consequential writes', async () => {
    const f = await receiveFixture({ externalBarcode: EXTERNAL_BARCODE, quantityOrdered: 2 });
    const before = await closeEffects(f);

    const res = await httpClose(f);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not yet inspected/i);

    expect(await closeEffects(f)).toEqual(before);
  });

  it('C5c — a close without an actual delivery date is refused with zero consequential writes', async () => {
    const f = await readyFixture(2);
    const before = await closeEffects(f);

    const res = await httpClose(f, null);
    console.info('[GH1243_C5C_STATUS]', res.status, JSON.stringify(res.body));
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await closeEffects(f)).toEqual(before);
  });

  // ── tenant isolation ─────────────────────────────────────────────────────

  it('C6 — another shop cannot close this job, by route or under its own tenant context', async () => {
    const f = await readyFixture(2);
    const foreign = await provisionFt2Shop(crypto.randomUUID());
    expect(foreign.shopId).not.toBe(f.shopId);
    const before = await closeEffects(f);

    const res = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${f.receiveJobId}/close`)
      .set('Authorization', `Bearer ${foreign.token}`)
      .send({ actual_delivery_date: DELIVERY_DATE });
    expect(res.status).toBe(404);

    // Below the route: the foreign tenant's transaction cannot see the job
    // even when handed this shop's id (RLS on receive_jobs).
    await expect(
      withTenant(foreign.shopId, (trx) =>
        closeReceiveJob(trx, {
          shopId: f.shopId,
          receiveJobId: f.receiveJobId,
          actualDeliveryDate: DELIVERY_DATE,
          closedBy: foreign.userId,
        }))
    ).rejects.toThrow(/job not found/i);

    expect(await closeEffects(f)).toEqual(before);

    // The owning shop's close is unaffected.
    expect((await httpClose(f)).status).toBe(200);
  });

  // ── ledger precondition ──────────────────────────────────────────────────

  it('C7 — an already-recorded canonical inbound movement fails the close closed with zero further effects', async () => {
    const f = await readyFixture(2);

    // The exact canonical receipt row closeReceiveJob would write for this
    // job/variant (receiveJob.service.ts RECEIVE_NAMESPACE identities).
    const RECEIVE_NAMESPACE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await withTenant(f.shopId, (trx) =>
      trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: uuidv5(
          `${f.receiveJobId}:${f.lasyncroVariantId}:inbound_purchase`, RECEIVE_NAMESPACE),
        lasyncro_variant_id: f.lasyncroVariantId,
        shop_id: f.shopId,
        movement_type: 'inbound_purchase',
        quantity_delta: 2,
        location_code: f.rootLocationCode,
        reference_type: 'receive_job',
        reference_id: f.receiveJobId,
        platform: 'wms',
        occurred_at: new Date(),
        device_event_id: uuidv5(`${f.receiveJobId}:${f.lasyncroVariantId}:device`, RECEIVE_NAMESPACE),
        operator_id: f.userId,
        triggered_by: 'receive_job',
      }));

    const before = await closeEffects(f);
    expect(before.inboundMovements).toHaveLength(1);

    const res = await httpClose(f);
    console.info('[GH1243_C7_STATUS]', res.status, JSON.stringify(res.body));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/INBOUND_MOVEMENT_CONFLICT/);

    // No second receipt: PO, truth, Stow, supplier, job state all unchanged.
    expect(await closeEffects(f)).toEqual(before);
  });
});
