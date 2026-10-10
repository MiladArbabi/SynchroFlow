/**
 * GH-1085 / BARCODE-LIFECYCLE-01 — Slice B.
 *
 * Barcode-less accepted stock must receive LSU- identities at inspection, and
 * must NOT become Stow-ready until practical physical scan identity exists.
 *
 * CANONICAL RULE — an accepted line is Stow-ready when:
 *     quantity_accepted = 0
 *   OR variant has a usable external physical barcode (variants.barcode)
 *   OR every accepted inventory_unit has label_printed_at IS NOT NULL
 *
 * Why LSP- does not count: variants.lasyncro_barcode is catalog identity, one
 * value shared by every unit of the SKU. It cannot tell two physical units
 * apart on a shelf. LSU- is the per-unit identity, and a printed LSU- label is
 * the only evidence that the unit in the box can actually be scanned. Producing
 * a PDF proves nothing physical; label_printed_at is the acknowledgement.
 *
 * Out of scope, deliberately: computeCoverage() (GH-1091 owns it), any UI, and
 * any new readiness schema field — receive_job_status already carries
 * 'barcode_assignment' and 'stow_ready' (migration 0097).
 *
 * Real services against the disposable synchroflow_test_* database
 * (`npm run test:integration`). closeReceiveJob is driven through the same
 * transaction shape production uses (httpCloseReceiveJob: db.transaction +
 * SET LOCAL app.current_tenant, which is exactly what withTenant does), so a
 * rejection is proven to roll the whole close back rather than merely throwing.
 */
import crypto from 'crypto';
import request from 'supertest';
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
import { markLabelsPrinted } from 'api-src/services/wms/inventoryUnit.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

/** generateLsuId → 'LSU-' + first 8 hex of a sha256. */
const LSU_PATTERN = /^LSU-[0-9a-f]{8}$/;

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the other wms integration suites) ─────────

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
  const shopDomain = `rbr1085-${label}-${Date.now()}.myshopify.com`;
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

/**
 * A genuinely mapped Shopify-backed variant, created through the real
 * ingestion path — never a placeholder or text-only inventory line.
 * `externalBarcode` is what the merchant/Shopify supplies in variants.barcode:
 * null for the barcode-less catalog Slice B is about, a real EAN for B6.
 */
async function seedMappedVariant(
  shopId: number,
  externalBarcode: string | null
): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/1085B${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/1085B${nonce}`,
          title: `GH1085 receive fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1085-RCV-${nonce}`,
                  barcode: externalBarcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/1085B${nonce}`,
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
  /** Needed only by B7, which drives the acknowledgement route over HTTP. */
  token: string;
  rootLocationCode: string;
  lasyncroVariantId: string;
  poId: string;
  poLineItemId: string;
  receiveJobId: string;
  receiveJobLineId: string;
  quantityOrdered: number;
}

