// tests/integration/inventory/projection-zero-state-regression.test.ts
//
// OB-03 — SLICE 0 regression freeze.
//
// Part A: a variant INCLUDED in a rebuildInventoryProjectionForVariants call
// with zero inventory_movements rows must resolve to an explicit zero
// physical inventory_truth row (on_hand=0, reserved=0, available=0) at
// WH-{shopId}-ROOT — never simply absent. This is the
// `variantsWithLedgerRows` zero-fill branch in
// services/inventory/rebuildInventoryProjection.ts.
//
// Part B: a variant that has NEVER been rebuilt (no inventory_truth row at
// all) must have zero release capacity on the shared capacity READ path
// (readReleaseCapacity / services/inventory/releaseCapacity.service.ts,
// GH-1145-A1) without throwing.
//
// PERMANENT regression contract, authored ahead of Slice 1 production/schema
// changes to freeze this CURRENT zero-state behavior.
//
// PLACEMENT
//   tests/integration/ (backend-integration project), disposable-PostgreSQL
//   harness.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedVariant(shopId: number, titlePrefix: string): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: `${titlePrefix} product`,
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OB03-${variantId.slice(0, 8)}`,
      title: `${titlePrefix} variant`,
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

describe('OB-03 — zero-state projection rebuild and never-rebuilt Pick capacity read', () => {
  it('Part A: a variant with zero ledger movements, included in the rebuild, resolves to an explicit zero physical row', async () => {
    const shopId = await createFixtureShop('ob03a');
    const variantId = await seedVariant(shopId, 'OB-03a zero-ledger');
    const rootCode = `WH-${shopId}-ROOT`;

    // Precondition: no inventory_movements rows for this variant at all.
    const [{ count: preCount }] = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .count<{ count: string }[]>('* as count')
    );
    expect(Number(preCount)).toBe(0);

    // Precondition: no inventory_truth row yet either.
    const preTruth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .select('location_code')
    );
    expect(preTruth).toHaveLength(0);

    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    });

    const truth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .select('location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity')
    );

    expect(truth).toHaveLength(1);
    expect(truth[0]).toMatchObject({
      location_code: rootCode,
      on_hand_quantity: 0,
      reserved_quantity: 0,
      available_quantity: 0,
    });
  });

  it('Part B: a never-rebuilt variant (no inventory_truth row) has zero release capacity on readReleaseCapacity, without throwing', async () => {
    const shopId = await createFixtureShop('ob03b');
    const variantId = await seedVariant(shopId, 'OB-03b never-rebuilt');

    // Precondition: confirm no inventory_truth row exists for this variant —
    // it has genuinely never gone through any rebuild.
    const preTruth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .select('location_code')
    );
    expect(preTruth).toHaveLength(0);

    const rows = await withTenant(shopId, (trx) =>
      readReleaseCapacity(trx, { shopId, variantIds: [variantId], lock: 'none' })
    );

    // Non-pickable: no usable row surfaces for this variant, and the read
    // path itself does not throw for a variant it has never seen.
    expect(rows).toEqual([]);
  });
});
