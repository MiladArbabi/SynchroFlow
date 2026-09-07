// tests/integration/entitlements/representative-route-commercial-gate.test.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2A — VERIFY §9
// ===================================================
// The low-cost REPRESENTATIVE real-route backend integration matrix that was
// deferred from RED. One real endpoint per migrated capability family, driven
// through the real Express app (createApp()) + real disposable PostgreSQL +
// issueTestToken. NOT the full ~130-chain matrix.
//
// requireCapability resolves tier from the JWT claim (resolveTier(req) ->
// req.user.tier), so a single seeded FT2 shop is sufficient — the tier under
// test is varied purely through the token. No shop_subscriptions row is needed
// for the commercial gate itself.
//
// DENY assertions: exact commercial 403 body (COMMERCIAL_ACCESS_DENIED + reason
// + capabilityId + currentTier).
// ALLOW assertions: the request PASSED the commercial middleware — i.e. it is
// NOT a COMMERCIAL_ACCESS_DENIED 403. A downstream domain 200/400/404/500 from
// the handler is a handler outcome, never a commercial denial (VERIFY §9).
// RBAC separation (VERIFY §10): a commercially-eligible operator clears
// requireCapability and is then denied by requireAction — ACTION_FORBIDDEN,
// never COMMERCIAL_ACCESS_DENIED.
//
// Real Express app (createApp(), never server.ts). Real disposable Postgres.
// No worker started. No Stripe/Shopify call in this file or its code path.

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

const app = createApp();

type Tier = 'starter' | 'core' | 'growth' | 'scale';

let SHOP_ID: number;
let USER_ID: number;

async function seedFt2Shop(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `a2a-verify-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_ID = await withTenant(SHOP_ID, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: SHOP_ID,
        email: `a2a-verify+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(SHOP_ID, (trx) =>
    trx('shop_memberships').insert({ shop_id: SHOP_ID, user_id: USER_ID, role: 'owner' }),
  );

  // requireFt2 -> LifecycleService.resolveForUser must return 'FT2'.
  await withTenant(SHOP_ID, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: SHOP_ID,
      user_id: USER_ID,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    }),
  );
}

beforeAll(async () => {
  await seedFt2Shop();
});

afterAll(async () => {
  await db.destroy();
});

function get(pathname: string, tier: Tier, roles: string[] = ['owner']) {
  const token = issueTestToken({ userId: USER_ID, shopId: SHOP_ID, tier, roles });
  return request(app).get(pathname).set('Authorization', `Bearer ${token}`);
}

/** True unless the response is a commercial-gate denial. */
function commercialGatePassed(res: request.Response): boolean {
  return !(res.status === 403 && res.body?.error === 'COMMERCIAL_ACCESS_DENIED');
}

function expectCommercialDenied(
  res: request.Response,
  capabilityId: string,
  currentTier: Tier,
  reason = 'TIER_TOO_LOW',
) {
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({
    error: 'COMMERCIAL_ACCESS_DENIED',
    reason,
    capabilityId,
    currentTier,
  });
  expect(res.body.error).not.toBe('ROLE_FORBIDDEN');
  expect(res.body.error).not.toBe('ACTION_FORBIDDEN');
}

// ===========================================================================
// P0-A3-5 — PURCHASING / SOURCING RUNTIME COMMERCIAL MATRIX
//
// SUPERSEDES the stale "purchasing.core is Starter+; no tier DENY case exists"
// contract this block used to carry. Ratified split
// (COMMERCIAL-REMODEL-ALIGN-01):
//
//   purchasing.core     Core+    representative: GET /api/v1/suppliers/
//   purchasing.sourcing Growth+  representative: GET /api/v1/suppliers/sourcing-worklist
//
// ALLOW keeps the meaning it has everywhere in this file: the request PASSED
// the commercial middleware. A downstream domain 200/400/404/500 is a handler
// outcome, never a commercial denial — no business fixture is fabricated to
// force a 200.
// ===========================================================================
const PURCHASING_CORE_ROUTE = '/api/v1/suppliers/';
const PURCHASING_SOURCING_ROUTE = '/api/v1/suppliers/sourcing-worklist';

