/**
 * GH-1242 — immutable runtime authority for LOCKED_ACTIONS.
 *
 * Real PostgreSQL, restricted sf_app, forced tenant RLS,
 * real JWT authentication and real requireAction middleware.
 *
 * The test-only HTTP route has no business-side effects.
 * Redis is a deterministic in-memory test double.
 *
 * Expected RED before correction:
 *   R1: forbidden persisted grants must not elevate roles.
 *   R2: persisted denials must not revoke locked authority.
 *   R3: Redis overrides must not change locked authority.
 *   R4: permission matrix must show effective locked policy.
 *
 * C1: configurable permissions and tenant isolation remain valid.
 */

const mockRedisCache = new Map<string, string>();

jest.mock(
  '@lasyncro/backend-core/services/redis.client.js',
  () => ({
    getRedisClient: () => ({
      get: async (key: string) =>
        mockRedisCache.get(key) ?? null,
      set: async (key: string, value: string) => {
        mockRedisCache.set(key, value);
        return 'OK';
      },
      del: async (key: string) =>
        Number(mockRedisCache.delete(key)),
    }),
  })
);

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { requireAction, ACTION_ROLE_MAP }
  from 'api-src/middleware/require-action.middleware';
import { LOCKED_ACTIONS }
  from 'api-src/services/permissions/permissionSettings.service';
import { authenticateToken }
  from '@lasyncro/backend-core/middleware/auth.middleware.js';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
  systemQuery,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop }
  from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(60000);

type Role = 'owner' | 'admin' | 'operator';

const POLICY: ReadonlyArray<{
  action: string;
  roles: readonly Role[];
}> = [
  { action: 'members:write', roles: ['owner'] },
  { action: 'members:remove', roles: ['owner'] },
  { action: 'billing:write', roles: ['owner'] },
  { action: 'shopify-billing:write', roles: ['owner'] },
  { action: 'wms:settings:write', roles: ['owner', 'admin'] },
  { action: 'wms:analytics:read', roles: ['owner', 'admin'] },
  {
    action: 'wms:analytics:display:write',
    roles: ['owner', 'admin'],
  },
  { action: 'wms:problem:resolve', roles: ['owner', 'admin'] },
  { action: 'orders:execute', roles: ['owner', 'admin'] },
  {
    action: 'orders:shipping-address:write',
    roles: ['owner', 'admin'],
  },
];

const ALL_ROLES: Role[] = ['owner', 'admin', 'operator'];

type Fixture = {
  shopId: number;
  users: Record<Role, number>;
};

let shopA: Fixture;
let shopB: Fixture;

const guardApp = express();

guardApp.get(
  '/gh1242/authorize/:action',
  authenticateToken,
  (req, res, next) =>
    requireAction(req.params.action as string)(req, res, next),
  (_req, res) => res.status(204).end()
);

const productionRoutes = createApp();

async function seedShop(label: string): Promise<Fixture> {
  const unique = crypto.randomBytes(7).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `gh1242-${label}-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  const users = {} as Record<Role, number>;

  for (const role of ALL_ROLES) {
    users[role] = await withTenant(shopId, async (trx) => {
      const [user] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `gh1242-${label}-${role}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: role,
          role,
        })
        .returning('id');

      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: user.id,
        role,
        revoked_at: null,
      });

      return Number(user.id);
    });
  }

  return { shopId, users };
}

function token(shop: Fixture, role: Role): string {
  return issueTestToken({
    userId: shop.users[role],
    shopId: shop.shopId,
    roles: [role],
  });
}

async function admission(
  shop: Fixture,
  role: Role,
  action: string
): Promise<number> {
  const response = await request(guardApp)
    .get(`/gh1242/authorize/${encodeURIComponent(action)}`)
    .set('Authorization', `Bearer ${token(shop, role)}`);

  return response.status;
}

