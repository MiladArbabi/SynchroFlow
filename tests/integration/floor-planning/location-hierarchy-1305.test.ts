import type { Knex } from 'knex';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { lockLocationHierarchy, validateLocationHierarchy } from 'api-src/services/inventory/locationHierarchy.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

async function fixture() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `hierarchy-1305-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const warehouseId = crypto.randomUUID();
  const otherWarehouseId = crypto.randomUUID();
  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`,
      password_hash: 'not_a_real_hash', first_name: 'Owner', role: 'owner' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: user.id,
      phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', allow_overage: true,
      billing_provider: 'stripe', stripe_customer_id: null });
    await trx('warehouses').insert([
      { shop_id: shopId, warehouse_id: warehouseId, name: 'Main', root_location_code: 'ROOT', is_default: true },
      { shop_id: shopId, warehouse_id: otherWarehouseId, name: 'Other', root_location_code: 'OTHER' },
    ]);
    for (const code of ['ROOT', 'A', 'B', 'C']) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: warehouseId,
        location_code: code, type: code === 'ROOT' ? 'warehouse' : 'bin',
        parent_location_code: code === 'ROOT' ? null : 'ROOT', active: true, zone_type: 'pick' });
    }
    await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: otherWarehouseId,
      location_code: 'OTHER', type: 'warehouse', active: true });
    return Number(user.id);
  });
  return { shopId, warehouseId, otherWarehouseId, token: issueTestToken({ shopId, userId, tier: 'growth' }) };
}

async function parents(shopId: number) {
  return withTenant(shopId, trx => trx('warehouse_locations').where({ shop_id: shopId })
    .orderBy('location_code').select('location_code', 'parent_location_code', 'barcode', 'rack_levels'));
}

beforeAll(() => { process.env.JWT_SECRET ||= 'test_jwt_secret'; });

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


