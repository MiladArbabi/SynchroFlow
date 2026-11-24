import crypto from 'crypto';
import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createRecountTask } from 'api-src/services/wms/inventoryRecount.service';

async function fixture(twoWarehouses = true) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `f2-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const w1 = crypto.randomUUID(), w2 = crypto.randomUUID();
  const product = crypto.randomUUID(), v1 = crypto.randomUUID(), v2 = crypto.randomUUID();
  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`,
      password_hash: 'not_a_real_hash', role: 'owner' }).returning('id');
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' });
    for (const [warehouseId, root, isDefault] of [[w1, 'ROOT1', true], ...(twoWarehouses ? [[w2, 'ROOT2', false]] : [])] as [string, string, boolean][]) {
      await trx('warehouses').insert({ shop_id: shopId, warehouse_id: warehouseId,
        name: root, root_location_code: root, is_default: isDefault, active: true });
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: warehouseId,
        location_code: root, type: 'warehouse', active: true, parent_location_code: null });
      const codes = warehouseId === w1 ? ['A', 'B'] : ['C', 'D', 'OLD'];
      for (const code of codes) await trx('warehouse_locations').insert({ shop_id: shopId,
        warehouse_id: warehouseId, location_code: code, type: 'bin', zone_type: 'pick',
        parent_location_code: root, active: code !== 'OLD' });
    }
    await trx('products').insert({ shop_id: shopId, lasyncro_product_id: product,
      title: 'F2 stock', status: 'active', product_type: 'physical' });
    await trx('variants').insert([v1, v2].map((id, i) => ({ shop_id: shopId,
      lasyncro_product_id: product, lasyncro_variant_id: id, title: `F2 ${i}`,
      sku: `${suffix}-${i}`, status: 'active', unit_cost: '1.00' })));
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    // OLD models a retained zero-balance inventory record at an inactive W2 address.
    const rows: [string, string, number][] = [[v1, 'ROOT1', 1], [v1, 'A', 5], [v2, 'B', 3],
      ...(twoWarehouses ? [[v1, 'C', 9], [v2, 'D', 11], [v1, 'OLD', 0]] as [string, string, number][] : [])];
    await trx('inventory_truth').insert(rows.map(([variant, code, qty]) => ({ shop_id: shopId,
      lasyncro_variant_id: variant, location_code: code, on_hand_quantity: qty,
      reserved_quantity: 0, committed_quantity: 0, available_quantity: qty, last_evaluated_at: new Date() })));
    return Number(user.id);
  });
  return { shopId, w1, w2, v1, v2, userId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, scope: 'full' | 'variant_set' | 'location' | 'locations', extra: object = {}) =>
  withTenant(f.shopId, trx => createRecountTask(trx, { shopId: f.shopId, warehouseId: f.w1,
    createdBy: f.userId, scope, ...extra }));
async function state(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const result: Record<string, any[]> = {};
    for (const table of ['inventory_truth', 'inventory_movements', 'inventory_units', 'inventory_recount_tasks',
      'inventory_recount_lines', 'shop_wms_settings', 'warehouse_locations']) result[table] = await trx(table)
      .where({ shop_id: f.shopId }).select('*').orderByRaw('to_jsonb(??)::text', [table]);
    return result;
  });
}
async function expectCreated(f: Fixture, task: Awaited<ReturnType<typeof create>>, expected: [string, string, number][], before: Awaited<ReturnType<typeof state>>) {
  const after = await state(f);
  expect(task.line_count).toBe(expected.length);
  expect(after.inventory_recount_tasks).toHaveLength(1);
  expect(after.inventory_recount_tasks[0]).toMatchObject({ recount_task_id: task.recount_task_id,
    warehouse_id: f.w1, status: 'dispatched', blind: true, created_by: f.userId });
  expect(after.inventory_recount_lines.map(l => [l.lasyncro_variant_id, l.location_code, Number(l.expected_quantity)])
    .sort((a, b) => String(a).localeCompare(String(b))))
    .toEqual(expected.sort((a, b) => String(a).localeCompare(String(b))));
  for (const table of ['inventory_truth', 'inventory_movements', 'inventory_units', 'warehouse_locations']) expect(after[table]).toEqual(before[table]);
}

