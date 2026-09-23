// tests/integration/inventory/shopify-opening-expectations-v2.test.ts
//
// SLICE 2 — reconcile_opening_expectation_v2 bootstrap path.
// Migration: 20260923150000_0194_create_shopify_opening_inventory_expectations.ts
// Production: apps/backend/src/services/inventory/seedShopifyOpeningBalances.ts
//   (seedOpeningExpectationsV2 branch, gated on
//   shop_wms_settings.bootstrap_model = 'reconcile_opening_expectation_v2')
//
// PLACEMENT
//   tests/integration/ (backend-integration project), disposable-PostgreSQL
//   harness. Fixture pattern mirrors
//   tests/integration/inventory/shopify-opening-balance-legacy-regression.test.ts
//   and tests/integration/inventory/shop-wms-settings-bootstrap-model.migration.test.ts.
//
// COVERS
//   S2-01: v2, qty=100 → expectation row (reported=100, expected=100), zero
//          opening_balance movement, zero physical availability after rebuild.
//   S2-02: v2, qty=-5 → reported=-5, expected=0, no physical negative inventory.
//   S2-03: expectation rows invisible to physical projection.
//   S2-04: two variants in one snapshot share identical observed_at.
//   S2-05: retry / first-write-wins — changed quantities on retry do not
//          update existing rows, no duplicate rows, no physical movement
//          either time.
//   S2-06: atomic missing mapping — one unmapped required variant fails the
//          whole snapshot; zero expectation rows, zero physical movements.
//   S2-08: table immutability — UPDATE and DELETE both rejected.
//   S2-09: RLS — cross-tenant expectation row invisible.
//
// S2-07 (legacy compatibility) is intentionally NOT duplicated here — see
// tests/integration/inventory/shopify-opening-balance-legacy-regression.test.ts
// (Slice 0), re-run as a neighbour regression per the Slice 2 brief.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { seedShopifyOpeningBalances } from 'api-src/services/inventory/seedShopifyOpeningBalances';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';

async function createFixtureShop(
  namePrefix: string,
  bootstrapModel: 'legacy_opening_balance_v1' | 'reconcile_opening_expectation_v2'
): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  // createTenantShop only inserts into public.shops — no shop_wms_settings
  // row exists for this shop yet (ISSUE-12, confirmed via migration 0193's
  // own comments). Provision it explicitly with the requested classification.
  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .insert({ shop_id: shopId, bootstrap_model: bootstrapModel })
      .onConflict('shop_id')
      .ignore()
  );

  return shopId;
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
      sku: `S2-${variantId.slice(0, 8)}`,
      title: `${titlePrefix} variant`,
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

