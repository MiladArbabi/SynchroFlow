/**
 * FLOOR-PLANNING-CANVAS-01 — C2b
 *
 * Atomic persistence contract for multi-selection movement.
 *
 * PATCH /api/v1/floor-planning/zones/positions
 *
 * The operation must be tenant-scoped and all-or-nothing:
 * either every requested location receives its new coordinates, or none do.
 */

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemQuery,
  withTenant,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET =
    process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY =
    process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id'),
  );

  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }

  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function hmacInstall(
  shopDomain: string,
): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');

  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);

  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw(
      'SELECT public.resolve_auth_user_by_email(?) AS value',
      [`shopify-install+${shopDomain}@lasyncro.internal`],
    ),
  );

  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();

  return {
    shopId: ghost.shop_id as number,
    userId: ghost.id as number,
  };
}

async function provisionFt2Shop(label: string) {
  const shopDomain =
    `fp-bulk-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.myshopify.com`;

  const { shopId, userId } = await hmacInstall(shopDomain);

  await seedFreshInstall(shopId);

  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED',
      updated_at: new Date(),
    }),
  );

  let cursor = 0;
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);

  const token = issueTestToken({ userId, shopId });

  const confirm = await request(app)
    .post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  expect(confirm.status).toBe(200);

  await pumpEvents(shopId);

  return {
    shopId,
    userId,
    token,
    rootLocationCode: `WH-${shopId}-ROOT`,
  };
}

const authed = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

