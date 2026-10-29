// S8-C5 / S4-3B — recoverable held capture (contract SF-RECEIVE-S8C5-S4-CONTRACT-026,
// S4-3 audit C1–C9, ratified D1–D3 and handoff rulings 4a–4c).
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import {
  inspectReceiveJobLine,
  receiveLineReconciliationState,
  recountReceiveJobLine,
} from 'api-src/services/wms/receiveJob.service';
import {
  finalizeReconciliation,
  parseGroupedLines,
  saveReconciliationDraft,
} from 'api-src/services/wms/receiveReconciliation.service';
import { createProblemCenterTask } from 'api-src/services/wms/problemCenterTask.service';
import { markLabelsPrinted } from 'api-src/services/wms/inventoryUnit.service';
import { evaluateReceiveJobBarcodeReadiness } from 'api-src/services/wms/receiveBarcodeReadiness.service';
import { issueTestToken } from '../../unit/helpers/auth';

/**
 * Held capture is service-layer only until S4-4 (D1): every public route
 * refuses recoverable-held intent with 409 before persisting anything (C9),
 * so the capture cases call the services directly, in tenant transactions
 * that run as the restricted runtime role sf_app (proved in C8).
 *
 *   C1  per-line defect held=2 → 2 held LSUs after the accepted range, 2 quantity-1
 *       Problem Center tasks (bin NULL), delivered = a + r + h, no truth / movements.
 *   C2  grouped finalization with recoverable_held new exceptions → same post-state
 *       and 0225 finalization held; a legacy payload keeps its canonical hash (4b).
 *   C3  same inspect device-event replay → no new LSU / task.
 *   C4  concurrent per-line inspects, and inspect vs grouped finalize → one result.
 *   C5  held never counts as shortfall; evidence-sum mismatch → 409 with no side
 *       effects; illegal type / role / disposition refused (parser and 0224 CHECK).
 *   C6  Recount before inspection supersedes held evidence and keeps history (D3).
 *   C7  unacknowledged held labels block readiness; acknowledgement clears it; close stays 409.
 *   C8  sf_app tenant isolation: owning-shop positive, other-shop negative; LSUs unique.
 *   C9  public inspect / exception / grouped draft / finalize refuse held with 409, no
 *       held side effects; ordinary non-held requests still succeed.
 *
 * Commits held units and tasks: runs only in the isolated held-unit CI step,
 * never with the 0224 / 0225 migration rollback suites.
 */

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-28';
/** A real GTIN: accepted stock is ready without LSU acknowledgement, so C7 isolates the held labels. */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the GH-1241 S3-B / S8-C5 suites) ─────────

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

interface Shop { shopId: number; userId: number; token: string }

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs43-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
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
  return { shopId, userId, token };
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S43${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/S43${nonce}`,
        title: `S4-3B held fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-3B-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/S43${nonce}`, unitCost: { amount: '4.00' } },
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

interface Job { shop: Shop; receiveJobId: string; lineId: string; variantId: string; expected: number }

/** shipped single-line PO → real create + claim routes (v2 delivery accounting). */
async function openJob(shop: Shop, expected: number): Promise<Job> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const variantId = await seedMappedVariant(shop.shopId);
  const poId = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-3B supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-3B held line', quantity_ordered: expected, unit_cost_cents: 400,
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
      .first('receive_job_line_id', 'quantity_expected'));
  expect(Number(line.quantity_expected)).toBe(expected);
  return { shop, receiveJobId, lineId: line.receive_job_line_id as string, variantId, expected };
}

async function confirmCount(j: Job, quantity: number) {
  const res = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/lines/${j.lineId}/confirm-count`)
    .set(auth(j.shop.token)).send({ quantity_confirmed: quantity, device_event_id: crypto.randomUUID() });
  expect(res.status).toBe(200);
}

/**
 * Per-line recoverable-held evidence. The public reporter refuses it until S4-4
 * (C9), so the explicit 0224 shape is seeded as sf_app, the role the S4-4 writer
 * will use.
 */
async function seedHeldEvidence(j: Job, type: 'defect' | 'packaging_damage', quantity: number, notes: string | null = null) {
  return withTenant(j.shop.shopId, async (trx) => {
    const [row] = await trx('receive_exceptions').insert({
      shop_id: j.shop.shopId, receive_job_id: j.receiveJobId, receive_job_line_id: j.lineId,
      lasyncro_variant_id: j.variantId, exception_type: type, quantity_affected: quantity,
      accounting_role: null, counts_toward_shortfall: false, disposition: 'recoverable_held',
      notes, raised_by: j.shop.userId, raised_at: new Date(),
    }).returning('receive_exception_id');
    return row.receive_exception_id as string;
  });
}

