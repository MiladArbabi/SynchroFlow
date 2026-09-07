// COMMERCIAL-ACCESS-ARCH-01 / NAV-ENTITLEMENT-PARITY-01 — Slice P0-A
// =================================================================
// RED regression contracts for the ratified commercial-access model
// (see WORKSHOP output, Part 2). This file is PURE / CONTRACT layer:
// it imports canonical tier config and reads production source as text.
// It never renders React and never touches a DB.
//
// Each `it()` states the contract, the ratified rule it protects, and
// whether it is expected RED (fails today for a real architecture/business
// reason) or a GREEN CONTROL (must already hold and must keep holding).
//
// Ratified inputs used here:
//   - Tier hierarchy: starter < core < growth < scale (WORKSHOP Part 2 §1)
//   - Module sets are cumulative: STARTER ⊆ CORE ⊆ GROWTH ⊆ SCALE
//   - Scale standard limits resolve as unlimited
//   - One canonical module registry; nav must only reference emittable ids
//   - Purchasing = Core+ (purchasing.core) / Growth+ (purchasing.sourcing),
//     canonical module `suppliers-portal` (P0-A3-5 retired the Starter+ claim)
//   - Warehouse: operations=Starter, problem-center=Core,
//     floor-planning=Growth, warehouse.analytics=Growth
//   - No `import.meta.env.DEV` bypass inside the access decision
//   - No fabricated `requiredTier ?? 'growth'` modal semantics
//   - One shared policy package: packages/commercial-policy/

import fs from 'fs';
import path from 'path';

import { TIER_CONFIG, TIERS } from '../../packages/backend-core/src/config/tiers';
import { FT2_PAID_MODULES } from 'api-src/contracts/ft2-paid.contract';

// P0-A1: the pure canonical policy engine. Namespace import never throws on a
// missing member, so these assertions go RED (member is undefined) rather than
// crashing with a resolution error while the engine is unimplemented.
import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));

// Ratified numeric rank — kept LOCAL to the test on purpose; the whole point
// of C8 is that production must stop redefining this in five places.
const RANK: Record<string, number> = { starter: 0, core: 1, growth: 2, scale: 3 };
const ORDERED_TIERS = [...TIERS].sort((a, b) => RANK[a] - RANK[b]);

// The single canonical package the architecture must converge on.
const COMMERCIAL_POLICY_PKG = 'packages/commercial-policy';

// Files that today each carry their own private tier-rank map.
const TIER_RANK_DUP_FILES = [
  'apps/frontend/src/hooks/usePlanEntitlement.ts',
  'apps/frontend/src/navigation/resolveNavVisibility.ts',
  'apps/frontend/src/components/ModuleTabBar.tsx',
  'apps/frontend/src/config/exportReports.ts',
  'apps/backend/src/middleware/require-entitlement.middleware.ts',
];

const NAV_BOOTSTRAP = 'apps/frontend/src/runtime/navBootstrap.ts';
const WAREHOUSE_TABS = 'apps/frontend/src/pages/ft2-pages/warehouseModuleTabs.ts';
const RESOLVE_NAV_VIS = 'apps/frontend/src/navigation/resolveNavVisibility.ts';
const SIDENAV = 'apps/frontend/src/layouts/AppLayout/SidenavContent.tsx';
const MODULE_TAB_BAR = 'apps/frontend/src/components/ModuleTabBar.tsx';
const UPGRADE_PROMPT = 'apps/frontend/src/components/UpgradePrompt.tsx';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every module key any current grant path can actually emit. */
function emittableModuleIds(): Set<string> {
  const s = new Set<string>();
  for (const t of TIERS) for (const m of TIER_CONFIG[t].modules) s.add(m);
  for (const m of FT2_PAID_MODULES) s.add(m); // includes grant-only keys e.g. echo-hub
  return s;
}