/** supplier → PO → PO line → receive job, all through the real service. */
async function receiveFixture(opts: {
  externalBarcode: string | null;
  quantityOrdered: number;
}): Promise<ReceiveFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const shop = await provisionFt2Shop(crypto.randomUUID());
  const lasyncroVariantId = await seedMappedVariant(shop.shopId, opts.externalBarcode);

  const { poId, poLineItemId, receiveJobId, receiveJobLineId } = await withTenant(
    shop.shopId,
    async (trx) => {
      const [supplier] = await trx('suppliers')
        .insert({ shop_id: shop.shopId, name: `GH1085 supplier ${crypto.randomUUID()}` })
        .returning('id');
      const [po] = await trx('purchase_orders')
        .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'draft' })
        .returning('id');
      const [poLine] = await trx('purchase_order_line_items')
        .insert({
          po_id: po.id,
          shop_id: shop.shopId,
          lasyncro_variant_id: lasyncroVariantId,
          description: 'GH1085 barcode readiness line',
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
        poId: po.id as string,
        poLineItemId: poLine.id as string,
        receiveJobId: jobId,
        receiveJobLineId: jobLine!.receive_job_line_id as string,
      };
    }
  );

  // GH-1111: Receive execution mutations are protected until the assigned
  // operator has explicitly claimed the job. This suite tests barcode
  // readiness, not pre-claim ownership rejection, so establish the canonical
  // claimed state through the real route before returning the fixture.
  const claim = await request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set('Authorization', `Bearer ${shop.token}`)
    .send({});

  expect(claim.status).toBe(200);

  return {
    shopId: shop.shopId,
    userId: shop.userId,
    token: shop.token,
    rootLocationCode: shop.rootLocationCode,
    lasyncroVariantId,
    poId,
    poLineItemId,
    receiveJobId,
    receiveJobLineId,
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

/**
 * Real close path, in production's transaction shape. Any throw rolls back the
 * entire close, which is what makes the zero-side-effect assertions meaningful.
 */
function close(f: ReceiveFixture, actualDeliveryDate?: string) {
  return withTenant(f.shopId, (trx) =>
    closeReceiveJob(trx, {
      shopId: f.shopId,
      receiveJobId: f.receiveJobId,
      actualDeliveryDate,
      closedBy: f.userId,
    }));
}

/** Real label acknowledgement path. */
function acknowledgeLabels(f: ReceiveFixture, unitIds: string[]) {
  return withTenant(f.shopId, (trx) => markLabelsPrinted(trx, f.shopId, unitIds));
}

/** Every piece of state these contracts assert on, shop-scoped throughout. */
async function state(f: ReceiveFixture) {
  return withTenant(f.shopId, async (trx) => ({
    job: await trx('receive_jobs')
      .where({ shop_id: f.shopId, receive_job_id: f.receiveJobId })
      .first('status', 'closed_at', 'units_accepted', 'units_inspected', 'units_rejected'),

    line: await trx('receive_job_lines')
      .where({ shop_id: f.shopId, receive_job_line_id: f.receiveJobLineId })
      .first('quantity_expected', 'quantity_accepted', 'quantity_rejected', 'quantity_sellable_provisional', 'inspection_complete'),

    units: await trx('inventory_units')
      .where({ shop_id: f.shopId, receive_job_line_id: f.receiveJobLineId })
      .orderBy('receive_sequence')
      .select('lasyncro_unit_id', 'receive_sequence', 'label_printed_at', 'status'),

    poLine: await trx('purchase_order_line_items')
      .where({ shop_id: f.shopId, id: f.poLineItemId })
      .first('quantity_ordered', 'quantity_received'),

    inboundMovements: await trx('inventory_movements')
      .where({
        shop_id: f.shopId,
        reference_type: 'receive_job',
        reference_id: f.receiveJobId,
        movement_type: 'inbound_purchase',
      })
      .select('lasyncro_variant_id', 'quantity_delta', 'location_code'),

    rootTruth: await trx('inventory_truth')
      .where({
        shop_id: f.shopId,
        lasyncro_variant_id: f.lasyncroVariantId,
        location_code: f.rootLocationCode,
      })
      .first('on_hand_quantity', 'available_quantity'),

    stowTasks: await trx('stow_tasks')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.lasyncroVariantId })
      .select('quantity', 'status', 'trigger'),

    variant: await trx('variants')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.lasyncroVariantId })
      .first('barcode', 'lasyncro_barcode'),
  }));
}

/** Nothing from a refused close may survive. */
function expectNoCloseSideEffects(s: Awaited<ReturnType<typeof state>>) {
  expect(s.job!.status).not.toBe('closed');
  expect(s.job!.closed_at).toBeNull();
  expect(Number(s.poLine!.quantity_received)).toBe(0);
  expect(s.inboundMovements).toEqual([]);
  expect(s.rootTruth).toBeUndefined();
  expect(s.stowTasks).toEqual([]);
}

// ── B1 ──────────────────────────────────────────────────────────────────────

it('B1 — a barcode-less count receive still inspects and still mints one LSU- identity per accepted unit', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });

  await expect(inspect(f, 2)).resolves.toBeUndefined();

  const s = await state(f);

  expect(s.units).toHaveLength(2);
  expect(s.units.map((u: any) => u.receive_sequence)).toEqual([1, 2]);

  for (const unit of s.units) {
    expect(unit.lasyncro_unit_id).toMatch(LSU_PATTERN);
    // Nothing physical has happened yet — no label has been acknowledged.
    expect(unit.label_printed_at).toBeNull();
  }
  expect(new Set(s.units.map((u: any) => u.lasyncro_unit_id)).size).toBe(2);

  // The merchant never supplied a GTIN and we must not invent one.
  expect(s.variant!.barcode).toBeNull();
});

// ── B2 ──────────────────────────────────────────────────────────────────────

