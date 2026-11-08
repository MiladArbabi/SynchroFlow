import crypto from 'crypto';
import knexLib, { Knex } from 'knex';
import { systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import * as migration from '../../../apps/backend/migrations/20261108120000_0229_harden_location_hierarchy';

jest.setTimeout(30000);

let admin: Knex;
let shopA: number;
let shopB: number;
const rollback = new Error('GH1305_ROLLBACK');

beforeAll(async () => {
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) throw new Error('DISPOSABLE_TEST_CONTEXT_REQUIRED');
  admin = knexLib({ client: 'pg', connection: { host: process.env.PGHOST, port: Number(process.env.PGPORT),
    user: process.env.PGMIGRATION_USER, password: process.env.PGMIGRATION_PASSWORD,
    database: process.env.PGDATABASE }, pool: { min: 0, max: 2 } });
  const makeShop = () => systemTransaction(async trx => {
    const id = await createTenantShop(trx, `migration-1305-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
  shopA = await makeShop();
  shopB = await makeShop();
});
afterAll(async () => { if (admin) await admin.destroy(); });

async function rolledBack(body: (trx: Knex.Transaction) => Promise<void>) {
  try {
    await admin.transaction(async trx => {
      await trx.raw('SET LOCAL row_security = off');
      await body(trx);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

/** Reconstruct the actual pre-0229 shapes; never invoke the forward-only down. */
async function previousSchema(trx: Knex.Transaction, production: boolean) {
  await trx.raw(`
    DROP TRIGGER warehouse_locations_integrity_1305 ON public.warehouse_locations;
    DROP FUNCTION public.guard_location_integrity_1305();
    DROP FUNCTION public.assert_location_integrity_1305(integer, uuid, text, text, text);
    ALTER TABLE public.warehouse_locations DROP CONSTRAINT warehouse_locations_owner_1305_fk;
  `);
  if (production) {
    await trx.raw(`
      ALTER TABLE public.warehouse_locations DROP CONSTRAINT warehouse_locations_parent_same_warehouse_fk;
      ALTER TABLE public.warehouse_locations DROP CONSTRAINT IF EXISTS warehouse_locations_warehouse_code_unique;
      DROP INDEX IF EXISTS public.warehouse_locations_warehouse_code_unique;
      ALTER TABLE public.warehouse_locations ADD CONSTRAINT warehouse_locations_shop_id_parent_location_code_foreign
        FOREIGN KEY (shop_id, parent_location_code) REFERENCES public.warehouse_locations(shop_id, location_code) ON DELETE RESTRICT;
    `);
  }
}

async function seed(trx: Knex.Transaction, shop: number) {
  await setTenantContext(trx, shop);
  const warehouse = crypto.randomUUID();
  const root = 'LEGACY-' + crypto.randomBytes(4).toString('hex');
  await trx('warehouses').insert({ shop_id: shop, warehouse_id: warehouse, name: root,
    root_location_code: root, is_default: false });
  await trx('warehouse_locations').insert({ shop_id: shop, warehouse_id: warehouse,
    location_code: root, type: 'warehouse', barcode: 'label-' + root, rack_levels: 4, max_capacity: 30 });
  await trx('warehouse_locations').insert({ shop_id: shop, warehouse_id: warehouse,
    location_code: root + '-RACK', parent_location_code: root, type: 'bin', active: true, zone_type: 'pick' });
  await trx('warehouse_locations').insert({ shop_id: shop, warehouse_id: warehouse,
    location_code: root + '-BIN', parent_location_code: root + '-RACK', type: 'bin', active: false });
  return { warehouse, root };
}

async function snapshot(trx: Knex.Transaction) {
  const result: Record<string, unknown> = {};
  for (const table of ['warehouse_locations', 'inventory_movements', 'inventory_truth', 'inventory_units', 'pick_reservation_allocations']) {
    result[table] = await trx(table).whereIn('shop_id', [shopA, shopB]).select('*').orderByRaw('to_jsonb(??)::text', [table]);
  }
  return result;
}

async function seedInventory(trx: Knex.Transaction, shop: number, root: string) {
  await setTenantContext(trx, shop);
  const product = crypto.randomUUID();
  const variant = crypto.randomUUID();
  await trx('products').insert({ shop_id: shop, lasyncro_product_id: product, title: 'Legacy stock', status: 'active', product_type: 'physical' });
  await trx('variants').insert({ shop_id: shop, lasyncro_product_id: product, lasyncro_variant_id: variant,
    title: 'Legacy variant', sku: crypto.randomUUID(), unit_cost: '1.00', status: 'active' });
  const [supplier] = await trx('suppliers').insert({ shop_id: shop, name: 'Legacy supplier' }).returning('id');
  const [po] = await trx('purchase_orders').insert({ shop_id: shop, supplier_id: supplier.id, status: 'shipped' }).returning('id');
  const [job] = await trx('receive_jobs').insert({ shop_id: shop, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2 }).returning('receive_job_id');
  const [line] = await trx('receive_job_lines').insert({ shop_id: shop, receive_job_id: job.receive_job_id,
    lasyncro_variant_id: variant, quantity_expected: 1 }).returning('receive_job_line_id');
  await trx('inventory_units').insert({ shop_id: shop, lasyncro_variant_id: variant,
    lasyncro_unit_id: 'LSU-' + crypto.randomBytes(4).toString('hex'), receive_job_line_id: line.receive_job_line_id,
    receive_sequence: 1, status: 'stowed', current_location_code: root });
  await trx('inventory_movements').insert({ shop_id: shop, lasyncro_variant_id: variant,
    lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
    movement_type: 'inbound_purchase', quantity_delta: 1, reference_type: 'test_fixture_receipt',
    reference_id: crypto.randomUUID(), platform: 'wms', location_code: root,
    occurred_at: new Date(), triggered_by: 'test_fixture' });
  await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
  await trx('inventory_truth').insert({ shop_id: shop, lasyncro_variant_id: variant, location_code: root,
    on_hand_quantity: 1, reserved_quantity: 0, committed_quantity: 0, available_quantity: 1, last_evaluated_at: new Date() });
}

async function validShape(production: boolean) {
  await rolledBack(async trx => {
    await previousSchema(trx, production);
    const a = await seed(trx, shopA);
    await seed(trx, shopB);
    await seedInventory(trx, shopA, a.root + '-RACK');
    const before = await snapshot(trx);
    await migration.up(trx);
    expect(await snapshot(trx)).toEqual(before);
    const keys = await trx.raw(`SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'public.warehouse_locations'::regclass
        AND conname IN ('warehouse_locations_parent_same_warehouse_fk', 'warehouse_locations_owner_1305_fk') ORDER BY conname`);
    expect(keys.rows).toEqual([
      { conname: 'warehouse_locations_owner_1305_fk', convalidated: true },
      { conname: 'warehouse_locations_parent_same_warehouse_fk', convalidated: true },
    ]);
    const policy = await trx.raw(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.warehouse_locations'::regclass`);
    expect(policy.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    // Validate migrated behavior using the restricted role on this same schema transaction.
    await trx.raw('SET LOCAL ROLE sf_app');
    await trx.raw('SET LOCAL row_security = on');
    await setTenantContext(trx, shopA);
    const role = await trx.raw('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0]).toEqual({ role: 'sf_app', rolsuper: false, rolbypassrls: false });
    expect(await trx('warehouse_locations').where({ shop_id: shopB })).toEqual([]);
    await expect(trx.transaction(sp => sp('warehouse_locations')
      .where({ shop_id: shopA, location_code: a.root }).delete())).rejects.toMatchObject({ code: '23503' });
    await trx('warehouse_locations').insert({ shop_id: shopA, warehouse_id: a.warehouse,
      location_code: a.root + '-NEW', parent_location_code: a.root, type: 'bin' });
  });
}

async function invalidData(kind: 'cycle' | 'parent' | 'owner' | 'identity', expected: string) {
  await rolledBack(async trx => {
    await previousSchema(trx, true);
    const a = await seed(trx, shopA);
    const b = await seed(trx, shopB);
    // Keep tenant context on A while corrupting B: validation must scan all tenants.
    await setTenantContext(trx, shopA);
    if (kind === 'cycle') await trx('warehouse_locations').where({ shop_id: shopB, location_code: b.root })
      .update({ parent_location_code: b.root + '-BIN' });
    if (kind === 'identity') await trx('warehouse_locations').where({ shop_id: shopB, location_code: b.root + '-BIN' })
      .update({ barcode: b.root });
    if (kind === 'owner') await trx('warehouse_locations').where({ shop_id: shopB, location_code: b.root + '-BIN' })
      .update({ warehouse_id: a.warehouse });
    if (kind === 'parent') {
      const other = await seed(trx, shopB);
      await trx('warehouse_locations').where({ shop_id: shopB, location_code: b.root + '-BIN' })
        .update({ parent_location_code: other.root });
    }
    const before = await snapshot(trx);
    await expect(migration.up(trx)).rejects.toThrow(expected);
    expect(await snapshot(trx)).toEqual(before);
    // Retrying an unchanged invalid dataset must fail identically and preserve it.
    await expect(migration.up(trx)).rejects.toThrow(expected);
    expect(await snapshot(trx)).toEqual(before);
    const guard = await trx.raw(`SELECT to_regprocedure('public.assert_location_integrity_1305(integer,uuid,text,text,text)') AS fn`);
    expect(guard.rows[0].fn).toBeNull(); // failed migration rolled back its DDL
  });
}

describe('GH1305 bounded forward migration', () => {
  it('preserves fresh-schema legacy identities and stocked parents, with RLS enforced', async () => { await validShape(false); });
  it('repairs production-shaped FK/index drift without changing stock or identity', async () => { await validShape(true); });
  it('fails without repairing cycles in a different tenant', async () => { await invalidData('cycle', 'LOCATION_LEGACY_HIERARCHY_CYCLE'); });
  it('fails without repairing cross-warehouse parents', async () => { await invalidData('parent', 'LOCATION_LEGACY_PARENT_INVALID'); });
  it('fails without repairing cross-tenant warehouse ownership', async () => { await invalidData('owner', 'LOCATION_LEGACY_WAREHOUSE_INVALID'); });
  it('fails without rewriting inactive legacy barcode collisions', async () => { await invalidData('identity', 'LOCATION_LEGACY_IDENTITY_COLLISION'); });
  it('refuses down without weakening integrity', async () => { await expect(migration.down()).rejects.toThrow('forward-only'); });
});
