/**
 * GH-1085 / BARCODE-LIFECYCLE-01 — Slice C.
 *
 * The execution invariant for Stow and Pick: inventory may not be moved by
 * a Stow unless the operator scanned the exact physical unit, and Pick
 * execution owns scan identity/recovery for the stock it picks.
 *
 * GH-1145 SUPERSEDES the original Release-time prerequisites of this suite.
 * Release eligibility is canonical physical stock only: stock releases and
 * reserves regardless of variant barcode, inventory_units rows,
 * label_printed_at or barcode_print_jobs. C3/C4/C7 were converted from
 * "release is refused" into "release succeeds" regressions; the Stow identity
 * cases (C1/C2/C2b) are unchanged.
 *
 * TWO KINDS OF EVIDENCE, NEVER INTERCHANGEABLE
 *   exact-unit   LSU- — one physical unit, one sticker. The only thing that
 *                can prove "this box in my hand is the one the task means".
 *   product      variants.barcode (EAN/UPC/GTIN) and the LSP- catalog
 *                identity. Both identify a SKU, not a unit.
 *
 * Slice B established that a printed LSU- label (label_printed_at) is the
 * acknowledgement that a unit is physically identifiable. Slice C originally
 * carried that through to Stow confirm and Pick release/reservation; after
 * GH-1145 it remains a Stow and Pick-execution concern, not a Release gate.
 *
 * Real services and the real release route against the disposable
 * synchroflow_test_* database (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { confirmStow } from 'api-src/services/wms/stow.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(240000);

/**
 * The exact trigger closeReceiveJob writes for its Stow tasks
 * (receiveJob.service.ts — createStowTask({ trigger: 'inbound_stock' })).
 * Read from source, not assumed.
 */
const RECEIVE_STOW_TRIGGER = 'inbound_stock';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as the other GH-1085 suites) ────────────────

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
  const shopDomain = `bei1085-${label}-${Date.now()}.myshopify.com`;
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
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  return { shopId, userId, token, rootLocationCode: `WH-${shopId}-ROOT` };
}

// ── catalog / warehouse fixtures ───────────────────────────────────────────

async function seedMappedVariant(shopId: number, externalBarcode: string | null): Promise<string> {
  const nonce = crypto.randomBytes(5).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/1085C${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/1085C${nonce}`,
        title: `GH1085C fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `GH1085C-${nonce}`,
          barcode: externalBarcode,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/1085C${nonce}`, unitCost: { amount: '4.00' } },
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

/** An active pick bin under the tenant's warehouse root. */
async function createPickBin(shopId: number, rootLocationCode: string): Promise<string> {
  const binCode = `BIN-C${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await withTenant(shopId, async (trx) => {
    const root = await trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: rootLocationCode })
      .first('warehouse_id');
    expect(root?.warehouse_id).toBeTruthy();
    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: root!.warehouse_id,
      location_code: binCode,
      type: 'bin',
      parent_location_code: rootLocationCode,
      active: true,
      zone_type: 'pick',
    });
  });
  return binCode;
}

async function seedTruth(
  shopId: number,
  lasyncroVariantId: string,
  locationCode: string,
  quantity: number
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
      on_hand_quantity: quantity,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: quantity,
      last_evaluated_at: new Date(),
    }));
}

