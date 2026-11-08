import crypto from 'crypto';
import knexLib, { Knex } from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { resolveLocationIdentity } from 'api-src/services/wms/locationIdentity.service';
import { resolveProblemBin } from 'api-src/services/wms/receiveHeldCustody.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();
let admin: Knex;
beforeAll(() => {
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) throw new Error('DISPOSABLE_TEST_CONTEXT_REQUIRED');
  process.env.JWT_SECRET ||= 'test_jwt_secret';
  admin = knexLib({ client: 'pg', connection: { host: process.env.PGHOST,
    port: Number(process.env.PGPORT), user: process.env.PGMIGRATION_USER,
    password: process.env.PGMIGRATION_PASSWORD, database: process.env.PGDATABASE }, pool: { min: 0, max: 2 } });
});
afterAll(async () => { if (admin) await admin.destroy(); });

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


const endpoints = ['/api/v1/wms/location/resolve', '/api/v1/wms/scan/resolve'];

describe('GH1305 unambiguous location identity', () => {
  it('resolves canonical codes, legacy overrides, and same-row code/override once through both routes', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' })
      .update({ barcode: 'old rack label' }));
    for (const path of endpoints) {
      for (const value of ['A', 'old rack label']) {
        const r = await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send({ scanned_value: value });
        expect(r.status).toBe(200);
        expect(r.body.location_code).toBe('A');
      }
    }
    await withTenant(f.shopId, async trx => {
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ barcode: 'A' });
      expect((await resolveLocationIdentity(trx, f.shopId, 'A')).location_code).toBe('A');
    });
  });

  it('unknown and foreign-tenant identities do not resolve; foreign barcode equality is allowed', async () => {
    const a = await fixture();
    const b = await fixture();
    await withTenant(b.shopId, trx => trx('warehouse_locations').where({ shop_id: b.shopId, location_code: 'A' })
      .update({ barcode: 'foreign-only' }));
    for (const path of endpoints) {
      const r = await request(app).post(path).set('Authorization', `Bearer ${a.token}`)
        .send({ scanned_value: 'foreign-only' });
      expect(r.status).toBe(404);
    }
    await withTenant(a.shopId, trx => trx('warehouse_locations').where({ shop_id: a.shopId, location_code: 'A' })
      .update({ barcode: 'foreign-only' }));
  });

  it('rejects cross-column collisions on create, update and duplicate with complete rollback', async () => {
    const f = await fixture();
    const read = () => withTenant(f.shopId, trx => trx('warehouse_locations')
      .where({ shop_id: f.shopId }).orderBy('location_code').select('*'));
    const before = await read();
    const create = await request(app).post('/api/v1/floor-planning/zones')
      .set('Authorization', `Bearer ${f.token}`).send({ location_code: 'NEW', type: 'bin', parent_location_code: 'A', barcode: 'B' });
    expect(create.status).toBe(409);
    expect(create.body.error).toBe('LOCATION_IDENTITY_COLLISION');
    const update = await request(app).patch('/api/v1/floor-planning/zones/A')
      .set('Authorization', `Bearer ${f.token}`).send({ barcode: 'B', active: false });
    expect(update.status).toBe(409);
    expect(update.body.error).toBe('LOCATION_IDENTITY_COLLISION');
    expect(await read()).toEqual(before);
    // The first duplicate inserts PICK-01; the second conflicts with a legacy override.
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'B' })
      .update({ barcode: 'PICK-02' }));
    const beforeDuplicate = await read();
    const duplicate = await request(app).post('/api/v1/floor-planning/zones/duplicate')
      .set('Authorization', `Bearer ${f.token}`).send({ location_codes: ['A', 'C'], offset: { x: 1, y: 1 } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('LOCATION_IDENTITY_COLLISION');
    expect(await read()).toEqual(beforeDuplicate);
  });

  it('counts inactive legacy matches before eligibility filtering in WMS and Receive', async () => {
    const f = await fixture();
    const jobId = await withTenant(f.shopId, async trx => {
      const [supplier] = await trx('suppliers').insert({ shop_id: f.shopId, name: 'Identity fixture' }).returning('id');
      const [po] = await trx('purchase_orders').insert({ shop_id: f.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
      const [job] = await trx('receive_jobs').insert({ shop_id: f.shopId, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2 }).returning('receive_job_id');
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ zone_type: 'problem' });
      return job.receive_job_id;
    });
    // Reconstruct a legacy identity collision explicitly in this disposable DB.
    // The production write guard stays enabled after the fixture transaction.
    await admin.transaction(async trx => {
      await trx.raw('SET LOCAL row_security = off');
      await trx.raw('ALTER TABLE warehouse_locations DISABLE TRIGGER warehouse_locations_integrity_1305');
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'B' }).update({ barcode: 'A', active: false });
      await trx.raw('ALTER TABLE warehouse_locations ENABLE TRIGGER warehouse_locations_integrity_1305');
    });
    try {
      for (const path of endpoints) {
        const r = await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send({ scanned_value: 'A' });
        expect(r.status).toBe(409);
        expect(r.body.error).toBe('LOCATION_IDENTITY_AMBIGUOUS');
      }
      await expect(withTenant(f.shopId, trx => resolveProblemBin(trx, {
        shopId: f.shopId, receiveJobId: jobId, scannedValue: 'A',
      }))).rejects.toMatchObject({ errorCode: 'LOCATION_IDENTITY_AMBIGUOUS', statusCode: 409 });
    } finally {
      await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'B' }).update({ barcode: null }));
    }
    await withTenant(f.shopId, async trx => {
      expect(await resolveProblemBin(trx, { shopId: f.shopId, receiveJobId: jobId, scannedValue: 'A' }))
        .toEqual({ location_code: 'A', barcode: null });
    });
  });
});