async function seedIdentityMapping(
  shopId: number,
  variantId: string,
  externalVariantId: string
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomBytes(4).toString('hex')}`,
      external_variant_id: externalVariantId,
    })
  );
}

function buildShopifyResponse(
  variants: Array<{ shopifyVariantId: string; inventoryQuantity: number }>
) {
  return {
    data: {
      products: {
        edges: [
          {
            node: {
              title: 'S2 product',
              variants: {
                edges: variants.map((v) => ({
                  node: { id: v.shopifyVariantId, inventoryQuantity: v.inventoryQuantity },
                })),
              },
            },
          },
        ],
      },
    },
  };
}

function injectedClient(response: ReturnType<typeof buildShopifyResponse>) {
  return { request: jest.fn().mockResolvedValue(response) };
}

async function runSeed(
  shopId: number,
  response: ReturnType<typeof buildShopifyResponse>
): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await seedShopifyOpeningBalances(
      trx,
      'unused-access-token',
      'unused-shop.myshopify.com',
      shopId,
      injectedClient(response)
    );
  });
}

describe('SHOPIFY-OPENING-EXPECTATIONS-V2 — reconcile_opening_expectation_v2 bootstrap path', () => {
  // ── S2-01 ─────────────────────────────────────────────────────────────
  it('S2-01: positive quantity produces an expectation row and zero physical writes', async () => {
    const shopId = await createFixtureShop('s2-01', 'reconcile_opening_expectation_v2');
    const variantId = await seedVariant(shopId, 'S2-01');
    const shopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantId, shopifyVariantId);

    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: 100 }]));

    const expectationRow = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('reported_quantity', 'expected_quantity', 'observed_at', 'external_variant_id')
    );
    expect(expectationRow).toBeDefined();
    expect(expectationRow.external_variant_id).toBe(shopifyVariantId);
    expect(Number(expectationRow.reported_quantity)).toBe(100);
    expect(Number(expectationRow.expected_quantity)).toBe(100);

    const movements = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({ shop_id: shopId, lasyncro_variant_id: variantId })
    );
    expect(movements).toHaveLength(0);

    const rootCode = `WH-${shopId}-ROOT`;
    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    });

    const truth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootCode })
        .first('on_hand_quantity', 'available_quantity')
    );
    expect(Number(truth.on_hand_quantity)).toBe(0);
    expect(Number(truth.available_quantity)).toBe(0);
  });

  // ── S2-02 ─────────────────────────────────────────────────────────────
  it('S2-02: negative reported quantity normalizes expected_quantity to zero, no physical negative inventory', async () => {
    const shopId = await createFixtureShop('s2-02', 'reconcile_opening_expectation_v2');
    const variantId = await seedVariant(shopId, 'S2-02');
    const shopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantId, shopifyVariantId);

    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: -5 }]));

    const expectationRow = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('reported_quantity', 'expected_quantity')
    );
    expect(Number(expectationRow.reported_quantity)).toBe(-5);
    expect(Number(expectationRow.expected_quantity)).toBe(0);

    const movements = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({ shop_id: shopId, lasyncro_variant_id: variantId })
    );
    expect(movements).toHaveLength(0);
  });

  // ── S2-03 ─────────────────────────────────────────────────────────────
  it('S2-03: expectation rows are invisible to physical projection — rebuild does not convert them into stock', async () => {
    const shopId = await createFixtureShop('s2-03', 'reconcile_opening_expectation_v2');
    const variantId = await seedVariant(shopId, 'S2-03');
    const shopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantId, shopifyVariantId);

    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: 250 }]));

    const rootCode = `WH-${shopId}-ROOT`;
    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    });

    const truth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootCode })
        .first('on_hand_quantity', 'reserved_quantity', 'available_quantity', 'sellable_quantity')
    );
    expect(truth).toBeDefined();
    expect(Number(truth.on_hand_quantity)).toBe(0);
    expect(Number(truth.reserved_quantity)).toBe(0);
    expect(Number(truth.available_quantity)).toBe(0);
    expect(Number(truth.sellable_quantity)).toBe(0);
  });

  // ── S2-04 ─────────────────────────────────────────────────────────────
  it('S2-04: two variants from the same successful v2 snapshot share an identical observed_at', async () => {
    const shopId = await createFixtureShop('s2-04', 'reconcile_opening_expectation_v2');
    const variantIdA = await seedVariant(shopId, 'S2-04-A');
    const variantIdB = await seedVariant(shopId, 'S2-04-B');
    const shopifyVariantIdA = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    const shopifyVariantIdB = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantIdA, shopifyVariantIdA);
    await seedIdentityMapping(shopId, variantIdB, shopifyVariantIdB);

    await runSeed(
      shopId,
      buildShopifyResponse([
        { shopifyVariantId: shopifyVariantIdA, inventoryQuantity: 10 },
        { shopifyVariantId: shopifyVariantIdB, inventoryQuantity: 20 },
      ])
    );

    const rows = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_variant_id', [variantIdA, variantIdB])
        .select('lasyncro_variant_id', 'observed_at')
    );
    expect(rows).toHaveLength(2);
    const [a, b] = rows;
    expect(new Date(a.observed_at).getTime()).toBe(new Date(b.observed_at).getTime());
  });

  // ── S2-05 ─────────────────────────────────────────────────────────────
  it('S2-05: retry with changed quantities does not update the existing expectation row, no duplicates, no physical movement either run', async () => {
    const shopId = await createFixtureShop('s2-05', 'reconcile_opening_expectation_v2');
    const variantId = await seedVariant(shopId, 'S2-05');
    const shopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantId, shopifyVariantId);

    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: 30 }]));

    const firstRow = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('reported_quantity', 'expected_quantity', 'observed_at')
    );
    expect(Number(firstRow.reported_quantity)).toBe(30);

    // Retry — same shop/variant, CHANGED quantity.
    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: 999 }]));

    const rowsAfterRetry = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations').where({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
      })
    );
    expect(rowsAfterRetry).toHaveLength(1);
    expect(Number(rowsAfterRetry[0].reported_quantity)).toBe(30); // unchanged
    expect(Number(rowsAfterRetry[0].expected_quantity)).toBe(30); // unchanged
    expect(new Date(rowsAfterRetry[0].observed_at).getTime()).toBe(
      new Date(firstRow.observed_at).getTime()
    ); // unchanged

    const movements = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({ shop_id: shopId, lasyncro_variant_id: variantId })
    );
    expect(movements).toHaveLength(0);
  });

  // ── S2-05b ────────────────────────────────────────────────────────────
  it('S2-05b: shop-level snapshot immutability — retry with a NEW variant and changed quantities does not extend or mutate the accepted snapshot', async () => {
    const shopId = await createFixtureShop('s2-05b', 'reconcile_opening_expectation_v2');
    const variantIdA = await seedVariant(shopId, 'S2-05b-A');
    const variantIdB = await seedVariant(shopId, 'S2-05b-B');
    const variantIdC = await seedVariant(shopId, 'S2-05b-C');
    const shopifyVariantIdA = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    const shopifyVariantIdB = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    const shopifyVariantIdC = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantIdA, shopifyVariantIdA);
    await seedIdentityMapping(shopId, variantIdB, shopifyVariantIdB);
    await seedIdentityMapping(shopId, variantIdC, shopifyVariantIdC);

    // First accepted snapshot: A and B only, at observed_at=T1.
    await runSeed(
      shopId,
      buildShopifyResponse([
        { shopifyVariantId: shopifyVariantIdA, inventoryQuantity: 10 },
        { shopifyVariantId: shopifyVariantIdB, inventoryQuantity: 20 },
      ])
    );

    const firstRows = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId })
        .orderBy('lasyncro_variant_id')
        .select('lasyncro_variant_id', 'reported_quantity', 'expected_quantity', 'observed_at')
    );
    expect(firstRows).toHaveLength(2);

    // Retry: A and B with CHANGED quantities, plus a brand-new variant C.
    await runSeed(
      shopId,
      buildShopifyResponse([
        { shopifyVariantId: shopifyVariantIdA, inventoryQuantity: 999 },
        { shopifyVariantId: shopifyVariantIdB, inventoryQuantity: 888 },
        { shopifyVariantId: shopifyVariantIdC, inventoryQuantity: 777 },
      ])
    );

    const rowsAfterRetry = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId })
        .orderBy('lasyncro_variant_id')
        .select('lasyncro_variant_id', 'reported_quantity', 'expected_quantity', 'observed_at')
    );

    // Still only A and B — C must never have been inserted.
    expect(rowsAfterRetry).toHaveLength(2);
    expect(rowsAfterRetry.map((r) => r.lasyncro_variant_id).sort()).toEqual(
      [variantIdA, variantIdB].sort()
    );
    const cRow = rowsAfterRetry.find((r) => r.lasyncro_variant_id === variantIdC);
    expect(cRow).toBeUndefined();

    // A and B byte-identical to the first accepted snapshot.
    for (const first of firstRows) {
      const after = rowsAfterRetry.find(
        (r) => r.lasyncro_variant_id === first.lasyncro_variant_id
      );
      expect(after).toBeDefined();
      expect(Number(after!.reported_quantity)).toBe(Number(first.reported_quantity));
      expect(Number(after!.expected_quantity)).toBe(Number(first.expected_quantity));
      expect(new Date(after!.observed_at).getTime()).toBe(
        new Date(first.observed_at).getTime()
      );
    }

    const movements = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_variant_id', [variantIdA, variantIdB, variantIdC])
    );
    expect(movements).toHaveLength(0);
  });

  // ── S2-06 ─────────────────────────────────────────────────────────────
  it('S2-06: a v2 snapshot with one unmapped variant fails atomically — zero expectation rows, zero physical movements', async () => {
    const shopId = await createFixtureShop('s2-06', 'reconcile_opening_expectation_v2');
    const mappedVariantId = await seedVariant(shopId, 'S2-06-mapped');
    const mappedShopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, mappedVariantId, mappedShopifyVariantId);

    const unmappedShopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    // Intentionally no external_product_identity_map row for this one.

    await expect(
      runSeed(
        shopId,
        buildShopifyResponse([
          { shopifyVariantId: mappedShopifyVariantId, inventoryQuantity: 15 },
          { shopifyVariantId: unmappedShopifyVariantId, inventoryQuantity: 7 },
        ])
      )
    ).rejects.toThrow();

    const expectationRows = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations').where({ shop_id: shopId })
    );
    expect(expectationRows).toHaveLength(0);

    const movements = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({ shop_id: shopId })
    );
    expect(movements).toHaveLength(0);
  });

  // ── S2-08 ─────────────────────────────────────────────────────────────
  it('S2-08: an expectation row rejects UPDATE and DELETE, original row unchanged', async () => {
    const shopId = await createFixtureShop('s2-08', 'reconcile_opening_expectation_v2');
    const variantId = await seedVariant(shopId, 'S2-08');
    const shopifyVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopId, variantId, shopifyVariantId);

    await runSeed(shopId, buildShopifyResponse([{ shopifyVariantId, inventoryQuantity: 42 }]));

    const before = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first()
    );
    expect(before).toBeDefined();

    await expect(
      withTenant(shopId, (trx) =>
        trx('shopify_opening_inventory_expectations')
          .where({ shop_id: shopId, lasyncro_variant_id: variantId })
          .update({ reported_quantity: 1 })
      )
    ).rejects.toThrow(/append-only/i);

    await expect(
      withTenant(shopId, (trx) =>
        trx('shopify_opening_inventory_expectations')
          .where({ shop_id: shopId, lasyncro_variant_id: variantId })
          .del()
      )
    ).rejects.toThrow(/append-only/i);

    const after = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first()
    );
    expect(after).toEqual(before);
  });

  // ── S2-09 ─────────────────────────────────────────────────────────────
  it('S2-09: cross-tenant expectation row access is rejected by RLS', async () => {
    const shopIdA = await createFixtureShop('s2-09-a', 'reconcile_opening_expectation_v2');
    const shopIdB = await createFixtureShop('s2-09-b', 'reconcile_opening_expectation_v2');

    const variantIdB = await seedVariant(shopIdB, 'S2-09-B');
    const shopifyVariantIdB = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;
    await seedIdentityMapping(shopIdB, variantIdB, shopifyVariantIdB);

    await runSeed(shopIdB, buildShopifyResponse([{ shopifyVariantId: shopifyVariantIdB, inventoryQuantity: 5 }]));

    const rowUnderB = await withTenant(shopIdB, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopIdB, lasyncro_variant_id: variantIdB })
        .first()
    );
    expect(rowUnderB).toBeDefined();

    // Attempt to read shop B's row while tenant context is set to shop A.
    const rowFromA = await withTenant(shopIdA, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopIdB, lasyncro_variant_id: variantIdB })
        .first()
    );
    expect(rowFromA).toBeUndefined();
  });
});