it('B2 — barcode-less accepted stock is not Stow-ready on inspection alone', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });

  await inspect(f, 2);

  const s = await state(f);

  // Inspection established WHAT arrived. It has not established that any of it
  // can be scanned, so the job owes a barcode-assignment step.
  expect(s.job!.status).toBe('barcode_assignment');
  expect(s.job!.status).not.toBe('stow_ready');

  // Nothing may be routed to a bin before it is identifiable.
  expect(s.stowTasks).toEqual([]);
});

// ── B3 ──────────────────────────────────────────────────────────────────────

it('B3 — close fails atomically while no LSU- label has been acknowledged', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
  await inspect(f, 2);

  const before = await state(f);
  expect(before.units).toHaveLength(2);
  expect(before.units.every((u: any) => u.label_printed_at === null)).toBe(true);

  await expect(close(f, '2026-09-14')).rejects.toThrow(/barcode|label/i);

  // The close ran inside production's transaction shape, so a rejection must
  // leave nothing behind at all.
  expectNoCloseSideEffects(await state(f));
});

// ── B4 ──────────────────────────────────────────────────────────────────────

it('B4 — partial label acknowledgement is not sufficient readiness', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
  await inspect(f, 2);

  const seeded = await state(f);
  expect(seeded.units).toHaveLength(2);

  // Exactly ONE unit acknowledged, through the real service. The second is
  // deliberately left alone — never hand-updated to fake readiness.
  await acknowledgeLabels(f, [seeded.units[0].lasyncro_unit_id]);

  const s = await state(f);
  expect(s.units[0].label_printed_at).not.toBeNull();
  expect(s.units[1].label_printed_at).toBeNull();

  // One labelled unit out of two means one unscannable unit on the shelf.
  expect(s.job!.status).not.toBe('stow_ready');

  await expect(close(f, '2026-09-14')).rejects.toThrow(/barcode|label/i);
  expectNoCloseSideEffects(await state(f));
});

// ── B5 ──────────────────────────────────────────────────────────────────────

it('B5 — acknowledging every accepted LSU- label unlocks Stow and allows close', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
  await inspect(f, 2);

  const seeded = await state(f);
  expect(seeded.units).toHaveLength(2);

  await acknowledgeLabels(f, seeded.units.map((u: any) => u.lasyncro_unit_id));

  const ready = await state(f);
  expect(ready.units.every((u: any) => u.label_printed_at !== null)).toBe(true);

  // Every accepted unit now carries physical scan identity.
  expect(ready.job!.status).toBe('stow_ready');

  await expect(close(f, '2026-09-14')).resolves.toBeUndefined();

  const s = await state(f);
  expect(s.job!.status).toBe('closed');
  expect(Number(s.poLine!.quantity_received)).toBe(2);

  expect(s.inboundMovements).toEqual([
    expect.objectContaining({
      lasyncro_variant_id: f.lasyncroVariantId,
      quantity_delta: 2,
      location_code: f.rootLocationCode,
    }),
  ]);

  expect(Number(s.rootTruth!.on_hand_quantity)).toBe(2);
  expect(Number(s.rootTruth!.available_quantity)).toBe(2);

  expect(s.stowTasks).toEqual([
    expect.objectContaining({ quantity: 2, trigger: 'inbound_stock' }),
  ]);
});

// ── B6 ──────────────────────────────────────────────────────────────────────

it('B6 — an existing external barcode satisfies readiness without forcing LSU- relabelling', async () => {
  // A BYO-barcode merchant: every unit already carries a scannable GTIN.
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 2 });

  await inspect(f, 2);

  const s = await state(f);

  // Per-unit identity is still minted for traceability …
  expect(s.units).toHaveLength(2);
  for (const unit of s.units) {
    expect(unit.lasyncro_unit_id).toMatch(LSU_PATTERN);
    // … but acknowledging an LSU- label is NOT required of this merchant.
    expect(unit.label_printed_at).toBeNull();
  }
  expect(s.variant!.barcode).toBe('5012345678900');

  // The external barcode already satisfies the readiness rule.
  expect(s.job!.status).toBe('stow_ready');

  await expect(close(f, '2026-09-14')).resolves.toBeUndefined();

  const after = await state(f);
  expect(after.job!.status).toBe('closed');
  expect(Number(after.poLine!.quantity_received)).toBe(2);
  expect(after.inboundMovements).toEqual([
    expect.objectContaining({
      lasyncro_variant_id: f.lasyncroVariantId,
      quantity_delta: 2,
      location_code: f.rootLocationCode,
    }),
  ]);
  expect(Number(after.rootTruth!.on_hand_quantity)).toBe(2);
  expect(after.stowTasks).toEqual([
    expect.objectContaining({ quantity: 2, trigger: 'inbound_stock' }),
  ]);
});

