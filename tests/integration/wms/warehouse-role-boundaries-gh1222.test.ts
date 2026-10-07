// GH-1222 / TIER-07 — Warehouse role / commercial authorization boundaries.
//
// Ratified backend contract (commercial and role authority stay independent):
//
// D1 GRID READ — GET /api/v1/floor-planning/grid is operational read
//    infrastructure: warehouse.operations + wms:read. Operators keep the
//    read-only geometry needed for execution (pick map).
//    Floor Planning MANAGEMENT stays owner/admin: GET /floor-planning/layout
//    remains warehouse.floor_planning + floor-planning:read.
// D2 ANALYTICS READ — warehouse.analytics + wms:analytics:read (owner/admin).
//    Operator -> 403 ACTION_FORBIDDEN, never COMMERCIAL_ACCESS_DENIED.
// D3 ANALYTICS DISPLAY WRITE — display-token create/patch/rotate/revoke use
//    wms:analytics:display:write (owner/admin). Operator -> 403 with zero
//    token-row mutation.
// D4 PROBLEM CENTER OPERATIONAL READ — operator keeps GET /wms/problem-center.
// D5 PROBLEM CENTER MANAGEMENT RESOLVE — POST /wms/problem-center/:taskId/resolve
//    uses wms:problem:resolve (owner/admin). Operator is denied by authorization
//    BEFORE the controller runs; owner/admin pass authorization (a non-existent
//    task then yields the controller's own 404).
//
// Operator authority is the canonical default policy: no shop_role_permissions
// rows are seeded, so requireAction resolves through ACTION_ROLE_MAP defaults.
//
// Pattern: GH-1221 (wms-settings-management-authorization-gh1221.test.ts) —
// real Express app (createApp()), real disposable Postgres, real middleware
// chain, real tenant + memberships, authoritative tier via the canonical
// transitionShopSubscription path. No worker, no provider call.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type Role = 'owner' | 'admin' | 'operator';

let SHOP_ID: number;
const USER_IDS: Partial<Record<Role, number>> = {};

async function createMember(shopId: number, unique: string, role: Role): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `warehouse-roles-1222-${role}-${unique}@test.example`,
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

