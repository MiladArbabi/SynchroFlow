// AUTH-PERM-01 / D06 — owner-only permission-matrix mutation.
//
// PATCH /api/v1/settings/permissions mutates the shop's role→action policy and
// must be owner-only. Route admission stays requireAction('wms:settings:write')
// (owner/admin, shared with GET and PATCH /wms/settings — GH-1221), and the
// controller adds an independent, non-configurable owner check on the trusted
// JWT shop_roles claim (RECOUNT-131 precedent). A persisted shop_role_permissions
// grant must never widen it.
//
// CONTRACT-PERM-01-1: owner PATCH -> 200, row updated, cache invalidated once.
// CONTRACT-PERM-01-2: admin PATCH -> 403 { ACTION_FORBIDDEN, requiredRole: owner },
//   zero mutation, zero invalidation.
// CONTRACT-PERM-01-3: operator PATCH -> 403 ACTION_FORBIDDEN on wms:settings:write
//   (existing route admission), zero mutation, zero invalidation.
// CONTRACT-PERM-01-4: admin with persisted wms:settings:write grant -> controller
//   403 regardless, zero mutation, zero invalidation.
// CONTRACT-PERM-01-5: owner and admin GET -> 200 permission matrix.
// CONTRACT-PERM-01-6: owner B PATCH mutates only shop B; shop A unchanged.
// CONTRACT-PERM-01-7: owner PATCH of a LOCKED action -> existing ACTION_LOCKED
//   rejection, zero mutation, zero invalidation.
//
// Real Express app (createApp()), real JWT auth, real requireAction admission,
// real disposable Postgres with real memberships, permission rows and tenant RLS.
// Redis is a deterministic double: reads always miss (persisted rows decide
// admission) and del() calls are recorded to observe cache invalidation.
// No worker, no provider call.

const mockRedisDel = jest.fn(async (_key: string) => 1);
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({
    get: async () => null,
    set: async () => 'OK',
    del: (key: string) => mockRedisDel(key),
  }),
}));

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

const PERMISSIONS_ROUTE = '/api/v1/settings/permissions';

// Configurable (non-locked) action whose operator grant is the mutation target.
const TARGET_ACTION = 'suppliers:read';
const TARGET_ROLE = 'operator';
// Owner-only authority being certified; admin holds it at the route layer.
const ROUTE_ACTION = 'wms:settings:write';
// Existing LOCKED action (permissionSettings.LOCKED_ACTIONS).
const LOCKED_ACTION = 'members:write';

type Role = 'owner' | 'admin' | 'operator';
type Shop = { shopId: number; users: Record<Role, number> };
type Grant = { granted: boolean } | undefined;

let shopA: Shop;
let shopB: Shop;

async function seedShop(label: string): Promise<Shop> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `auth-perm-01-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const users = {} as Record<Role, number>;
  for (const role of ['owner', 'admin', 'operator'] as const) {
    users[role] = await withTenant(shopId, async (trx) => {
      const [row] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `auth-perm-01-${label}-${role}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: role,
          role,
        })
        .returning('id');
      const userId = row.id as number;

      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: userId,
        role,
        revoked_at: null,
      });

      return userId;
    });
  }

  return { shopId, users };
}

function tokenFor(shop: Shop, role: Role): string {
  return issueTestToken({
    userId: shop.users[role],
    shopId: shop.shopId,
    roles: [role],
  });
}

function patchPermissions(shop: Shop, role: Role, updates: unknown[]) {
  return request(app)
    .patch(PERMISSIONS_ROUTE)
    .set('Authorization', `Bearer ${tokenFor(shop, role)}`)
    .send({ updates });
}

function getPermissions(shop: Shop, role: Role) {
  return request(app)
    .get(PERMISSIONS_ROUTE)
    .set('Authorization', `Bearer ${tokenFor(shop, role)}`);
}

async function readGrant(shop: Shop, action: string, role: Role): Promise<Grant> {
  const row = await withTenant(shop.shopId, (trx) =>
    trx('shop_role_permissions')
      .where({ shop_id: shop.shopId, action, role })
      .first('granted'),
  );
  return row ? { granted: row.granted as boolean } : undefined;
}

async function readShopRows(shop: Shop) {
  return withTenant(shop.shopId, (trx) =>
    trx('shop_role_permissions')
      .where({ shop_id: shop.shopId })
      .orderBy(['action', 'role'])
      .select('action', 'role', 'granted', 'locked'),
  );
}