beforeAll(async () => {
  const name = process.env.PGDATABASE ?? '';

  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
    !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)
  ) {
    throw new Error('GH1242_NON_DISPOSABLE_DB_BLOCKED');
  }

  const identity = await systemQuery(db.raw(`
    SELECT current_database() AS database,
           current_user AS role,
           rolsuper,
           rolbypassrls
      FROM pg_roles
     WHERE rolname = current_user
  `));

  expect(identity.rows).toEqual([{
    database: name,
    role: 'sf_app',
    rolsuper: false,
    rolbypassrls: false,
  }]);

  const policyState = await systemQuery(db.raw(`
    SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
     WHERE relname = 'shop_role_permissions'
       AND relkind = 'r'
  `));

  expect(policyState.rows).toEqual([{
    relrowsecurity: true,
    relforcerowsecurity: true,
  }]);

  expect([...LOCKED_ACTIONS].sort()).toEqual(
    POLICY.map((entry) => entry.action).sort()
  );

  for (const entry of POLICY) {
    expect(ACTION_ROLE_MAP[entry.action]).toEqual(entry.roles);
  }

  shopA = await seedShop('drift');
  shopB = await seedShop('control');

  const rows = POLICY.flatMap(({ action, roles }) =>
    ALL_ROLES.map((role) => ({
      shop_id: shopA.shopId,
      action,
      role,
      granted: !roles.includes(role),
      locked: false,
      updated_at: new Date(),
    }))
  );

  rows.push(
    {
      shop_id: shopA.shopId,
      action: 'integrations:write',
      role: 'operator',
      granted: true,
      locked: false,
      updated_at: new Date(),
    },
    {
      shop_id: shopA.shopId,
      action: 'integrations:write',
      role: 'admin',
      granted: false,
      locked: false,
      updated_at: new Date(),
    }
  );

  await withTenant(shopA.shopId, (trx) =>
    trx('shop_role_permissions')
      .insert(rows)
      .onConflict(['shop_id', 'action', 'role'])
      .merge(['granted', 'locked', 'updated_at'])
  );
});

beforeEach(() => {
  mockRedisCache.clear();
});

afterAll(async () => {
  await db.destroy();
});

describe('GH-1242 — immutable locked-action runtime policy', () => {
  it('R1 EXPECTED RED: forbidden persisted grants cannot elevate roles', async () => {
    const actual: string[] = [];
    const expected: string[] = [];

    for (const { action, roles } of POLICY) {
      for (const role of ALL_ROLES) {
        if (roles.includes(role)) continue;

        const status = await admission(shopA, role, action);

        actual.push(`${action}:${role}:${status}`);
        expected.push(`${action}:${role}:403`);
      }
    }

    expect(expected).toHaveLength(14);
    expect(actual).toEqual(expected);
  });

  it('R2 EXPECTED RED: persisted denials cannot revoke locked authority', async () => {
    const actual: string[] = [];
    const expected: string[] = [];

    for (const { action, roles } of POLICY) {
      for (const role of roles) {
        const status = await admission(shopA, role, action);

        actual.push(`${action}:${role}:${status}`);
        expected.push(`${action}:${role}:204`);
      }
    }

    expect(expected).toHaveLength(16);
    expect(actual).toEqual(expected);
  });

  it('R3 EXPECTED RED: Redis cannot override locked authority', async () => {
    mockRedisCache.set(
      `permissions:shop:${shopB.shopId}`,
      JSON.stringify({
        'members:write:operator': true,
        'billing:write:admin': true,
        'wms:settings:write:admin': false,
      })
    );

    const actual = [
      await admission(shopB, 'operator', 'members:write'),
      await admission(shopB, 'admin', 'billing:write'),
      await admission(shopB, 'admin', 'wms:settings:write'),
    ];

    expect(actual).toEqual([403, 403, 204]);
  });

  it('R4 EXPECTED RED: matrix reports effective locked policy', async () => {
    mockRedisCache.set(
      `permissions:shop:${shopA.shopId}`,
      JSON.stringify({
        'wms:settings:write:owner': true,
      })
    );

    const response = await request(productionRoutes)
      .get('/api/v1/settings/permissions')
      .set('Authorization', `Bearer ${token(shopA, 'owner')}`);

    expect(response.status).toBe(200);

    const actions = response.body.actions as Array<{
      action: string;
      permissions: Record<
        Role,
        { granted: boolean; locked: boolean }
      >;
    }>;

    for (const { action, roles } of POLICY) {
      const row = actions.find((item) => item.action === action);

      expect(row).toBeDefined();

      for (const role of ALL_ROLES) {
        expect(row!.permissions[role]).toEqual({
          granted: roles.includes(role),
          locked: true,
        });
      }
    }
  });

  it('C1 GREEN: configurable permissions preserve overrides and tenant isolation', async () => {
    expect(await admission(
      shopA, 'operator', 'integrations:write'
    )).toBe(204);

    expect(await admission(
      shopA, 'admin', 'integrations:write'
    )).toBe(403);

    expect(await admission(
      shopB, 'operator', 'integrations:write'
    )).toBe(403);

    expect(await admission(
      shopB, 'admin', 'integrations:write'
    )).toBe(204);
  });
});
