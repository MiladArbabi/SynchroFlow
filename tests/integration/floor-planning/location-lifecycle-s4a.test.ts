import { assertStowDestinationEligible } from 'api-src/services/wms/stowDestinationEligibility.service';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { lockLocationHierarchy } from 'api-src/services/inventory/locationHierarchy.service';
import { assertLocationLifecycleEligible } from 'api-src/services/inventory/locationLifecycleEligibility.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(60000);
const app = createApp();
beforeAll(() => { process.env.JWT_SECRET ||= 'test_jwt_secret'; });

async function fixture() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `s4a-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const warehouseId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`,
      password_hash: 'not_a_real_hash', first_name: 'Owner', role: 'owner' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: user.id,
      phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', allow_overage: true,
      billing_provider: 'stripe', stripe_customer_id: null });
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' });
    await trx('warehouses').insert({ shop_id: shopId, warehouse_id: warehouseId,
      name: 'Main', root_location_code: 'ROOT', is_default: true });
    for (const code of ['ROOT', 'A', 'B', 'C']) await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouseId, location_code: code,
      type: code === 'ROOT' ? 'warehouse' : 'bin', parent_location_code: code === 'ROOT' ? null : 'ROOT',
      active: true, zone_type: 'pick' });
    await trx('products').insert({ shop_id: shopId, lasyncro_product_id: productId,
      title: 'S4A stock', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ shop_id: shopId, lasyncro_product_id: productId,
      lasyncro_variant_id: variantId, title: 'S4A variant', sku: suffix, unit_cost: '1.00', status: 'active' });
    return Number(user.id);
  });
  return { shopId, warehouseId, variantId, productId, userId,
    token: issueTestToken({ shopId, userId, tier: 'growth' }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const patch = (f: Fixture, code: string, body: object) => request(app)
  .patch('/api/v1/floor-planning/zones/' + code).set('Authorization', `Bearer ${f.token}`).send(body);
async function truth(f: Fixture, code: string, quantity = 0, reserved = 0) {
  await withTenant(f.shopId, async trx => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
      location_code: code, on_hand_quantity: quantity, reserved_quantity: reserved,
      committed_quantity: 0, available_quantity: Math.max(0, quantity - reserved), last_evaluated_at: new Date() });
  });
}
async function snapshot(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const state: Record<string, unknown> = {};
    for (const table of ['warehouse_locations', 'inventory_truth', 'inventory_units', 'inventory_movements',
      'inventory_recount_tasks', 'inventory_recount_lines', 'pick_reservation_allocations', 'pick_scan_unit_lineage',
      'pick_scan_unit_settlement', 'stow_tasks']) {
      state[table] = await trx(table).where({ shop_id: f.shopId }).select('*').orderByRaw('to_jsonb(??)::text', [table]);
    }
    return state;
  });
}

