/**
 * GH1176 — warehouse root boundary contracts.
 *
 * PATCH /api/v1/floor-planning/zones/:locationCode
 *
 * 1. A direct request must not shrink the warehouse root so that an existing
 *    positioned child lies outside the boundary (zero side effects on reject).
 * 2. Root geometry alone is not a mapped warehouse: wms.zonesConfigured stays
 *    false and Opening Inventory is not started.
 */

import crypto from 'crypto';
import * as hierarchy from 'api-src/services/inventory/locationHierarchy.service';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { resolveAuthUserByEmail } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { seedFirstEntry } from 'api-src/scripts/seed_first_entry';
import { wmsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { getShopOpeningInventoryProgress } from 'api-src/services/wms/inventoryRecount.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const password = 'Root-boundary-fixture-1176';
const originalSeedMode = process.env.DEV_SEED_MODE;

beforeAll(() => {
  process.env.DEV_SEED_MODE = 'first_entry';
  process.env.SHOPIFY_API_SECRET ||= 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY ||= 'test_shopify_key';
  process.env.API_URL ||= 'https://api.test';
  process.env.JWT_SECRET ||= 'test_jwt_secret';
});

afterAll(() => {
  if (originalSeedMode === undefined) delete process.env.DEV_SEED_MODE;
  else process.env.DEV_SEED_MODE = originalSeedMode;
});

async function createFixture() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const shopDomain = `root-boundary-${suffix}.myshopify.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(`shop=${shopDomain}&timestamp=${timestamp}`).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ shop: shopDomain, timestamp, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const user = await resolveAuthUserByEmail(`shopify-install+${shopDomain}@lasyncro.internal`);
  expect(user).toBeTruthy();

  const fixture = await seedFirstEntry(Number(user!.shop_id), {
    email: `root-boundary-${suffix}@example.test`,
    password,
  });
  // Growth: root width/depth/position are Growth-gated spatial fields.
  const token = issueTestToken({ userId: fixture.ownerId, shopId: fixture.shopId, tier: 'growth' });
  return { ...fixture, token };
}

async function readGeometry(shopId: number, locationCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: locationCode })
      .first('position_x', 'position_y', 'width', 'depth'),
  );
  return {
    position_x: row?.position_x == null ? null : Number(row.position_x),
    position_y: row?.position_y == null ? null : Number(row.position_y),
    width: row?.width == null ? null : Number(row.width),
    depth: row?.depth == null ? null : Number(row.depth),
  };
}

describe('GH1176 — warehouse root boundary', () => {
  it('GH1176: rejects a root width that would exclude an existing positioned child, with zero side effects', async () => {
    const fixture = await createFixture();
    await withTenant(fixture.shopId, async (trx) => {
      await trx('warehouse_locations')
        .where({ shop_id: fixture.shopId, location_code: fixture.rootLocationCode })
        .update({ position_x: 0, position_y: 0, width: 12, depth: 12 });
      // Child spans x 8..10 inside the 12m root.
      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        location_code: 'EDGE-BIN',
        parent_location_code: fixture.rootLocationCode,
        type: 'bin',
        zone_type: 'pick',
        active: true,
        position_x: 8,
        position_y: 2,
        width: 2,
        depth: 1,
        orientation: 0,
        rack_levels: 1,
      });
    });
    const rootBefore = await readGeometry(fixture.shopId, fixture.rootLocationCode);
    const childBefore = await readGeometry(fixture.shopId, 'EDGE-BIN');
    expect(rootBefore).toEqual({ position_x: 0, position_y: 0, width: 12, depth: 12 });

    const res = await request(app)
      .patch(`/api/v1/floor-planning/zones/${fixture.rootLocationCode}`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .send({ width: 6 });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await readGeometry(fixture.shopId, fixture.rootLocationCode)).toEqual(rootBefore);
    expect(await readGeometry(fixture.shopId, 'EDGE-BIN')).toEqual(childBefore);
  });

  // GH1176 audit: null child size uses the visible Canvas footprint (1m x 0.8m).
  it.each([
    { field: 'width' as const, child: { position_x: 9.5, position_y: 2, width: null, depth: 1 } },
    { field: 'depth' as const, child: { position_x: 2, position_y: 9.5, width: 1, depth: null } },
  ])('GH1176: rejects a root $field shrink that would clip a child with a null $field, with zero side effects', async ({ field, child }) => {
    const fixture = await createFixture();
    await withTenant(fixture.shopId, async (trx) => {
      await trx('warehouse_locations')
        .where({ shop_id: fixture.shopId, location_code: fixture.rootLocationCode })
        .update({ position_x: 0, position_y: 0, width: 12, depth: 12 });
      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        location_code: 'NULL-SIZE-BIN',
        parent_location_code: fixture.rootLocationCode,
        type: 'bin',
        zone_type: 'pick',
        active: true,
        orientation: 0,
        rack_levels: 1,
        ...child,
      });
    });
    const rootBefore = await readGeometry(fixture.shopId, fixture.rootLocationCode);
    const childBefore = await readGeometry(fixture.shopId, 'NULL-SIZE-BIN');
    expect(childBefore[field]).toBeNull();

    const res = await request(app)
      .patch(`/api/v1/floor-planning/zones/${fixture.rootLocationCode}`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .send({ [field]: 10 });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await readGeometry(fixture.shopId, fixture.rootLocationCode)).toEqual(rootBefore);
    // No synthetic size is persisted onto the child.
    expect(await readGeometry(fixture.shopId, 'NULL-SIZE-BIN')).toEqual(childBefore);
  });

  it('GH1176 invariant: persisted root geometry alone leaves the warehouse unmapped and Opening Inventory unstarted', async () => {
    const fixture = await createFixture();

    const res = await request(app)
      .patch(`/api/v1/floor-planning/zones/${fixture.rootLocationCode}`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .send({ position_x: 0, position_y: 0, width: 20, depth: 15 });
    expect(res.status).toBe(200);
    expect(await readGeometry(fixture.shopId, fixture.rootLocationCode))
      .toEqual({ position_x: 0, position_y: 0, width: 20, depth: 15 });

    const signals = Object.fromEntries(
      (await runWithTenantContext(fixture.shopId, () =>
        wmsOnboardingSignalProvider.getSignals({ shopId: fixture.shopId }),
      )).map(({ name, value }) => [name, value]),
    );
    expect(signals['wms.zonesConfigured']).toBe(false);
    expect(signals['wms.openingInventoryReconciled']).toBe(false);

    const progress = await withTenant(fixture.shopId, (trx) =>
      getShopOpeningInventoryProgress(trx, fixture.shopId),
    );
    expect(progress).toMatchObject({ state: 'not_started', started_at: null });
    expect(await withTenant(fixture.shopId, (trx) => trx('inventory_recount_tasks')
      .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' }))).toEqual([]);
  });
});

/**
 * FP-SPATIAL-S2B — authoritative boundary containment on every Floor Planning
 * geometry write (create, PATCH, bulk move, duplicate, root resize/move).
 * Rejections are 422 with every affected location code and zero side effects.
 */
type Fixture = Awaited<ReturnType<typeof createFixture>>;
const auth = (f: Fixture) => ({ Authorization: `Bearer ${f.token}` });

async function setRoot(f: Fixture, geometry: Record<string, number | null>) {
  await withTenant(f.shopId, (trx) => trx('warehouse_locations')
    .where({ shop_id: f.shopId, location_code: f.rootLocationCode }).update(geometry));
}

/** Direct insert: also used to create legacy out-of-bounds rows. */
async function insertLocation(f: Fixture, code: string, geometry: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  await withTenant(f.shopId, (trx) => trx('warehouse_locations').insert({
    shop_id: f.shopId, warehouse_id: f.warehouseId, location_code: code,
    parent_location_code: f.rootLocationCode, type: 'bin', zone_type: 'pick', active: true,
    orientation: 0, rack_levels: 1, width: 2, depth: 1, ...geometry, ...extra,
  }));
}

async function snapshot(f: Fixture) {
  return withTenant(f.shopId, (trx) => trx('warehouse_locations').where({ shop_id: f.shopId })
    .orderBy('location_code')
    .select('location_code', 'type', 'parent_location_code', 'barcode', 'active', 'position_x', 'position_y', 'width', 'depth'));
}

const createBody = (f: Fixture, code: string, geometry: Record<string, unknown>) => ({
  location_code: code, type: 'bin', zone_type: 'pick', parent_location_code: f.rootLocationCode,
  width: 2, depth: 1, ...geometry,
});

function expectBoundary422(res: request.Response, code: string, locationCodes: string[]) {
  expect(res.status).toBe(422);
  expect(res.body).toMatchObject({ error: code });
  expect([...res.body.location_codes].sort()).toEqual([...locationCodes].sort());
}

describe('FP-SPATIAL-S2B — warehouse boundary containment on every geometry write', () => {
  it('create: accepts inside (exact edge), rejects outside on lower/left and upper/right with zero side effects', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 5, position_y: 5, width: 10, depth: 8 }); // boundary x 5..15, y 5..13
    const inside = await request(app).post('/api/v1/floor-planning/zones').set(auth(f)).send(createBody(f, 'IN-01', { position_x: 13, position_y: 12 }));
    expect(inside.status).toBe(201); // touches right and bottom edges exactly
    const before = await snapshot(f);
    for (const [code, geometry] of [
      ['LEFT-01', { position_x: 4, position_y: 6 }], ['TOP-01', { position_x: 6, position_y: 4.5 }],
      ['RIGHT-01', { position_x: 13.5, position_y: 6 }], ['BOTTOM-01', { position_x: 6, position_y: 12.5 }],
    ] as const) {
      expectBoundary422(await request(app).post('/api/v1/floor-planning/zones').set(auth(f)).send(createBody(f, code, geometry)),
        'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', [code]);
    }
    expect(await snapshot(f)).toEqual(before);
  });

  it('create: null size uses the 1 x 0.8 m display footprint, never persisted; implicit (0,0) origin applies', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: null, position_y: null, width: 10, depth: 8 }); // implicit origin
    const clipped = await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send(createBody(f, 'NULL-01', { position_x: 9.2, position_y: 1, width: null, depth: null }));
    expectBoundary422(clipped, 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['NULL-01']);
    const fits = await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send(createBody(f, 'NULL-02', { position_x: 9, position_y: 7.2, width: null, depth: null }));
    expect(fits.status).toBe(201);
    expect((await snapshot(f)).find((row) => row.location_code === 'NULL-02')).toMatchObject({ width: null, depth: null });
    expect(await readGeometry(f.shopId, f.rootLocationCode)).toEqual({ position_x: null, position_y: null, width: 10, depth: 8 });
  });

  it('PATCH: single move and resize may not leave the boundary; inside edits succeed', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'MOVE-01', { position_x: 2, position_y: 2 });
    const before = await snapshot(f);
    const patch = (body: Record<string, unknown>) => request(app).patch('/api/v1/floor-planning/zones/MOVE-01').set(auth(f)).send(body);
    expectBoundary422(await patch({ position_x: 8.5 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['MOVE-01']);
    expectBoundary422(await patch({ width: 9 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['MOVE-01']);
    expectBoundary422(await patch({ depth: 6.5 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['MOVE-01']);
    expect(await snapshot(f)).toEqual(before);
    expect((await patch({ position_x: 8, position_y: 7 })).status).toBe(200);
    expect((await patch({ width: 2 })).status).toBe(200);
  });

  it('bulk move: one outside location rejects the whole batch atomically and names every offender', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    for (const code of ['BULK-01', 'BULK-02', 'BULK-03']) await insertLocation(f, code, { position_x: 1, position_y: 1 });
    const before = await snapshot(f);
    const res = await request(app).patch('/api/v1/floor-planning/zones/positions').set(auth(f)).send({ positions: [
      { location_code: 'BULK-01', position_x: 3, position_y: 3 },
      { location_code: 'BULK-02', position_x: 9, position_y: 3 },
      { location_code: 'BULK-03', position_x: 3, position_y: 7.5 },
    ] });
    expectBoundary422(res, 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['BULK-02', 'BULK-03']);
    expect(await snapshot(f)).toEqual(before);
    const ok = await request(app).patch('/api/v1/floor-planning/zones/positions').set(auth(f)).send({ positions: [
      { location_code: 'BULK-01', position_x: 3, position_y: 3 }, { location_code: 'BULK-02', position_x: 8, position_y: 7 },
    ] });
    expect(ok.status).toBe(200);
  });

  it('duplicate: copies must land inside; one outside copy rolls back the whole duplicate', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'PICK-01', { position_x: 1, position_y: 1 });
    await insertLocation(f, 'PICK-02', { position_x: 6, position_y: 1 });
    const before = await snapshot(f);
    const res = await request(app).post('/api/v1/floor-planning/zones/duplicate').set(auth(f))
      .send({ location_codes: ['PICK-01', 'PICK-02'], offset: { x: 3, y: 0 } }); // PICK-02 copy 9..11 > 10
    expectBoundary422(res, 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['PICK-02']);
    expect(await snapshot(f)).toEqual(before);
    const ok = await request(app).post('/api/v1/floor-planning/zones/duplicate').set(auth(f))
      .send({ location_codes: ['PICK-01', 'PICK-02'], offset: { x: 1, y: 2 } });
    expect(ok.status).toBe(201);
    expect(ok.body.created).toHaveLength(2);
  });

  it('root: shrink and move may not newly exclude components; expansion and safe moves succeed', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'EDGE-01', { position_x: 7, position_y: 1 });   // x 7..9
    await insertLocation(f, 'LOW-01', { position_x: 0.5, position_y: 0.5 }); // near the lower/left corner
    const patchRoot = (body: Record<string, unknown>) =>
      request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send(body);
    const before = await snapshot(f);
    expectBoundary422(await patchRoot({ width: 8.5 }), 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['EDGE-01']);
    expectBoundary422(await patchRoot({ position_x: 1, position_y: 0 }), 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['LOW-01']);
    expectBoundary422(await patchRoot({ position_y: 1 }), 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['LOW-01']);
    expect(await snapshot(f)).toEqual(before);
    expect((await patchRoot({ width: 20, depth: 15 })).status).toBe(200);           // expansion
    expect((await patchRoot({ position_x: 0.5, position_y: 0.5 })).status).toBe(200); // safe move (LOW-01 at edge)
    expect(await readGeometry(f.shopId, f.rootLocationCode)).toEqual({ position_x: 0.5, position_y: 0.5, width: 20, depth: 15 });
  });

  it('nested bin addresses beneath shelf/bin parents are not independent floor objects', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'SHELF-A', { position_x: 1, position_y: 1 }, { type: 'shelf', zone_type: 'storage' });
    // Legacy nested address with a stale far-away position: identity is the parent link, not geometry.
    await insertLocation(f, 'SHELF-A-01', { position_x: 40, position_y: 40 }, { parent_location_code: 'SHELF-A' });
    const shrink = await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send({ width: 6, depth: 6 });
    expect(shrink.status).toBe(200);
    const nestedMove = await request(app).patch('/api/v1/floor-planning/zones/SHELF-A-01').set(auth(f)).send({ position_x: 45 });
    expect(nestedMove.status).toBe(200);
    // Re-parenting the stale address to the root would make it an independent floor object outside: rejected.
    const reparent = await request(app).patch('/api/v1/floor-planning/zones/SHELF-A-01').set(auth(f))
      .send({ parent_location_code: f.rootLocationCode });
    expectBoundary422(reparent, 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['SHELF-A-01']);
  });

  it('legacy out-of-bounds rows: unrelated edits and non-worsening corrections succeed; worsening is rejected', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'LEGACY-01', { position_x: 12, position_y: 1 }); // 4 m outside on the right
    const patch = (body: Record<string, unknown>) => request(app).patch('/api/v1/floor-planning/zones/LEGACY-01').set(auth(f)).send(body);
    expect((await patch({ barcode: 'LEGACY-BC-01' })).status).toBe(200);
    expect((await patch({ active: false })).status).toBe(200);
    expect((await patch({ position_x: 10 })).status).toBe(200);   // closer, still outside
    expectBoundary422(await patch({ position_x: 11 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['LEGACY-01']);
    expectBoundary422(await patch({ width: 3 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['LEGACY-01']);
    expect((await patch({ position_x: 4 })).status).toBe(200);    // fully corrected
    // Root changes must preserve or improve every legacy violation too.
    await insertLocation(f, 'LEGACY-02', { position_x: 30, position_y: 1 });
    expectBoundary422(await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send({ width: 9 }),
      'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['LEGACY-02']);
    expect((await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send({ width: 11 })).status).toBe(200);
  });

  it('boundary-less warehouses keep working; boundaries never cross tenants', async () => {
    const small = await createFixture();
    await setRoot(small, { position_x: 0, position_y: 0, width: 5, depth: 5 });
    const open = await createFixture(); // seeded root without dimensions
    expect(await readGeometry(open.shopId, open.rootLocationCode)).toMatchObject({ width: null, depth: null });
    const created = await request(app).post('/api/v1/floor-planning/zones').set(auth(open))
      .send(createBody(open, 'FAR-01', { position_x: 400, position_y: 400 }));
    expect(created.status).toBe(201);
    await insertLocation(open, 'FAR-02', { position_x: 300, position_y: 1 });
    expect((await request(app).patch('/api/v1/floor-planning/zones/positions').set(auth(open))
      .send({ positions: [{ location_code: 'FAR-02', position_x: 900, position_y: 900 }] })).status).toBe(200);
    expect(await readGeometry(open.shopId, open.rootLocationCode)).toMatchObject({ width: null, depth: null });
    // The small boundary of another shop still applies only to that shop.
    expectBoundary422(await request(app).post('/api/v1/floor-planning/zones').set(auth(small))
      .send(createBody(small, 'FAR-01', { position_x: 400, position_y: 400 })), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['FAR-01']);
  });
});


describe('S2B review regressions — authoritative roots and per-edge legacy edits', () => {
  it('an earlier warehouse-type row with null dimensions cannot disable the configured boundary', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    const extra = await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send({ location_code: '000-EXTRA-ROOT', type: 'warehouse' });
    expect(extra.status).toBe(201);
    const before = await snapshot(f);
    expectBoundary422(await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send(createBody(f, 'BYPASS', { position_x: 40, position_y: 40 })), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['BYPASS']);
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['missing', 'wrong-type', 'wrong-warehouse', 'nested-root'])('fails closed for a configured %s root', async fault => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'WRONG-TYPE', { position_x: 1, position_y: 1 });
    await withTenant(f.shopId, async trx => {
      if (fault === 'nested-root') {
        await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'WRONG-TYPE' }).update({ parent_location_code: null });
        await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: f.rootLocationCode })
          .update({ parent_location_code: 'WRONG-TYPE' });
      } else {
        let code = fault === 'missing' ? 'MISSING-ROOT' : 'WRONG-TYPE';
        if (fault === 'wrong-warehouse') {
          const otherId = crypto.randomUUID();
          code = 'OTHER-ROOT';
          await trx('warehouses').insert({ shop_id: f.shopId, warehouse_id: otherId, name: 'Other', root_location_code: 'OTHER-CONFIG' });
          await trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: otherId, location_code: code, type: 'warehouse' });
        }
        await trx('warehouses').where({ shop_id: f.shopId, warehouse_id: f.warehouseId }).update({ root_location_code: code });
      }
    });
    const before = await snapshot(f);
    const response = await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send(createBody(f, 'FAIL-CLOSED', { position_x: 40, position_y: 40 }));
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('WAREHOUSE_BOUNDARY_ROOT_INVALID');
    expect(await snapshot(f)).toEqual(before);
  });

  it('rejects trading right overflow for bottom overflow and root changes worsening a legacy component', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    await insertLocation(f, 'LEGACY-EDGE', { position_x: 12, position_y: 1 });
    const before = await snapshot(f);
    expectBoundary422(await request(app).patch('/api/v1/floor-planning/zones/LEGACY-EDGE').set(auth(f))
      .send({ position_x: 8, position_y: 11 }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['LEGACY-EDGE']);
    expectBoundary422(await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f))
      .send({ width: 9 }), 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['LEGACY-EDGE']);
    expectBoundary422(await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f))
      .send({ position_x: 1, position_y: 2 }), 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS', ['LEGACY-EDGE']);
    expect(await snapshot(f)).toEqual(before);
    expect((await request(app).patch('/api/v1/floor-planning/zones/LEGACY-EDGE').set(auth(f)).send({ barcode: 'LEGACY-EDGE-BC' })).status).toBe(200);
    expect((await request(app).patch('/api/v1/floor-planning/zones/LEGACY-EDGE').set(auth(f)).send({ position_x: 11 })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send({ width: 11 })).status).toBe(200);
  });

  it('keeps two configured warehouse boundaries in one tenant isolated, including atomic mixed-warehouse batches', async () => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    const other = { ...f, warehouseId: crypto.randomUUID(), rootLocationCode: 'SECOND-ROOT' };
    await withTenant(f.shopId, async trx => {
      await trx('warehouses').insert({ shop_id: f.shopId, warehouse_id: other.warehouseId, name: 'Second', root_location_code: other.rootLocationCode });
      await trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: other.warehouseId,
        location_code: other.rootLocationCode, type: 'warehouse', position_x: 20, position_y: 20, width: 5, depth: 5 });
    });
    await insertLocation(f, 'FIRST-BIN', { position_x: 1, position_y: 1 });
    await insertLocation(other, 'SECOND-BIN', { position_x: 21, position_y: 21 });
    expect((await request(app).post('/api/v1/floor-planning/zones').set(auth(f))
      .send(createBody(other, 'SECOND-CREATE', { position_x: 22, position_y: 22 }))).status).toBe(201);
    const before = await snapshot(f);
    expectBoundary422(await request(app).patch('/api/v1/floor-planning/zones/positions').set(auth(f)).send({ positions: [
      { location_code: 'FIRST-BIN', position_x: 2, position_y: 2 },
      { location_code: 'SECOND-BIN', position_x: 8, position_y: 7 }, // inside first, outside second
    ] }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['SECOND-BIN']);
    expectBoundary422(await request(app).post('/api/v1/floor-planning/zones/duplicate').set(auth(f))
      .send({ location_codes: ['FIRST-BIN', 'SECOND-BIN'], offset: { x: 3, y: 0 } }), 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY', ['SECOND-BIN']);
    expect(await snapshot(f)).toEqual(before);
    expect((await request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f)).send({ width: 5 })).status).toBe(200);
    expect(await readGeometry(f.shopId, other.rootLocationCode)).toEqual({ position_x: 20, position_y: 20, width: 5, depth: 5 });
    expect((await request(app).patch(`/api/v1/floor-planning/zones/${other.rootLocationCode}`).set(auth(f)).send({ position_x: 21 })).status).toBe(200);
    expect((await readGeometry(f.shopId, f.rootLocationCode)).width).toBe(5);
  });
});

/** Hold the first real API writer after it owns the production advisory lock.
 * Release only after PostgreSQL proves the second API writer is blocked on
 * that lock. Polling has a failure deadline, never a sleep-based ordering.
 */
async function overlappingWrites(f: Fixture, firstRequest: () => PromiseLike<request.Response>, secondRequest: () => PromiseLike<request.Response>) {
  const realLock = hierarchy.lockLocationHierarchy;
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<void>(resolve => { ready = resolve; });
  let calls = 0;
  const spy = jest.spyOn(hierarchy, 'lockLocationHierarchy').mockImplementation(async (trx, shopId) => {
    const first = shopId === f.shopId && ++calls === 1;
    await realLock(trx, shopId);
    if (first) { ready(); await held; }
  });
  const first = Promise.resolve(firstRequest());
  let second: Promise<request.Response> | undefined;
  try {
    await Promise.race([locked, first.then(() => { throw new Error('First API request did not acquire the geometry lock'); })]);
    second = Promise.resolve(secondRequest());
    const deadline = Date.now() + 10000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      waiting = await withTenant(f.shopId, async trx => (await trx.raw(`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 1305
          AND objid = ? AND objsubid = 2 AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      ) AS waiting`, [f.shopId])).rows[0].waiting);
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    spy.mockRestore();
  }
  return [await first, await second!];
}

const concurrentCases = (['shrink', 'move'] as const).flatMap(rootChange =>
  (['create', 'PATCH', 'bulk', 'duplicate'] as const).flatMap(operation =>
    [true, false].map(rootFirst => ({ rootChange, operation, rootFirst }))));

describe('S2B concurrent API geometry writers re-evaluate committed geometry', () => {
  it.each(concurrentCases)('$rootChange / $operation / rootFirst=$rootFirst', async ({ rootChange, operation, rootFirst }) => {
    const f = await createFixture();
    await setRoot(f, { position_x: 0, position_y: 0, width: 10, depth: 8 });
    const initialX = rootChange === 'shrink' ? 1 : 3;
    const targetX = rootChange === 'shrink' ? 8 : 1;
    await insertLocation(f, 'RACE-BIN', { position_x: initialX, position_y: 1 });
    await insertLocation(f, 'RACE-SAFE', { position_x: 3, position_y: 3 });
    const before = await snapshot(f);
    const root = () => request(app).patch(`/api/v1/floor-planning/zones/${f.rootLocationCode}`).set(auth(f))
      .send(rootChange === 'shrink' ? { width: 5 } : { position_x: 2 });
    const component = () => {
      if (operation === 'create') return request(app).post('/api/v1/floor-planning/zones').set(auth(f))
        .send(createBody(f, 'RACE-NEW', { position_x: targetX, position_y: 1 }));
      if (operation === 'PATCH') return request(app).patch('/api/v1/floor-planning/zones/RACE-BIN').set(auth(f))
        .send({ position_x: targetX });
      if (operation === 'bulk') return request(app).patch('/api/v1/floor-planning/zones/positions').set(auth(f)).send({ positions: [
        { location_code: 'RACE-SAFE', position_x: 4, position_y: 3 },
        { location_code: 'RACE-BIN', position_x: targetX, position_y: 1 },
      ] });
      return request(app).post('/api/v1/floor-planning/zones/duplicate').set(auth(f))
        .send({ location_codes: ['RACE-BIN'], offset: { x: targetX - initialX, y: 0 } });
    };
    const [first, second] = await overlappingWrites(f, rootFirst ? root : component, rootFirst ? component : root);
    expect(first.status).toBe(rootFirst || operation === 'PATCH' || operation === 'bulk' ? 200 : 201);
    expect(second.status).toBe(422);
    expect(second.body.error).toBe(rootFirst ? 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY' : 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS');
    const after = await snapshot(f);
    if (rootFirst) {
      expect(after.filter(row => row.location_code !== f.rootLocationCode))
        .toEqual(before.filter(row => row.location_code !== f.rootLocationCode)); // rejected batch/copy has no effects
      expect(await readGeometry(f.shopId, f.rootLocationCode)).toEqual({ position_x: rootChange === 'move' ? 2 : 0,
        position_y: 0, width: rootChange === 'shrink' ? 5 : 10, depth: 8 });
    } else {
      expect(after.find(row => row.location_code === f.rootLocationCode)).toEqual(before.find(row => row.location_code === f.rootLocationCode));
      const code = operation === 'create' ? 'RACE-NEW' : operation === 'duplicate' ? first.body.created[0].location_code : 'RACE-BIN';
      expect((await readGeometry(f.shopId, code)).position_x).toBe(targetX);
    }
  }, 30000);
});