/** supplier → PO → receive_job → receive_job_line, the anchor units require. */
async function seedReceiveJobLine(shopId: number, lasyncroVariantId: string): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `GH1085C supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplier.id, status: 'draft' })
      .returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id })
      .returning('receive_job_id');
    const [jobLine] = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: job.receive_job_id,
        lasyncro_variant_id: lasyncroVariantId,
        quantity_expected: 10,
      })
      .returning('receive_job_line_id');
    return jobLine.receive_job_line_id as string;
  });
}

/**
 * Units in the CANONICAL RECEIVE SHAPE at warehouse root:
 * status 'received' and current_location_code NULL. That null is not missing
 * data — stow.service.ts's STOW-LSU-01 note states a received unit "has never
 * had one", its stock having been credited to WH-{shopId}-ROOT by
 * closeReceiveJob. batchConfirmUnits writes exactly this shape.
 */
async function seedReceivedUnits(
  shopId: number,
  opts: { lasyncroVariantId: string; receiveJobLineId: string; count: number; labelPrinted?: boolean }
): Promise<string[]> {
  const ids: string[] = [];
  await withTenant(shopId, async (trx) => {
    for (let seq = 1; seq <= opts.count; seq++) {
      const unitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId,
        lasyncro_unit_id: unitId,
        lasyncro_variant_id: opts.lasyncroVariantId,
        receive_job_line_id: opts.receiveJobLineId,
        receive_sequence: seq,
        status: 'received',
        current_location_code: null,
        label_printed_at: opts.labelPrinted ? new Date() : null,
      });
      ids.push(unitId);
    }
  });
  return ids;
}

/** Units physically stowed into a pick bin — the shape a bin allocation draws on. */
async function seedStowedUnits(
  shopId: number,
  opts: {
    lasyncroVariantId: string;
    receiveJobLineId: string;
    count: number;
    locationCode: string;
    labelPrinted: boolean;
    startSequence?: number;
  }
): Promise<string[]> {
  const ids: string[] = [];
  const start = opts.startSequence ?? 1;
  await withTenant(shopId, async (trx) => {
    for (let i = 0; i < opts.count; i++) {
      const unitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId,
        lasyncro_unit_id: unitId,
        lasyncro_variant_id: opts.lasyncroVariantId,
        receive_job_line_id: opts.receiveJobLineId,
        receive_sequence: start + i,
        status: 'stowed',
        current_location_code: opts.locationCode,
        label_printed_at: opts.labelPrinted ? new Date() : null,
      });
      ids.push(unitId);
    }
  });
  return ids;
}

/** A releasable order carrying exactly the fixture variant. */
async function seedOrder(
  shopId: number,
  lasyncroVariantId: string,
  quantity: number
): Promise<string> {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();
  const variant = await withTenant(shopId, (trx) =>
    trx('variants').where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
      .first('lasyncro_product_id'));

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId, shop_id: shopId, payment_state: 'paid',
      currency: 'USD', total_price: '100.00', subtotal_price: '100.00', total_tax: '0.00',
      order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: lasyncroOrderId, shop_id: shopId, platform: 'shopify',
      external_order_id: String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'),
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: variant!.lasyncro_product_id,
      lasyncro_variant_id: lasyncroVariantId,
      sku: null, title: 'GH1085C order line', quantity,
      unit_price: '10.00', line_total: (10 * quantity).toFixed(2),
      created_at: now, updated_at: now,
    });
    // Projection-single-writer guarded (migration 0076) — same transaction-local
    // guard the other GH-1085 suites use for an authorised fixture.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId, status: 'pending', status_updated_at: now,
    });
  });

  return lasyncroOrderId;
}

// ── state readers ──────────────────────────────────────────────────────────

async function variantState(shopId: number, lasyncroVariantId: string) {
  return withTenant(shopId, async (trx) => ({
    truth: await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
      .orderBy('location_code')
      .select('location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity'),
    movements: await trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
      .orderBy('lasyncro_inventory_movement_id')
      .select('movement_type', 'quantity_delta', 'location_code'),
    allocations: await trx('pick_reservation_allocations')
      .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
      .select('pick_batch_id', 'location_code', 'quantity'),
    units: await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
      .orderBy('receive_sequence')
      .select('lasyncro_unit_id', 'status', 'current_location_code', 'label_printed_at'),
  }));
}

async function stowTaskRow(shopId: number, stowTaskId: string) {
  return withTenant(shopId, (trx) =>
    trx('stow_tasks').where({ shop_id: shopId, stow_task_id: stowTaskId })
      .first('status', 'quantity', 'location_code', 'completed_at'));
}

/** An in-progress Receive-created Stow task, claimed and destined for a bin. */
async function seedInProgressReceiveStow(
  shopId: number,
  userId: number,
  opts: { lasyncroVariantId: string; quantity: number; locationCode: string }
): Promise<string> {
  const [row] = await withTenant(shopId, (trx) =>
    trx('stow_tasks').insert({
      shop_id: shopId,
      lasyncro_variant_id: opts.lasyncroVariantId,
      quantity: opts.quantity,
      location_code: opts.locationCode,
      status: 'in_progress',
      trigger: RECEIVE_STOW_TRIGGER,
      claimed_by: userId,
      claimed_at: new Date(),
    }).returning('stow_task_id'));
  return row.stow_task_id as string;
}

function releaseBatch(token: string, orderId: string) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`)
    .send({ priority_order_ids: [orderId], exclusive: true });
}