describe('GH-1305 S4A lifecycle rejection and rollback', () => {
  it('allows empty edits, deletion, geometry and no-op identity fields', async () => {
    const f = await fixture();
    expect((await patch(f, 'A', { barcode: 'A-LABEL', parent_location_code: 'B' })).status).toBe(200);
    expect((await patch(f, 'A', { active: false })).status).toBe(200);
    expect((await request(app).delete('/api/v1/floor-planning/zones/A')
      .set('Authorization', `Bearer ${f.token}`)).status).toBe(200);
    await truth(f, 'B', 2);
    expect((await patch(f, 'B', { orientation: 90, active: true, parent_location_code: 'ROOT' })).status).toBe(200);
  });

  it.each([1, -1])('rejects individual signed stock rows (%i), including direct-parent stock', async quantity => {
    const f = await fixture();
    await truth(f, 'A', quantity);
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'C' })
      .update({ parent_location_code: 'A' }));
    const before = await snapshot(f);
    for (const body of [{ active: false }, { barcode: 'NEW' }, { zone_type: 'storage' }, { parent_location_code: 'B' }]) {
      const r = await patch(f, 'A', body);
      expect({ status: r.status, error: r.body.error }).toEqual({ status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: inventory' });
      expect(await snapshot(f)).toEqual(before);
    }
  });

  it('detects descendant stock without netting opposite discrepancies', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId }).whereIn('location_code', ['B', 'C'])
      .update({ parent_location_code: 'A' }));
    await truth(f, 'B', 5); await truth(f, 'C', -5);
    const before = await snapshot(f);
    expect((await patch(f, 'A', { active: false })).status).toBe(409);
    expect(await snapshot(f)).toEqual(before);
  });

  it('protects reservations even when on-hand is zero', async () => {
    const f = await fixture(); await truth(f, 'A', 0, 1);
    const before = await snapshot(f);
    expect((await patch(f, 'A', { active: false })).status).toBe(409);
    expect(await snapshot(f)).toEqual(before);
  });

  it.each([false, true])('protects physical units at zero projected stock (identity_unverified=%s)', async unverified => {
    const f = await fixture();
    await withTenant(f.shopId, async trx => {
      const [supplier] = await trx('suppliers').insert({ shop_id: f.shopId, name: 'S4A supplier' }).returning('id');
      const [po] = await trx('purchase_orders').insert({ shop_id: f.shopId, supplier_id: supplier.id }).returning('id');
      const [job] = await trx('receive_jobs').insert({ shop_id: f.shopId, po_id: po.id }).returning('receive_job_id');
      const [line] = await trx('receive_job_lines').insert({ shop_id: f.shopId, receive_job_id: job.receive_job_id,
        lasyncro_variant_id: f.variantId, quantity_expected: 1 }).returning('receive_job_line_id');
      await trx('inventory_units').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        lasyncro_unit_id: 'LSU-' + crypto.randomBytes(4).toString('hex'), receive_job_line_id: line.receive_job_line_id,
        receive_sequence: 1, status: 'stowed', current_location_code: 'A', identity_unverified: unverified });
    });
    const before = await snapshot(f);
    const r = await patch(f, 'A', { barcode: 'NEW' });
    expect({ status: r.status, error: r.body.error }).toEqual({ status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: physical_custody' });
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['dispatched', 'counting', 'manual_review'])('protects active Recount scope without any lines (%s)', async status => {
    const f = await fixture();
    await withTenant(f.shopId, trx => trx('inventory_recount_tasks').insert({ shop_id: f.shopId,
      warehouse_id: f.warehouseId, label: 'S4A', scope: 'location', purpose: 'opening_inventory',
      scope_location_code: 'A', status, created_by: f.userId }));
    const before = await snapshot(f);
    const r = await patch(f, 'A', { active: false });
    expect({ status: r.status, error: r.body.error }).toEqual({ status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: recount' });
    expect(await snapshot(f)).toEqual(before);
  });

  it('protects active Stow work', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => trx('stow_tasks').insert({ shop_id: f.shopId,
      lasyncro_variant_id: f.variantId, quantity: 1, location_code: 'A', status: 'pending', trigger: 'inbound_stock' }));
    const before = await snapshot(f);
    expect((await patch(f, 'A', { active: false })).body.error).toBe('LOCATION_LIFECYCLE_BLOCKED: stow');
    expect(await snapshot(f)).toEqual(before);
  });

  it('rejects a whole bulk delete when one selected descendant has stock', async () => {
    const f = await fixture(); await truth(f, 'C', -1);
    const before = await snapshot(f);
    const r = await request(app).delete('/api/v1/floor-planning/zones')
      .set('Authorization', `Bearer ${f.token}`).send({ location_codes: ['B', 'C'] });
    expect(r.status).toBe(409); expect(await snapshot(f)).toEqual(before);
  });

  it('preserves ledger history and refuses unsafe code reuse', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => trx('inventory_movements').insert({ shop_id: f.shopId,
      lasyncro_variant_id: f.variantId, lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(), movement_type: 'inbound_purchase', quantity_delta: 1,
      reference_type: 'test_fixture_receipt', reference_id: crypto.randomUUID(), platform: 'wms',
      location_code: 'A', occurred_at: new Date(), triggered_by: 'test_fixture' }));
    const before = await snapshot(f);
    expect((await request(app).delete('/api/v1/floor-planning/zones/A')
      .set('Authorization', `Bearer ${f.token}`)).body.error).toBe('LOCATION_LIFECYCLE_BLOCKED: location_history');
    expect(await snapshot(f)).toEqual(before);
    // Legacy orphan evidence may predate a configured address. It must never
    // become the history of a newly-created physical location.
    await withTenant(f.shopId, trx => trx('inventory_movements').insert({ shop_id: f.shopId,
      lasyncro_variant_id: f.variantId, lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(), movement_type: 'inbound_purchase', quantity_delta: 1,
      reference_type: 'test_fixture_receipt', reference_id: crypto.randomUUID(), platform: 'wms',
      location_code: 'OLD', occurred_at: new Date(), triggered_by: 'test_fixture' }));
    const r = await request(app).post('/api/v1/floor-planning/zones').set('Authorization', `Bearer ${f.token}`)
      .send({ location_code: 'OLD', type: 'bin', parent_location_code: 'ROOT' });
    expect({ status: r.status, error: r.body.error }).toEqual({ status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: location_history' });
  });

  it('isolates shops and verifies restricted sf_app / forced RLS and 0234 grants', async () => {
    const f = await fixture(); const other = await fixture(); await truth(other, 'A', 3);
    expect((await patch(f, 'A', { active: false })).status).toBe(200);
    await withTenant(f.shopId, async trx => {
      expect(await trx('warehouse_locations').where({ shop_id: other.shopId })).toEqual([]);
      const r = await trx.raw(`SELECT current_user AS role, rolsuper, rolbypassrls,
        has_table_privilege(current_user, 'pick_scan_unit_settlement', 'DELETE') AS delete_settlement,
        has_column_privilege(current_user, 'pick_scan_unit_settlement', 'lasyncro_unit_id', 'UPDATE') AS rewrite_identity
        FROM pg_roles WHERE rolname = current_user`);
      expect(r.rows[0]).toEqual({ role: 'sf_app', rolsuper: false, rolbypassrls: false, delete_settlement: false, rewrite_identity: false });
      const forced = await trx.raw(`SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS forced
        FROM pg_class WHERE oid IN ('warehouse_locations'::regclass, 'inventory_units'::regclass, 'pick_scan_unit_settlement'::regclass)`);
      expect(forced.rows[0].forced).toBe(true);
      await expect(lockLocationHierarchy(trx, other.shopId)).rejects.toThrow('LOCATION_TENANT_CONTEXT_INVALID');
    });
  });
});


