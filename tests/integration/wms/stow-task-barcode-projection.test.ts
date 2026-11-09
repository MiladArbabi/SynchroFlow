import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { httpGetStowTasks } from 'api-src/api/wms/wms.controller';
import { resolveBarcode } from 'api-src/services/wms/barcodeResolution.service';

/**
 * SF-STOW-UX-REFINEMENT-01 — GET /wms/stow-tasks `barcode`.
 *
 * Contract: the field is the merchant's external product barcode
 * (variants.barcode), exposed ONLY when a Stow scan of exactly that value
 * would place the task's own variant. Otherwise null. It is never an SKU or an
 * LSP- identity, and it is read-only.
 *
 * Every non-null projection is cross-checked against the real resolver, so the
 * projection cannot drift from resolveBarcode precedence unnoticed.
 */

const EAN = '7350000000011';

async function createFixtureShop(): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `stow-barcode-${crypto.randomUUID().slice(0, 8)}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function insertVariant(
  shopId: number,
  values: { barcode: string | null; sku?: string | null },
): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Barcode projection product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: values.sku === undefined ? `BP-${variantId.slice(0, 8)}` : values.sku,
      barcode: values.barcode,
      title: 'Barcode projection variant',
      unit_cost: '5.00',
      status: 'active',
    });
    return variantId;
  });
}

/** Non-inbound trigger: no Receive lineage is needed to be listed. */
async function insertTask(shopId: number, variantId: string): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const row = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        quantity: 1,
        status: 'pending',
        trigger: 'return_restock',
      })
      .returning('stow_task_id')
      .then((rows) => rows[0]);
    return String((row as any).stow_task_id ?? row);
  });
}

async function fixture(values: { barcode: string | null; sku?: string | null }) {
  const shopId = await createFixtureShop();
  const variantId = await insertVariant(shopId, values);
  const taskId = await insertTask(shopId, variantId);
  return { shopId, variantId, taskId };
}

async function projectedTask(shopId: number, taskId: string) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  await httpGetStowTasks({ user: { shopId } } as any, res);
  expect(res.statusCode).toBe(200);
  const task = (res.body.stow_tasks as any[]).find((t) => t.stow_task_id === taskId);
  expect(task).toBeDefined();
  return task;
}

async function resolvedVariant(shopId: number, scanned: string): Promise<string | null> {
  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, scanned));
  return result?.lasyncro_variant_id ?? null;
}

/** Eligible: projected exactly, and the real resolver places this variant. */
async function expectEligible(f: { shopId: number; variantId: string; taskId: string }, value: string) {
  const task = await projectedTask(f.shopId, f.taskId);
  expect(task.barcode).toBe(value);
  await expect(resolvedVariant(f.shopId, value)).resolves.toBe(f.variantId);
}

async function setLegacyFallback(shopId: number, enabled: boolean) {
  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .insert({ shop_id: shopId, legacy_barcode_fallback_enabled: enabled, bootstrap_model: 'legacy_opening_balance_v1' })
      .onConflict('shop_id')
      .merge({ legacy_barcode_fallback_enabled: enabled }));
}

async function insertIdentityMapBarcode(shopId: number, variantId: string, barcode: string) {
  await withTenant(shopId, (trx) =>
    trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      platform: 'shopify',
      external_product_id: `gid-p-${crypto.randomUUID().slice(0, 8)}`,
      external_variant_id: `gid-v-${crypto.randomUUID().slice(0, 8)}`,
      barcode,
    }));
}

async function insertLocation(shopId: number, locationCode: string, barcode: string | null) {
  await withTenant(shopId, async (trx) => {
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Barcode projection warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: locationCode, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'storage', barcode },
    ]);
  });
}

describe('SF-STOW-UX-REFINEMENT-01 — stow task product barcode projection', () => {
  it('exposes the external product barcode when a scan of it places this variant', async () => {
    const f = await fixture({ barcode: EAN });
    await expectEligible(f, EAN);
  });

  it('is additive: existing identity fields are unchanged', async () => {
    const f = await fixture({ barcode: EAN, sku: 'BP-SKU-1' });
    const task = await projectedTask(f.shopId, f.taskId);
    expect(task.sku).toBe('BP-SKU-1');
    expect(task.lasyncro_variant_id).toBe(f.variantId);
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
  ])('is null for a %s barcode, and never falls back to the SKU', async (_label, barcode) => {
    const f = await fixture({ barcode, sku: 'BP-SKU-ONLY' });
    const task = await projectedTask(f.shopId, f.taskId);
    expect(task.barcode).toBeNull();
    expect(task.sku).toBe('BP-SKU-ONLY');
  });

  it('is null for a padded stored value, which a trimmed scan can never match', async () => {
    const f = await fixture({ barcode: ` ${EAN} ` });
    expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
    await expect(resolvedVariant(f.shopId, EAN)).resolves.not.toBe(f.variantId);
  });

  it.each(['LSU-ABCD1234', 'LSO-ABCD1234', 'LSP-ABCD1234'])(
    'is null for a reserved-namespace value (%s)',
    async (reserved) => {
      const f = await fixture({ barcode: reserved });
      expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
      await expect(resolvedVariant(f.shopId, reserved)).resolves.not.toBe(f.variantId);
    },
  );

  it('honours the tenant legacy-fallback gate: disabled hides, enabled shows', async () => {
    const f = await fixture({ barcode: EAN });

    await setLegacyFallback(f.shopId, false);
    expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
    await expect(resolvedVariant(f.shopId, EAN)).resolves.toBeNull();

    await setLegacyFallback(f.shopId, true);
    await expectEligible(f, EAN);
  });

  it('is null when the identity map, consulted first, sends the value to another variant', async () => {
    const f = await fixture({ barcode: EAN });
    const other = await insertVariant(f.shopId, { barcode: null });
    await insertIdentityMapBarcode(f.shopId, other, EAN);

    expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
    await expect(resolvedVariant(f.shopId, EAN)).resolves.toBe(other);
  });

  it('stays eligible when the identity map names this same variant', async () => {
    const f = await fixture({ barcode: EAN });
    await insertIdentityMapBarcode(f.shopId, f.variantId, EAN);
    await expectEligible(f, EAN);
  });

  it('is null when another variant in the shop carries the same barcode', async () => {
    const f = await fixture({ barcode: EAN });
    await insertVariant(f.shopId, { barcode: EAN });
    expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
  });

  it.each([
    ['location code', (shopId: number) => insertLocation(shopId, EAN, null)],
    ['location barcode', (shopId: number) => insertLocation(shopId, 'A-1', EAN)],
  ])('is null when a %s equals the value, since that scan switches bins', async (_label, seed) => {
    const f = await fixture({ barcode: EAN });
    await seed(f.shopId);
    expect((await projectedTask(f.shopId, f.taskId)).barcode).toBeNull();
  });

  it('is tenant-scoped: the same barcode in another shop does not suppress it', async () => {
    const f = await fixture({ barcode: EAN });
    const otherShop = await createFixtureShop();
    await insertVariant(otherShop, { barcode: EAN });
    await insertIdentityMapBarcode(otherShop, await insertVariant(otherShop, { barcode: null }), EAN);
    await setLegacyFallback(otherShop, false);

    await expectEligible(f, EAN);
  });
});