/**
 * GH-1145: a Release of canonical physical stock succeeds and reserves exactly
 * the expected quantity at the expected bin — on_hand unchanged, reserved up,
 * available down.
 */
async function expectReleasedAt(
  shopId: number,
  lasyncroVariantId: string,
  release: request.Response,
  before: Awaited<ReturnType<typeof variantState>>,
  locationCode: string,
  quantity: number
) {
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { pick_batch_id: expect.any(String) } });

  const after = await variantState(shopId, lasyncroVariantId);

  expect(after.allocations).toEqual([
    expect.objectContaining({
      pick_batch_id: release.body.pick_batch_id,
      location_code: locationCode,
      quantity,
    }),
  ]);

  expect(after.movements.filter((m: any) => m.movement_type === 'reservation_hold')).toEqual([
    expect.objectContaining({ movement_type: 'reservation_hold', location_code: locationCode }),
  ]);

  const truthAfter = after.truth.find((t: any) => t.location_code === locationCode)!;
  const truthBefore = before.truth.find((t: any) => t.location_code === locationCode)!;
  expect(Number(truthAfter.on_hand_quantity)).toBe(Number(truthBefore.on_hand_quantity));
  expect(Number(truthAfter.reserved_quantity)).toBe(Number(truthBefore.reserved_quantity) + quantity);
  expect(Number(truthAfter.available_quantity)).toBe(Number(truthBefore.available_quantity) - quantity);
}

// ── C1 ─────────────────────────────────────────────────────────────────────

it('C1 — a Receive-created Stow cannot move inventory without an exact LSU scan', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, shop.rootLocationCode, 2);
  const jobLineId = await seedReceiveJobLine(shop.shopId, variantId);
  // Units DO exist, so a refusal cannot be blamed on "no units resolved" —
  // today's FIFO fallback has everything it needs to succeed.
  await seedReceivedUnits(shop.shopId, {
    lasyncroVariantId: variantId, receiveJobLineId: jobLineId, count: 2, labelPrinted: true,
  });

  const stowTaskId = await seedInProgressReceiveStow(shop.shopId, shop.userId, {
    lasyncroVariantId: variantId, quantity: 2, locationCode: binCode,
  });

  const before = await variantState(shop.shopId, variantId);
  const beforeTask = await stowTaskRow(shop.shopId, stowTaskId);

  // No lasyncroUnitId — the operator never scanned a physical unit.
  await expect(
    withTenant(shop.shopId, (trx) =>
      confirmStow(trx, { stowTaskId, shopId: shop.shopId, claimedBy: shop.userId }))
  ).rejects.toThrow(/unit|LSU/i);

  const after = await variantState(shop.shopId, variantId);

  // Nothing physical may be inferred from a task alone.
  expect(await stowTaskRow(shop.shopId, stowTaskId)).toEqual(beforeTask);
  expect(after.truth).toEqual(before.truth);
  expect(after.units).toEqual(before.units);
  expect(after.movements).toEqual(before.movements);
});

// ── C2 ─────────────────────────────────────────────────────────────────────

it('C2 — a Stow scan of another variant\'s LSU fails closed', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantA = await seedMappedVariant(shop.shopId, null);
  const variantB = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  // Plenty of variant-A stock at source, so a refusal can never be a shortage.
  await seedTruth(shop.shopId, variantA, shop.rootLocationCode, 10);

  const lineA = await seedReceiveJobLine(shop.shopId, variantA);
  await seedReceivedUnits(shop.shopId, {
    lasyncroVariantId: variantA, receiveJobLineId: lineA, count: 2, labelPrinted: true,
  });

  const lineB = await seedReceiveJobLine(shop.shopId, variantB);
  const [foreignUnitId] = await seedReceivedUnits(shop.shopId, {
    lasyncroVariantId: variantB, receiveJobLineId: lineB, count: 1, labelPrinted: true,
  });

  const stowTaskId = await seedInProgressReceiveStow(shop.shopId, shop.userId, {
    lasyncroVariantId: variantA, quantity: 1, locationCode: binCode,
  });

  const beforeA = await variantState(shop.shopId, variantA);
  const beforeB = await variantState(shop.shopId, variantB);
  const beforeTask = await stowTaskRow(shop.shopId, stowTaskId);

  await expect(
    withTenant(shop.shopId, (trx) =>
      confirmStow(trx, {
        stowTaskId, shopId: shop.shopId, claimedBy: shop.userId,
        lasyncroUnitId: foreignUnitId,
      }))
  ).rejects.toThrow(/mismatch|variant|unit/i);

  // The scanned unit belongs to a different product — nothing may move.
  expect(await stowTaskRow(shop.shopId, stowTaskId)).toEqual(beforeTask);
  expect(await variantState(shop.shopId, variantA)).toEqual(beforeA);
  expect(await variantState(shop.shopId, variantB)).toEqual(beforeB);
});

