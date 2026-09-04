// COMMERCIAL-ACCESS-ARCH-01 / NAV-ENTITLEMENT-PARITY-01 — Slice P0-A
// =================================================================
// RED contracts for C6 (direct-route parity) and C12 (backend commercial
// authority). CONTRACT layer: reads production route/gate source as text.
// No React render, no DB, no server boot.
//
// Ratified rules protected (WORKSHOP Part 2 §6):
//   - Navigation visibility is NOT security. A direct URL must produce the
//     same commercial-access result as the nav click.
//   - Every module route subtree carries ONE commercial gate bound to the
//     same requirement the nav/tab surfaces use.
//   - Backend enforces commercial eligibility server-side via
//     requireCapability(capabilityId) + requireAction(action) — not
//     role/action alone, and not tier>=Starter alone.
//   - Purchasing routes: a shop lacking the purchasing capability must not
//     get access merely by passing role/action.
//   - Warehouse Analytics: Growth-level commercial gate.
//   - Demand: Growth (GREEN control — already enforced).

import fs from 'fs';
import path from 'path';
import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));

const LIFECYCLE_ROUTE_HOST = 'apps/frontend/src/lifecycle/LifecycleRouteHost.tsx';
const SUPPLIERS_PAGE = 'apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx';
const WMS_PAGE = 'apps/frontend/src/pages/ft2-pages/WmsFT2Page.tsx';

const SUPPLIERS_ROUTES = 'apps/backend/src/api/suppliers/suppliers.routes.ts';
const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';
const DEMAND_ROUTES = 'apps/backend/src/api/demand/demand.routes.ts';

const COMMERCIAL_GATE_MARKERS =
  /CommercialGate|capabilityId|requireCapability|useCapability|useCommercialAccess/;

// ===========================================================================
// C6 — DIRECT-ROUTE PARITY (a URL cannot bypass commercial policy)
// ===========================================================================
describe('C6 — direct-route commercial parity', () => {
  it('EXPECTED RED: the /suppliers-portal route subtree has a commercial route gate', () => {
    const routeHost = read(LIFECYCLE_ROUTE_HOST);
    const page = read(SUPPLIERS_PAGE);
    // Today: LifecycleRouteHost renders <SuppliersPortalPage/> raw, and the
    // page contains no PlanGate / CommercialGate / capability check at all.
    const gatedAtRoute = COMMERCIAL_GATE_MARKERS.test(routeHost);
    const gatedInPage = COMMERCIAL_GATE_MARKERS.test(page) || /PlanGate/.test(page);
    expect(gatedAtRoute || gatedInPage).toBe(true);
  });

  it('EXPECTED RED: the Warehouse route is gated by the canonical requirement, not the no-op Starter PlanGate', () => {
    const page = read(WMS_PAGE);
    const onlyNoOp =
      /feature="wms\.pick_batches"/.test(page) && !COMMERCIAL_GATE_MARKERS.test(page);
    expect(onlyNoOp).toBe(false);
  });

  it('EXPECTED RED: A2B Warehouse, Purchasing, and Demand nav items are capability-driven', () => {
    // P0-A1 delivers the registry (packages/commercial-policy: capabilities.ts +
    // catalog.ts). P0-A2B migrates only the named commercial surfaces; unrelated
    // navigation may retain legacy requiredModuleId / requiredTier fields.
    const registryExists =
      exists('packages/commercial-policy/src/capabilities.ts') ||
      exists('packages/commercial-policy/src/catalog.ts');
    expect(registryExists).toBe(true);

    const nav = read('apps/frontend/src/runtime/navBootstrap.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const expected: Record<string, string> = {
      warehouse: 'warehouse.operations',
      'wms-operations': 'warehouse.operations',
      'floor-planning': 'warehouse.floor_planning',
      'wms-analytics': 'warehouse.analytics',
      'product-issues': 'warehouse.problem_center',
      purchasing: 'purchasing.core',
      'open-pos': 'purchasing.core',
      suppliers: 'purchasing.core',
      sourcing: 'purchasing.core',
      demand: 'demand.forecasting',
    };
    const missing = Object.entries(expected).filter(([id, capabilityId]) =>
      !new RegExp(`id:\\s*'${id}'[\\s\\S]{0,400}?capabilityId:\\s*'${capabilityId.replace(/\./g, '\\.')}'`).test(nav),
    );
    expect(missing).toEqual([]);

    for (const parentId of ['warehouse', 'purchasing']) {
      const chunk = nav.split('registerNavItem(').find((part) => part.includes(`id: '${parentId}'`)) ?? '';
      expect(/requiredModuleId\s*:|requiredTier\s*:/.test(chunk)).toBe(false);
    }
    const demand = nav.slice(nav.indexOf("{ id: 'demand'"), nav.indexOf('}', nav.indexOf("{ id: 'demand'")) + 1);
    expect(/requiredModuleId\s*:|requiredTier\s*:/.test(demand)).toBe(false);
  });
});