// ── B7 ──────────────────────────────────────────────────────────────────────

/**
 * B1–B6 prove the readiness SEMANTICS, but nothing in production calls
 * markLabelsPrinted(), so barcode-less stock can never actually cross
 * barcode_assignment → stow_ready. This contract is the missing operator
 * action: an explicit acknowledgement that the labels were printed and
 * attached.
 *
 * Acknowledgement is a POST, deliberately. GET /unit-labels returns a PDF, and
 * generating or downloading a PDF proves nothing about the physical box — it
 * must never be the thing that marks labels printed.
 */
const ACK_ROUTE = (lineId: string) =>
  `/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`;

const RECEIVE_JOB_ROUTE = (jobId: string) =>
  `/api/v1/suppliers/receive-jobs/${jobId}`;

const RECEIVE_EXCEPTION_ROUTE = (jobId: string) =>
  `/api/v1/suppliers/receive-jobs/${jobId}/exception`;

const RECEIVE_PROGRESS_ROUTE = (jobId: string, lineId: string) =>
  `/api/v1/suppliers/receive-jobs/${jobId}/lines/${lineId}/progress`;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function fetchReceiveJobLine(f: ReceiveFixture) {
  const response = await request(app)
    .get(RECEIVE_JOB_ROUTE(f.receiveJobId))
    .set(auth(f.token));

  expect(response.status).toBe(200);
  const line = response.body.lines.find(
    (candidate: any) => candidate.receive_job_line_id === f.receiveJobLineId
  );
  expect(line).toBeTruthy();
  return line;
}

function patchReceiveProgress(f: ReceiveFixture, quantity: number) {
  return request(app)
    .patch(RECEIVE_PROGRESS_ROUTE(f.receiveJobId, f.receiveJobLineId))
    .set(auth(f.token))
    .send({ quantity_sellable_provisional: quantity });
}

it('B7 — an operator can acknowledge a line\'s printed LSU- labels, which unlocks Stow', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
  await inspect(f, 2);

  const before = await state(f);
  expect(before.units).toHaveLength(2);
  expect(before.units.every((u: any) => u.label_printed_at === null)).toBe(true);

  const ack = await request(app)
    .post(ACK_ROUTE(f.receiveJobLineId))
    .set('Authorization', `Bearer ${f.token}`)
    .send({});

  expect(ack.status).toBe(200);

  const after = await state(f);

  // Every accepted unit on the line is acknowledged, through the canonical path.
  expect(after.units).toHaveLength(2);
  expect(after.units.every((u: any) => u.label_printed_at !== null)).toBe(true);

  // This line was the only outstanding barcode-less work, so the job is ready.
  expect(after.job!.status).toBe('stow_ready');

  // Tenant isolation: a foreign shop may not acknowledge this line.
  const stranger = await provisionFt2Shop(crypto.randomUUID());
  const foreign = await request(app)
    .post(ACK_ROUTE(f.receiveJobLineId))
    .set('Authorization', `Bearer ${stranger.token}`)
    .send({});

  expect(foreign.status).toBeGreaterThanOrEqual(400);
  expect(foreign.status).toBeLessThan(500);
});

it('B8 — supplier receive-job GET exposes canonical label-hold readiness before and after acknowledgement', async () => {
  const f = await receiveFixture({ externalBarcode: null, quantityOrdered: 2 });
  await inspect(f, 2);

  const before = await fetchReceiveJobLine(f);
  expect(before.awaiting_label_ack).toBe(true);
  expect(Number(before.accepted_unit_count)).toBe(2);
  expect(Number(before.labelled_unit_count)).toBe(0);
  expect(before.barcode_readiness_reason).toBe('labels_outstanding');

  const ack = await request(app)
    .post(ACK_ROUTE(f.receiveJobLineId))
    .set(auth(f.token))
    .send({});

  expect(ack.status).toBe(200);

  const after = await fetchReceiveJobLine(f);
  expect(after.awaiting_label_ack).toBe(false);
  expect(Number(after.labelled_unit_count)).toBe(Number(after.accepted_unit_count));
  expect(Number(after.labelled_unit_count)).toBe(2);
  expect(after.barcode_readiness_reason).not.toBe('labels_outstanding');
});

