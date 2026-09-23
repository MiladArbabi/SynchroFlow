// tests/integration/inventory/shopify-opening-balance-legacy-regression.test.ts
//
// OB-09b — SLICE 0 regression freeze. A legacy tenant's physical inventory
// derived solely from the EXISTING Shopify opening_balance movement (the
// exact row shape seedShopifyOpeningBalances.ts's legacy_opening_balance_v1
// path writes) must remain effective after the CURRENT
// projection rebuild path runs, and the original opening_balance movement
// row itself must be byte-for-byte/field-for-field unchanged afterward.
// PERMANENT regression contract, authored ahead of Slice 1 production/schema
// changes ("bootstrap_model") to this exact opening-balance flow.
//
// PLACEMENT
//   tests/integration/ (backend-integration project), disposable-PostgreSQL
//   harness. Fixture pattern mirrors
//   tests/integration/wms/stow-receive-lineage-contract.test.ts.
//
// SCOPE
//   Exercises the CURRENT rebuildInventoryProjectionForVariants read/replay
//   path only. Does not call seedShopifyOpeningBalances.ts itself (that
//   requires a live/injected Shopify GraphQL client and is read-only per
//   brief) — the fixture row below matches its exact persisted shape
//   (movement_type='opening_balance', reference_type='opening_balance',
//   platform='shopify', location_code=WH-{shopId}-ROOT, triggered_by='system').

import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';

// Matches seedShopifyOpeningBalances.ts's OPENING_BALANCE_NAMESPACE exactly —
// this is the same deterministic device_event_id derivation the production
// seeder uses, so the fixture row is structurally identical to what that
// seeder would have written for this shop/variant.
const OPENING_BALANCE_NAMESPACE = '9f0e7b9c-6d4a-4e91-bc5e-2a1f8c7d3e44';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedLegacyOpeningBalanceFixture(shopId: number, qty: number) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const movementId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'OB-09b legacy product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OB09B-${variantId.slice(0, 8)}`,
      title: 'OB-09b legacy variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: movementId,
      device_event_id: uuidv5(
        `${shopId}:${variantId}:opening_balance`,
        OPENING_BALANCE_NAMESPACE
      ),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'opening_balance',
      quantity_delta: qty,
      reference_type: 'opening_balance',
      reference_id: crypto.randomUUID(),
      platform: 'shopify',
      location_code: rootCode,
      occurred_at: new Date('2026-01-01T00:00:00Z'),
      triggered_by: 'system',
    });
  });

  return { productId, variantId, rootCode, movementId };
}

describe('OB-09b — legacy Shopify opening_balance stock survives projection rebuild unchanged', () => {
  it('rebuild derives physical on-hand/available solely from the legacy opening_balance row, and the movement row itself is untouched', async () => {
    const shopId = await createFixtureShop('ob09b');
    const qty = 42;
    const fixture = await seedLegacyOpeningBalanceFixture(shopId, qty);

    const movementBefore = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: fixture.movementId })
        .first()
    );
    expect(movementBefore).toBeDefined();

    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(
        shopId,
        [fixture.variantId],
        trx,
        new Date('2026-01-02T00:00:00Z')
      );
    });

    const truth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: fixture.variantId, location_code: fixture.rootCode })
        .first('on_hand_quantity', 'reserved_quantity', 'available_quantity')
    );

    expect(truth).toEqual({
      on_hand_quantity: qty,
      reserved_quantity: 0,
      available_quantity: qty,
    });

    const movementAfter = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: fixture.movementId })
        .first()
    );

    // Field-for-field: the append-only row the seeder would have written is
    // byte-for-byte unchanged by the rebuild replay.
    expect(movementAfter).toEqual(movementBefore);
  });

  it('a zero-quantity legacy opening_balance row (explicit zero baseline) still produces a zero physical row after rebuild, unchanged movement', async () => {
    const shopId = await createFixtureShop('ob09b-zero');
    const fixture = await seedLegacyOpeningBalanceFixture(shopId, 0);

    const movementBefore = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: fixture.movementId })
        .first()
    );

    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await rebuildInventoryProjectionForVariants(
        shopId,
        [fixture.variantId],
        trx,
        new Date('2026-01-02T00:00:00Z')
      );
    });

    const truth = await withTenant(shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: fixture.variantId, location_code: fixture.rootCode })
        .first('on_hand_quantity', 'reserved_quantity', 'available_quantity')
    );
    expect(truth).toEqual({ on_hand_quantity: 0, reserved_quantity: 0, available_quantity: 0 });

    const movementAfter = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: fixture.movementId })
        .first()
    );
    expect(movementAfter).toEqual(movementBefore);
  });
});