async function seedFixture(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `warehouse-roles-1222-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_IDS.owner = await createMember(SHOP_ID, unique, 'owner');
  USER_IDS.admin = await createMember(SHOP_ID, unique, 'admin');
  USER_IDS.operator = await createMember(SHOP_ID, unique, 'operator');

  await withTenant(SHOP_ID, async (trx) => {
    // requireFt2 -> LifecycleService.resolveForUser reads the shop-scoped
    // snapshot, so one FT2 row satisfies every member of this shop.
    await trx('user_lifecycle_snapshot').insert({
      shop_id: SHOP_ID,
      user_id: USER_IDS.owner,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });
}

/** GH-1136 — authoritative tier via the canonical transition path. */
async function setCurrentTier(tier: Tier): Promise<void> {
  await withTenant(SHOP_ID, (trx) =>
    transitionShopSubscription(
      {
        shopId: SHOP_ID,
        to: { tier, status: 'active', billingProvider: 'shopify' },
        source: 'gh1222_warehouse_role_boundaries_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );
}

function tokenFor(role: Role, tier: Tier): string {
  return issueTestToken({
    userId: USER_IDS[role] as number,
    shopId: SHOP_ID,
    tier,
    roles: [role],
  });
}

const asRole = (role: Role, tier: Tier) => ({ Authorization: `Bearer ${tokenFor(role, tier)}` });

async function displayTokenRows(): Promise<{ id: string; token_hash: string; label: string | null }[]> {
  return withTenant(SHOP_ID, (trx) =>
    trx('shop_display_tokens')
      .where({ shop_id: SHOP_ID })
      .orderBy('created_at', 'asc')
      .select('id', 'token_hash', 'label'),
  );
}

beforeAll(async () => {
  await seedFixture();
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
// D1 — grid operational read != Floor Planning management admission
// ---------------------------------------------------------------------------

describe('GH-1222 D1 — warehouse grid is operational read; Floor Planning management stays owner/admin', () => {
  it('D1a EXPECTED RED: operator @ Core reads GET /floor-planning/grid -> 200 { locations: [] }', async () => {
    await setCurrentTier('core');

    const res = await request(app).get('/api/v1/floor-planning/grid').set(asRole('operator', 'core'));

    // Status and denial identity together, so a RED run shows WHICH gate denied.
    expect({ status: res.status, error: res.body?.error, capabilityId: res.body?.capabilityId, action: res.body?.action })
      .toEqual({ status: 200, error: undefined, capabilityId: undefined, action: undefined });
    expect(Array.isArray(res.body.locations)).toBe(true);
  });

  it('D1b EXPECTED RED: owner @ Core reads GET /floor-planning/grid -> 200', async () => {
    await setCurrentTier('core');

    const res = await request(app).get('/api/v1/floor-planning/grid').set(asRole('owner', 'core'));

    // Status and denial identity together, so a RED run shows WHICH gate denied.
    expect({ status: res.status, error: res.body?.error, capabilityId: res.body?.capabilityId, action: res.body?.action })
      .toEqual({ status: 200, error: undefined, capabilityId: undefined, action: undefined });
    expect(Array.isArray(res.body.locations)).toBe(true);
  });

  it('D1c GREEN CONTROL: operator @ Growth is denied Floor Planning management GET /floor-planning/layout', async () => {
    await setCurrentTier('growth');

    const res = await request(app).get('/api/v1/floor-planning/layout').set(asRole('operator', 'growth'));

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('floor-planning:read');
  });

  it.each(['owner', 'admin'] as const)(
    'D1d GREEN CONTROL: %s @ Growth is admitted to GET /floor-planning/layout',
    async (role) => {
      await setCurrentTier('growth');

      const res = await request(app).get('/api/v1/floor-planning/layout').set(asRole(role, 'growth'));

      expect(res.status).toBe(200);
    },
  );
});

// ---------------------------------------------------------------------------
// D2 — analytics read is owner/admin management intelligence
// ---------------------------------------------------------------------------

describe('GH-1222 D2 — Warehouse Analytics read authority', () => {
  it.each(['owner', 'admin'] as const)('D2 GREEN CONTROL: %s @ Core GET /wms/analytics -> 200', async (role) => {
    await setCurrentTier('core');

    const res = await request(app).get('/api/v1/wms/analytics').set(asRole(role, 'core'));

    expect(res.status).toBe(200);
  });

  it('D2 EXPECTED RED: operator @ Core GET /wms/analytics -> 403 ACTION_FORBIDDEN on wms:analytics:read', async () => {
    await setCurrentTier('core');

    const res = await request(app).get('/api/v1/wms/analytics').set(asRole('operator', 'core'));

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('wms:analytics:read');
  });
});

// ---------------------------------------------------------------------------
// D3 — analytics display-token writes use management write authority
// ---------------------------------------------------------------------------

describe('GH-1222 D3 — Analytics display-token write authority', () => {
  it.each(['owner', 'admin'] as const)(
    'D3 GREEN CONTROL: %s @ Core creates a display token -> 201 and one token row',
    async (role) => {
      await setCurrentTier('core');
      const before = (await displayTokenRows()).length;

      const res = await request(app)
        .post('/api/v1/wms/analytics/display-tokens')
        .set(asRole(role, 'core'))
        .send({ label: 'GH-1222 test display' });

      expect(res.status).toBe(201);
      expect(typeof res.body.id).toBe('string');
      const after = await displayTokenRows();
      expect(after).toHaveLength(before + 1);
      expect(after.find((t) => t.id === res.body.id)?.label).toBe('GH-1222 test display');
    },
  );

  it('D3 EXPECTED RED: operator @ Core create -> 403 ACTION_FORBIDDEN on wms:analytics:display:write, zero mutation', async () => {
    await setCurrentTier('core');
    const before = await displayTokenRows();

    const res = await request(app)
      .post('/api/v1/wms/analytics/display-tokens')
      .set(asRole('operator', 'core'))
      .send({ label: 'GH-1222 test display' });

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('wms:analytics:display:write');
    expect(await displayTokenRows()).toEqual(before);
  });

  it('D3b EXPECTED RED: operator @ Core rotate of an existing token -> 403 on wms:analytics:display:write, token unchanged', async () => {
    await setCurrentTier('core');
    const created = await request(app)
      .post('/api/v1/wms/analytics/display-tokens')
      .set(asRole('owner', 'core'))
      .send({ label: 'GH-1222 rotate target' });
    expect(created.status).toBe(201);
    const before = await displayTokenRows();

    const res = await request(app)
      .post(`/api/v1/wms/analytics/display-tokens/${created.body.id}/rotate`)
      .set(asRole('operator', 'core'))
      .send({});

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('wms:analytics:display:write');
    expect(await displayTokenRows()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// D4 / D5 — Problem Center operational read vs management resolve
// ---------------------------------------------------------------------------

describe('GH-1222 D4 — Problem Center operational read', () => {
  it('D4 GREEN CONTROL: operator @ Core GET /wms/problem-center -> 200', async () => {
    await setCurrentTier('core');

    const res = await request(app).get('/api/v1/wms/problem-center').set(asRole('operator', 'core'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.problem_tasks)).toBe(true);
  });
});

describe('GH-1222 D5 — Problem Center management resolve authority', () => {
  const NONEXISTENT_TASK_ID = '00000000-0000-4000-8000-000000001222';
  const RESOLVE_BODY = {
    resolution_action: 'write_off',
    resolution_notes: 'GH-1222 auth boundary',
  };

  it('D5 EXPECTED RED: operator @ Core resolve -> 403 ACTION_FORBIDDEN on wms:problem:resolve (authorization, before controller)', async () => {
    await setCurrentTier('core');

    const res = await request(app)
      .post(`/api/v1/wms/problem-center/${NONEXISTENT_TASK_ID}/resolve`)
      .set(asRole('operator', 'core'))
      .send(RESOLVE_BODY);

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('wms:problem:resolve');
  });

  it.each(['owner', 'admin'] as const)(
    'D5 GREEN CONTROL: %s @ Core passes resolve authorization and reaches the controller (non-existent task -> 404)',
    async (role) => {
      await setCurrentTier('core');

      const res = await request(app)
        .post(`/api/v1/wms/problem-center/${NONEXISTENT_TASK_ID}/resolve`)
        .set(asRole(role, 'core'))
        .send(RESOLVE_BODY);

      expect(res.body?.error).not.toBe('ACTION_FORBIDDEN');
      expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
      expect(res.status).toBe(404);
    },
  );
});
