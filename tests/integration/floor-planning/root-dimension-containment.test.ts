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