it('B9 — supplier receive-job GET projects canonical reported problems without changing receive quantities', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 3 });
  await inspect(f, 3);

  const before = await fetchReceiveJobLine(f);
  expect(Number(before.quantity_accepted)).toBe(3);
  expect(Number(before.quantity_rejected)).toBe(0);
  expect(before.reported_problems ?? []).toEqual([]);

  const report = await request(app)
    .post(RECEIVE_EXCEPTION_ROUTE(f.receiveJobId))
    .set(auth(f.token))
    .send({
      lasyncro_variant_id: f.lasyncroVariantId,
      receive_job_line_id: f.receiveJobLineId,
      exception_type: 'barcode_mismatch',
      quantity_affected: 1,
      notes: 'BAD-CODE',
    });

  expect(report.status).toBe(201);
  expect(report.body.receive_exception_id).toBeTruthy();

  const projected = await fetchReceiveJobLine(f);
  expect(Number(projected.quantity_accepted)).toBe(3);
  expect(Number(projected.quantity_rejected)).toBe(0);
  expect(projected.reported_problems).toEqual([
    expect.objectContaining({
      receive_exception_id: report.body.receive_exception_id,
      exception_type: 'barcode_mismatch',
      quantity_affected: 1,
      notes: 'BAD-CODE',
      resolved: false,
    }),
  ]);
  expect(projected.reported_problems[0].raised_at).toBeTruthy();

  const stranger = await provisionFt2Shop(crypto.randomUUID());
  const foreign = await request(app)
    .get(RECEIVE_JOB_ROUTE(f.receiveJobId))
    .set(auth(stranger.token));

  expect(foreign.status).toBe(404);
});

// ── Receive reconciliation accounting model ────────────────────────────────

async function reportReceiveProblem(
  f: ReceiveFixture,
  body: {
    exception_type: string;
    quantity_affected: number;
    notes?: string;
    accounting_role?: string;
    counts_toward_shortfall?: boolean;
  }
) {
  return request(app)
    .post(RECEIVE_EXCEPTION_ROUTE(f.receiveJobId))
    .set(auth(f.token))
    .send({
      lasyncro_variant_id: f.lasyncroVariantId,
      receive_job_line_id: f.receiveJobLineId,
      ...body,
    });
}

it('B10 — backend rejects short line completion when accounted shortfall is insufficient', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 3 });

  await expect(inspect(f, 2, 0)).rejects.toThrow(/shortfall|account/i);

  const persisted = await fetchReceiveJobLine(f);
  expect(Boolean(persisted.inspection_complete)).toBe(false);
});

it('B11 — backend accepts short line completion when accepted plus accounted shortfall equals expected', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 3 });

  const report = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(report.status).toBe(201);

  await expect(inspect(f, 2, 0)).resolves.toBeUndefined();

  const persisted = await fetchReceiveJobLine(f);
  expect(Number(persisted.quantity_accepted)).toBe(2);
  expect(Number(persisted.quantity_rejected)).toBe(0);
  expect(Boolean(persisted.inspection_complete)).toBe(true);
});

it('B12 — missing_item accounting does not require fake received inventory', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 1 });

  const report = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(report.status).toBe(201);

  await expect(inspect(f, 0, 0)).resolves.toBeUndefined();
  await expect(close(f, '2026-09-14')).resolves.toBeUndefined();

  const s = await state(f);
  expect(s.inboundMovements).toEqual([]);
  expect(s.rootTruth).toBeUndefined();
  expect(s.stowTasks).toEqual([]);
});

it('B13 — GET /receive-job restores durable reconciliation state', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 5 });

  const damaged = await reportReceiveProblem(f, {
    exception_type: 'defect',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  const missing = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(damaged.status).toBe(201);
  expect(missing.status).toBe(201);

  const line = await fetchReceiveJobLine(f);
  expect(line.reconciliation).toEqual(expect.objectContaining({
    expected: 5,
    sellable: 3,
    accounted: 2,
    unaccounted: 0,
    allocations: expect.arrayContaining([
      expect.objectContaining({ exception_type: 'defect', quantity_affected: 1, counts_toward_shortfall: true }),
      expect.objectContaining({ exception_type: 'missing_item', quantity_affected: 1, counts_toward_shortfall: true }),
    ]),
  }));
});