// ── C2b ────────────────────────────────────────────────────────────────────

it('C2b — one LSU scan cannot bulk-stow additional inbound units', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  // Generous source stock, so a refusal can never be a shortage.
  await seedTruth(shop.shopId, variantId, shop.rootLocationCode, 5);

  // Two units on ONE receive line — exactly the shape the sibling FIFO
  // currently reaches for once the scanned unit is consumed.
  const jobLineId = await seedReceiveJobLine(shop.shopId, variantId);
  const unitIds = await seedReceivedUnits(shop.shopId, {
    lasyncroVariantId: variantId, receiveJobLineId: jobLineId, count: 2, labelPrinted: true,
  });
  expect(unitIds).toHaveLength(2);

  const stowTaskId = await seedInProgressReceiveStow(shop.shopId, shop.userId, {
    lasyncroVariantId: variantId, quantity: 2, locationCode: binCode,
  });

  const before = await variantState(shop.shopId, variantId);
  const beforeTask = await stowTaskRow(shop.shopId, stowTaskId);

  /**
   * The operator scanned ONE box and claimed TWO were placed. The second unit
   * was never in anyone's hand, so the backend must not infer it — inbound
   * Stow is one physical scan to one exact physical unit.
   *
   * Scoped to 'inbound_stock' deliberately. return_restock,
   * order_cancelled_mid_pick and problem_center carry their own identity
   * contracts and are untouched by this invariant.
   */
  await expect(
    withTenant(shop.shopId, (trx) =>
      confirmStow(trx, {
        stowTaskId,
        shopId: shop.shopId,
        claimedBy: shop.userId,
        lasyncroUnitId: unitIds[0],
        quantityPlaced: 2,
      }))
  ).rejects.toThrow(/unit|LSU|quantity/i);

  const after = await variantState(shop.shopId, variantId);

  // Nothing moved: not the task, not the source, not the destination, and in
  // particular not the unscanned sibling.
  expect(await stowTaskRow(shop.shopId, stowTaskId)).toEqual(beforeTask);
  expect(after.truth).toEqual(before.truth);
  expect(after.units).toEqual(before.units);
  expect(after.movements).toEqual(before.movements);
});

// ── C3 ─────────────────────────────────────────────────────────────────────

it('C3 — canonical physical stock with no external barcode and no LSU rows releases; identity/recovery belongs to Pick execution', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, binCode, 2);
  const orderId = await seedOrder(shop.shopId, variantId, 2);

  // Fixture identity: no external barcode, only the LSP- catalog identity
  // from ingestion, and no LSU rows. GH-1145: none of that gates Release —
  // scan identity/recovery is resolved at Pick execution.
  const variantRow = await withTenant(shop.shopId, (trx) =>
    trx('variants').where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .first('barcode', 'lasyncro_barcode'));
  expect(variantRow!.barcode).toBeNull();
  expect(variantRow!.lasyncro_barcode).toMatch(/^LSP-/);

  const before = await variantState(shop.shopId, variantId);
  expect(before.units).toEqual([]);

  const release = await releaseBatch(shop.token, orderId);

  await expectReleasedAt(shop.shopId, variantId, release, before, binCode, 2);
});

// ── C4 ─────────────────────────────────────────────────────────────────────

it('C4 — missing label_printed_at does not block Release', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, binCode, 2);
  const jobLineId = await seedReceiveJobLine(shop.shopId, variantId);

  // Enough units, in the right bin, but no label has ever been acknowledged.
  // GH-1145: label acknowledgement is not a Release prerequisite.
  await seedStowedUnits(shop.shopId, {
    lasyncroVariantId: variantId, receiveJobLineId: jobLineId, count: 2,
    locationCode: binCode, labelPrinted: false,
  });

  const orderId = await seedOrder(shop.shopId, variantId, 2);
  const before = await variantState(shop.shopId, variantId);
  expect(before.units).toHaveLength(2);
  expect(before.units.every((u: any) => u.label_printed_at === null)).toBe(true);

  const release = await releaseBatch(shop.token, orderId);

  await expectReleasedAt(shop.shopId, variantId, release, before, binCode, 2);
});