it('retains a legacy location projection when deleting or reusing its address', async () => {
  const f = await fixture();
  await withTenant(f.shopId, async trx => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_unit_status').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
      location_code: 'A', status: 'stowed', status_updated_at: new Date() });
  });
  const before = await snapshot(f);
  const r = await request(app).delete('/api/v1/floor-planning/zones/A').set('Authorization', `Bearer ${f.token}`);
  expect({ status: r.status, error: r.body.error }).toEqual({ status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: location_history' });
  expect(await snapshot(f)).toEqual(before);
});


// F1: the prospective parent, not just the changed child, loses its leaf role.
describe('F1 prospective-parent Stow protection', () => {
  const mutate = (f: Fixture, operation: 'create' | 'reparent') => operation === 'create'
    ? request(app).post('/api/v1/floor-planning/zones').set('Authorization', `Bearer ${f.token}`)
      .send({ location_code: 'NEW-CHILD', type: 'bin', parent_location_code: 'A' })
    : patch(f, 'C', { parent_location_code: 'A' });

  it.each(['create', 'reparent'] as const)('F1 rejects %s beneath an active Stow destination without mutations', async operation => {
    const f = await fixture();
    await withTenant(f.shopId, async trx => {
      const [supplier] = await trx('suppliers').insert({ shop_id: f.shopId, name: 'F1 supplier', active: true }).returning('id');
      const [po] = await trx('purchase_orders').insert({ shop_id: f.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
      const [poLine] = await trx('purchase_order_line_items').insert({ shop_id: f.shopId, po_id: po.id,
        lasyncro_variant_id: f.variantId, description: 'F1 receipt', quantity_ordered: 1, quantity_received: 1 }).returning('id');
      const [job] = await trx('receive_jobs').insert({ shop_id: f.shopId, po_id: po.id, status: 'closed',
        total_variants: 1, total_units: 1 }).returning('receive_job_id');
      const [line] = await trx('receive_job_lines').insert({ shop_id: f.shopId, receive_job_id: job.receive_job_id,
        po_line_item_id: poLine.id, lasyncro_variant_id: f.variantId, quantity_expected: 1,
        quantity_accepted: 1, inspection_complete: true }).returning('receive_job_line_id');
      await trx('inventory_units').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        receive_job_line_id: line.receive_job_line_id, receive_sequence: 1, status: 'received',
        current_location_code: null, lasyncro_unit_id: 'LSU-' + crypto.randomUUID().slice(0, 12) });
      await trx('stow_tasks').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        receive_job_line_id: line.receive_job_line_id, po_id: po.id, quantity: 1, location_code: 'A',
        status: 'in_progress', trigger: 'inbound_stock', claimed_by: f.userId, claimed_at: trx.fn.now() });
    });
    await truth(f, 'ROOT', 1);
    await withTenant(f.shopId, trx => assertStowDestinationEligible(trx, f.shopId, 'A'));
    const before = await snapshot(f);
    const response = await mutate(f, operation);
    const afterEligibility = await withTenant(f.shopId, trx => assertStowDestinationEligible(trx, f.shopId, 'A'))
      .then(() => 'eligible', error => error.message as string);
    console.info('F1_PARENT_REPRO', { operation, status: response.status, parentEligibility: afterEligibility });
    expect({ status: response.status, error: response.body.error }).toEqual({
      status: 409, error: 'LOCATION_LIFECYCLE_BLOCKED: stow',
    });
    expect(afterEligibility).toBe('eligible');
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['create', 'reparent'] as const)('F1 permits %s beneath an empty parent without active Stow', async operation => {
    const f = await fixture();
    const before = await snapshot(f);
    const response = await mutate(f, operation);
    expect(response.status).toBe(operation === 'create' ? 201 : 200);
    const after = await snapshot(f);
    for (const table of ['inventory_truth', 'inventory_units', 'inventory_movements', 'stow_tasks',
      'pick_reservation_allocations', 'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) {
      expect(after[table]).toEqual(before[table]);
    }
    await expect(withTenant(f.shopId, trx => assertStowDestinationEligible(trx, f.shopId, 'A')))
      .rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
  });
});