it('B14 — resolved receive problems remain part of historical accounting', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 2 });

  const report = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(report.status).toBe(201);

  await withTenant(f.shopId, (trx) =>
    trx('receive_exceptions')
      .where({ receive_exception_id: report.body.receive_exception_id, shop_id: f.shopId })
      .update({ resolved: true, resolved_at: new Date(), resolved_by: f.userId })
  );

  const line = await fetchReceiveJobLine(f);
  expect(line.reconciliation.allocations).toEqual([
    expect.objectContaining({
      receive_exception_id: report.body.receive_exception_id,
      exception_type: 'missing_item',
      resolved: true,
      counts_toward_shortfall: true,
    }),
  ]);
  expect(line.reconciliation.accounted).toBe(1);
});

it('B15 — missing_item and extra_item are distinct from legacy wrong_quantity', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 2 });

  const missing = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  const extra = await reportReceiveProblem(f, {
    exception_type: 'extra_item',
    quantity_affected: 1,
    accounting_role: 'overage',
    counts_toward_shortfall: false,
  });

  expect(missing.status).toBe(201);
  expect(extra.status).toBe(201);

  const projected = await fetchReceiveJobLine(f);
  expect(projected.reported_problems).toEqual(expect.arrayContaining([
    expect.objectContaining({ exception_type: 'missing_item' }),
    expect.objectContaining({ exception_type: 'extra_item' }),
  ]));
  expect(projected.reported_problems.map((p: any) => p.exception_type)).not.toContain('wrong_quantity');
});

it('B16 — barcode problem does not count toward shortfall accounting unless explicitly marked accounting', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 2 });

  const barcodeProblem = await reportReceiveProblem(f, {
    exception_type: 'barcode_mismatch',
    quantity_affected: 1,
    notes: 'BAD-CODE',
  });
  expect(barcodeProblem.status).toBe(201);

  await expect(inspect(f, 1, 0)).rejects.toThrow(/shortfall|account/i);

  const line = await fetchReceiveJobLine(f);
  expect(line.reconciliation).toEqual(expect.objectContaining({
    expected: 2,
    accounted: 0,
  }));
  expect(line.reconciliation.allocations).toEqual([
    expect.objectContaining({
      exception_type: 'barcode_mismatch',
      quantity_affected: 1,
      counts_toward_shortfall: false,
    }),
  ]);
});

it('B17 — overdelivery is not committed by direct line inspection without persisted overage approval', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 1 });

  await expect(inspect(f, 2, 0)).rejects.toThrow(/overdelivery|overage|approval/i);

  const persisted = await fetchReceiveJobLine(f);
  expect(Number(persisted.quantity_accepted)).toBe(0);
  expect(Boolean(persisted.inspection_complete)).toBe(false);
});

// GH-1108 / RECEIVE-OVERCOUNT-01 — the frontend "Accept extra" flow persists
// canonical overage evidence (extra_item / accounting_role=overage) through
// this exact real HTTP route BEFORE ever attempting inspection. This proves
// the other half of the B17 contract: once that evidence genuinely exists,
// the same real service call that B17 proved rejects now succeeds, and the
// resulting canonical Receive state (accepted quantity, minted units, job
// counters, and post-close inventory truth) truthfully reflects the
// approved overage rather than a mocked stand-in for onInspectLine.
it('B17b — persisted extra_item/overage evidence unlocks an expected+1 inspection, and canonical state reflects the accepted overage', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 1 });

  const approval = await reportReceiveProblem(f, {
    exception_type: 'extra_item',
    quantity_affected: 1,
    accounting_role: 'overage',
    notes: 'Accepted 1 extra unit during receive — approved by operator.',
  });
  expect(approval.status).toBe(201);

  await expect(inspect(f, 2, 0)).resolves.toBeUndefined();

  const persisted = await fetchReceiveJobLine(f);
  expect(Number(persisted.quantity_accepted)).toBe(2);
  expect(Number(persisted.quantity_rejected)).toBe(0);
  expect(Boolean(persisted.inspection_complete)).toBe(true);
  expect(persisted.reported_problems).toEqual(expect.arrayContaining([
    expect.objectContaining({
      receive_exception_id: approval.body.receive_exception_id,
      exception_type: 'extra_item',
      quantity_affected: 1,
    }),
  ]));

  const s = await state(f);
  expect(Number(s.line!.quantity_accepted)).toBe(2);
  expect(Boolean(s.line!.inspection_complete)).toBe(true);
  expect(s.units).toHaveLength(2);
  expect(Number(s.job!.units_accepted)).toBe(2);
  expect(s.job!.status).toBe('stow_ready');

  await expect(close(f, '2026-09-15')).resolves.toBeUndefined();

  const after = await state(f);
  expect(after.job!.status).toBe('closed');
  expect(Number(after.poLine!.quantity_received)).toBe(2);
  expect(after.inboundMovements).toEqual([
    expect.objectContaining({
      lasyncro_variant_id: f.lasyncroVariantId,
      quantity_delta: 2,
      location_code: f.rootLocationCode,
    }),
  ]);
  expect(Number(after.rootTruth!.on_hand_quantity)).toBe(2);
  expect(after.stowTasks).toEqual([
    expect.objectContaining({ quantity: 2, trigger: 'inbound_stock' }),
  ]);
});