const cacheKey = (shop: Shop) => `permissions:shop:${shop.shopId}`;

beforeAll(async () => {
  shopA = await seedShop('a');
  shopB = await seedShop('b');
});

beforeEach(() => {
  mockRedisDel.mockClear();
});

afterAll(async () => {
  await db.destroy();
});

describe('AUTH-PERM-01 PATCH /api/v1/settings/permissions owner-only authority', () => {
  it('1 — GREEN CONTROL: owner PATCH updates the grant and invalidates the cache once', async () => {
    expect(await readGrant(shopA, TARGET_ACTION, TARGET_ROLE)).toBeUndefined();

    const res = await patchPermissions(shopA, 'owner', [
      { action: TARGET_ACTION, role: TARGET_ROLE, granted: true },
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 1, rejected: [] });
    expect(await readGrant(shopA, TARGET_ACTION, TARGET_ROLE)).toEqual({ granted: true });
    expect(mockRedisDel.mock.calls).toEqual([[cacheKey(shopA)]]);
  });

  it('2 — EXPECTED RED: admin PATCH is denied owner-only with zero mutation and zero invalidation', async () => {
    const before = await readShopRows(shopA);

    const res = await patchPermissions(shopA, 'admin', [
      { action: TARGET_ACTION, role: TARGET_ROLE, granted: false },
    ]);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'ACTION_FORBIDDEN', requiredRole: 'owner' });
    expect(await readShopRows(shopA)).toEqual(before);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('3 — GREEN CONTROL: operator PATCH is denied by existing route admission with zero mutation and zero invalidation', async () => {
    const before = await readShopRows(shopA);

    const res = await patchPermissions(shopA, 'operator', [
      { action: TARGET_ACTION, role: TARGET_ROLE, granted: true },
    ]);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe(ROUTE_ACTION);
    expect(await readShopRows(shopA)).toEqual(before);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('4 — EXPECTED RED: a persisted admin wms:settings:write grant cannot bypass owner-only', async () => {
    await withTenant(shopA.shopId, (trx) =>
      trx('shop_role_permissions')
        .insert({
          shop_id: shopA.shopId,
          action: ROUTE_ACTION,
          role: 'admin',
          granted: true,
          locked: true,
          updated_at: new Date(),
        })
        .onConflict(['shop_id', 'action', 'role'])
        .merge({ granted: true, updated_at: new Date() }),
    );
    expect(await readGrant(shopA, ROUTE_ACTION, 'admin')).toEqual({ granted: true });

    const before = await readShopRows(shopA);

    const res = await patchPermissions(shopA, 'admin', [
      { action: TARGET_ACTION, role: TARGET_ROLE, granted: false },
    ]);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'ACTION_FORBIDDEN', requiredRole: 'owner' });
    expect(await readShopRows(shopA)).toEqual(before);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('5 — GREEN CONTROL: owner and admin can both read the permission matrix', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const res = await getPermissions(shopA, role);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.actions)).toBe(true);
      expect(res.body.actions.map((a: { action: string }) => a.action)).toContain(TARGET_ACTION);
    }
  });

  it('6 — GREEN CONTROL: owner B PATCH mutates only shop B; shop A is unchanged', async () => {
    const shopABefore = await readShopRows(shopA);
    expect(await readGrant(shopB, TARGET_ACTION, TARGET_ROLE)).toBeUndefined();

    const res = await patchPermissions(shopB, 'owner', [
      { action: TARGET_ACTION, role: TARGET_ROLE, granted: true },
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 1, rejected: [] });
    expect(await readGrant(shopB, TARGET_ACTION, TARGET_ROLE)).toEqual({ granted: true });
    expect(await readShopRows(shopA)).toEqual(shopABefore);
    expect(mockRedisDel.mock.calls).toEqual([[cacheKey(shopB)]]);
  });

  it('7 — GREEN CONTROL: owner PATCH of a LOCKED action keeps ACTION_LOCKED with zero mutation and zero invalidation', async () => {
    const before = await readShopRows(shopA);
    const update = { action: LOCKED_ACTION, role: 'admin', granted: false };

    const res = await patchPermissions(shopA, 'owner', [update]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      applied: 0,
      rejected: [{ update, reason: 'ACTION_LOCKED' }],
    });
    expect(await readShopRows(shopA)).toEqual(before);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
