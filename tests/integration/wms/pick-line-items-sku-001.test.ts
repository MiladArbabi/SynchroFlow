/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — GET /batch/:id/line-items SKU fields.
 * Real route, real middleware, disposable DB only (scripts/with-test-db.js).
 *
 * - `sku` stays the order-line snapshot (oli.sku), verbatim.
 * - `variant_sku` is the allocation variant's own current SKU (v.sku via the
 *   existing RLS-scoped variant join); null when the variant has none.
 * - Clients show the snapshot when populated, else variant_sku (unit tests).
 * - Another tenant reads none of it.
 */
import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { app, fixture, provisionFt2Shop, release, type Fx } from './pick-assign-sf-01.fixture';

jest.setTimeout(180_000);

const lineItems = (token: string, batchId: string) =>
  request(app).get(`/api/v1/wms/batch/${batchId}/line-items`).set({ Authorization: `Bearer ${token}` });
const variantSku = (fx: Fx, variantId: string) =>
  withTenant(fx.shop.shopId, (trx) => trx('variants').where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId }).first('sku'))
    .then((r: { sku: string | null }) => r.sku);
const byAllocation = (body: any) =>
  Object.fromEntries((body.line_items as any[]).map((li) => [li.reservation_allocation_id, li]));

test('LIS-01 snapshot preserved, variant SKU exposed separately (populated, null, blank, unavailable); tenant-isolated', async () => {
  const fx = await fixture();
  const { batchId, allocations } = await release(fx);
  const [a0, a1] = allocations;
  const sku0 = await variantSku(fx, a0.lasyncro_variant_id);
  const sku1 = await variantSku(fx, a1.lasyncro_variant_id);
  expect(sku0).toEqual(expect.any(String));
  expect(sku1).toEqual(expect.any(String));
  expect(sku0).not.toBe(sku1);

  // 1. Order-line snapshot null (fixture default) → sku null; variant_sku = that allocation's own variant SKU.
  let res = await lineItems(fx.shop.ownerToken, batchId);
  expect(res.status).toBe(200);
  let rows = byAllocation(res.body);
  expect(rows[a0.allocation_id]).toMatchObject({ lasyncro_variant_id: a0.lasyncro_variant_id, sku: null, variant_sku: sku0 });
  expect(rows[a1.allocation_id]).toMatchObject({ lasyncro_variant_id: a1.lasyncro_variant_id, sku: null, variant_sku: sku1 });

  // 2. Snapshot populated / blank → returned verbatim; variant_sku unchanged alongside it.
  await withTenant(fx.shop.shopId, async (trx) => {
    await trx('order_line_items').where({ lasyncro_line_item_id: a0.lasyncro_line_item_id }).update({ sku: 'ORDER-SNAP-1' });
    await trx('order_line_items').where({ lasyncro_line_item_id: a1.lasyncro_line_item_id }).update({ sku: '   ' });
  });
  res = await lineItems(fx.shop.ownerToken, batchId);
  rows = byAllocation(res.body);
  expect(rows[a0.allocation_id]).toMatchObject({ sku: 'ORDER-SNAP-1', variant_sku: sku0 });
  expect(rows[a1.allocation_id]).toMatchObject({ sku: '   ', variant_sku: sku1 });

  // 3. Variant SKU unavailable → variant_sku null; nothing manufactured.
  await withTenant(fx.shop.shopId, (trx) =>
    trx('variants').where({ shop_id: fx.shop.shopId, lasyncro_variant_id: a1.lasyncro_variant_id }).update({ sku: null }));
  await withTenant(fx.shop.shopId, (trx) =>
    trx('order_line_items').where({ lasyncro_line_item_id: a1.lasyncro_line_item_id }).update({ sku: null }));
  res = await lineItems(fx.shop.ownerToken, batchId);
  rows = byAllocation(res.body);
  expect(rows[a1.allocation_id]).toMatchObject({ sku: null, variant_sku: null });
  expect(rows[a0.allocation_id]).toMatchObject({ sku: 'ORDER-SNAP-1', variant_sku: sku0 });

  // 4. Another tenant: no line items (and so no SKU) for this batch.
  const other = await provisionFt2Shop(crypto.randomBytes(4).toString('hex'));
  const foreign = await lineItems(other.ownerToken, batchId);
  expect([200, 404]).toContain(foreign.status);
  expect(foreign.body.line_items ?? []).toEqual([]);
  expect(JSON.stringify(foreign.body)).not.toContain(sku0);
});