// GH-1108 AUDIT CORRECTION — isPersistedOverageApproval previously treated
// exception_type='extra_item' alone as approval (OVERAGE_ACCOUNTING_TYPES
// fallback), so merely reporting an extra-item problem — without the
// operator ever choosing "Accept extra" — could satisfy overage_approved.
// Approval must be the explicit accounting_role='overage' evidence only.
it('B17c — an extra_item exception WITHOUT accounting_role=overage does not satisfy overage approval', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 1 });

  const report = await reportReceiveProblem(f, {
    exception_type: 'extra_item',
    quantity_affected: 1,
    // Deliberately no accounting_role — exception_type alone must not approve.
  });
  expect(report.status).toBe(201);

  await expect(inspect(f, 2, 0)).rejects.toThrow(/overdelivery|overage|approval/i);

  const persisted = await fetchReceiveJobLine(f);
  expect(Number(persisted.quantity_accepted)).toBe(0);
  expect(Boolean(persisted.inspection_complete)).toBe(false);
});

// The real "Report problem" frontend path never sends accounting_role for
// any exception_type (ReceiveSessionPage.handleReportProblem's onReportException
// call omits it entirely) — this mirrors that exact call shape rather than
// asserting only the minimal API-level case above.
it('B17d — the real Report Problem frontend call shape (extra_item, no accounting_role) never becomes overage approval', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 1 });

  const report = await reportReceiveProblem(f, {
    exception_type: 'extra_item',
    quantity_affected: 1,
    notes: '1 extra unit found during receive',
  });
  expect(report.status).toBe(201);

  await expect(inspect(f, 2, 0)).rejects.toThrow(/overdelivery|overage|approval/i);

  const persisted = await fetchReceiveJobLine(f);
  expect(Number(persisted.quantity_accepted)).toBe(0);
  expect(Boolean(persisted.inspection_complete)).toBe(false);
  expect(persisted.reported_problems).toEqual(expect.arrayContaining([
    expect.objectContaining({ exception_type: 'extra_item', quantity_affected: 1 }),
  ]));
});

it('B18 — quantity_rejected is not required to equal missing shortfall for reconciliation completion', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 4 });

  const missing = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 2,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(missing.status).toBe(201);

  await expect(inspect(f, 2, 0)).resolves.toBeUndefined();

  const projected = await fetchReceiveJobLine(f);
  expect(Number(projected.quantity_accepted)).toBe(2);
  expect(Number(projected.quantity_rejected)).toBe(0);
  expect(projected.reconciliation.accounted).toBe(2);
  expect(projected.reconciliation.unaccounted).toBe(0);
});

it('B19 — provisional count is durable without inventory mutation', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 10 });

  const progress = await patchReceiveProgress(f, 7);
  expect(progress.status).toBe(200);
  expect(progress.body).toEqual(expect.objectContaining({
    success: true,
    receive_job_id: f.receiveJobId,
    receive_job_line_id: f.receiveJobLineId,
    quantity_sellable_provisional: 7,
  }));

  const projected = await fetchReceiveJobLine(f);
  expect(projected.reconciliation).toEqual(expect.objectContaining({
    expected: 10,
    sellable: 7,
    accounted: 0,
    unaccounted: 3,
  }));
  expect(Boolean(projected.inspection_complete)).toBe(false);
  expect(Number(projected.quantity_accepted)).toBe(0);

  const s = await state(f);
  expect(Number(s.line!.quantity_sellable_provisional)).toBe(7);
  expect(Number(s.line!.quantity_accepted)).toBe(0);
  expect(Boolean(s.line!.inspection_complete)).toBe(false);
  expect(Number(s.poLine!.quantity_received)).toBe(0);
  expect(Number(s.job!.units_inspected)).toBe(0);
  expect(Number(s.job!.units_accepted)).toBe(0);
  expect(s.units).toEqual([]);
  expect(s.inboundMovements).toEqual([]);
  expect(s.rootTruth).toBeUndefined();
  expect(s.stowTasks).toEqual([]);
});