describe('GH1305 hierarchy integrity', () => {
  it('runs as restricted sf_app with forced tenant RLS', async () => {
    const f = await fixture();
    await withTenant(f.shopId, async trx => {
      const r = await trx.raw(`SELECT current_user AS role, rolsuper, rolbypassrls,
        relrowsecurity, relforcerowsecurity FROM pg_roles CROSS JOIN pg_class
        WHERE rolname = current_user AND pg_class.oid = 'public.warehouse_locations'::regclass`);
      expect(r.rows[0]).toEqual({ role: 'sf_app', rolsuper: false, rolbypassrls: false,
        relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  it('rejects self and ancestor cycles through the registered PATCH route with rollback', async () => {
    const f = await fixture();
    const base = '/api/v1/floor-planning/zones/';
    const patch = (code: string, parent: string) => request(app).patch(base + code)
      .set('Authorization', `Bearer ${f.token}`).send({ parent_location_code: parent });
    expect((await patch('B', 'A')).status).toBe(200);
    expect((await patch('C', 'B')).status).toBe(200);
    const before = await parents(f.shopId);
    expect((await patch('A', 'A')).body.error).toBe('LOCATION_HIERARCHY_CYCLE');
    const cycle = await patch('A', 'C');
    expect(cycle.status).toBe(409);
    expect(cycle.body.error).toBe('LOCATION_HIERARCHY_CYCLE');
    expect(await parents(f.shopId)).toEqual(before);
  });

  it('rejects cross-warehouse and foreign-tenant parents and ownership through API and SQL', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await withTenant(foreign.shopId, trx => trx('warehouse_locations').insert({ shop_id: foreign.shopId,
      warehouse_id: foreign.warehouseId, location_code: 'FOREIGN', type: 'bin' }));
    for (const parent of ['OTHER', 'FOREIGN']) {
      const r = await request(app).patch('/api/v1/floor-planning/zones/A')
        .set('Authorization', `Bearer ${f.token}`).send({ parent_location_code: parent });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('LOCATION_PARENT_INVALID');
    }
    await expect(withTenant(f.shopId, trx => trx('warehouse_locations')
      .where({ shop_id: f.shopId, location_code: 'A' }).update({ parent_location_code: 'OTHER' })))
      .rejects.toThrow('LOCATION_PARENT_INVALID');
    await expect(withTenant(f.shopId, trx => trx('warehouse_locations').insert({ shop_id: f.shopId,
      warehouse_id: foreign.warehouseId, location_code: 'BAD', type: 'bin' })))
      .rejects.toThrow('LOCATION_WAREHOUSE_INVALID');
    await withTenant(f.shopId, async trx => {
      expect(await trx('warehouse_locations').where({ shop_id: foreign.shopId })).toEqual([]);
    });
  });

  it('creates independent explicit codes, keeps tenant uniqueness, and never derives rows from rack_levels', async () => {
    const f = await fixture();
    const r = await request(app).post('/api/v1/floor-planning/zones')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ location_code: 'A-S1', type: 'bin', parent_location_code: 'A' });
    expect(r.status).toBe(201);
    const before = await parents(f.shopId);
    const geometry = await request(app).patch('/api/v1/floor-planning/zones/A')
      .set('Authorization', `Bearer ${f.token}`).send({ rack_levels: 4 });
    expect(geometry.status).toBe(200);
    expect((await parents(f.shopId)).map(r => r.location_code)).toEqual(before.map(r => r.location_code));
    await expect(withTenant(f.shopId, trx => trx('warehouse_locations').insert({ shop_id: f.shopId,
      warehouse_id: f.otherWarehouseId, location_code: 'A', type: 'bin' }))).rejects.toMatchObject({ code: '23505' });
    await expect(withTenant(f.shopId, trx => trx('warehouse_locations')
      .where({ shop_id: f.shopId, location_code: 'A' }).delete())).rejects.toMatchObject({ code: '23503' });
  });

  it('serializes genuinely overlapping reciprocal reparenting; the waiter sees the committed ancestor', async () => {
    const f = await fixture();
    // Hold a committed-edge candidate while a second connection enters the DB guard.
    let release!: () => void;
    let firstReady!: () => void;
    const ready = new Promise<void>(r => { firstReady = r; });
    const hold = new Promise<void>(r => { release = r; });
    const first = withTenant(f.shopId, async trx => {
      await lockLocationHierarchy(trx, f.shopId);
      await validateLocationHierarchy(trx, { shopId: f.shopId, warehouseId: f.warehouseId,
        locationCode: 'A', parentCode: 'B', barcode: null });
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ parent_location_code: 'B' });
      firstReady();
      await hold;
    });
    await ready;
    let secondPid!: number;
    let secondStarted!: () => void;
    const started = new Promise<void>(r => { secondStarted = r; });
    const second = withTenant(f.shopId, async trx => {
      secondPid = (await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      secondStarted();
      // Direct SQL exercises the trigger, independently of the API helper.
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'B' }).update({ parent_location_code: 'A' });
    }).then(() => ({ error: null }), error => ({ error }));
    try {
      await started;
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        waiting = await withTenant(f.shopId, async trx => {
          const r = await trx.raw(`SELECT EXISTS (SELECT 1 FROM pg_locks
            WHERE pid = ? AND locktype = 'advisory' AND NOT granted) AS waiting`, [secondPid]);
          return r.rows[0].waiting;
        });
      }
      expect(waiting).toBe(true); // prove overlap before releasing the first writer
    } finally { release(); await first; }
    expect((await second).error?.message).toContain('LOCATION_HIERARCHY_CYCLE');
    const final = await parents(f.shopId);
    expect(final.find(r => r.location_code === 'A').parent_location_code).toBe('B');
    expect(final.find(r => r.location_code === 'B').parent_location_code).toBe('ROOT');
  });

  it('configures one child pick bin without geometry or moving stocked-parent inventory', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => seedInventory(trx, f.shopId, 'A'));
    const stock = () => withTenant(f.shopId, async trx => {
      const result: Record<string, unknown> = {};
      for (const table of ['inventory_truth', 'inventory_units', 'inventory_movements', 'pick_reservation_allocations']) {
        result[table] = await trx(table).where({ shop_id: f.shopId }).select('*').orderByRaw('to_jsonb(??)::text', [table]);
      }
      return result;
    });
    const before = await stock();
    const response = await request(app).post('/api/v1/floor-planning/zones')
      .set('Authorization', `Bearer ${f.token}`).send({ location_code: 'A-S1', type: 'bin',
        parent_location_code: 'A', zone_type: 'pick', barcode: 'shelf override' });
    expect(response.status).toBe(201);
    await withTenant(f.shopId, async trx => {
      const children = await trx('warehouse_locations').where({ shop_id: f.shopId, parent_location_code: 'A' });
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ location_code: 'A-S1', type: 'bin', zone_type: 'pick',
        warehouse_id: f.warehouseId, barcode: 'shelf override', position_x: null, position_y: null,
        width: null, depth: null, rack_levels: null });
      const layout = await request(app).get('/api/v1/floor-planning/layout').set('Authorization', `Bearer ${f.token}`);
      expect(layout.status).toBe(200);
      expect(layout.body.zones).toEqual(expect.arrayContaining([expect.objectContaining({ location_code: 'A-S1', parent_location_code: 'A' })]));
    });
    expect(await stock()).toEqual(before);
  });

  it('fails closed for a stale-snapshot isolation level', async () => {
    const f = await fixture();
    await expect(withTenant(f.shopId, async trx => {
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ parent_location_code: 'B' });
    }, { isolationLevel: 'repeatable read' })).rejects.toThrow('LOCATION_ISOLATION_UNSUPPORTED');
  });
});