describe('GH-1305 F2 Recount warehouse candidate selection', () => {
  it('full W1 excludes W2 inventory and inactive historical addresses', async () => {
    const f = await fixture(), before = await state(f);
    await expectCreated(f, await create(f, 'full'), [[f.v1, 'ROOT1', 1], [f.v1, 'A', 5], [f.v2, 'B', 3]], before);
  });
  it('variant_set restricts both warehouse and requested variants', async () => {
    const f = await fixture(), before = await state(f);
    await expectCreated(f, await create(f, 'variant_set', { variantIds: [f.v1] }), [[f.v1, 'ROOT1', 1], [f.v1, 'A', 5]], before);
  });
  it('full retains single-warehouse and default-warehouse compatibility', async () => {
    const f = await fixture(false), before = await state(f);
    const task = await withTenant(f.shopId, trx => createRecountTask(trx, { shopId: f.shopId, scope: 'full', createdBy: f.userId }));
    await expectCreated(f, task, [[f.v1, 'ROOT1', 1], [f.v1, 'A', 5], [f.v2, 'B', 3]], before);
  });
  it('variant_set retains single-warehouse compatibility', async () => {
    const f = await fixture(false), before = await state(f);
    await expectCreated(f, await create(f, 'variant_set', { variantIds: [f.v2] }), [[f.v2, 'B', 3]], before);
  });
  it('inactive W1 candidates still reject full scope and roll back every write', async () => {
    const f = await fixture(false);
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ active: false }));
    const before = await state(f);
    await expect(create(f, 'full')).rejects.toThrow('RECOUNT_LOCATION_INELIGIBLE');
    expect(await state(f)).toEqual(before);
  });
  it('inactive W1 candidates still reject variant_set and roll back every write', async () => {
    const f = await fixture(false);
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'B' }).update({ active: false }));
    const before = await state(f);
    await expect(create(f, 'variant_set', { variantIds: [f.v2] })).rejects.toThrow('RECOUNT_LOCATION_INELIGIBLE');
    expect(await state(f)).toEqual(before);
  });
  it('explicit foreign-warehouse location is rejected rather than silently omitted', async () => {
    const f = await fixture(), before = await state(f);
    await expect(create(f, 'location', { locationCode: 'C' })).rejects.toThrow('RECOUNT_LOCATION_INELIGIBLE');
    expect(await state(f)).toEqual(before);
  });
  it('explicit mixed-warehouse locations are rejected atomically', async () => {
    const f = await fixture(), before = await state(f);
    await expect(create(f, 'locations', { locationCodes: ['A', 'C'] })).rejects.toThrow('every locationCode to belong to the selected warehouse');
    expect(await state(f)).toEqual(before);
  });
  it('foreign warehouse ids cannot select either tenant inventory', async () => {
    const f = await fixture(false), foreign = await fixture(false);
    const before = await state(f), foreignBefore = await state(foreign);
    await expect(create(f, 'full', { warehouseId: foreign.w1 })).rejects.toThrow();
    expect(await state(f)).toEqual(before); expect(await state(foreign)).toEqual(foreignBefore);
  });
  it('a mismatched foreign tenant context cannot create or modify owner work', async () => {
    const f = await fixture(false), foreign = await fixture(false);
    const before = await state(f), foreignBefore = await state(foreign);
    await expect(withTenant(foreign.shopId, trx => createRecountTask(trx, { shopId: f.shopId,
      warehouseId: f.w1, createdBy: foreign.userId, scope: 'full' }))).rejects.toThrow('LOCATION_TENANT_CONTEXT_INVALID');
    expect(await state(f)).toEqual(before); expect(await state(foreign)).toEqual(foreignBefore);
  });
  it('caller rollback restores label, tasks, lines and inventory', async () => {
    const f = await fixture(false), before = await state(f);
    await expect(withTenant(f.shopId, async trx => {
      await createRecountTask(trx, { shopId: f.shopId, warehouseId: f.w1, scope: 'full', createdBy: f.userId });
      throw new Error('F2_CALLER_ROLLBACK');
    })).rejects.toThrow('F2_CALLER_ROLLBACK');
    expect(await state(f)).toEqual(before);
  });
});
