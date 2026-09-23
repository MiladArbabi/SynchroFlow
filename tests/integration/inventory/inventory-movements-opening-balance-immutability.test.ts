// tests/integration/inventory/inventory-movements-opening-balance-immutability.test.ts
//
// OB-09a — SLICE 0 regression freeze. Proves the CURRENT
// prevent_inventory_movements_mutation() trigger (migration
// 20260214150348_0037_create_inventory_ledger_and_projection.ts) blocks
// UPDATE and DELETE on an existing movement_type='opening_balance' row in
// inventory_movements, exactly as it blocks every other movement type.
// PERMANENT regression contract, authored to freeze CURRENT behavior ahead
// of Slice 1 production/schema changes to opening-balance handling.
//
// PLACEMENT
//   tests/integration/ (backend-integration project) — the only Jest
//   project wired to the disposable-PostgreSQL harness
//   scripts/with-test-db.js. Mirrors
//   tests/integration/inventory/stock-protection-policy.migration.test.ts
//   and tests/integration/billing/shop-subscription-transition-ledger.migration.test.ts.
//
// SCOPE
//   Only the append-only trigger's exact behavior on an opening_balance row.
//   Does not touch inventory_truth, does not create any new schema.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedVariant(shopId: number): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'OB-09a fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OB09A-${variantId.slice(0, 8)}`,
      title: 'OB-09a fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

async function seedOpeningBalanceMovement(
  shopId: number,
  variantId: string,
  quantityDelta: number
): Promise<string> {
  const movementId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  await withTenant(shopId, (trx) =>
    trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: movementId,
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'opening_balance',
      quantity_delta: quantityDelta,
      reference_type: 'opening_balance',
      reference_id: crypto.randomUUID(),
      platform: 'shopify',
      location_code: rootCode,
      occurred_at: new Date(),
    })
  );
  return movementId;
}

describe('OB-09a — inventory_movements append-only trigger covers movement_type=opening_balance', () => {
  it('INSERT of an opening_balance row is permitted', async () => {
    const shopId = await createFixtureShop('ob09a-insert');
    const variantId = await seedVariant(shopId);
    await seedOpeningBalanceMovement(shopId, variantId, 7);

    const [{ count }] = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'opening_balance' })
        .count<{ count: string }[]>('* as count')
    );
    expect(Number(count)).toBe(1);
  });

  it('UPDATE of an existing opening_balance row is rejected, row is unchanged', async () => {
    const shopId = await createFixtureShop('ob09a-update');
    const variantId = await seedVariant(shopId);
    const movementId = await seedOpeningBalanceMovement(shopId, variantId, 11);

    const before = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: movementId })
        .first('quantity_delta', 'location_code', 'movement_type')
    );

    await expect(
      withTenant(shopId, (trx) =>
        trx('inventory_movements')
          .where({ shop_id: shopId, lasyncro_inventory_movement_id: movementId })
          .update({ quantity_delta: 999 })
      )
    ).rejects.toThrow(/append-only/i);

    const after = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: movementId })
        .first('quantity_delta', 'location_code', 'movement_type')
    );
    expect(after).toEqual(before);
  });

  it('DELETE of an existing opening_balance row is rejected, row still present', async () => {
    const shopId = await createFixtureShop('ob09a-delete');
    const variantId = await seedVariant(shopId);
    const movementId = await seedOpeningBalanceMovement(shopId, variantId, 3);

    await expect(
      withTenant(shopId, (trx) =>
        trx('inventory_movements')
          .where({ shop_id: shopId, lasyncro_inventory_movement_id: movementId })
          .del()
      )
    ).rejects.toThrow(/append-only/i);

    const [{ count }] = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_inventory_movement_id: movementId })
        .count<{ count: string }[]>('* as count')
    );
    expect(Number(count)).toBe(1);
  });
});