function inspect(j: Job, q: { accepted: number; held: number; rejected?: number }, deviceEventId = crypto.randomUUID()) {
  return withTenant(j.shop.shopId, (trx) => inspectReceiveJobLine(trx, {
    shopId: j.shop.shopId,
    receiveJobId: j.receiveJobId,
    lasyncroVariantId: j.variantId,
    receiveJobLineId: j.lineId,
    quantityAccepted: q.accepted,
    quantityRejected: q.rejected ?? 0,
    quantityMissing: 0,
    quantityDeferred: 0,
    quantityHeldRecoverable: q.held,
    deviceEventId,
    requireExplicitDisposition: true,
    inspectedBy: j.shop.userId,
  }));
}

/** Everything the held contract cares about, scoped to this fixture. */
async function snapshot(j: Job) {
  return withTenant(j.shop.shopId, async (trx) => {
    const line = await trx('receive_job_lines').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId }).first();
    const units = await trx('inventory_units').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .orderBy('receive_sequence').select('lasyncro_unit_id', 'receive_sequence', 'status', 'current_location_code', 'held_placed_at', 'label_printed_at');
    const tasks = await trx('problem_center_tasks').where({ shop_id: j.shop.shopId, source: 'receive', lasyncro_variant_id: j.variantId })
      .orderBy('lasyncro_unit_id').select('problem_task_id', 'source_exception_id', 'lasyncro_unit_id', 'quantity', 'problem_bin_location', 'exception_type', 'notes', 'status');
    const exceptions = await trx('receive_exceptions').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })
      .orderBy('raised_at').select('receive_exception_id', 'exception_type', 'quantity_affected', 'accounting_role', 'counts_toward_shortfall', 'disposition', 'superseded_at', 'notes');
    const movements = await trx('inventory_movements').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId }).count('* as n').first();
    const truth = await trx('inventory_truth').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId }).sum('on_hand_quantity as n').first();
    const stow = await trx('stow_tasks').where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId }).count('* as n').first();
    const job = await trx('receive_jobs').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).first('status', 'units_inspected', 'units_accepted', 'units_rejected');
    return {
      line,
      units,
      held: units.filter((u: any) => u.status === 'held'),
      accepted: units.filter((u: any) => u.status !== 'held'),
      tasks,
      exceptions,
      movements: Number(movements?.n ?? 0),
      truth: Number(truth?.n ?? 0),
      stowTasks: Number(stow?.n ?? 0),
      jobStatus: job.status as string,
      counters: { inspected: Number(job.units_inspected), accepted: Number(job.units_accepted), rejected: Number(job.units_rejected) },
      finalizations: await trx('receive_reconciliation_finalizations')
        .where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).select('*'),
      finalizationLines: await trx('receive_reconciliation_finalization_lines')
        .where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId }).select('*'),
    };
  });
}

function expectNoHeldSideEffects(s: Awaited<ReturnType<typeof snapshot>>) {
  expect(s.held).toHaveLength(0);
  expect(s.tasks).toHaveLength(0);
  expect(s.exceptions.filter((e: any) => e.disposition === 'recoverable_held' && e.superseded_at == null)).toHaveLength(0);
  expect(Number(s.line.quantity_held_recoverable ?? 0)).toBe(0);
}