it('B20 — provisional shortfall survives refresh projection', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 10 });

  const progress = await patchReceiveProgress(f, 9);
  expect(progress.status).toBe(200);

  const projected = await fetchReceiveJobLine(f);
  expect(projected.reconciliation).toEqual(expect.objectContaining({
    expected: 10,
    sellable: 9,
    accounted: 0,
    unaccounted: 1,
  }));
});

it('B21 — provisional zero is distinct from untouched', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 10 });

  const untouched = await fetchReceiveJobLine(f);
  expect(untouched.quantity_sellable_provisional).toBeNull();
  expect(untouched.reconciliation.sellable).toBe(10);

  const progress = await patchReceiveProgress(f, 0);
  expect(progress.status).toBe(200);

  const projected = await fetchReceiveJobLine(f);
  expect(Number(projected.quantity_sellable_provisional)).toBe(0);
  expect(projected.reconciliation).toEqual(expect.objectContaining({
    expected: 10,
    sellable: 0,
    accounted: 0,
    unaccounted: 10,
  }));
});

it('B22 — overdelivery draft is allowed without inventory mutation', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 10 });

  const progress = await patchReceiveProgress(f, 11);
  expect(progress.status).toBe(200);

  const projected = await fetchReceiveJobLine(f);
  expect(projected.reconciliation).toEqual(expect.objectContaining({
    expected: 10,
    sellable: 11,
    accounted: 0,
    unaccounted: 0,
  }));

  const s = await state(f);
  expect(Number(s.line!.quantity_sellable_provisional)).toBe(11);
  expect(Number(s.line!.quantity_accepted)).toBe(0);
  expect(Boolean(s.line!.inspection_complete)).toBe(false);
  expect(Number(s.poLine!.quantity_received)).toBe(0);
  expect(s.units).toEqual([]);
  expect(s.inboundMovements).toEqual([]);
  expect(s.stowTasks).toEqual([]);
});

it('B23 — completed line cannot have draft progress mutated', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 2 });
  await inspect(f, 2);

  const progress = await patchReceiveProgress(f, 1);
  expect(progress.status).toBe(409);

  const projected = await fetchReceiveJobLine(f);
  expect(Number(projected.quantity_accepted)).toBe(2);
  expect(Boolean(projected.inspection_complete)).toBe(true);
});

it('B24 — final inspection clears draft progress and final accepted becomes canonical', async () => {
  const f = await receiveFixture({ externalBarcode: '5012345678900', quantityOrdered: 4 });

  const progress = await patchReceiveProgress(f, 2);
  expect(progress.status).toBe(200);
  const report = await reportReceiveProblem(f, {
    exception_type: 'missing_item',
    quantity_affected: 2,
    accounting_role: 'shortfall',
    counts_toward_shortfall: true,
  });
  expect(report.status).toBe(201);

  await expect(inspect(f, 2, 0)).resolves.toBeUndefined();

  const s = await state(f);
  expect(s.line!.quantity_sellable_provisional).toBeNull();
  expect(Number(s.line!.quantity_accepted)).toBe(2);
  expect(Boolean(s.line!.inspection_complete)).toBe(true);

  const projected = await fetchReceiveJobLine(f);
  expect(Number(projected.quantity_accepted)).toBe(2);
  expect(projected.reconciliation.sellable).toBe(2);
});


// ── B25 ─────────────────────────────────────────────────────────────────────

it('B25 — a Stow-ready Receive cannot close without an actual delivery date', async () => {
  const f = await receiveFixture({
    externalBarcode: '5012345678900',
    quantityOrdered: 2,
  });

  await inspect(f, 2);

  const ready = await state(f);
  expect(ready.job!.status).toBe('stow_ready');

  await expect(close(f)).rejects.toThrow(/actual delivery date|required/i);

  expectNoCloseSideEffects(await state(f));
});