// ── C5 ─────────────────────────────────────────────────────────────────────

it('C5 — stock covered by physically acknowledged LSU labels releases normally', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, binCode, 2);
  const jobLineId = await seedReceiveJobLine(shop.shopId, variantId);

  // Location-aware coverage: same shop, same variant, stowed INTO the
  // allocation bin, labels acknowledged.
  await seedStowedUnits(shop.shopId, {
    lasyncroVariantId: variantId, receiveJobLineId: jobLineId, count: 2,
    locationCode: binCode, labelPrinted: true,
  });

  const orderId = await seedOrder(shop.shopId, variantId, 2);
  const before = await variantState(shop.shopId, variantId);

  const release = await releaseBatch(shop.token, orderId);
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { pick_batch_id: expect.any(String) } });

  const after = await variantState(shop.shopId, variantId);

  expect(after.allocations).toEqual([
    expect.objectContaining({
      pick_batch_id: release.body.pick_batch_id,
      location_code: binCode,
      quantity: 2,
    }),
  ]);

  expect(after.movements.filter((m: any) => m.movement_type === 'reservation_hold')).toEqual([
    expect.objectContaining({ movement_type: 'reservation_hold', location_code: binCode }),
  ]);

  const binTruth = after.truth.find((t: any) => t.location_code === binCode)!;
  const binBefore = before.truth.find((t: any) => t.location_code === binCode)!;
  expect(Number(binTruth.on_hand_quantity)).toBe(Number(binBefore.on_hand_quantity));
  expect(Number(binTruth.reserved_quantity)).toBe(Number(binBefore.reserved_quantity) + 2);
  expect(Number(binTruth.available_quantity)).toBe(Number(binBefore.available_quantity) - 2);
});

// ── C6 ─────────────────────────────────────────────────────────────────────

it('C6 — stock with a real external barcode releases without any LSU relabelling', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  // A BYO-barcode merchant. Historical stock like this has no LSU rows at all
  // and must never be forced through relabelling to stay sellable.
  const variantId = await seedMappedVariant(shop.shopId, '5012345678900');
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, binCode, 2);
  const orderId = await seedOrder(shop.shopId, variantId, 2);

  const before = await variantState(shop.shopId, variantId);
  expect(before.units).toEqual([]);

  const release = await releaseBatch(shop.token, orderId);
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { pick_batch_id: expect.any(String) } });

  const after = await variantState(shop.shopId, variantId);
  expect(after.allocations).toEqual([
    expect.objectContaining({ location_code: binCode, quantity: 2 }),
  ]);
  expect(after.movements.filter((m: any) => m.movement_type === 'reservation_hold')).toHaveLength(1);
});

// ── C7 ─────────────────────────────────────────────────────────────────────

it('C7 — barcode_print_jobs is irrelevant to Release eligibility; canonical physical stock releases independently of it', async () => {
  const shop = await provisionFt2Shop(crypto.randomUUID());
  const variantId = await seedMappedVariant(shop.shopId, null);
  const binCode = await createPickBin(shop.shopId, shop.rootLocationCode);

  await seedTruth(shop.shopId, variantId, binCode, 2);

  /**
   * The artefact closeReceiveJob still writes today: one row per VARIANT,
   * barcode_value = SKU or a slice of the variant UUID. It is not per-unit, it
   * is not acknowledged by anyone, and for a barcode-less variant its value is
   * invented from a UUID. GH-1145: it is irrelevant to Release — the stock
   * releases on canonical physical quantity alone, with or without it.
   */
  await withTenant(shop.shopId, (trx) =>
    trx('barcode_print_jobs').insert({
      shop_id: shop.shopId,
      lasyncro_variant_id: variantId,
      quantity: 2,
      barcode_value: variantId.replace(/-/g, '').slice(0, 12).toUpperCase(),
      status: 'pending',
      created_by: shop.userId,
    }));

  const orderId = await seedOrder(shop.shopId, variantId, 2);
  const before = await variantState(shop.shopId, variantId);

  const release = await releaseBatch(shop.token, orderId);

  await expectReleasedAt(shop.shopId, variantId, release, before, binCode, 2);
});