// ===========================================================================
// C12 — BACKEND COMMERCIAL AUTHORITY
// ===========================================================================
describe('C12 — backend commercial authority', () => {
  it('A2A: an exported requireCapability enforcement middleware exists in the ratified location and consumes @lasyncro/commercial-policy', () => {
    // P0-A2A places requireCapability alongside requireTier in
    // require-entitlement.middleware.ts (a dedicated require-capability.middleware.ts
    // is an accepted alternative). The architecture — not a specific filename — is
    // what is contractual: an exported requireCapability that drives its decision
    // from the shared commercial-policy engine.
    const DEDICATED = 'apps/backend/src/middleware/require-capability.middleware.ts';
    const src =
      (exists(DEDICATED) ? read(DEDICATED) : '') +
      '\n' +
      read('apps/backend/src/middleware/require-entitlement.middleware.ts');
    expect(/export\s+(?:function|const)\s+requireCapability\b/.test(src)).toBe(true);
    expect(/from\s+['"]@lasyncro\/commercial-policy['"]/.test(src)).toBe(true);
    expect(/\bevaluateAccess\b/.test(src) && /\bCAPABILITY_REQUIREMENTS\b/.test(src)).toBe(true);
  });

  it('EXPECTED RED: suppliers routes enforce a commercial capability/module, not role/action alone', () => {
    const src = read(SUPPLIERS_ROUTES);
    const hasCommercialGate = /requireCapability|requireModule|requireTier/.test(src);
    // Today every suppliers route is only authenticateToken + requireFt2 + requireAction.
    expect(hasCommercialGate).toBe(true);
  });

  it('EXPECTED RED: a shop passing role/action but lacking the purchasing capability must still be denied', () => {
    // Encoded structurally: at least one suppliers route must chain a
    // capability/module check BEFORE its requireAction guard.
    const src = read(SUPPLIERS_ROUTES);
    const capBeforeAction =
      /require(Capability|Module)\([^)]*\)[\s\S]{0,120}requireAction/.test(src);
    expect(capBeforeAction).toBe(true);
  });

  it('A2A: Warehouse Analytics routes enforce requireCapability(warehouse.analytics), canonical Growth+', () => {
    // P0-A2A migrated every /analytics* WMS route from the incidental
    // requireTier('growth') literal to the canonical capability gate. The
    // enforcement is unchanged in effect — warehouse.analytics is Growth+ in
    // the shared policy — but now expressed through the single engine.
    const src = read(WMS_ROUTES);
    const analyticsRouteCount = (src.match(/'\/analytics(?:\/[a-z-]+)?'/g) || []).length;
    expect(analyticsRouteCount).toBeGreaterThan(0);
    expect(/requireCapability\(\s*['"]warehouse\.analytics['"]\s*\)/.test(src)).toBe(true);
    expect((CP as any).CAPABILITY_REQUIREMENTS['warehouse.analytics'].minimumTier).toBe('growth');
  });

  it('A2A: Demand route enforces requireCapability(demand.forecasting), canonical Growth+', () => {
    expect(/requireCapability\(\s*['"]demand\.forecasting['"]\s*\)/.test(read(DEMAND_ROUTES))).toBe(true);
    expect((CP as any).CAPABILITY_REQUIREMENTS['demand.forecasting'].minimumTier).toBe('growth');
  });
});

// ###########################################################################
// P0-A2B — FRONTEND DIRECT-ROUTE PARITY (added by A2B TEST STRATEGY / RED)
// ###########################################################################
// The 3 C6 REDs above stay genuine REDs (B15). These strengthen the direct-URL
// contract: each module route subtree must carry ONE frontend commercial gate
// bound to the SAME CapabilityId the nav/tab surfaces use — a direct URL must
// not bypass commercial policy. Every EXPECTED RED fails because the frontend
// route gate is absent / non-canonical, not for a plumbing reason.

const ROUTE_HOST = LIFECYCLE_ROUTE_HOST;
const FE = (p: string) => `apps/frontend/src/${p}`;

/** Text of every file that could carry the route-subtree commercial gate. */
function routeGateSurface(pageRel: string): string {
  return read(ROUTE_HOST) + '\n' + (exists(pageRel) ? read(pageRel) : '');
}

const GATE_MARK = /CommercialGate|capabilityId|useCommercialAccess|useCapabilityAccess/;

// ===========================================================================
// B9 — a reusable frontend CommercialGate exists and consumes the shared engine
// ===========================================================================
describe('B9 — CommercialGate route gate', () => {
  it('EXPECTED RED: a frontend CommercialGate module exists', () => {
    const candidates = [
      FE('components/CommercialGate.tsx'),
      FE('runtime/CommercialGate.tsx'),
      FE('navigation/CommercialGate.tsx'),
      FE('lifecycle/CommercialGate.tsx'),
    ];
    expect(candidates.some((c) => exists(c))).toBe(true);
  });

  it('EXPECTED RED: CommercialGate consumes @lasyncro/commercial-policy (capabilityId + evaluateAccess)', () => {
    const candidates = [
      FE('components/CommercialGate.tsx'),
      FE('runtime/CommercialGate.tsx'),
      FE('navigation/CommercialGate.tsx'),
      FE('lifecycle/CommercialGate.tsx'),
    ];
    const src = candidates.filter((c) => exists(c)).map((c) => read(c)).join('\n');
    expect(src.length).toBeGreaterThan(0);
    expect(/@lasyncro\/commercial-policy/.test(src)).toBe(true);
    expect(/capabilityId/.test(src) && /evaluateAccess|useCommercialAccess/.test(src)).toBe(true);
  });
});

// ===========================================================================
// B10 — direct-route parity, per capability family
// ===========================================================================
describe('B10 — direct route subtrees carry the canonical commercial gate', () => {
  const CASES: Array<{ name: string; page: string; capabilityId: string }> = [
    { name: '/wms/*',              page: FE('pages/ft2-pages/WmsFT2Page.tsx'),         capabilityId: 'warehouse.operations' },
    { name: '/wms/analytics',      page: FE('pages/ft2-pages/WmsAnalyticsPage.tsx'),   capabilityId: 'warehouse.analytics' },
    { name: '/suppliers-portal/*', page: FE('pages/ft2-pages/SuppliersPortalPage.tsx'), capabilityId: 'purchasing.core' },
    { name: '/floor-planning/*',   page: FE('pages/ft2-pages/FloorPlanningPage.tsx'),  capabilityId: 'warehouse.floor_planning' },
    { name: '/problem-center/*',   page: FE('pages/ft2-pages/ProblemCenterPage.tsx'),  capabilityId: 'warehouse.problem_center' },
    { name: '/demand/*',           page: FE('pages/ft2-pages/DemandPage.tsx'),         capabilityId: 'demand.forecasting' },
  ];

  it.each(CASES)('EXPECTED RED: $name route subtree is gated by capabilityId $capabilityId', ({ page, capabilityId }) => {
    const src = routeGateSurface(page);
    const capEsc = capabilityId.replace(/\./g, '\\.');
    // The gate must both exist AND name the ratified capability for this subtree.
    expect(GATE_MARK.test(src)).toBe(true);
    expect(new RegExp(`capabilityId[=:]\\s*['"]${capEsc}['"]|['"]${capEsc}['"]`).test(src)).toBe(true);
  });

  it('EXPECTED RED: the Warehouse subtree no longer relies on the no-op PlanGate feature="wms.pick_batches"', () => {
    const src = read(FE('pages/ft2-pages/WmsFT2Page.tsx'));
    const onlyNoOp = /feature="wms\.pick_batches"/.test(src) && !GATE_MARK.test(src);
    expect(onlyNoOp).toBe(false);
  });

  it('EXPECTED RED: /wms/analytics has its own Growth gate independent of the parent Starter WMS gate', () => {
    // Today WmsFT2Page wraps /analytics in PlanGate feature="wms.pick_batches"
    // (Starter) — a direct nav to /wms/analytics gets no Growth check.
    const src = routeGateSurface(FE('pages/ft2-pages/WmsAnalyticsPage.tsx'));
    expect(/warehouse\.analytics/.test(src)).toBe(true);
  });
});

// ===========================================================================
// B11 — Demand GREEN CONTROL: behaviour preserved, only the mechanism migrates
// ===========================================================================
describe('B11 — Demand behaviour is preserved across the migration', () => {
  it('GREEN CONTROL: canonical demand.forecasting is Growth+ (Starter/Core deny, Growth/Scale allow)', () => {
    const decide = (tier: 'starter' | 'core' | 'growth' | 'scale') =>
      (CP as any).evaluateAccess(
        (CP as any).CAPABILITY_REQUIREMENTS['demand.forecasting'],
        (CP as any).standardContextForTier(tier),
      ).allowed;
    expect(decide('starter')).toBe(false);
    expect(decide('core')).toBe(false);
    expect(decide('growth')).toBe(true);
    expect(decide('scale')).toBe(true);
  });

  it('GREEN CONTROL: DemandPage still renders a commercial gate today (mechanism migrates, gate stays)', () => {
    const src = read(FE('pages/ft2-pages/DemandPage.tsx'));
    expect(/PlanGate|CommercialGate|UpgradePrompt|capabilityId/.test(src)).toBe(true);
  });
});

// ===========================================================================
// B13 — denial-reason semantics the frontend renderer must honour (engine-owned
//       GREEN CONTROLS; the renderer-side REDs are in the frontend specs
//       upgrade-prompt-decision.test.tsx / commercial-gate.test.tsx).
// B18 — CapabilityId fail-closed (engine-owned GREEN CONTROLS).
// ===========================================================================
describe('B13 — AccessDecision.reason is authoritative (canonical semantics)', () => {
  const ea = (CP as any).evaluateAccess;

  it('GREEN CONTROL: TIER_TOO_LOW carries the EXACT requiredTier', () => {
    const d = ea((CP as any).CAPABILITY_REQUIREMENTS['demand.forecasting'], (CP as any).standardContextForTier('starter'));
    expect(d.reason).toBe('TIER_TOO_LOW');
    expect(d.requiredTier).toBe('growth');
  });

  it('GREEN CONTROL: TIER_TOO_LOW to Core is Core, never a fabricated Growth', () => {
    const d = ea({ minimumTier: 'core' }, (CP as any).standardContextForTier('starter'));
    expect(d.reason).toBe('TIER_TOO_LOW');
    expect(d.requiredTier).toBe('core');
  });

  it('GREEN CONTROL: MODULE_NOT_INCLUDED at Scale carries NO requiredTier step', () => {
    const d = ea({ moduleId: 'suppliers-portal' }, { tier: 'scale', modules: new Set(), flags: new Set() });
    expect(d.reason).toBe('MODULE_NOT_INCLUDED');
    expect(d.requiredTier).toBeUndefined();
    expect(d.requiredModule).toBe('suppliers-portal');
  });

  it('GREEN CONTROL: FEATURE_NOT_INCLUDED carries the feature', () => {
    const d = ea({ feature: 'wms.analytics' }, { tier: 'scale', modules: new Set(), flags: new Set() });
    expect(d.reason).toBe('FEATURE_NOT_INCLUDED');
    expect(d.requiredFeature).toBe('wms.analytics');
  });

  it('GREEN CONTROL: ROLE_FORBIDDEN carries no billing/tier step', () => {
    const d = ea({ action: 'suppliers:write' }, { tier: 'growth', modules: new Set(), flags: new Set(), allowedActions: new Set() });
    expect(d.reason).toBe('ROLE_FORBIDDEN');
    expect(d.requiredTier).toBeUndefined();
    expect(d.requiredModule).toBeUndefined();
  });
});

describe('B18 — unknown CapabilityId fails closed in the shared engine', () => {
  it('GREEN CONTROL: isCapabilityId rejects an unknown id; the registry has no entry', () => {
    expect((CP as any).isCapabilityId('warehouse.operations')).toBe(true);
    expect((CP as any).isCapabilityId('warehouse.__not_real__')).toBe(false);
    expect((CP as any).CAPABILITY_REQUIREMENTS['warehouse.__not_real__']).toBeUndefined();
  });
});