describe('P0-A3-5 purchasing.core (Core+) — GET /api/v1/suppliers/', () => {
  it('DENY: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW / purchasing.core', async () => {
    const res = await get(PURCHASING_CORE_ROUTE, 'starter');
    expectCommercialDenied(res, 'purchasing.core', 'starter');
  });

  it.each<[Tier]>([['core'], ['growth'], ['scale']])(
    'ALLOW: %s clears the commercial gate',
    async (tier) => {
      const res = await get(PURCHASING_CORE_ROUTE, tier);
      expect(commercialGatePassed(res)).toBe(true);
    },
  );
});

describe('P0-A3-5 purchasing.sourcing (Growth+) — GET /api/v1/suppliers/sourcing-worklist', () => {
  it.each<[Tier]>([['starter'], ['core']])(
    'EXPECTED RED: %s => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW / purchasing.sourcing',
    async (tier) => {
      // Starter is denied today, but on purchasing.core — the capabilityId in
      // the body is contractual, so the Starter case is RED on identity even
      // while the HTTP status matches. Core is RED outright: the route still
      // carries requireCapability('purchasing.core'), which Core satisfies.
      const res = await get(PURCHASING_SOURCING_ROUTE, tier);
      expectCommercialDenied(res, 'purchasing.sourcing', tier);
    },
  );

  it.each<[Tier]>([['growth'], ['scale']])(
    'ALLOW: %s clears the commercial gate',
    async (tier) => {
      const res = await get(PURCHASING_SOURCING_ROUTE, tier);
      expect(commercialGatePassed(res)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// PUR-C9 — RBAC stays independently authoritative on a sourcing route.
// ---------------------------------------------------------------------------
describe('P0-A3-5 sourcing RBAC separation — commercial and role denial stay distinct', () => {
  it('an eligible Growth user is never denied COMMERCIALLY on the sourcing route', async () => {
    const res = await get(PURCHASING_SOURCING_ROUTE, 'growth', ['operator']);
    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
  });

  it('a role denial on the sourcing route is ACTION_FORBIDDEN, never COMMERCIAL_ACCESS_DENIED', async () => {
    // The sourcing worklist requires suppliers:read, which an operator does not
    // hold. Commercial eligibility (Growth) is satisfied, so the only remaining
    // denial vocabulary must be requireAction's.
    const res = await get(PURCHASING_SOURCING_ROUTE, 'growth', ['operator']);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
  });
});

// ===========================================================================
// WMS base  ->  warehouse.operations  (Starter+; no tier DENY case exists)
// ===========================================================================
describe('warehouse.operations — GET /api/v1/wms/batches', () => {
  it('ALLOW: Starter clears the commercial gate', async () => {
    const res = await get('/api/v1/wms/batches', 'starter');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// WMS analytics  ->  warehouse.analytics  (Growth+)
// ===========================================================================
describe('warehouse.analytics — GET /api/v1/wms/analytics', () => {
  it('DENY: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/wms/analytics', 'starter');
    expectCommercialDenied(res, 'warehouse.analytics', 'starter');
  });

  it('DENY: Core => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/wms/analytics', 'core');
    expectCommercialDenied(res, 'warehouse.analytics', 'core');
  });

  it('ALLOW: Growth clears the commercial gate', async () => {
    const res = await get('/api/v1/wms/analytics', 'growth');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// WMS problem center  ->  warehouse.problem_center  (Core+)
// ===========================================================================
describe('warehouse.problem_center — GET /api/v1/wms/problem-center/pick-exceptions', () => {
  it('DENY: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/wms/problem-center/pick-exceptions', 'starter');
    expectCommercialDenied(res, 'warehouse.problem_center', 'starter');
  });

  it('ALLOW: Core clears the commercial gate', async () => {
    const res = await get('/api/v1/wms/problem-center/pick-exceptions', 'core');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// floor planning  ->  warehouse.floor_planning  (Growth+; closes the audited
// Starter/Core leak — Core is now DENY)
// ===========================================================================
describe('warehouse.floor_planning — GET /api/v1/floor-planning/layout', () => {
  it('DENY: Core => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW (leak closed)', async () => {
    const res = await get('/api/v1/floor-planning/layout', 'core');
    expectCommercialDenied(res, 'warehouse.floor_planning', 'core');
  });

  it('ALLOW: Growth clears the commercial gate', async () => {
    const res = await get('/api/v1/floor-planning/layout', 'growth');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// Overview Live Map  ->  overview.live_map  (Growth+; P0-A3-2 TEST STRATEGY /
// RED — the route currently has NO commercial gate at all, so every DENY
// case below fails against production code today)
// ===========================================================================
describe('overview.live_map — GET /api/v1/wms/live-activity', () => {
  it('EXPECTED RED: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/wms/live-activity', 'starter');
    expectCommercialDenied(res, 'overview.live_map', 'starter');
  });

  it('EXPECTED RED: Core => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/wms/live-activity', 'core');
    expectCommercialDenied(res, 'overview.live_map', 'core');
  });

  it('GREEN CONTROL (vacuous today — no gate exists yet, so nothing denies it; must stay true once the gate lands): Growth clears the commercial gate', async () => {
    const res = await get('/api/v1/wms/live-activity', 'growth');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// demand  ->  demand.forecasting  (Growth+)
// ===========================================================================
describe('demand.forecasting — GET /api/v1/modules/demand/', () => {
  it('DENY: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW', async () => {
    const res = await get('/api/v1/modules/demand/', 'starter');
    expectCommercialDenied(res, 'demand.forecasting', 'starter');
  });

  it('ALLOW: Growth clears the commercial gate', async () => {
    const res = await get('/api/v1/modules/demand/', 'growth');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// P0-A3-3 — Returns commercial classes (RED)
//
// One representative REAL route per ratified Returns capability class:
//   returns.intake   (Starter+)  GET /api/v1/modules/returns/jobs
//   returns.core     (Core+)     GET /api/v1/modules/returns/items
//   returns.analysis (Growth+)   GET /api/v1/modules/returns/correlation
//
// All three representatives are GETs, so the existing `get()` helper, the
// single seeded FT2 shop and the JWT-tier pattern above are reused unchanged.
//
// ALLOW here means exactly what it means everywhere else in this file: the
// request PASSED the commercial middleware. A downstream domain 200/400/404/500
// is a handler outcome, never a commercial denial. No business fixture data is
// fabricated to manufacture an HTTP 200.
// ===========================================================================

const RETURNS_INTAKE_ROUTE = '/api/v1/modules/returns/jobs';
const RETURNS_CORE_ROUTE = '/api/v1/modules/returns/items';
const RETURNS_ANALYSIS_ROUTE = '/api/v1/modules/returns/correlation';

/**
 * Returns-scoped ALLOW assertion.
 *
 * `commercialGatePassed()` alone is NOT sufficient here: Returns still denies
 * through the LEGACY `requireTier` vocabulary (403 `TIER_INSUFFICIENT`, with no
 * capabilityId/reason/currentTier), which that helper does not recognise as a
 * denial. Using it by itself would report a vacuous PASS for a tenant that is
 * in fact being turned away on tier grounds. This asserts the request was not
 * turned away by EITHER commercial vocabulary.
 *
 * A downstream domain 200/400/404/500 remains a handler outcome, never a
 * commercial denial — no business fixture is fabricated to force a 200.
 */
function expectNoTierDenial(res: request.Response) {
  expect(commercialGatePassed(res)).toBe(true);
  expect(res.body?.error).not.toBe('TIER_INSUFFICIENT');
}

describe('P0-A3-3 returns.intake (Starter+) — GET /api/v1/modules/returns/jobs', () => {
  it.each<[Tier]>([['starter'], ['core'], ['growth'], ['scale']])(
    'EXPECTED RED: %s clears the commercial gate',
    async (tier) => {
      const res = await get(RETURNS_INTAKE_ROUTE, tier);
      expectNoTierDenial(res);
    },
  );
});

describe('P0-A3-3 returns.core (Core+) — GET /api/v1/modules/returns/items', () => {
  it('EXPECTED RED: Starter => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW / returns.core', async () => {
    const res = await get(RETURNS_CORE_ROUTE, 'starter');
    expectCommercialDenied(res, 'returns.core', 'starter');
  });

  it.each<[Tier]>([['core'], ['growth'], ['scale']])(
    'EXPECTED RED: %s clears the commercial gate',
    async (tier) => {
      const res = await get(RETURNS_CORE_ROUTE, tier);
      expectNoTierDenial(res);
    },
  );
});

describe('P0-A3-3 returns.analysis (Growth+) — GET /api/v1/modules/returns/correlation', () => {
  it.each<[Tier]>([['starter'], ['core']])(
    'EXPECTED RED: %s => COMMERCIAL_ACCESS_DENIED / TIER_TOO_LOW / returns.analysis',
    async (tier) => {
      const res = await get(RETURNS_ANALYSIS_ROUTE, tier);
      expectCommercialDenied(res, 'returns.analysis', tier);
    },
  );

  it.each<[Tier]>([['growth'], ['scale']])(
    'EXPECTED RED: %s clears the commercial gate',
    async (tier) => {
      const res = await get(RETURNS_ANALYSIS_ROUTE, tier);
      expectNoTierDenial(res);
    },
  );
});

describe('P0-A3-3 Returns RBAC separation — the commercial gate is not a role gate', () => {
  it('EXPECTED RED: an operator @ Growth on /correlation is never denied COMMERCIALLY', async () => {
    // Whether or not the operator holds returns:read, the denial must not be
    // COMMERCIAL_ACCESS_DENIED — Growth holds returns.analysis. Commercial and
    // role denial stay separate concerns.
    const res = await get(RETURNS_ANALYSIS_ROUTE, 'growth', ['operator']);
    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
  });
});

// ===========================================================================
// Scale invariant — every migrated family clears the gate at Scale
// ===========================================================================
describe('Scale clears every migrated commercial gate', () => {
  it.each([
    ['/api/v1/suppliers/'],
    ['/api/v1/suppliers/sourcing-worklist'],
    ['/api/v1/wms/batches'],
    ['/api/v1/wms/analytics'],
    ['/api/v1/wms/problem-center/pick-exceptions'],
    ['/api/v1/floor-planning/layout'],
    ['/api/v1/modules/demand/'],
    ['/api/v1/wms/live-activity'],
  ])('ALLOW: %s at Scale is never a commercial denial', async (pathname) => {
    const res = await get(pathname, 'scale');
    expect(commercialGatePassed(res)).toBe(true);
  });
});

// ===========================================================================
// VERIFY §10 — RBAC separation on a real route: a commercially-eligible
// operator clears requireCapability, then requireAction denies the write.
// ===========================================================================
describe('RBAC stays with requireAction — POST /api/v1/suppliers/ as operator @ Growth', () => {
  it('403 is a role denial (ACTION_FORBIDDEN), not COMMERCIAL_ACCESS_DENIED', async () => {
    const token = issueTestToken({
      userId: USER_ID,
      shopId: SHOP_ID,
      tier: 'growth',
      roles: ['operator'],
    });
    const res = await request(app)
      .post('/api/v1/suppliers/')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
  });
});
