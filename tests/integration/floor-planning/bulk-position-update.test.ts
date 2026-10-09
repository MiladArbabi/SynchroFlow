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

async function seedMovableZone(
  shopId: number,
  locationCode: string,
  x: number,
  y: number,
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
      type: 'bin',
      zone_type: 'pick',
      parent_location_code: root.location_code,
      active: true,
      position_x: x,
      position_y: y,
      width: 1,
      depth: 1,
      orientation: 0,
      rack_levels: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

async function readPosition(shopId: number, locationCode: string) {
  return withTenant(shopId, (trx) =>
    trx('warehouse_locations')
      .where({
        shop_id: shopId,
        location_code: locationCode,
      })
      .first('position_x', 'position_y'),
  );
}

describe('FLOOR-PLANNING-CANVAS-01 C2b — atomic bulk position update', () => {
  it('updates every requested tenant-owned location in one successful operation', async () => {
    const shop = await provisionFt2Shop('success');

    await seedMovableZone(shop.shopId, 'MOVE-01', 1, 1);
    await seedMovableZone(shop.shopId, 'MOVE-02', 3, 1);

    const res = await request(app)
      .patch('/api/v1/floor-planning/zones/positions')
      .set(authed(shop.token))
      .send({
        positions: [
          { location_code: 'MOVE-01', position_x: 5, position_y: 4 },
          { location_code: 'MOVE-02', position_x: 7, position_y: 4 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      updated: 2,
    });

    const move01 = await readPosition(shop.shopId, 'MOVE-01');
    const move02 = await readPosition(shop.shopId, 'MOVE-02');

    expect(Number(move01.position_x)).toBe(5);
    expect(Number(move01.position_y)).toBe(4);
    expect(Number(move02.position_x)).toBe(7);
    expect(Number(move02.position_y)).toBe(4);
  });

  it.each([
    ['empty batch', { positions: [] }],
    [
      'duplicate location code',
      {
        positions: [
          { location_code: 'MOVE-01', position_x: 2, position_y: 2 },
          { location_code: 'MOVE-01', position_x: 3, position_y: 3 },
        ],
      },
    ],
    [
      'missing coordinate',
      {
        positions: [
          { location_code: 'MOVE-01', position_x: 2 },
        ],
      },
    ],
    [
      'negative coordinate',
      {
        positions: [
          { location_code: 'MOVE-01', position_x: -1, position_y: 2 },
        ],
      },
    ],
  ])('rejects invalid request: %s', async (_label, payload) => {
    const shop = await provisionFt2Shop(`invalid-${crypto.randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .patch('/api/v1/floor-planning/zones/positions')
      .set(authed(shop.token))
      .send(payload);

    expect(res.status).toBe(400);
  });

  it('rejects warehouse/root movement', async () => {
    const shop = await provisionFt2Shop('warehouse');

    const before = await readPosition(shop.shopId, shop.rootLocationCode);

    const res = await request(app)
      .patch('/api/v1/floor-planning/zones/positions')
      .set(authed(shop.token))
      .send({
        positions: [
          {
            location_code: shop.rootLocationCode,
            position_x: 5,
            position_y: 5,
          },
        ],
      });

    expect(res.status).toBe(400);

    const after = await readPosition(shop.shopId, shop.rootLocationCode);
    expect(after).toEqual(before);
  });

  it('rolls back the entire batch when one requested location does not exist', async () => {
    const shop = await provisionFt2Shop('missing');

    await seedMovableZone(shop.shopId, 'SAFE-01', 1, 1);
    await seedMovableZone(shop.shopId, 'SAFE-02', 3, 1);

    const before1 = await readPosition(shop.shopId, 'SAFE-01');
    const before2 = await readPosition(shop.shopId, 'SAFE-02');

    const res = await request(app)
      .patch('/api/v1/floor-planning/zones/positions')
      .set(authed(shop.token))
      .send({
        positions: [
          { location_code: 'SAFE-01', position_x: 8, position_y: 8 },
          { location_code: 'DOES-NOT-EXIST', position_x: 9, position_y: 8 },
          { location_code: 'SAFE-02', position_x: 10, position_y: 8 },
        ],
      });

    expect(res.status).toBe(404);

    expect(await readPosition(shop.shopId, 'SAFE-01')).toEqual(before1);
    expect(await readPosition(shop.shopId, 'SAFE-02')).toEqual(before2);
  });

  it('treats a foreign-tenant location as missing and changes zero local rows', async () => {
    const owner = await provisionFt2Shop('owner');
    const foreign = await provisionFt2Shop('foreign');

    await seedMovableZone(owner.shopId, 'OWNER-01', 1, 1);
    await seedMovableZone(foreign.shopId, 'FOREIGN-01', 20, 20);

    const ownerBefore = await readPosition(owner.shopId, 'OWNER-01');
    const foreignBefore = await readPosition(foreign.shopId, 'FOREIGN-01');

    const res = await request(app)
      .patch('/api/v1/floor-planning/zones/positions')
      .set(authed(owner.token))
      .send({
        positions: [
          { location_code: 'OWNER-01', position_x: 6, position_y: 6 },
          { location_code: 'FOREIGN-01', position_x: 7, position_y: 6 },
        ],
      });

    expect(res.status).toBe(404);

    expect(await readPosition(owner.shopId, 'OWNER-01')).toEqual(ownerBefore);
    expect(await readPosition(foreign.shopId, 'FOREIGN-01')).toEqual(foreignBefore);
  });
});