/** C1 post-state, reused by C2–C4: accepted a, held h, no stock effect. */
function expectHeldCapture(s: Awaited<ReturnType<typeof snapshot>>, a: number, h: number, exceptionIdsByUnit: string[]) {
  expect(s.line.inspection_complete).toBe(true);
  expect(Number(s.line.quantity_accepted)).toBe(a);
  expect(Number(s.line.quantity_held_recoverable)).toBe(h);
  expect(Number(s.line.quantity_delivered)).toBe(a + Number(s.line.quantity_rejected) + h);
  expect(s.counters).toEqual({ inspected: a + Number(s.line.quantity_rejected) + h, accepted: a, rejected: Number(s.line.quantity_rejected) });
  expect(s.accepted.map((u: any) => u.receive_sequence)).toEqual(Array.from({ length: a }, (_, i) => i + 1));
  expect(s.held.map((u: any) => u.receive_sequence)).toEqual(Array.from({ length: h }, (_, i) => a + i + 1));
  for (const u of s.held) {
    expect(u.current_location_code).toBeNull();
    expect(u.held_placed_at).toBeNull();
  }
  expect(new Set(s.units.map((u: any) => u.lasyncro_unit_id)).size).toBe(a + h);

  // One quantity-1 task per held LSU, no problem bin (custody is S4-4), lineage kept.
  expect(s.tasks).toHaveLength(h);
  const bySeq = [...s.held].sort((x: any, y: any) => x.receive_sequence - y.receive_sequence);
  bySeq.forEach((unit: any, i: number) => {
    const task = s.tasks.find((t: any) => t.lasyncro_unit_id === unit.lasyncro_unit_id);
    expect(task).toEqual(expect.objectContaining({ quantity: 1, problem_bin_location: null, status: 'open', source_exception_id: exceptionIdsByUnit[i] }));
  });

  // Held units are never stock: no movement, truth, or Stow task (close never ran).
  expect(s.movements).toBe(0);
  expect(s.truth).toBe(0);
  expect(s.stowTasks).toBe(0);
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

describe('S4-3B recoverable held capture', () => {
  it('C1 — per-line defect held=2 mints 2 held LSUs and 2 linked quantity-1 tasks with no stock effect', async () => {
    const j = await openJob(shopA, 5);
    await confirmCount(j, 3);
    const exceptionId = await seedHeldEvidence(j, 'defect', 2, 'cracked casing');

    await inspect(j, { accepted: 3, held: 2 });

    const s = await snapshot(j);
    expectHeldCapture(s, 3, 2, [exceptionId, exceptionId]);
    expect(Number(s.line.quantity_delivered)).toBe(5);
    expect(s.tasks.every((t: any) => t.exception_type === 'defect' && t.notes === 'cracked casing')).toBe(true);
    // Immutable evidence is untouched by capture.
    expect(s.exceptions).toEqual([expect.objectContaining({
      receive_exception_id: exceptionId, disposition: 'recoverable_held', accounting_role: null,
      counts_toward_shortfall: false, superseded_at: null, quantity_affected: 2,
    })]);
  });

  it('C2 — grouped finalization with recoverable_held new exceptions writes held to 0225 with the same post-state', async () => {
    const j = await openJob(shopA, 4);
    await confirmCount(j, 2);
    const raw = [{
      receive_job_line_id: j.lineId,
      quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
      quantity_held_recoverable: 2,
      new_exceptions: [
        { exception_type: 'packaging_damage', quantity_affected: 1, disposition: 'recoverable_held', notes: 'torn box' },
        { exception_type: 'defect', quantity_affected: 1, disposition: 'recoverable_held', notes: 'scratched' },
      ],
    }];
    const lines = parseGroupedLines(raw, { allowRecoverableHeld: true });
    const finalizationEvent = crypto.randomUUID();
    const revision = await withTenant(j.shop.shopId, (trx) => saveReconciliationDraft(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, baseRevisionId: null,
      deviceEventId: crypto.randomUUID(), lines, actorId: j.shop.userId,
    }));
    const finalize = (submitted = lines) => withTenant(j.shop.shopId, (trx) => finalizeReconciliation(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, currentRevisionId: revision.revision_id,
      deviceEventId: finalizationEvent, lines: submitted, actorId: j.shop.userId,
    }));
    const result = await finalize();
    expect(result.status).toBe('finalized');
    const first = await snapshot(j);
    expect(await finalize()).toEqual(result);
    expect(await snapshot(j)).toEqual(first);
    await expect(finalize(lines.map((line) => ({ ...line, quantity_held_recoverable: 1, quantity_rejected: 1 }))))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'RECEIVE_RECONCILIATION_REPLAY_CONFLICT' });
    expect(await snapshot(j)).toEqual(first);

    const s = await snapshot(j);
    const created = s.exceptions.filter((e: any) => e.disposition === 'recoverable_held');
    expect(created).toHaveLength(2);
    for (const e of created) expect(e).toEqual(expect.objectContaining({ accounting_role: null, counts_toward_shortfall: false }));
    // Units follow raised_at, then receive_exception_id (4a); both rows share one raised_at window.
    const ordered = [...created].sort((a: any, b: any) =>
      (new Date(a.raised_at ?? 0).getTime() - new Date(b.raised_at ?? 0).getTime())
      || String(a.receive_exception_id).localeCompare(String(b.receive_exception_id)));
    const exceptionOrder = await withTenant(j.shop.shopId, (trx) => trx('receive_exceptions')
      .whereIn('receive_exception_id', ordered.map((e: any) => e.receive_exception_id))
      .orderBy([{ column: 'raised_at' }, { column: 'receive_exception_id' }]).pluck('receive_exception_id'));
    expectHeldCapture(s, 2, 2, exceptionOrder);

    const finalLine = await withTenant(j.shop.shopId, (trx) =>
      trx('receive_reconciliation_finalization_lines').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId }).first());
    expect(finalLine).toEqual(expect.objectContaining({
      quantity_accepted: 2, quantity_rejected: 0, quantity_held_recoverable: 2,
      quantity_missing: 0, quantity_deferred: 0, quantity_expected: 4, quantity_overage_approved: 0,
    }));
  });

  it('C2/4b — payloads without disposition keep the historical canonical form and hash', () => {
    const lineId = crypto.randomUUID();
    const legacy = [{
      receive_job_line_id: lineId, quantity_accepted: 3, quantity_rejected: 1, quantity_missing: 0, quantity_deferred: 0,
      new_exceptions: [{ exception_type: 'defect', quantity_affected: 1, notes: 'dent' }],
    }];
    const parsed = parseGroupedLines(legacy);
    expect(Object.keys(parsed[0].new_exceptions[0])).toEqual(['exception_type', 'quantity_affected', 'accounting_role', 'notes']);
    const historical = [{
      receive_job_line_id: lineId.toLowerCase(), quantity_accepted: 3, quantity_rejected: 1, quantity_missing: 0, quantity_deferred: 0,
      quantity_held_recoverable: 0,
      new_exceptions: [{ exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall', notes: 'dent' }],
      existing_exception_ids: [],
    }];
    const sha = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
    expect(sha(parsed)).toBe(sha(historical));
  });

  it('C2/4b — a persisted legacy draft replays and finalizes with its original hash', async () => {
    const j = await openJob(shopA, 4);
    await confirmCount(j, 3);
    // Historical canonical shape is built independently of the current parser.
    const historical = [{
      receive_job_line_id: j.lineId.toLowerCase(), quantity_accepted: 3, quantity_rejected: 1,
      quantity_missing: 0, quantity_deferred: 0, quantity_held_recoverable: 0,
      new_exceptions: [{ exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall', notes: 'dent' }],
      existing_exception_ids: [],
    }];
    const storedHash = crypto.createHash('sha256').update(JSON.stringify(historical)).digest('hex');
    const draftEvent = crypto.randomUUID();
    const original = await withTenant(j.shop.shopId, async (trx) => {
      const [row] = await trx('receive_reconciliation_revisions').insert({
        shop_id: j.shop.shopId, receive_job_id: j.receiveJobId, revision_number: 1,
        base_revision_id: null, device_event_id: draftEvent, payload: JSON.stringify(historical),
        payload_hash: storedHash, created_by: j.shop.userId,
      }).returning('*');
      return row;
    });
    const lines = parseGroupedLines(historical);
    expect(Object.prototype.hasOwnProperty.call(lines[0].new_exceptions[0], 'disposition')).toBe(false);
    expect(crypto.createHash('sha256').update(JSON.stringify(lines)).digest('hex')).toBe(original.payload_hash);
    const replay = await withTenant(j.shop.shopId, (trx) => saveReconciliationDraft(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, baseRevisionId: null,
      deviceEventId: draftEvent, lines, actorId: j.shop.userId,
    }));
    expect(replay.revision_id).toBe(original.revision_id);
    const finalized = await withTenant(j.shop.shopId, (trx) => finalizeReconciliation(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, currentRevisionId: original.revision_id,
      deviceEventId: crypto.randomUUID(), lines, actorId: j.shop.userId,
    }));
    expect(finalized.status).toBe('finalized');
    const persisted = await withTenant(j.shop.shopId, (trx) => trx('receive_reconciliation_revisions')
      .where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).select('*'));
    expect(persisted).toEqual([original]);
    expect(persisted[0].payload_hash).toBe(storedHash);
    expectNoHeldSideEffects(await snapshot(j));
  });

  it('C1/C2 — failure after capture rolls back per-line and grouped transaction state', async () => {
    for (const grouped of [false, true]) {
      const j = await openJob(shopA, 3);
      await confirmCount(j, 1);
      const exceptionId = grouped ? null : await seedHeldEvidence(j, 'defect', 2);
      const lines = parseGroupedLines([{
        receive_job_line_id: j.lineId, quantity_accepted: 1, quantity_rejected: 0,
        quantity_missing: 0, quantity_deferred: 0, quantity_held_recoverable: 2,
        new_exceptions: grouped ? [{ exception_type: 'defect', quantity_affected: 2, disposition: 'recoverable_held', notes: 'cracked' }] : [],
        existing_exception_ids: exceptionId ? [exceptionId] : [],
      }], { allowRecoverableHeld: true });
      const revision = grouped ? await withTenant(j.shop.shopId, (trx) => saveReconciliationDraft(trx, {
        shopId: j.shop.shopId, receiveJobId: j.receiveJobId, baseRevisionId: null,
        deviceEventId: crypto.randomUUID(), lines, actorId: j.shop.userId,
      })) : null;
      const before = await snapshot(j);
      const sentinel = new Error('S4_3B_CAPTURE_ROLLBACK_SENTINEL');
      await expect(withTenant(j.shop.shopId, async (trx) => {
        if (revision) {
          await finalizeReconciliation(trx, {
            shopId: j.shop.shopId, receiveJobId: j.receiveJobId, currentRevisionId: revision.revision_id,
            deviceEventId: crypto.randomUUID(), lines, actorId: j.shop.userId,
          });
        } else {
          await inspectReceiveJobLine(trx, {
            shopId: j.shop.shopId, receiveJobId: j.receiveJobId, receiveJobLineId: j.lineId,
            lasyncroVariantId: j.variantId, quantityAccepted: 1, quantityRejected: 0,
            quantityMissing: 0, quantityDeferred: 0, quantityHeldRecoverable: 2,
            deviceEventId: crypto.randomUUID(), requireExplicitDisposition: true, inspectedBy: j.shop.userId,
          });
        }
        // Prove the failure occurs after actual SQL writes, using the SAME trx.
        const units = await trx('inventory_units').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId });
        const held = units.filter((u: any) => u.status === 'held');
        expect(held).toHaveLength(2);
        const tasks = await trx('problem_center_tasks').where({ shop_id: j.shop.shopId, source: 'receive' })
          .whereIn('lasyncro_unit_id', held.map((u: any) => u.lasyncro_unit_id));
        expect(tasks).toHaveLength(2);
        const job = await trx('receive_jobs').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).first();
        expect(Number(job.units_inspected)).toBe(3);
        if (revision) {
          expect(await trx('receive_reconciliation_finalizations').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId })).toHaveLength(1);
          expect(await trx('receive_reconciliation_finalization_lines').where({ shop_id: j.shop.shopId, receive_job_line_id: j.lineId })).toHaveLength(1);
        }
        throw sentinel;
      })).rejects.toBe(sentinel);
      // Exact snapshots include line state, counters, exceptions, finalization,
      // accepted/held LSUs, tasks, truth, movements and Stow.
      expect(await snapshot(j)).toEqual(before);
      expect(before.units).toHaveLength(0);
      expect(before.tasks).toHaveLength(0);
      expect(before.finalizations).toHaveLength(0);
      expect(before.finalizationLines).toHaveLength(0);
      expect(before.movements).toBe(0);
      expect(before.truth).toBe(0);
    }
  });

  it('C1/C3 — Receive task identity is mandatory, quantity is one and lineage conflicts fail closed', async () => {
    const j = await openJob(shopA, 3);
    await confirmCount(j, 1);
    const exceptionId = await seedHeldEvidence(j, 'defect', 1, 'primary defect');
    const conflictingException = await seedHeldEvidence(j, 'packaging_damage', 1, 'different primary lineage');
    await inspect(j, { accepted: 1, held: 2 });
    const before = await snapshot(j);
    const task = before.tasks.find((t: any) => t.source_exception_id === exceptionId)!;
    const valid = {
      shopId: j.shop.shopId, source: 'receive' as const, sourceExceptionId: exceptionId,
      lasyncroUnitId: task.lasyncro_unit_id, lasyncroVariantId: j.variantId,
      quantity: 1, exceptionType: 'defect', notes: 'primary defect',
    };
    for (const invalid of [
      { ...valid, lasyncroUnitId: undefined }, { ...valid, lasyncroUnitId: '' },
      { ...valid, sourceExceptionId: undefined as unknown as string }, { ...valid, sourceExceptionId: '' },
      { ...valid, quantity: 0 }, { ...valid, quantity: 2 }, { ...valid, quantity: 1.5 },
    ]) {
      await expect(withTenant(j.shop.shopId, (trx) => createProblemCenterTask(trx, invalid)))
        .rejects.toThrow(/PROBLEM_TASK_(RECEIVE_UNIT|QUANTITY)_INVALID/);
    }
    const reused = await withTenant(j.shop.shopId, (trx) => createProblemCenterTask(trx, valid));
    expect(reused).toEqual({ problem_task_id: task.problem_task_id, created: false, problem_bin_location: null });
    await expect(withTenant(j.shop.shopId, (trx) => createProblemCenterTask(trx, {
      ...valid, sourceExceptionId: conflictingException,
    }))).rejects.toThrow('PROBLEM_TASK_RECEIVE_UNIT_CONFLICT');
    const after = await snapshot(j);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.units).toEqual(before.units);
    expect(after.counters).toEqual(before.counters);
    expect(after.movements).toBe(0);
    expect(after.truth).toBe(0);
  });

  it('C3 — replaying the same inspect device event mints no extra LSU or task', async () => {
    const j = await openJob(shopA, 4);
    await confirmCount(j, 2);
    const exceptionId = await seedHeldEvidence(j, 'packaging_damage', 2);
    const event = crypto.randomUUID();

    await inspect(j, { accepted: 2, held: 2 }, event);
    const first = await snapshot(j);
    await inspect(j, { accepted: 2, held: 2 }, event);
    const replayed = await snapshot(j);

    expectHeldCapture(replayed, 2, 2, [exceptionId, exceptionId]);
    expect(replayed.units).toEqual(first.units);
    expect(replayed.tasks).toEqual(first.tasks);
    await expect(inspect(j, { accepted: 2, held: 1, rejected: 1 }, event))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'RECEIVE_HELD_EVIDENCE_MISMATCH' });
    expect(await snapshot(j)).toEqual(first);
    // A different event on the finished line is refused, never a second capture.
    await expect(inspect(j, { accepted: 2, held: 2 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await snapshot(j)).tasks).toEqual(first.tasks);
  });

  it('C4 — concurrent per-line inspects, and inspect vs grouped finalize, yield exactly one capture', async () => {
    // (a) two inspects with distinct events race on the same line.
    const a = await openJob(shopA, 3);
    await confirmCount(a, 1);
    const aException = await seedHeldEvidence(a, 'defect', 2);
    const raced = await Promise.allSettled([inspect(a, { accepted: 1, held: 2 }), inspect(a, { accepted: 1, held: 2 })]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = raced.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ statusCode: 409 });
    expectHeldCapture(await snapshot(a), 1, 2, [aException, aException]);

    // (b) per-line inspect races a grouped finalization referencing the same evidence.
    const b = await openJob(shopA, 3);
    await confirmCount(b, 1);
    const bException = await seedHeldEvidence(b, 'defect', 2);
    const lines = parseGroupedLines([{
      receive_job_line_id: b.lineId, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
      quantity_held_recoverable: 2, existing_exception_ids: [bException],
    }], { allowRecoverableHeld: true });
    const revision = await withTenant(b.shop.shopId, (trx) => saveReconciliationDraft(trx, {
      shopId: b.shop.shopId, receiveJobId: b.receiveJobId, baseRevisionId: null,
      deviceEventId: crypto.randomUUID(), lines, actorId: b.shop.userId,
    }));
    const outcomes = await Promise.allSettled([
      inspect(b, { accepted: 1, held: 2 }),
      withTenant(b.shop.shopId, (trx) => finalizeReconciliation(trx, {
        shopId: b.shop.shopId, receiveJobId: b.receiveJobId, currentRevisionId: revision.revision_id,
        deviceEventId: crypto.randomUUID(), lines, actorId: b.shop.userId,
      })),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
    expectHeldCapture(await snapshot(b), 1, 2, [bException, bException]);
    const finalized = await withTenant(b.shop.shopId, (trx) =>
      trx('receive_reconciliation_finalization_lines').where({ shop_id: b.shop.shopId, receive_job_line_id: b.lineId }).first());
    if (outcomes[1].status === 'fulfilled') expect(Number(finalized.quantity_held_recoverable)).toBe(2);
    else expect(finalized).toBeUndefined();
  });

  it('C5 — held is never shortfall; evidence mismatch and illegal shapes are refused without side effects', async () => {
    const j = await openJob(shopA, 5);
    await confirmCount(j, 3);
    await seedHeldEvidence(j, 'defect', 2);

    // Projection: a recoverable defect is delivered stock, not shortfall (audit F1).
    const projection = await withTenant(j.shop.shopId, (trx) => receiveLineReconciliationState(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, receiveJobLineId: j.lineId, expected: 5, sellable: 3,
    }));
    expect(projection.accounted).toBe(0);
    expect(projection.allocations).toEqual([expect.objectContaining({ exception_type: 'defect', counts_toward_shortfall: false })]);

    // Held must equal the active primary evidence exactly — neither less nor zero.
    await expect(inspect(j, { accepted: 3, held: 1, rejected: 1 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'RECEIVE_HELD_EVIDENCE_MISMATCH' });
    await expect(inspect(j, { accepted: 3, held: 0, rejected: 2 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'RECEIVE_HELD_EVIDENCE_MISMATCH' });
    const after = await snapshot(j);
    expect(after.line.inspection_complete).toBe(false);
    expect(after.units).toHaveLength(0);
    expect(after.tasks).toHaveLength(0);

    // Parser: type, role and disposition are explicit (0224 / K2).
    const base = { receive_job_line_id: j.lineId, quantity_accepted: 3, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0, quantity_held_recoverable: 2 };
    const parseWith = (e: Record<string, unknown>) => () => parseGroupedLines([{ ...base, new_exceptions: [e] }], { allowRecoverableHeld: true });
    expect(parseWith({ exception_type: 'missing_item', quantity_affected: 2, disposition: 'recoverable_held' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(parseWith({ exception_type: 'wrong_item', quantity_affected: 2, disposition: 'recoverable_held' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(parseWith({ exception_type: 'defect', quantity_affected: 2, disposition: 'recoverable_held', accounting_role: 'shortfall' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(parseWith({ exception_type: 'defect', quantity_affected: 2, disposition: 'salvage' })).toThrow(expect.objectContaining({ statusCode: 400 }));

    // Database authority: 0224 refuses a recoverable_held row that claims shortfall.
    await expect(withTenant(j.shop.shopId, (trx) => trx('receive_exceptions').insert({
      shop_id: j.shop.shopId, receive_job_id: j.receiveJobId, receive_job_line_id: j.lineId,
      lasyncro_variant_id: j.variantId, exception_type: 'defect', quantity_affected: 1,
      accounting_role: 'shortfall', counts_toward_shortfall: true, disposition: 'recoverable_held',
      raised_by: j.shop.userId, raised_at: new Date(),
    }))).rejects.toMatchObject({ code: '23514' });
  });

  it('C6 — Recount before inspection supersedes active held evidence and keeps immutable history', async () => {
    const j = await openJob(shopA, 4);
    await confirmCount(j, 2);
    const exceptionId = await seedHeldEvidence(j, 'packaging_damage', 2, 'crushed');
    const before = (await snapshot(j)).exceptions[0];

    const recount = await withTenant(j.shop.shopId, (trx) => recountReceiveJobLine(trx, {
      shopId: j.shop.shopId, receiveJobId: j.receiveJobId, receiveJobLineId: j.lineId,
      recountEventId: crypto.randomUUID(), recountedBy: j.shop.userId,
    }));
    expect(recount.superseded_exception_ids).toEqual([exceptionId]);

    const s = await snapshot(j);
    expect(s.exceptions).toHaveLength(1);
    const history = s.exceptions[0];
    expect(history.superseded_at).not.toBeNull();
    // Only supersession provenance changed; the evidence itself is preserved.
    expect({ ...history, superseded_at: null }).toEqual({ ...before, superseded_at: null });

    // No stale held accounting: the old evidence can no longer back a held capture.
    await confirmCount(j, 2);
    await expect(inspect(j, { accepted: 2, held: 2 })).rejects.toMatchObject({ statusCode: 409, errorCode: 'RECEIVE_HELD_EVIDENCE_MISMATCH' });
    const afterRefusal = await snapshot(j);
    expectNoHeldSideEffects(afterRefusal);
    expect(afterRefusal.exceptions).toEqual(s.exceptions);
    expect(afterRefusal.movements).toBe(0);
    expect(afterRefusal.truth).toBe(0);
    expect(afterRefusal.stowTasks).toBe(0);
  });

  it('C7 — unacknowledged held labels block readiness, acknowledgement clears it, and close stays 409', async () => {
    const j = await openJob(shopA, 3);
    await confirmCount(j, 1);
    await seedHeldEvidence(j, 'defect', 2);
    await inspect(j, { accepted: 1, held: 2 });

    const readiness = () => withTenant(j.shop.shopId, (trx) => evaluateReceiveJobBarcodeReadiness(trx, j.shop.shopId, j.receiveJobId));
    const blocked = await readiness();
    expect(blocked.ready).toBe(false);
    expect(blocked.lines[0]).toEqual(expect.objectContaining({ reason: 'held_labels_outstanding', quantityHeld: 2, heldUnitCount: 2, heldLabelledCount: 0 }));
    expect((await snapshot(j)).jobStatus).toBe('barcode_assignment');

    const view = await request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`).set(auth(j.shop.token));
    expect(view.status).toBe(200);
    expect(view.body.lines[0].awaiting_label_ack).toBe(true);

    const heldIds = (await snapshot(j)).held.map((u: any) => u.lasyncro_unit_id);
    await withTenant(j.shop.shopId, (trx) => markLabelsPrinted(trx, j.shop.shopId, heldIds));
    const cleared = await readiness();
    expect(cleared.lines[0].heldLabelledCount).toBe(2);
    expect(cleared.lines[0].reason).not.toMatch(/^held_/);
    expect(cleared.ready).toBe(true);

    // The S4-4 close gate is intact: a Receive holding units cannot close yet.
    const close = await request(app).post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
      .set(auth(j.shop.token)).send({ actual_delivery_date: DELIVERY_DATE });
    expect(close.status).toBe(409);
    const s = await snapshot(j);
    expect(s.jobStatus).not.toBe('closed');
    expect(s.movements).toBe(0);
    expect(s.truth).toBe(0);
    expect(s.stowTasks).toBe(0);
  });

  it('C8 — sf_app tenant isolation: owning shop sees held units and tasks, another shop sees none and cannot capture', async () => {
    const role = await withTenant(shopA.shopId, (trx) => trx.raw(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`));
    expect(role.rows[0]).toEqual({ u: 'sf_app', rolsuper: false, rolbypassrls: false });

    const j = await openJob(shopA, 3);
    await confirmCount(j, 1);
    await seedHeldEvidence(j, 'defect', 2);
    await inspect(j, { accepted: 1, held: 2 });
    const owned = await snapshot(j);
    expect(owned.held).toHaveLength(2);
    expect(owned.tasks).toHaveLength(2);
    const heldIds = owned.held.map((u: any) => u.lasyncro_unit_id);

    const foreign = await withTenant(shopB.shopId, async (trx) => ({
      units: await trx('inventory_units').whereIn('lasyncro_unit_id', heldIds).select('id'),
      tasks: await trx('problem_center_tasks').whereIn('lasyncro_unit_id', heldIds).select('problem_task_id'),
      exceptions: await trx('receive_exceptions').where({ receive_job_line_id: j.lineId }).select('receive_exception_id'),
    }));
    expect(foreign).toEqual({ units: [], tasks: [], exceptions: [] });

    // Shop B cannot drive a capture on shop A's Receive.
    await expect(withTenant(shopB.shopId, (trx) => inspectReceiveJobLine(trx, {
      shopId: shopB.shopId, receiveJobId: j.receiveJobId, lasyncroVariantId: j.variantId, receiveJobLineId: j.lineId,
      quantityAccepted: 1, quantityRejected: 0, quantityMissing: 0, quantityDeferred: 0, quantityHeldRecoverable: 2,
      deviceEventId: crypto.randomUUID(), requireExplicitDisposition: true, inspectedBy: shopB.userId,
    }))).rejects.toMatchObject({ statusCode: 404 });
    expect((await snapshot(j)).tasks).toEqual(owned.tasks);

    // LSU identity is unique per shop across every unit this shop holds.
    const dupes = await withTenant(shopA.shopId, (trx) => trx('inventory_units')
      .where({ shop_id: shopA.shopId }).groupBy('lasyncro_unit_id').havingRaw('COUNT(*) > 1').select('lasyncro_unit_id'));
    expect(dupes).toEqual([]);
  });

  it('C9 — public routes refuse recoverable-held intent with 409 and persist nothing held; ordinary requests still work', async () => {
    const j = await openJob(shopB, 4);
    await confirmCount(j, 2);
    const base = `/api/v1/suppliers/receive-jobs/${j.receiveJobId}`;
    const heldLine = {
      receive_job_line_id: j.lineId, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
    };

    const report = await request(app).post(`${base}/exception`).set(auth(j.shop.token)).send({
      lasyncro_variant_id: j.variantId, receive_job_line_id: j.lineId, exception_type: 'defect',
      quantity_affected: 2, disposition: 'recoverable_held', device_event_id: crypto.randomUUID(),
    });
    const inspectRes = await request(app).post(`${base}/inspect`).set(auth(j.shop.token)).send({
      receive_job_line_id: j.lineId, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
      quantity_held_recoverable: 2, device_event_id: crypto.randomUUID(),
    });
    const draftHeld = await request(app).put(`${base}/reconciliation/draft`).set(auth(j.shop.token)).send({
      base_revision_id: null, device_event_id: crypto.randomUUID(), lines: [{ ...heldLine, quantity_held_recoverable: 2 }],
    });
    const draftDisposition = await request(app).put(`${base}/reconciliation/draft`).set(auth(j.shop.token)).send({
      base_revision_id: null, device_event_id: crypto.randomUUID(),
      lines: [{ ...heldLine, quantity_held_recoverable: 0, quantity_missing: 2,
        new_exceptions: [{ exception_type: 'defect', quantity_affected: 2, disposition: 'recoverable_held' }] }],
    });
    const finalizeHeld = await request(app).post(`${base}/reconciliation/finalize`).set(auth(j.shop.token)).send({
      current_revision_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(), lines: [{ ...heldLine, quantity_held_recoverable: 2 }],
    });
    for (const res of [report, inspectRes, draftHeld, draftDisposition, finalizeHeld]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RECEIVE_RECOVERABLE_HELD_NOT_ENABLED');
    }
    const refused = await snapshot(j);
    expectNoHeldSideEffects(refused);
    expect(refused.exceptions).toHaveLength(0);
    expect(refused.line.inspection_complete).toBe(false);
    const revisions = await withTenant(j.shop.shopId, (trx) =>
      trx('receive_reconciliation_revisions').where({ shop_id: j.shop.shopId, receive_job_id: j.receiveJobId }).count('* as n').first());
    expect(Number(revisions?.n)).toBe(0);

    // Controls: ordinary, non-held requests are not blocked.
    const ordinaryReport = await request(app).post(`${base}/exception`).set(auth(j.shop.token)).send({
      lasyncro_variant_id: j.variantId, receive_job_line_id: j.lineId, exception_type: 'packaging_damage',
      quantity_affected: 1, notes: 'scuffed sleeve', device_event_id: crypto.randomUUID(),
    });
    expect(ordinaryReport.status).toBe(201);
    const draft = await request(app).put(`${base}/reconciliation/draft`).set(auth(j.shop.token)).send({
      base_revision_id: null, device_event_id: crypto.randomUUID(),
      lines: [{ ...heldLine, quantity_missing: 2, new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2 }] }],
    });
    expect(draft.status).toBe(200);
    const finalize = await request(app).post(`${base}/reconciliation/finalize`).set(auth(j.shop.token)).send({
      current_revision_id: draft.body.revision_id, device_event_id: crypto.randomUUID(),
      lines: [{ ...heldLine, quantity_missing: 2, new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2 }] }],
    });
    expect(finalize.status).toBe(200);
    expectNoHeldSideEffects(await snapshot(j));
  });
});
