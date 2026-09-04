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
// suppliers  ->  purchasing.core  (Starter+; no tier DENY case exists)
// ===========================================================================
describe('purchasing.core — GET /api/v1/suppliers/', () => {
  it('ALLOW: Starter clears the commercial gate', async () => {
    const res = await get('/api/v1/suppliers/', 'starter');
    expect(commercialGatePassed(res)).toBe(true);
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
// Scale invariant — every migrated family clears the gate at Scale
// ===========================================================================
describe('Scale clears every migrated commercial gate', () => {
  it.each([
    ['/api/v1/suppliers/'],
    ['/api/v1/wms/batches'],
    ['/api/v1/wms/analytics'],
    ['/api/v1/wms/problem-center/pick-exceptions'],
    ['/api/v1/floor-planning/layout'],
    ['/api/v1/modules/demand/'],
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
