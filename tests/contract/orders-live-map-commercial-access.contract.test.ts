// tests/contract/orders-live-map-commercial-access.contract.test.ts
//
// ORD-UX-01 — Orders Live Intelligence commercial contract
// ========================================================
// PURE / CONTRACT layer: reads canonical policy and production source as text.
// Never renders React, never touches a DB, never boots a server.
//
// Two things are protected here:
//   1. orders.live_map is Orders (order-nexus) + Growth+, and orders.core is
//      Core+.
//   2. The Orders map does NOT borrow Overview's route. `/live-activity` keeps
//      its overview.live_map ownership, and the Orders surface reads a parallel
//      route gated on orders.live_map that reuses the SAME controller.

import fs from 'fs';
import path from 'path';

import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';
const ORDERS_PAGE = 'apps/frontend/src/pages/ft2-pages/OrdersFT2Page.tsx';
const WMS_CONTROLLER = 'apps/backend/src/api/wms/wms.controller.ts';
const LIVE_ACTIVITY_SERVICE = 'apps/backend/src/services/wms/liveActivity.service.ts';

/**
 * Bounded slice of one exported arrow-function handler's body, so a match can
 * only come from THAT handler and never from elsewhere in a 5k-line file.
 */
function handlerBody(src: string, name: string): string {
  const decl = new RegExp(`export const ${name} = async \\(`);
  const m = decl.exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.search(/\n\};/);
  return end === -1 ? rest : rest.slice(0, end);
}

type Tier = 'starter' | 'core' | 'growth' | 'scale';

const REGISTRY = CP.CAPABILITY_REQUIREMENTS as unknown as
  Record<string, CP.AccessRequirement | undefined>;

/**
 * VACUOUS-ALLOW SAFETY. evaluateAccess(undefined, ctx) returns ALLOWED by
 * design, so a missing capability would make every ALLOW row pass and silently
 * flip DENY rows. Fail loudly instead of evaluating.
 */
function requirementOrFail(id: string): CP.AccessRequirement {
  const req = REGISTRY[id];
  expect(req).toBeDefined();
  return req as CP.AccessRequirement;
}

function decide(id: string, tier: Tier): CP.AccessDecision {
  return CP.evaluateAccess(requirementOrFail(id), CP.standardContextForTier(tier));
}

/**
 * Bounded source slice for ONE route registration, so a match can only come
 * from that route and never from an unrelated part of the file. Same technique
 * as the Overview live-map contract.
 */
function routeChunk(pathLiteral: string): string {
  const src = read(WMS_ROUTES);
  const pathIdx = src.indexOf(`'${pathLiteral}'`);
  if (pathIdx === -1) return '';
  const start = src.lastIndexOf('router.', pathIdx);
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.search(/\n\nrouter\.|\nexport default/);
  return end === -1 ? rest : rest.slice(0, end);
}

// ===========================================================================
// ORDLM-C1 — canonical policy
// ===========================================================================
describe('ORDLM-C1 — orders.live_map is Orders (order-nexus) + Growth+', () => {
  it('requirement is exactly { moduleId: order-nexus, minimumTier: growth }', () => {
    const req = requirementOrFail('orders.live_map');
    expect(req.moduleId).toBe('order-nexus');
    expect(req.minimumTier).toBe('growth');
    expect(req.feature).toBeUndefined();
  });

  it.each<[Tier, boolean]>([
    ['starter', false],
    ['core', false],
    ['growth', true],
    ['scale', true],
  ])('orders.live_map @ %s => %s', (tier, allowed) => {
    expect(decide('orders.live_map', tier).allowed).toBe(allowed);
  });

  it('a denial carries the Growth step so the teaser never hardcodes it', () => {
    const denial = decide('orders.live_map', 'core');
    expect(denial.allowed).toBe(false);
    expect(denial.requiredTier).toBe('growth');
  });
});

// ===========================================================================
// ORDLM-C2 — orders.core is Core+
// ===========================================================================
describe('ORDLM-C2 — orders.core is Core+', () => {
  it('orders.core requires order-nexus at minimumTier core', () => {
    const req = requirementOrFail('orders.core');
    expect(req.moduleId).toBe('order-nexus');
    expect(req.minimumTier).toBe('core');
    expect(req.feature).toBeUndefined();
  });

  it.each<[Tier, boolean]>([
    ['starter', false],
    ['core', true],
    ['growth', true],
    ['scale', true],
  ])('orders.core @ %s => %s', (tier, allowed) => {
    expect(decide('orders.core', tier).allowed).toBe(allowed);
  });

  it('CONTROL: Core keeps Orders but not the Orders live map', () => {
    expect(decide('orders.core', 'core').allowed).toBe(true);
    expect(decide('orders.live_map', 'core').allowed).toBe(false);
  });
});

// ===========================================================================
// ORDLM-C3 — Overview's route ownership is untouched
// ===========================================================================
describe('ORDLM-C3 — GET /live-activity still belongs to overview.live_map', () => {
  it('the bounded route registration still requires overview.live_map', () => {
    const chunk = routeChunk('/live-activity');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'overview\.live_map'\s*\)/.test(chunk)).toBe(true);
  });

  it('it was NOT re-pointed at orders.live_map', () => {
    const chunk = routeChunk('/live-activity');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'orders\.live_map'\s*\)/.test(chunk)).toBe(false);
  });

  it('CONTROL: its wms:read RBAC is preserved, not weakened', () => {
    const chunk = routeChunk('/live-activity');
    expect(/requireAction\(\s*'wms:read'\s*\)/.test(chunk)).toBe(true);
  });
});