async function seedZone(
  shopId: number,
  {
    locationCode,
    type = 'bin',
    zoneType = 'pick',
    parentLocationCode,
    x = 1,
    y = 1,
    width = 1,
    depth = 1,
    orientation = 0,
    rackLevels = 1,
    dockFace = null,
    barcode = null,
  }: {
    locationCode: string;
    type?: 'lane' | 'shelf' | 'bin';
    zoneType?: string;
    parentLocationCode?: string;
    x?: number;
    y?: number;
    width?: number;
    depth?: number;
    orientation?: number;
    rackLevels?: number | null;
    dockFace?: 'north' | 'south' | 'east' | 'west' | 'none' | null;
    barcode?: string | null;
  },
) {
  await withTenant(shopId, async (trx) => {
    const root = await trx('warehouse_locations')
      .where({ shop_id: shopId, type: 'warehouse' })
      .first('location_code', 'warehouse_id');

    expect(root?.location_code).toBeTruthy();
    expect(root?.warehouse_id).toBeTruthy();

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: root.warehouse_id,
      location_code: locationCode,
      type,
      zone_type: zoneType,
      parent_location_code: parentLocationCode ?? root.location_code,
      barcode,
      active: true,
      position_x: x,
      position_y: y,
      width,
      depth,
      orientation,
      rack_levels: rackLevels,
      dock_face: dockFace,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

async function readZone(shopId: number, locationCode: string) {
  return withTenant(shopId, (trx) =>
    trx('warehouse_locations')
      .where({
        shop_id: shopId,
        location_code: locationCode,
      })
      .first(),
  );
}

async function readZones(shopId: number, locationCodes: string[]) {
  return withTenant(shopId, (trx) =>
    trx('warehouse_locations')
      .where({ shop_id: shopId })
      .whereIn('location_code', locationCodes)
      .orderBy('location_code', 'asc'),
  );
}

async function seedStock(
  shopId: number,
  locationCode: string,
  quantity: number,
) {
  await withTenant(shopId, async (trx) => {
    const variant = await trx('variants')
      .where({ shop_id: shopId })
      .first('lasyncro_variant_id');

    expect(variant?.lasyncro_variant_id).toBeTruthy();

    const now = new Date();

    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variant.lasyncro_variant_id,
      location_code: locationCode,
      on_hand_quantity: quantity,
      available_quantity: quantity,
      reserved_quantity: 0,
      last_evaluated_at: now,
      updated_at: now,
    });
  });
}

describe('FLOOR-PLANNING-CANVAS-01 C3B — atomic bulk zone actions', () => {
  describe('POST /api/v1/floor-planning/zones/duplicate', () => {
    it('duplicates the complete selected group atomically with deterministic role codes and one common offset', async () => {
      const shop = await provisionFt2Shop('duplicate-success');

      await seedZone(shop.shopId, {
        locationCode: 'CUSTOM-PICK-A',
        zoneType: 'pick',
        x: 2,
        y: 3,
        width: 1.5,
        depth: 0.75,
        orientation: 90,
        rackLevels: 4,
        barcode: 'DO-NOT-COPY',
      });

      await seedZone(shop.shopId, {
        locationCode: 'CUSTOM-PACK-A',
        zoneType: 'pack',
        x: 6,
        y: 3,
        width: 2,
        depth: 1.5,
        orientation: 0,
        rackLevels: 2,
      });

      // Existing canonical PICK-01 means lowest-gap generation must allocate PICK-02.
      await seedZone(shop.shopId, {
        locationCode: 'PICK-01',
        zoneType: 'pick',
        x: 12,
        y: 10,
      });

      const res = await request(app)
        .post('/api/v1/floor-planning/zones/duplicate')
        .set(authed(shop.token))
        .send({
          location_codes: ['CUSTOM-PICK-A', 'CUSTOM-PACK-A'],
          offset: { x: 2, y: 1 },
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        created: [
          {
            source_location_code: 'CUSTOM-PICK-A',
            location_code: 'PICK-02',
          },
          {
            source_location_code: 'CUSTOM-PACK-A',
            location_code: 'PACK-01',
          },
        ],
      });

      const pick = await readZone(shop.shopId, 'PICK-02');
      const pack = await readZone(shop.shopId, 'PACK-01');

      expect(pick).toEqual(expect.objectContaining({
        type: 'bin',
        zone_type: 'pick',
        position_x: expect.anything(),
        position_y: expect.anything(),
        width: expect.anything(),
        depth: expect.anything(),
        orientation: 90,
        rack_levels: 4,
        barcode: null,
      }));

      expect(Number(pick.position_x)).toBe(4);
      expect(Number(pick.position_y)).toBe(4);
      expect(Number(pick.width)).toBe(1.5);
      expect(Number(pick.depth)).toBe(0.75);

      expect(Number(pack.position_x)).toBe(8);
      expect(Number(pack.position_y)).toBe(4);

      // Relative spacing is unchanged: both receive the same translation.
      expect(
        Number(pack.position_x) - Number(pick.position_x),
      ).toBe(4);
    });

    it.each([
      ['empty selection', { location_codes: [], offset: { x: 1, y: 0 } }],
      ['duplicate source code', {
        location_codes: ['A', 'A'],
        offset: { x: 1, y: 0 },
      }],
      ['missing offset', { location_codes: ['A'] }],
      ['invalid offset', {
        location_codes: ['A'],
        offset: { x: Number.NaN, y: 0 },
      }],
    ])('rejects invalid duplicate request: %s', async (_label, payload) => {
      const shop = await provisionFt2Shop(
        `duplicate-invalid-${crypto.randomUUID().slice(0, 6)}`,
      );

      const res = await request(app)
        .post('/api/v1/floor-planning/zones/duplicate')
        .set(authed(shop.token))
        .send(payload);

      expect(res.status).toBe(400);
    });

    it('rejects warehouse/root duplication', async () => {
      const shop = await provisionFt2Shop('duplicate-root');

      const res = await request(app)
        .post('/api/v1/floor-planning/zones/duplicate')
        .set(authed(shop.token))
        .send({
          location_codes: [shop.rootLocationCode],
          offset: { x: 1, y: 0 },
        });

      expect(res.status).toBe(400);
    });

    it('rolls back the entire duplicate when one source is missing', async () => {
      const shop = await provisionFt2Shop('duplicate-missing');

      await seedZone(shop.shopId, {
        locationCode: 'SOURCE-01',
        zoneType: 'pick',
      });

      const res = await request(app)
        .post('/api/v1/floor-planning/zones/duplicate')
        .set(authed(shop.token))
        .send({
          location_codes: ['SOURCE-01', 'DOES-NOT-EXIST'],
          offset: { x: 2, y: 0 },
        });

      expect(res.status).toBe(404);

      expect(await readZone(shop.shopId, 'PICK-01')).toBeUndefined();
    });

    it('treats a foreign-tenant source as missing and creates zero local duplicates', async () => {
      const owner = await provisionFt2Shop('duplicate-owner');
      const foreign = await provisionFt2Shop('duplicate-foreign');

      await seedZone(owner.shopId, {
        locationCode: 'OWNER-SOURCE',
        zoneType: 'pick',
      });

      await seedZone(foreign.shopId, {
        locationCode: 'FOREIGN-SOURCE',
        zoneType: 'pack',
      });

      const res = await request(app)
        .post('/api/v1/floor-planning/zones/duplicate')
        .set(authed(owner.token))
        .send({
          location_codes: ['OWNER-SOURCE', 'FOREIGN-SOURCE'],
          offset: { x: 2, y: 0 },
        });

      expect(res.status).toBe(404);
      expect(await readZone(owner.shopId, 'PICK-01')).toBeUndefined();
      expect(await readZone(owner.shopId, 'PACK-01')).toBeUndefined();
    });
  });

  describe('DELETE /api/v1/floor-planning/zones', () => {
    it('deletes the complete requested group in one operation', async () => {
      const shop = await provisionFt2Shop('delete-success');

      await seedZone(shop.shopId, {
        locationCode: 'DELETE-01',
        zoneType: 'pick',
      });
      await seedZone(shop.shopId, {
        locationCode: 'DELETE-02',
        zoneType: 'pack',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: ['DELETE-01', 'DELETE-02'],
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        deleted: 2,
      });

      expect(
        await readZones(shop.shopId, ['DELETE-01', 'DELETE-02']),
      ).toHaveLength(0);
    });

    it('allows a selected parent and all selected children to be deleted together', async () => {
      const shop = await provisionFt2Shop('delete-tree');

      await seedZone(shop.shopId, {
        locationCode: 'PARENT-01',
        type: 'lane',
        zoneType: 'pick',
      });

      await seedZone(shop.shopId, {
        locationCode: 'CHILD-01',
        type: 'bin',
        zoneType: 'pick',
        parentLocationCode: 'PARENT-01',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: ['PARENT-01', 'CHILD-01'],
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        deleted: 2,
      });

      expect(
        await readZones(shop.shopId, ['PARENT-01', 'CHILD-01']),
      ).toHaveLength(0);
    });

    it('rejects the whole delete when a selected parent has an unselected child', async () => {
      const shop = await provisionFt2Shop('delete-dependent-child');

      await seedZone(shop.shopId, {
        locationCode: 'PARENT-01',
        type: 'lane',
      });

      await seedZone(shop.shopId, {
        locationCode: 'CHILD-01',
        parentLocationCode: 'PARENT-01',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: ['PARENT-01'],
        });

      expect(res.status).toBe(409);
      expect(await readZone(shop.shopId, 'PARENT-01')).toBeTruthy();
      expect(await readZone(shop.shopId, 'CHILD-01')).toBeTruthy();
    });

    it('rejects the whole delete when any selected location contains stock', async () => {
      const shop = await provisionFt2Shop('delete-stock');

      await seedZone(shop.shopId, {
        locationCode: 'SAFE-01',
        zoneType: 'pick',
      });
      await seedZone(shop.shopId, {
        locationCode: 'STOCKED-01',
        zoneType: 'pick',
      });

      await seedStock(shop.shopId, 'STOCKED-01', 2);

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: ['SAFE-01', 'STOCKED-01'],
        });

      expect(res.status).toBe(409);
      expect(await readZone(shop.shopId, 'SAFE-01')).toBeTruthy();
      expect(await readZone(shop.shopId, 'STOCKED-01')).toBeTruthy();
    });

    it('rejects warehouse/root deletion without changing other selected locations', async () => {
      const shop = await provisionFt2Shop('delete-root');

      await seedZone(shop.shopId, {
        locationCode: 'SAFE-01',
        zoneType: 'pick',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: [shop.rootLocationCode, 'SAFE-01'],
        });

      expect(res.status).toBe(409);
      expect(await readZone(shop.shopId, 'SAFE-01')).toBeTruthy();
      expect(await readZone(shop.shopId, shop.rootLocationCode)).toBeTruthy();
    });

    it('rolls back the entire delete when one requested location is missing', async () => {
      const shop = await provisionFt2Shop('delete-missing');

      await seedZone(shop.shopId, {
        locationCode: 'SAFE-01',
        zoneType: 'pick',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(shop.token))
        .send({
          location_codes: ['SAFE-01', 'DOES-NOT-EXIST'],
        });

      expect(res.status).toBe(404);
      expect(await readZone(shop.shopId, 'SAFE-01')).toBeTruthy();
    });

    it('treats a foreign-tenant location as missing and deletes zero local rows', async () => {
      const owner = await provisionFt2Shop('delete-owner');
      const foreign = await provisionFt2Shop('delete-foreign');

      await seedZone(owner.shopId, {
        locationCode: 'OWNER-01',
        zoneType: 'pick',
      });

      await seedZone(foreign.shopId, {
        locationCode: 'FOREIGN-01',
        zoneType: 'pick',
      });

      const res = await request(app)
        .delete('/api/v1/floor-planning/zones')
        .set(authed(owner.token))
        .send({
          location_codes: ['OWNER-01', 'FOREIGN-01'],
        });

      expect(res.status).toBe(404);
      expect(await readZone(owner.shopId, 'OWNER-01')).toBeTruthy();
      expect(await readZone(foreign.shopId, 'FOREIGN-01')).toBeTruthy();
    });
  });
});
