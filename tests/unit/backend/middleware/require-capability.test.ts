// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2A
// =======================================
// RED behavioural contracts for requireCapability(capabilityId).
//
// A mini Express app + supertest with a stubbed `req.user` — no DB, no full
// app, no FT2 bootstrap. Proves the middleware's per-tier decision, the
// COMMERCIAL_ACCESS_DENIED body, RBAC separation, and the Scale invariant.
// (The full route+handler integration matrix — real suppliers/wms/floor-
// planning/demand endpoints with seeded FT2 shops — is added in P0-A2A
// VERIFY, once requireCapability + the route migrations exist and FT2
// fixtures can be seeded deterministically.)
//
// RED today because requireCapability is not implemented.

import express from 'express';
import request from 'supertest';
import * as EntMw from 'api-src/middleware/require-entitlement.middleware';

// requireCapability may land in require-entitlement.middleware or its own file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let requireCapability: any = (EntMw as any).requireCapability;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  requireCapability = requireCapability ?? require('api-src/middleware/require-capability.middleware').requireCapability;
} catch {
  /* file does not exist yet — RED */
}

type Tier = 'starter' | 'core' | 'growth' | 'scale';
interface Ctx { tier: Tier; roles?: string[] }

async function hit(capabilityId: string, ctx: Ctx) {
  if (typeof requireCapability !== 'function') {
    return { __unimplemented: true as const, status: 0, body: {} as Record<string, unknown> };
  }
  const app = express();
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = { userId: 1, shopId: 1, tier: ctx.tier, shop_roles: ctx.roles ?? ['owner'] };
    next();
  });
  app.get('/t', requireCapability(capabilityId), (_req, res) => res.json({ ok: true }));
  const r = await request(app).get('/t');
  return { __unimplemented: false as const, status: r.status, body: r.body as Record<string, unknown> };
}

const READY = () => expect(typeof requireCapability).toBe('function'); // RED gate — clean failure

// tier → expected {status, reason?} per capability (the ratified matrix)
const MATRIX: Record<string, Partial<Record<Tier, { status: number; reason?: string }>>> = {
  'warehouse.operations':     { starter: { status: 200 }, core: { status: 200 }, growth: { status: 200 }, scale: { status: 200 } },
  'warehouse.analytics':      { starter: { status: 403, reason: 'TIER_TOO_LOW' }, core: { status: 403, reason: 'TIER_TOO_LOW' }, growth: { status: 200 }, scale: { status: 200 } },
  'warehouse.floor_planning': { starter: { status: 403, reason: 'TIER_TOO_LOW' }, core: { status: 403, reason: 'TIER_TOO_LOW' }, growth: { status: 200 }, scale: { status: 200 } },
  'warehouse.problem_center': { starter: { status: 403, reason: 'TIER_TOO_LOW' }, core: { status: 200 }, growth: { status: 200 }, scale: { status: 200 } },
  'purchasing.core':          { starter: { status: 200 }, core: { status: 200 }, growth: { status: 200 }, scale: { status: 200 } },
  'demand.forecasting':       { starter: { status: 403, reason: 'TIER_TOO_LOW' }, core: { status: 403, reason: 'TIER_TOO_LOW' }, growth: { status: 200 }, scale: { status: 200 } },
};

describe.each(Object.entries(MATRIX))('requireCapability(%s)', (capabilityId, byTier) => {
  it.each(Object.entries(byTier))('EXPECTED RED: %s => %o', async (tier, expected) => {
    READY();
    const r = await hit(capabilityId, { tier: tier as Tier });
    expect(r.__unimplemented).toBe(false);
    expect(r.status).toBe(expected.status);
    if (expected.status === 403) {
      expect(r.body.error).toBe('COMMERCIAL_ACCESS_DENIED');
      expect(r.body.reason).toBe(expected.reason);
      expect(r.body.capabilityId).toBe(capabilityId);
      expect(r.body.currentTier).toBe(tier);
      expect(r.body.error).not.toBe('ROLE_FORBIDDEN');
    }
  });
});

// ===========================================================================
// A2A-C9 — denial body shape (TIER_TOO_LOW carries currentTier + requiredTier)
// ===========================================================================
describe('A2A-C9 — denial body', () => {
  it('EXPECTED RED: TIER_TOO_LOW body = { error:COMMERCIAL_ACCESS_DENIED, reason, capabilityId, currentTier, requiredTier }', async () => {
    READY();
    const r = await hit('demand.forecasting', { tier: 'starter' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      reason: 'TIER_TOO_LOW',
      capabilityId: 'demand.forecasting',
      currentTier: 'starter',
      requiredTier: 'growth',
    });
  });
});

// ===========================================================================
// A2A-C17 — Scale never returns TIER_TOO_LOW
// ===========================================================================
describe('A2A-C17 — Scale never downgrades', () => {
  it.each(Object.keys(MATRIX))('EXPECTED RED: %s @ scale => 200, never TIER_TOO_LOW', async (capabilityId) => {
    READY();
    const r = await hit(capabilityId, { tier: 'scale' });
    expect(r.status).toBe(200);
    expect(r.body.reason).not.toBe('TIER_TOO_LOW');
  });
});

// ===========================================================================
// A2A-C16 — RBAC stays separate (requireCapability does no role check)
// ===========================================================================
describe('A2A-C16 — commercial gate is not RBAC', () => {
  it('EXPECTED RED: purchasing.core passes for an operator role (commercial only; role is requireAction\'s job)', async () => {
    READY();
    const r = await hit('purchasing.core', { tier: 'starter', roles: ['operator'] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('EXPECTED RED: requireCapability then requireAction — operator write is denied by requireAction, not commercial', async () => {
    READY();
    if (typeof (EntMw as any).requireCapability !== 'function' && typeof requireCapability !== 'function') {
      expect(typeof requireCapability).toBe('function'); // RED
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireAction } = require('api-src/middleware/require-action.middleware');
    const app = express();
    app.use((req, _res, next) => {
      // Canonical AuthContext shape: authenticateToken maps the JWT `shop_roles`
      // claim onto `req.user.roles`. No `shopId` => requireAction resolves
      // against the static ACTION_ROLE_MAP (DB-free, deterministic) instead of
      // the Redis/DB-backed permission cache — the pattern this unit layer uses.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = { userId: 1, tier: 'growth', roles: ['operator'] };
      next();
    });
    app.post('/w', requireCapability('purchasing.core'), requireAction('suppliers:write'), (_req, res) => res.json({ ok: true }));
    const r = await request(app).post('/w');
    expect(r.status).toBe(403);
    expect(r.body.error).not.toBe('COMMERCIAL_ACCESS_DENIED'); // it's a role denial
  });
});

// ===========================================================================
// A2A-C18 — tier comes from req.user.tier (no DB); changing it changes the decision
// ===========================================================================
describe('A2A-C18 — JWT tier boundary', () => {
  it('EXPECTED RED: decision follows req.user.tier with no DB round-trip', async () => {
    READY();
    const lo = await hit('demand.forecasting', { tier: 'core' });
    const hi = await hit('demand.forecasting', { tier: 'growth' });
    expect(lo.status).toBe(403);
    expect(hi.status).toBe(200);
  });
});