/** Strip block and line comments so commented-out config never counts. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Pull every LIVE `requiredModuleId: '<id>'` literal out of nav registration. */
function navRequiredModuleIds(): string[] {
  const src = stripComments(read(NAV_BOOTSTRAP));
  return [...src.matchAll(/requiredModuleId:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** The registerNavItem(...) source chunk for one top-level nav item. */
function navItemSource(navItemId: string): string {
  return stripComments(read(NAV_BOOTSTRAP))
    .split('registerNavItem(')
    .find((c) => c.includes(`id: '${navItemId}'`)) ?? '';
}

/** Isolate one `{ id: '<tabId>' ... }` object literal from a tab config file. */
function tabEntrySource(fileRel: string, tabId: string): string {
  const src = read(fileRel);
  const start = src.indexOf(`{ id: '${tabId}'`);
  if (start === -1) throw new Error(`tab entry not found: ${tabId} in ${fileRel}`);
  const end = src.indexOf('}', start);
  return src.slice(start, end + 1);
}

// ===========================================================================
// C1 — TIER MONOTONICITY
// ===========================================================================
describe('C1 — tier monotonicity', () => {
  it('GREEN CONTROL: every lower-tier module is present in every higher tier', () => {
    for (let i = 0; i < ORDERED_TIERS.length; i++) {
      for (let j = i + 1; j < ORDERED_TIERS.length; j++) {
        const lower = new Set(TIER_CONFIG[ORDERED_TIERS[i]].modules);
        const higher = new Set(TIER_CONFIG[ORDERED_TIERS[j]].modules);
        for (const m of lower) {
          expect(higher.has(m)).toBe(true);
        }
      }
    }
  });

  it('GREEN CONTROL: Scale satisfies every Growth module requirement (not just one sample)', () => {
    const growth = new Set(TIER_CONFIG.growth.modules);
    const scale = new Set(TIER_CONFIG.scale.modules);
    for (const m of growth) expect(scale.has(m)).toBe(true);
    // and no Growth capability is silently dropped at Scale
    expect([...growth].every((m) => scale.has(m))).toBe(true);
  });

  it('EXPECTED RED: a canonical capability-level access resolver exists (packages/commercial-policy)', () => {
    // P0-A1: @lasyncro/commercial-policy must export a pure evaluateAccess().
    // (Package physically exists since P0-A0 — this now checks the real engine.)
    expect(exists(COMMERCIAL_POLICY_PKG)).toBe(true);
    expect(typeof CP.evaluateAccess).toBe('function');
  });
});

// ===========================================================================
// C2 — CUMULATIVE COMMERCIAL SETS
// ===========================================================================
describe('C2 — cumulative commercial sets', () => {
  it('GREEN CONTROL: STARTER ⊆ CORE ⊆ GROWTH ⊆ SCALE for modules', () => {
    const chain = ORDERED_TIERS.map((t) => new Set(TIER_CONFIG[t].modules));
    for (let i = 1; i < chain.length; i++) {
      for (const m of chain[i - 1]) expect(chain[i].has(m)).toBe(true);
    }
  });

  it('GREEN CONTROL: STARTER ⊆ CORE ⊆ GROWTH ⊆ SCALE for flags', () => {
    const chain = ORDERED_TIERS.map((t) => new Set(TIER_CONFIG[t].flags));
    for (let i = 1; i < chain.length; i++) {
      for (const f of chain[i - 1]) expect(chain[i].has(f)).toBe(true);
    }
  });
});

// ===========================================================================
// C3 — SCALE SUPREMACY / UNLIMITED
// ===========================================================================
describe('C3 — Scale unlimited', () => {
  it('GREEN CONTROL: Scale carries no finite standard plan-volume hard stop', () => {
    // Asserted through the EXISTING TierConfig shape — no invented sentinel.
    // If a finite Scale cap is ever re-introduced this flips to RED.
    expect(TIER_CONFIG.scale.monthlyOrderCap).toBe(Infinity);
    expect(TIER_CONFIG.scale.shippedOrderCap).toBe(Infinity);
    expect(TIER_CONFIG.scale.seatLimit).toBe(Infinity);
    expect(TIER_CONFIG.scale.specterSessionCap).toBe(Infinity);
  });

  it('GREEN CONTROL: Scale module set is a superset of every other tier', () => {
    const scale = new Set(TIER_CONFIG.scale.modules);
    for (const t of TIERS) {
      for (const m of TIER_CONFIG[t].modules) expect(scale.has(m)).toBe(true);
    }
  });
});

// ===========================================================================
// C4 — CANONICAL MODULE / CAPABILITY CONFIG
// ===========================================================================
describe('C4 — canonical module config', () => {
  const EMITTABLE = emittableModuleIds();

  it('GREEN CONTROL: `wms` is a canonical, emittable Warehouse module id', () => {
    expect(EMITTABLE.has('wms')).toBe(true);
  });

  it('EXPECTED RED: `wms-lite` is NOT a valid canonical entitlement id, yet nav references it', () => {
    expect(EMITTABLE.has('wms-lite')).toBe(false); // fact
    expect(navRequiredModuleIds()).not.toContain('wms-lite'); // contract — RED today
  });

  it('EXPECTED RED: Warehouse and Operations use warehouse.operations capability, never a hand-written WMS module key', () => {
    const warehouse = navItemSource('warehouse');
    expect(/id:\s*'warehouse'[\s\S]{0,240}?capabilityId:\s*'warehouse\.operations'/.test(warehouse)).toBe(true);
    expect(/id:\s*'wms-operations'[\s\S]{0,240}?capabilityId:\s*'warehouse\.operations'/.test(warehouse)).toBe(true);
    expect(/requiredModuleId:\s*'(?:wms|wms-lite)'/.test(warehouse)).toBe(false);
    expect(CP.CAPABILITY_REQUIREMENTS['warehouse.operations'].moduleId).toBe('wms');
  });

  it('GREEN CONTROL: canonical effective entitlements emit `suppliers-portal` at CORE and above', () => {
    // TIER_CONFIG is the frozen persisted-row seed shape. Runtime availability
    // comes from modulesForTier(currentTier) union additive persisted rows.
    //
    // SUPERSEDED 2026-09-06 by COMMERCIAL-REMODEL-ALIGN-01: this previously
    // asserted every tier. Purchasing is now Core+ — Starter has no Purchasing
    // surface at all — so Starter must NOT emit suppliers-portal.
    expect(CP.modulesForTier('starter').has('suppliers-portal')).toBe(false);
    for (const tier of ['core', 'growth', 'scale'] as const) {
      expect(CP.modulesForTier(tier).has('suppliers-portal')).toBe(true);
    }
  });

  it('EXPECTED RED: every LIVE requiredModuleId referenced by navigation is emittable', () => {
    const unemittable = [...new Set(navRequiredModuleIds())].filter((id) => !EMITTABLE.has(id));
    expect(unemittable).toEqual([]); // RED: ['wms-lite', 'suppliers-portal']
  });
});

// ===========================================================================
// C7 — MODAL DENIAL SEMANTICS (static supplement; behavioral GREEN check
//      lands post-implement once a denial `reason` object exists)
// ===========================================================================
describe('C7 — no fabricated Growth upgrade semantics', () => {
  const FABRICATE = /requiredTier(?:\s+as[^)]*)?\)?\s*\?\?\s*['"]growth['"]/i;

  it('EXPECTED RED: SidenavContent must not default a missing requiredTier to growth', () => {
    expect(FABRICATE.test(read(SIDENAV))).toBe(false);
  });

  it('EXPECTED RED: ModuleTabBar must not default a missing requiredTier to growth', () => {
    expect(FABRICATE.test(read(MODULE_TAB_BAR))).toBe(false);
  });

  it('EXPECTED RED: UpgradePrompt must not hardcode a Growth fallback label', () => {
    expect(/\?\?\s*['"]Growth['"]/.test(read(UPGRADE_PROMPT))).toBe(false);
  });
});

// ===========================================================================
// C8 — SINGLE POLICY SOURCE
// ===========================================================================
describe('C8 — single policy source', () => {
  it('EXPECTED RED: packages/commercial-policy exists as the one policy home', () => {
    // P0-A1: the canonical tier rank lives here — the five private copies re-export it.
    expect(exists(COMMERCIAL_POLICY_PKG)).toBe(true);
    expect(CP.TIER_ORDER).toEqual({ starter: 0, core: 1, growth: 2, scale: 3 });
    expect(typeof CP.tierAtLeast).toBe('function');
  });

  it('EXPECTED RED (A2B): migrated nav/tab evaluators define no private tier-rank map', () => {
    const localRank = /^\s*(?:export\s+)?const\s+TIER_ORDER\b/m;
    const migrated = [
      'apps/frontend/src/navigation/resolveNavVisibility.ts',
      'apps/frontend/src/components/ModuleTabBar.tsx',
    ];
    const offenders = migrated.filter((f) => localRank.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// C9 — NO DEV ACCESS BYPASS
// ===========================================================================
describe('C9 — environment-independent access decision', () => {
  it('EXPECTED RED: resolveNavVisibility contains no import.meta.env branch', () => {
    expect(/import\.meta\.env/.test(read(RESOLVE_NAV_VIS))).toBe(false);
  });

  it('EXPECTED RED: the module-visibility gate is not short-circuited by DEV', () => {
    const src = read(RESOLVE_NAV_VIS);
    const devEnabled = /import\.meta\.env\.DEV[\s\S]{0,40}return\s+'enabled'/.test(src);
    expect(devEnabled).toBe(false);
  });
});

// ===========================================================================
// C10 — PURCHASING STARTER+ POLICY (semantic; full behavior in parity file)
// ===========================================================================
describe('C10 — Purchasing Core+/Growth+ policy', () => {
  // SUPERSEDED 2026-09-06 by COMMERCIAL-REMODEL-ALIGN-01. Purchasing was
  // Starter+ under P0-A1; the ratified remodel makes purchasing.core Core+ and
  // introduces purchasing.sourcing (ADVANCED SOURCING) at Growth+.
  it('EXPECTED RED: canonical policy declares purchasing.core at minimum tier core', () => {
    const req = CP.CAPABILITY_REQUIREMENTS?.['purchasing.core'];
    expect(req).toBeDefined();
    expect(req?.moduleId).toBe('suppliers-portal');
    expect(req?.minimumTier).toBe('core');
  });

  it('EXPECTED RED: canonical policy declares purchasing.sourcing at minimum tier growth', () => {
    const req = (CP.CAPABILITY_REQUIREMENTS as Record<string, { moduleId?: string; minimumTier?: string } | undefined>)?.['purchasing.sourcing'];
    expect(req).toBeDefined();
    expect(req?.moduleId).toBe('suppliers-portal');
    expect(req?.minimumTier).toBe('growth');
  });

  it('EXPECTED RED: a bespoke/revoked module grant denies as MODULE_NOT_INCLUDED, not a tier', () => {
    // Scale shop, module absent from context → reason must be MODULE_NOT_INCLUDED,
    // never TIER_TOO_LOW (Scale is the top tier).
    const decision = CP.evaluateAccess?.(
      { moduleId: 'suppliers-portal' },
      { tier: 'scale', modules: new Set<string>(), flags: new Set<string>() },
    );
    expect(decision?.allowed).toBe(false);
    expect(decision?.reason).toBe('MODULE_NOT_INCLUDED');
  });
});

// ===========================================================================
// C11 — WAREHOUSE POLICY
// ===========================================================================
describe('C11 — Warehouse policy', () => {
  it('EXPECTED RED: Warehouse Analytics must not declare two contradictory minimum tiers', () => {
    const entry = tabEntrySource(WAREHOUSE_TABS, 'wms-analytics');
    const declaresGrowth = /requiredTier:\s*'growth'/.test(entry);
    const declaresStarterFeature = /feature:\s*'wms\.pick_batches'/.test(entry);
    // wms.pick_batches is a Starter feature — it cannot also gate a Growth surface.
    expect(declaresGrowth && declaresStarterFeature).toBe(false);
  });

  it('GREEN CONTROL: wms.pick_batches is a Starter feature in the registry', () => {
    const src = read('apps/frontend/src/hooks/usePlanEntitlement.ts');
    expect(/'wms\.pick_batches':\s*'starter'/.test(src)).toBe(true);
  });

  it('GREEN CONTROL: floor-planning is a Growth module, problem-center is a Core module', () => {
    expect(new Set(TIER_CONFIG.growth.modules).has('floor-planning')).toBe(true);
    expect(new Set(TIER_CONFIG.core.modules).has('floor-planning')).toBe(false);
    expect(new Set(TIER_CONFIG.core.modules).has('problem-center')).toBe(true);
    expect(new Set(TIER_CONFIG.starter.modules).has('problem-center')).toBe(false);
  });
});

// ===========================================================================
// C13 — CONFIG REFERENCES MUST BE EMITTABLE (stronger than "string in a union")
// ===========================================================================
describe('C13 — every referenced module/capability is emittable', () => {
  const EMITTABLE = emittableModuleIds();

  it('EXPECTED RED: navigation module references are all emittable by the commercial policy', () => {
    const bad = [...new Set(navRequiredModuleIds())].filter((id) => !EMITTABLE.has(id));
    expect(bad).toEqual([]); // RED: ['wms-lite', 'suppliers-portal']
  });

  it('EXPECTED RED: ModuleTabBar can express a module requirement at all', () => {
    // Cross-surface parity is impossible while the tab layer has no way to
    // reference a canonical module/capability id.
    const src = read(MODULE_TAB_BAR);
    const canExpressModule = /requiredModuleId|capabilityId|requireCapability/.test(src);
    expect(canExpressModule).toBe(true);
  });

  it('EXPECTED RED: the Warehouse route gate references an emittable capability, not a no-op feature', () => {
    const src = read('apps/frontend/src/pages/ft2-pages/WmsFT2Page.tsx');
    const onlyNoOpGate =
      /feature="wms\.pick_batches"/.test(src) &&
      !/capabilityId|CommercialGate|requireCapability|'wms'/.test(src);
    expect(onlyNoOpGate).toBe(false);
  });
});

// ###########################################################################
// P0-A2B — FRONTEND COMMERCIAL CONVERGENCE (added by A2B TEST STRATEGY / RED)
// ###########################################################################
// Every EXPECTED RED below fails because the A2B frontend behaviour is ABSENT
// (nav/tabs/gate do not yet consume a CapabilityId → CAPABILITY_REQUIREMENTS →
// evaluateAccess), not for a plumbing reason. Proof capability set:
//   warehouse.operations · warehouse.analytics · warehouse.floor_planning ·
//   warehouse.problem_center · purchasing.core · demand.forecasting
//
// P0-A3 boundary (B17): exportReports.ts was migrated in P0-A3-1 and no longer
// owns a private TIER_ORDER. usePlanEntitlement.ts remains the sole deferred
// P0-A3 residual — its own migration lands in a later P0-A3 slice. The A2B
// contracts here are scoped to the MIGRATED surfaces only.

const A2B_NAV_SRC = stripComments(read(NAV_BOOTSTRAP));
const PURCHASING_TABS_F = 'apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts';
const INVENTORY_TABS_F = 'apps/frontend/src/pages/ft2-pages/inventoryModuleTabs.ts';

/** Extract the registerNavItem(...) chunk (parent) for a nav id. */
function navItemChunk(id: string): string {
  return A2B_NAV_SRC.split('registerNavItem(').find((c) => c.includes(`id: '${id}'`)) ?? '';
}

// ===========================================================================
// B2 — Sidenav consumes a canonical CapabilityId (not hand-rolled module/tier)
// ===========================================================================
describe('B2 — Sidenav capability ids', () => {
  it('EXPECTED RED: navBootstrap references `capabilityId:` at all', () => {
    expect(/capabilityId\s*:/.test(A2B_NAV_SRC)).toBe(true);
  });

  it('EXPECTED RED: warehouse + purchasing nav parents no longer hand-roll requiredModuleId', () => {
    expect(/requiredModuleId\s*:/.test(navItemChunk('warehouse'))).toBe(false);
    expect(/requiredModuleId\s*:/.test(navItemChunk('purchasing'))).toBe(false);
  });

  it('EXPECTED RED: every migrated nav id carries its ratified CapabilityId', () => {
    const want: Record<string, string> = {
      warehouse: 'warehouse.operations',
      'wms-operations': 'warehouse.operations',
      'floor-planning': 'warehouse.floor_planning',
      'wms-analytics': 'warehouse.analytics',
      'product-issues': 'warehouse.problem_center',
      purchasing: 'purchasing.core',
      'open-pos': 'purchasing.core',
      suppliers: 'purchasing.core',
      // P0-A3-5: Sourcing is the Growth+ ADVANCED SOURCING surface, not
      // purchasing.core. Stale purchasing.core row retired here.
      sourcing: 'purchasing.sourcing',
      demand: 'demand.forecasting',
    };
    const missing = Object.entries(want)
      .filter(([id, cap]) => {
        const re = new RegExp(
          `id:\\s*'${id}'[\\s\\S]{0,400}?capabilityId:\\s*'${cap.replace(/\./g, '\\.')}'`,
        );
        return !re.test(A2B_NAV_SRC);
      })
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it('GREEN CONTROL: each of the ratified CapabilityIds exists in the shared registry', () => {
    for (const cap of [
      'warehouse.operations', 'warehouse.analytics', 'warehouse.floor_planning',
      'warehouse.problem_center', 'purchasing.core', 'purchasing.sourcing', 'demand.forecasting',
    ]) {
      expect((CP as any).CAPABILITY_REQUIREMENTS[cap]).toBeDefined();
    }
  });
});

// ===========================================================================
// B3 — no LIVE frontend commercial reference to `wms-lite`
// ===========================================================================
describe('B3 — wms-lite removed from the frontend commercial surfaces', () => {
  const A2B_FRONTEND_COMMERCIAL_FILES = [
    NAV_BOOTSTRAP,
    RESOLVE_NAV_VIS,
    MODULE_TAB_BAR,
    WAREHOUSE_TABS,
    SIDENAV,
    'apps/frontend/src/runtime/resolveNavigation.ts',
    'apps/frontend/src/runtime/useResolvedNavigation.ts',
  ];

  it('EXPECTED RED: zero live `wms-lite` references across the frontend commercial surfaces', () => {
    const offenders = A2B_FRONTEND_COMMERCIAL_FILES.filter((f) =>
      /['"]wms-lite['"]/.test(stripComments(read(f))),
    );
    expect(offenders).toEqual([]);
  });

  it('GREEN CONTROL: `wms` is the canonical emittable Warehouse module id', () => {
    expect(emittableModuleIds().has('wms')).toBe(true);
    expect(emittableModuleIds().has('wms-lite')).toBe(false);
  });
});

// ===========================================================================
// B4 — no parent commercial inheritance (each commercial child is explicit)
// ===========================================================================
describe('B4 — commercial children are explicit, never inherited from a parent', () => {
  it('purchasing children (open-pos/suppliers/sourcing) each declare their OWN ratified capabilityId', () => {
    // P0-A3-5: the homogeneous purchasing.core expectation is retired. The
    // Purchasing children are NOT one commercial class — COMMERCIAL-REMODEL-
    // ALIGN-01 split them, and B4's invariant is precisely that each child
    // states its own decision rather than inheriting one. An explicit
    // id -> capability map is therefore the correct shape here, matching the
    // warehouse-children case below.
    const want: Record<string, string> = {
      'open-pos': 'purchasing.core',
      suppliers: 'purchasing.core',
      sourcing: 'purchasing.sourcing',
    };
    const missing = Object.entries(want).filter(
      ([id, cap]) =>
        !new RegExp(`id:\\s*'${id}'[\\s\\S]{0,240}?capabilityId:\\s*'${cap.replace(/\./g, '\\.')}'`).test(A2B_NAV_SRC),
    );
    expect(missing.map((m) => m[0])).toEqual([]);
  });

  it('EXPECTED RED: warehouse children (operations/floor-planning/analytics/problem center) each declare capabilityId', () => {
    const want: Record<string, string> = {
      'wms-operations': 'warehouse.operations',
      'floor-planning': 'warehouse.floor_planning',
      'wms-analytics': 'warehouse.analytics',
      'product-issues': 'warehouse.problem_center',
    };
    const missing = Object.entries(want).filter(
      ([id, cap]) =>
        !new RegExp(`id:\\s*'${id}'[\\s\\S]{0,240}?capabilityId:\\s*'${cap.replace(/\./g, '\\.')}'`).test(A2B_NAV_SRC),
    );
    expect(missing.map((m) => m[0])).toEqual([]);
  });
});

// ===========================================================================
// B5 — DEV parity (strengthens C9): the decision path is env-independent
// ===========================================================================
describe('B5 — no DEV commercial bypass anywhere in the resolved-nav path', () => {
  it('EXPECTED RED: resolveNavVisibility contains no import.meta.env reference', () => {
    expect(/import\.meta\.env/.test(read(RESOLVE_NAV_VIS))).toBe(false);
  });

  it('GREEN CONTROL: resolveNavigation / useResolvedNavigation carry no DEV commercial bypass', () => {
    for (const f of [
      'apps/frontend/src/runtime/resolveNavigation.ts',
      'apps/frontend/src/runtime/useResolvedNavigation.ts',
    ]) {
      expect(/import\.meta\.env\.DEV[\s\S]{0,60}return\s+'enabled'/.test(read(f))).toBe(false);
    }
  });
});

// ===========================================================================
// B6 — no fabricated Growth (strengthens C7): denial tier derives from a decision
// ===========================================================================
describe('B6 — migrated denial surfaces derive requiredTier from a decision, not `?? growth`', () => {
  const FABRICATE = /requiredTier(?:\s+as[^)]*)?\)?\s*\?\?\s*['"]growth['"]/i;

  it('EXPECTED RED: SidenavContent has no `requiredTier ?? "growth"` fabrication', () => {
    expect(FABRICATE.test(read(SIDENAV))).toBe(false);
  });

  it('EXPECTED RED: ModuleTabBar has no `requiredTier ?? "growth"` fabrication', () => {
    expect(FABRICATE.test(read(MODULE_TAB_BAR))).toBe(false);
  });

  it('EXPECTED RED: SidenavContent opens its upgrade path from an AccessDecision (decision.reason / decision.requiredTier)', () => {
    expect(/decision\.(reason|requiredTier)|AccessDecision/.test(read(SIDENAV))).toBe(true);
  });

  it('EXPECTED RED: ModuleTabBar opens its upgrade path from an AccessDecision', () => {
    expect(/decision\.(reason|requiredTier)|AccessDecision/.test(read(MODULE_TAB_BAR))).toBe(true);
  });
});

describe('B6 — compact Sidenav denial parity', () => {
  it('EXPECTED RED: a denied compact child never navigates directly and reuses denial handling', () => {
    const src = read(SIDENAV);
    const compact = src.split('COMPACT MODE — submodule hover popover')[1]?.split('<UpgradePrompt')[0] ?? '';
    expect(compact.length).toBeGreaterThan(0);
    expect(/navigate\(child\.path\)/.test(compact)).toBe(false);
    expect(/renderChild\(child\)|handleChildClick|child\.disabled|decision\.(?:allowed|reason)/.test(compact)).toBe(true);
    expect(/renderChild\(child\)|setUpgradeOpen|onDenied|decision\.reason/.test(compact)).toBe(true);
  });
});

// ===========================================================================
// B7 — ModuleTab descriptors carry a CapabilityId
// ===========================================================================
describe('B7 — ModuleTabBar capability support', () => {
  it('EXPECTED RED: the ModuleTab type supports `capabilityId?: CapabilityId`', () => {
    expect(/capabilityId\?\s*:\s*CapabilityId/.test(read(MODULE_TAB_BAR))).toBe(true);
  });

  it('EXPECTED RED: every migrated tab config expresses its CapabilityId', () => {
    const want: Array<[string, string, string]> = [
      [WAREHOUSE_TABS, 'wms-operations', 'warehouse.operations'],
      [WAREHOUSE_TABS, 'floor-planning', 'warehouse.floor_planning'],
      [WAREHOUSE_TABS, 'wms-analytics', 'warehouse.analytics'],
      [WAREHOUSE_TABS, 'product-issues', 'warehouse.problem_center'],
      [PURCHASING_TABS_F, 'purchasing-pos', 'purchasing.core'],
      [PURCHASING_TABS_F, 'purchasing-suppliers', 'purchasing.core'],
      // P0-A3-5: the Sourcing tab is Growth+ ADVANCED SOURCING.
      [PURCHASING_TABS_F, 'purchasing-sourcing', 'purchasing.sourcing'],
      [INVENTORY_TABS_F, 'demand', 'demand.forecasting'],
    ];
    const missing = want.filter(([file, id, cap]) => {
      const src = read(file);
      const re = new RegExp(`id:\\s*'${id}'[\\s\\S]{0,200}?capabilityId:\\s*'${cap.replace(/\./g, '\\.')}'`);
      return !re.test(src);
    });
    expect(missing.map((m) => m[1])).toEqual([]);
  });
});

// ===========================================================================
// B8 — ModuleTabBar removes its local tab policy for migrated tabs
// ===========================================================================
describe('B8 — migrated tabs decided by the shared evaluator, not local logic', () => {
  it('EXPECTED RED: ModuleTabBar defines no private TIER_ORDER map', () => {
    expect(/^\s*(?:export\s+)?const\s+TIER_ORDER\b/m.test(read(MODULE_TAB_BAR))).toBe(false);
  });

  it('EXPECTED RED: ModuleTabBar derives its decision from the shared engine / gate', () => {
    const src = read(MODULE_TAB_BAR);
    expect(/@lasyncro\/commercial-policy|evaluateAccess|useCommercialAccess|CommercialGate|capabilityId/.test(src)).toBe(true);
  });

  it('EXPECTED RED: Warehouse Analytics tab uses canonical warehouse.analytics (feature wms.analytics), never wms.pick_batches', () => {
    const entry = tabEntrySource(WAREHOUSE_TABS, 'wms-analytics');
    expect(/feature:\s*'wms\.pick_batches'/.test(entry)).toBe(false);
    expect(/capabilityId:\s*'warehouse\.analytics'/.test(entry)).toBe(true);
  });

  it('GREEN CONTROL: warehouse.analytics canonical feature is wms.analytics at Growth', () => {
    const req = (CP as any).CAPABILITY_REQUIREMENTS['warehouse.analytics'];
    expect(req.feature).toBe('wms.analytics');
    expect(req.minimumTier).toBe('growth');
  });
});

// ===========================================================================
// B16 / B17 — private tier-rank boundary: A2B migrated vs P0-A3 residual
// ===========================================================================
describe('B16/B17 — tier-rank convergence is scoped to the migrated surfaces', () => {
  const localRank = /^\s*(?:export\s+)?const\s+TIER_ORDER\b/m;
  // A2B nav/tab evaluators plus exportReports.ts, migrated in P0-A3-1.
  const MIGRATED_FRONTEND_TIER_RANK_OWNERS = [
    'apps/frontend/src/navigation/resolveNavVisibility.ts',
    'apps/frontend/src/components/ModuleTabBar.tsx',
    'apps/frontend/src/config/exportReports.ts',
  ];
  const P0A3_RESIDUAL = [
    'apps/frontend/src/hooks/usePlanEntitlement.ts',
  ];

  it('GREEN BOUNDARY: every migrated target (A2B + P0-A3-1 exportReports.ts) owns no private tier rank; only the named P0-A3 residual may', () => {
    for (const f of MIGRATED_FRONTEND_TIER_RANK_OWNERS) {
      expect(localRank.test(read(f))).toBe(false);
    }
    const permitted = new Set([...MIGRATED_FRONTEND_TIER_RANK_OWNERS, ...P0A3_RESIDUAL]);
    const unexpected = TIER_RANK_DUP_FILES
      .filter((f) => f.startsWith('apps/frontend/'))
      .filter((f) => localRank.test(read(f)) && !permitted.has(f));
    expect(unexpected).toEqual([]);
  });

  it('GREEN BOUNDARY: usePlanEntitlement.ts is the exact remaining deferred P0-A3 residual', () => {
    const residual = P0A3_RESIDUAL.filter((f) => localRank.test(read(f)));
    expect(residual).toEqual(P0A3_RESIDUAL);
  });
});

// ===========================================================================
// B18 — CapabilityId type safety (no silent Growth fallback on unknown ids)
// ===========================================================================
describe('B18 — unknown capability ids fail closed, never default to Growth', () => {
  it('GREEN CONTROL: isCapabilityId rejects an invalid CapabilityId string', () => {
    expect((CP as any).isCapabilityId('warehouse.operations')).toBe(true);
    expect((CP as any).isCapabilityId('warehouse.not_a_real_capability')).toBe(false);
    expect((CP as any).CAPABILITY_REQUIREMENTS['warehouse.not_a_real_capability']).toBeUndefined();
  });

  it('EXPECTED RED: the migrated nav/tab descriptors use a typed CapabilityId (import from @lasyncro/commercial-policy)', () => {
    const anyDescriptorTyped =
      /import\s+type\s+\{[^}]*CapabilityId[^}]*\}\s+from\s+'@lasyncro\/commercial-policy'/.test(read(MODULE_TAB_BAR)) ||
      /CapabilityId/.test(read(NAV_BOOTSTRAP));
    expect(anyDescriptorTyped).toBe(true);
  });
});
