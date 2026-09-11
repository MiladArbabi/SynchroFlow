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
import { encrypt } from 'api-src/security/encryption.service';

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
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED', updated_at: new Date(),
    }));
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId });
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
function close(f: ReceiveFixture) {
  return withTenant(f.shopId, (trx) =>
    closeReceiveJob(trx, {
      shopId: f.shopId,
      receiveJobId: f.receiveJobId,
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
      .first('status', 'closed_at', 'units_accepted'),

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

  await expect(close(f)).rejects.toThrow(/barcode|label/i);

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

  await expect(close(f)).rejects.toThrow(/barcode|label/i);
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

  await expect(close(f)).resolves.toBeUndefined();

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

  await expect(close(f)).resolves.toBeUndefined();

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