// ===========================================================================
// ORDLM-C4 — the Orders route exists, is gated on orders.live_map, and reuses
// the same controller rather than duplicating it
// ===========================================================================
describe('ORDLM-C4 — GET /orders-live-activity is the Orders-owned live map route', () => {
  it('requires orders.live_map', () => {
    const chunk = routeChunk('/orders-live-activity');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'orders\.live_map'\s*\)/.test(chunk)).toBe(true);
  });

  it('does not depend on overview.live_map', () => {
    const chunk = routeChunk('/orders-live-activity');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/overview\.live_map/.test(chunk)).toBe(false);
  });

  it('carries the same auth/lifecycle/RBAC stack as the Overview route', () => {
    const chunk = routeChunk('/orders-live-activity');
    expect(/authenticateToken/.test(chunk)).toBe(true);
    expect(/requireFt2/.test(chunk)).toBe(true);
    expect(/requireAction\(\s*'wms:read'\s*\)/.test(chunk)).toBe(true);
  });

  it('is served by its OWN handler, httpGetOrdersLiveActivity', () => {
    // CONTRACT-ENT-MOUNT-02 forbids one handler symbol behind divergent
    // entitlement chains. Each surface therefore carries its own thin
    // controller with exactly one commercial owner.
    const ordersChunk = routeChunk('/orders-live-activity');
    expect(/httpGetOrdersLiveActivity/.test(ordersChunk)).toBe(true);
  });

  it('CONTROL: the Overview route keeps httpGetLiveActivity', () => {
    const overviewChunk = routeChunk('/live-activity');
    expect(/httpGetLiveActivity/.test(overviewChunk)).toBe(true);
    expect(/httpGetOrdersLiveActivity/.test(overviewChunk)).toBe(false);
  });

  it('both thin controllers delegate to the ONE shared live-activity service', () => {
    // The anti-duplication invariant, asserted at the implementation rather
    // than at the route: neither controller may carry query logic of its own,
    // and both must read the same service, so the two endpoints cannot drift.
    const controller = read(WMS_CONTROLLER);
    expect(
      /import\s*\{[^}]*\bgetLiveActivity\b[^}]*\}\s*from\s*'[^']*liveActivity\.service\.js'/.test(controller)
    ).toBe(true);

    for (const handler of ['httpGetLiveActivity', 'httpGetOrdersLiveActivity']) {
      const body = handlerBody(controller, handler);
      expect(body.length).toBeGreaterThan(0);
      expect(/getLiveActivity\(\s*shopId\s*\)/.test(body)).toBe(true);
      // A thin controller queries nothing itself.
      expect(/db\.transaction|trx\(/.test(body)).toBe(false);
    }
  });

  it('the shared service is the single owner of the live-activity query logic', () => {
    const service = read(LIVE_ACTIVITY_SERVICE);
    expect(/export\s+async\s+function\s+getLiveActivity/.test(service)).toBe(true);
    expect(/db\.transaction/.test(service)).toBe(true);
    // It builds the payload; it must never own the HTTP response.
    expect(/\bres\.status\(/.test(service)).toBe(false);
  });
});

// ===========================================================================
// ORDLM-C5 — the Orders page reads the canonical decision, not a raw tier
// ===========================================================================
describe('ORDLM-C5 — OrdersFT2Page gates the map on the canonical decision', () => {
  it('consumes the shared commercial-access adapter and references orders.live_map', () => {
    const src = read(ORDERS_PAGE);
    expect(/useCommercialAccess/.test(src)).toBe(true);
    expect(/decide\(\s*'orders\.live_map'\s*\)/.test(src)).toBe(true);
  });

  it('eligibility is not reconstructed from a raw tier comparison', () => {
    const src = read(ORDERS_PAGE);
    expect(/tier\s*===\s*'(?:scale|growth)'/.test(src)).toBe(false);
  });

  it('the access boolean derives from the decision plus its resolution signal', () => {
    const src = read(ORDERS_PAGE);
    const decl = /const\s+hasMapAccess\s*=\s*([^;]*)/.exec(src);
    expect(decl).not.toBeNull();
    const init = (decl as RegExpExecArray)[1];
    expect(/isResolved/.test(init)).toBe(true);
    expect(/\.allowed/.test(init)).toBe(true);
  });

  it('floor-geometry acquisition is gated on that same boolean', () => {
    // A denied tenant must not fetch real floor geometry at all — hiding the
    // rendered map while still issuing GET /api/v1/floor-planning/layout would
    // pass the render-level tests and still leak the gated resource.
    const src = read(ORDERS_PAGE);
    const floorCall = /useFloorPlanning\(([^)]*)\)/.exec(src);
    expect(floorCall).not.toBeNull();
    expect((floorCall as RegExpExecArray)[1].trim()).toBe('hasMapAccess');
  });

  it('Orders reads its own live-activity hook, never the Overview-owned one', () => {
    const src = read(ORDERS_PAGE);
    expect(/useOrdersLiveActivity\(/.test(src)).toBe(true);
    expect(/useWmsLiveActivity\(/.test(src)).toBe(false);
  });
});
