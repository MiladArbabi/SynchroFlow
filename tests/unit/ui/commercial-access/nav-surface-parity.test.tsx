// COMMERCIAL-ACCESS-ARCH-01 / NAV-ENTITLEMENT-PARITY-01 — Slice P0-A
// =================================================================
// C5 — CROSS-SURFACE PARITY (frontend behavior layer)
//
// Contract: same shop + same tier + same capability => same commercial
// decision across Sidenav, ModuleTabBar, direct route gate, backend.
//
// This file proves the divergence between:
//   - ModuleTabBar's real click behavior (rendered), and
//   - the decision the Sidenav config implies for the same destination.
//
// resolveNavVisibility() itself is NOT called here: in the jsdom Jest
// project `import.meta.env.DEV` resolves truthy, which triggers the
// production defect's own DEV short-circuit (covered by C9). Modelling the
// sidenav decision from config keeps this contract environment-independent.
//
// Canonical effective module floors are mirrored from modulesForTier(), not
// from the frozen backend-core TIER_CONFIG seed lists. Purchasing is Starter+
// in that effective model. Expected RED remains on capability expression and
// cross-surface convergence, not on an obsolete rows-only availability model.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- mocks -----------------------------------------------------------------

const mockNav = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNav,
}));

jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));

// ModuleTabBar always renders <UpgradePrompt mode="modal">, whose modal branch
// calls useEntitlements() and throws outside a provider. Not under test here.
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));

let mockTier: 'starter' | 'core' | 'growth' | 'scale' = 'scale';
const FEATURE_MIN: Record<string, number> = { 'wms.pick_batches': 0 };
const RANK: Record<string, number> = { starter: 0, core: 1, growth: 2, scale: 3 };
jest.mock('hooks/usePlanEntitlement', () => ({
  usePlanEntitlement: () => ({
    tier: mockTier,
    can: (f: string) => (FEATURE_MIN[f] ?? 0) <= RANK[mockTier],
  }),
}));

// P0-A2B-MODULETABBAR-HARNESS-01: ModuleTabBar now decides capabilityId
// tabs via the shared useCommercialAccess() hook (P0-A2B-ADDITIVE-PARITY-01),
// which normally sources its live entitlement snapshot from
// EntitlementsContext. This harness has no EntitlementsProvider and must
// not add one (that would pull in the real HTTP-backed context for a pure
// component test) — instead it supplies a controlled useCommercialAccess()
// backed by the REAL canonical policy (buildCommercialContext/
// decideCapability, via jest.requireActual — no hand-rolled tier/module/
// feature logic), driven by the SAME mutable `mockTier` the
// usePlanEntitlement mock above already uses, so both stay aligned per
// test. Snapshot is empty by default: these tests prove standard-plan
// (tier-floor) behavior, not additive grants — that is what the
// source-coupled architecture test below independently protects.
jest.mock('runtime/commercialContext', () => {
  const actual = jest.requireActual('runtime/commercialContext');
  return {
    __esModule: true,
    ...actual,
    useCommercialAccess: () => {
      const context = actual.buildCommercialContext({
        tier: mockTier,
        snapshot: { modules: new Set<string>(), flags: new Set<string>() },
      });
      return {
        context,
        isResolved: true,
        decide: (capabilityId: string) => actual.decideCapability(capabilityId, context),
      };
    },
  };
});

import { ModuleTabBar } from 'components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from 'pages/ft2-pages/warehouseModuleTabs';
import { PURCHASING_SUB_TABS } from 'pages/ft2-pages/purchasingSubTabs';
import { INVENTORY_MODULE_TABS } from 'pages/ft2-pages/inventoryModuleTabs';

// ---- canonical effective inputs, mirrored (deterministic, no env) ---------
// Source: @lasyncro/commercial-policy modulesForTier(tier). Persisted rows are
// additive and therefore cannot remove these standard plan-floor modules.
const STARTER_MODULES = [
  'overview', 'order-nexus', 'fulfillment', 'alerts',
  'shopify_integration', 'specter_sdk_free', 'wms', 'barcodes', 'suppliers-portal',
];
const CORE_MODULES = [...STARTER_MODULES, 'returns', 'products', 'problem-center'];
const GROWTH_MODULES = [...CORE_MODULES, 'customers', 'finances', 'demand', 'specter', 'floor-planning'];
const SCALE_MODULES = [...GROWTH_MODULES];
const GRANTED: Record<string, Set<string>> = {
  starter: new Set(STARTER_MODULES),
  core: new Set(CORE_MODULES),
  growth: new Set(GROWTH_MODULES),
  scale: new Set(SCALE_MODULES),
};

// Source: apps/frontend/src/runtime/navBootstrap.ts  (requiredModuleId literals).
// P0-A2B-VERIFY-CONTRACT-02: `warehouse` was migrated to capabilityId
// (warehouse.operations) and no longer carries a requiredModuleId at all —
// the stale `wms-lite` entry that used to live here was never a valid
// canonical module id (see C4/C13 in the contract suite) and is removed.
// Warehouse's Sidenav decision is now modelled via CAPABILITY_MODULE /
// effectiveCapabilityAllows('warehouse.operations', tier) below. `purchasing`
// and `inventory` are unmigrated at the parent level and still carry a real
// requiredModuleId, so they remain here.
const NAV_REQUIRED_MODULE: Record<string, string> = {
  purchasing: 'suppliers-portal',
  inventory: 'products',
};

const CAPABILITY_MODULE: Record<string, string> = {
  'warehouse.operations': 'wms',
  'purchasing.core': 'suppliers-portal',
  'demand.forecasting': 'demand',
};

const TIERS = ['starter', 'core', 'growth', 'scale'] as const;

/** What the Sidenav config implies for a top-level nav item at a given tier. */
function sidenavAllows(navItemId: keyof typeof NAV_REQUIRED_MODULE, tier: string): boolean {
  return GRANTED[tier].has(NAV_REQUIRED_MODULE[navItemId]);
}

function effectiveCapabilityAllows(capabilityId: keyof typeof CAPABILITY_MODULE, tier: string): boolean {
  return GRANTED[tier].has(CAPABILITY_MODULE[capabilityId]);
}

/** Render one tab bar at `tier`, click `label`, report whether it navigated. */
function tabAllows(tabs: typeof WAREHOUSE_MODULE_TABS, label: string, tier: typeof TIERS[number]): boolean {
  mockTier = tier;
  mockNav.mockClear();
  const { unmount } = render(
    <MemoryRouter>
      <ModuleTabBar tabs={tabs} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText(label));
  const navigated = mockNav.mock.calls.length > 0;
  unmount();
  return navigated;
}

// ===========================================================================
// WAREHOUSE OPERATIONS — ratified Starter+, must ALLOW everywhere
// ===========================================================================
describe('C5 — Warehouse Operations parity', () => {
  it('GREEN: ModuleTabBar allows Warehouse Operations for every tier', () => {
    for (const t of TIERS) expect(tabAllows(WAREHOUSE_MODULE_TABS, 'Operations', t)).toBe(true);
  });

  it('GREEN: canonical warehouse.operations capability allows Warehouse for every tier', () => {
    for (const t of TIERS) expect(effectiveCapabilityAllows('warehouse.operations', t)).toBe(true);
  });

  it('GREEN: tab decision and canonical warehouse.operations decision match for Growth and Scale', () => {
    for (const t of ['growth', 'scale'] as const) {
      expect(tabAllows(WAREHOUSE_MODULE_TABS, 'Operations', t)).toBe(effectiveCapabilityAllows('warehouse.operations', t));
    }
  });
});

// ===========================================================================
// PURCHASING + SOURCING — ratified Starter+ (P-A), must ALLOW everywhere
// ===========================================================================
describe('C5 — Purchasing / Sourcing parity', () => {
  it('GREEN: ModuleTabBar allows Open POs / Suppliers / Sourcing for every tier', () => {
    for (const t of TIERS) {
      expect(tabAllows(PURCHASING_SUB_TABS, 'Open POs', t)).toBe(true);
      expect(tabAllows(PURCHASING_SUB_TABS, 'Suppliers', t)).toBe(true);
      expect(tabAllows(PURCHASING_SUB_TABS, 'Sourcing', t)).toBe(true);
    }
  });

  it('GREEN: purchasing.core is available from the canonical effective tier floor at every tier', () => {
    for (const t of TIERS) {
      expect(effectiveCapabilityAllows('purchasing.core', t)).toBe(true);
      expect(sidenavAllows('purchasing', t)).toBe(true);
    }
  });

  it('EXPECTED RED: Purchasing declares purchasing.core on Sidenav, tabs, and CommercialGate', () => {
    for (const t of TIERS) {
      expect(tabAllows(PURCHASING_SUB_TABS, 'Sourcing', t)).toBe(effectiveCapabilityAllows('purchasing.core', t));
    }
    for (const id of ['purchasing', 'open-pos', 'suppliers', 'sourcing']) {
      expect(capRefRe('purchasing.core', id).test(NAV_BOOTSTRAP_SRC)).toBe(true);
    }
    for (const id of ['purchasing-pos', 'purchasing-suppliers', 'purchasing-sourcing']) {
      expect(capRefRe('purchasing.core', id).test(PURCHASING_TABS_SRC)).toBe(true);
    }
    const routeSurface = readSrc('apps/frontend/src/lifecycle/LifecycleRouteHost.tsx') +
      readSrc('apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx');
    expect(/CommercialGate/.test(routeSurface)).toBe(true);
    expect(/purchasing\.core/.test(routeSurface)).toBe(true);
  });
});

// ===========================================================================
// DEMAND — GREEN control: tab and sidenav agree at every tier
// ===========================================================================
describe('C5 — Demand parity (GREEN control)', () => {
  // Demand nav child: parent module `products` (Core+) AND child requiredTier 'growth'.
  const demandSidenavAllows = (tier: string) =>
    sidenavAllows('inventory', tier) && RANK[tier] >= RANK.growth;

  it('GREEN: Demand denied at Core, allowed at Growth/Scale — on BOTH surfaces', () => {
    expect(tabAllows(INVENTORY_MODULE_TABS, 'Demand', 'core')).toBe(false);
    expect(demandSidenavAllows('core')).toBe(false);

    for (const t of ['growth', 'scale'] as const) {
      expect(tabAllows(INVENTORY_MODULE_TABS, 'Demand', t)).toBe(true);
      expect(demandSidenavAllows(t)).toBe(true);
    }
  });

  it('GREEN: tab decision equals sidenav decision for Demand at every tier', () => {
    for (const t of TIERS) {
      expect(tabAllows(INVENTORY_MODULE_TABS, 'Demand', t)).toBe(demandSidenavAllows(t));
    }
  });
});

// ###########################################################################
// P0-A2B — CROSS-SURFACE CAPABILITY CONVERGENCE (B11 / B12)
// ###########################################################################
// The parity the current file proves via divergence is now made explicit as a
// full capability × tier matrix: Sidenav, ModuleTabBar and the CommercialGate
// route surface must all resolve the SAME decision as the canonical engine.
// EXPECTED RED because none of the three frontend surfaces reference a
// CapabilityId yet, so a shared decision is not even expressible.

// NOTE: the `frontend` Jest project has no ESM `.js`-extension resolver, so it
// cannot import `@lasyncro/commercial-policy` from source. The ratified matrix
// below is therefore mirrored as literal data (same approach the module-set
// mirror above already uses) — canonical source: the P0-A1 catalog +
// monetization_billing_playbook.md §32 "### P0-A2A".
import * as fs from 'fs';
import * as path from 'path';
// P0-A2B-VERIFY-CONTRACT-02: the jest.config.js frontend project now strips
// `.js` extensions from relative TS source imports (same generic rule the
// contract/backend-legacy projects already used), so this file can import
// @lasyncro/commercial-policy directly instead of mirroring its data.
import { isModuleId, MODULE_CLASSIFICATION } from '@lasyncro/commercial-policy';
import { buildCommercialContext } from 'runtime/commercialContext';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const readSrc = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const NAV_BOOTSTRAP_SRC = readSrc('apps/frontend/src/runtime/navBootstrap.ts');
const WAREHOUSE_TABS_SRC = readSrc('apps/frontend/src/pages/ft2-pages/warehouseModuleTabs.ts');
const PURCHASING_TABS_SRC = readSrc('apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts');
const INVENTORY_TABS_SRC = readSrc('apps/frontend/src/pages/ft2-pages/inventoryModuleTabs.ts');

// The proof capability set and the ratified allow/deny matrix.
const PROOF_CAPS = [
  'warehouse.operations',
  'warehouse.analytics',
  'warehouse.floor_planning',
  'warehouse.problem_center',
  'purchasing.core',
  'demand.forecasting',
] as const;

// Ratified capability × tier ALLOW/DENY matrix (canonical source above).
const RATIFIED: Record<typeof TIERS[number], Record<string, boolean>> = {
  starter: {
    'warehouse.operations': true, 'warehouse.analytics': false, 'warehouse.floor_planning': false,
    'warehouse.problem_center': false, 'purchasing.core': true, 'demand.forecasting': false,
  },
  core: {
    'warehouse.operations': true, 'warehouse.analytics': false, 'warehouse.floor_planning': false,
    'warehouse.problem_center': true, 'purchasing.core': true, 'demand.forecasting': false,
  },
  growth: Object.fromEntries(
    ['warehouse.operations', 'warehouse.analytics', 'warehouse.floor_planning',
      'warehouse.problem_center', 'purchasing.core', 'demand.forecasting'].map((c) => [c, true]),
  ),
  scale: Object.fromEntries(
    ['warehouse.operations', 'warehouse.analytics', 'warehouse.floor_planning',
      'warehouse.problem_center', 'purchasing.core', 'demand.forecasting'].map((c) => [c, true]),
  ),
};
const canonicalAllows = (cap: string, tier: typeof TIERS[number]): boolean => RATIFIED[tier][cap];

// Which nav id / tab id each capability maps to on each surface.
const NAV_ID_FOR: Record<string, string[]> = {
  'warehouse.operations': ['warehouse', 'wms-operations'],
  'warehouse.analytics': ['wms-analytics'],
  'warehouse.floor_planning': ['floor-planning'],
  'warehouse.problem_center': ['product-issues'],
  'purchasing.core': ['purchasing', 'open-pos', 'suppliers', 'sourcing'],
  'demand.forecasting': ['demand'],
};
const TAB_SRC_FOR: Record<string, { src: string; ids: string[] }> = {
  'warehouse.operations': { src: WAREHOUSE_TABS_SRC, ids: ['wms-operations'] },
  'warehouse.analytics': { src: WAREHOUSE_TABS_SRC, ids: ['wms-analytics'] },
  'warehouse.floor_planning': { src: WAREHOUSE_TABS_SRC, ids: ['floor-planning'] },
  'warehouse.problem_center': { src: WAREHOUSE_TABS_SRC, ids: ['product-issues'] },
  'purchasing.core': { src: PURCHASING_TABS_SRC, ids: ['purchasing-pos', 'purchasing-suppliers', 'purchasing-sourcing'] },
  'demand.forecasting': { src: INVENTORY_TABS_SRC, ids: ['demand'] },
};

const capRefRe = (cap: string, id: string) =>
  new RegExp(`id:\\s*'${id}'[\\s\\S]{0,400}?capabilityId:\\s*'${cap.replace(/\./g, '\\.')}'`);

describe('B12 — every proof capability is expressed as a CapabilityId on all three surfaces', () => {
  it.each(PROOF_CAPS)('EXPECTED RED: Sidenav (navBootstrap) declares capabilityId for %s', (cap) => {
    const ok = NAV_ID_FOR[cap].every((id) => capRefRe(cap, id).test(NAV_BOOTSTRAP_SRC));
    expect(ok).toBe(true);
  });

  it.each(PROOF_CAPS)('EXPECTED RED: ModuleTabBar tab config declares capabilityId for %s', (cap) => {
    const { src, ids } = TAB_SRC_FOR[cap];
    const ok = ids.every((id) => capRefRe(cap, id).test(src));
    expect(ok).toBe(true);
  });
});

describe('B12 — ratified decision matrix (GREEN CONTROL: the target every surface must match)', () => {
  // Demand's PLAN_FEATURES + module gate (modelled by demandSidenavAllows /
  // tabAllows above) is the one surface that is ALREADY correct — it is the
  // B11 green control the migration must preserve.
  it('GREEN CONTROL: Demand matrix (tab + sidenav models) equals the ratified rows', () => {
    // Demand sidenav model: parent `products` granted AND child requiredTier 'growth'.
    const demandNav = (t: string) => sidenavAllows('inventory', t) && RANK[t] >= RANK.growth;
    for (const t of TIERS) {
      expect({ t, tab: tabAllows(INVENTORY_MODULE_TABS, 'Demand', t) })
        .toEqual({ t, tab: canonicalAllows('demand.forecasting', t) });
      expect({ t, nav: demandNav(t) })
        .toEqual({ t, nav: canonicalAllows('demand.forecasting', t) });
    }
  });

  it('GREEN CONTROL: Scale row is all-ALLOW — no capability yields an upgrade path at Scale', () => {
    for (const cap of PROOF_CAPS) {
      expect({ cap, allow: canonicalAllows(cap, 'scale') }).toEqual({ cap, allow: true });
    }
  });

  it('GREEN CONTROL: Starter/Core rows match the ratified P0-A2A matrix', () => {
    expect(PROOF_CAPS.map((c) => [c, canonicalAllows(c, 'starter')])).toEqual([
      ['warehouse.operations', true],
      ['warehouse.analytics', false],
      ['warehouse.floor_planning', false],
      ['warehouse.problem_center', false],
      ['purchasing.core', true],
      ['demand.forecasting', false],
    ]);
    expect(PROOF_CAPS.map((c) => [c, canonicalAllows(c, 'core')])).toEqual([
      ['warehouse.operations', true],
      ['warehouse.analytics', false],
      ['warehouse.floor_planning', false],
      ['warehouse.problem_center', true],
      ['purchasing.core', true],
      ['demand.forecasting', false],
    ]);
  });
});

// ###########################################################################
// P0-A2B-VERIFY-CONTRACT-02 / P0-A2B-ADDITIVE-PARITY-CONTRACT-01 —
// ADDITIVE-GRANT CROSS-SURFACE PARITY
// ###########################################################################
// VERIFY (P0-A2B-VERIFY-CONTRACT-02) found: apps/frontend/src/components/
// ModuleTabBar.tsx builds its AccessContext as
//   buildCommercialContext({ tier: legacyTier, snapshot: { modules: new Set(), flags: new Set() } })
// — an ALWAYS-EMPTY snapshot, regardless of the shop's real entitlement
// grants. Sidenav (useResolvedNavigation -> resolveNavigation -> the SAME
// buildCommercialContext, but with the live snapshot from useEntitlements)
// and CommercialGate (useCommercialAccess -> the SAME buildCommercialContext,
// also with the live snapshot) both union tier floor WITH that snapshot.
//
// COVERAGE BOUNDARY (unchanged from P0-A2B-VERIFY-CONTRACT-02): none of the
// six ratified P0-A2B capabilities (PROOF_CAPS above) can expose this
// divergence live through ModuleTabBar's actual decide()/decideCapability()
// path — every moduleId-only capability's module is already Starter-standard
// (floor alone always satisfies it), and every capability carrying a
// minimumTier fails TIER_TOO_LOW before moduleId/feature are ever checked
// (evaluateAccess is FIRST-FAILURE-WINS), so no additive grant can rescue a
// tier-too-low decision, and decideCapability only accepts a REGISTERED
// CapabilityId. A behavioral (rendered/decision-value) RED cannot be built
// from the current capability catalog without either inventing a fake
// CapabilityId or hand-mirroring ModuleTabBar's construction call inside the
// test (P0-A2B-ADDITIVE-PARITY-CONTRACT-01: a mirrored construction is not a
// valid regression contract — it does not depend on the real source and can
// drift silently).
//
// SOURCE-COUPLED ARCHITECTURE CONTRACT (P0-A2B-ADDITIVE-PARITY-CONTRACT-01):
// read apps/frontend/src/components/ModuleTabBar.tsx directly and assert,
// against its ACTUAL text, that its capability path (a) consumes the shared
// snapshot-aware commercial adapter (useCommercialAccess — the same entry
// point Sidenav/CommercialGate use) and (b) never hardcodes an empty
// snapshot into a capability AccessContext. This depends on the real file,
// fails against its current content, and requires no future test edit —
// fixing ModuleTabBar.tsx to route through useCommercialAccess() and drop
// the hardcoded `{ modules: new Set(), flags: new Set() }` snapshot turns it
// GREEN with no further test changes.
const MODULE_TAB_BAR_SRC_FOR_SNAPSHOT_CONTRACT = readSrc('apps/frontend/src/components/ModuleTabBar.tsx');
const USES_SHARED_SNAPSHOT_AWARE_ADAPTER = /useCommercialAccess\s*\(/;
const HARDCODED_EMPTY_SNAPSHOT_CAPABILITY_CONTEXT =
  /snapshot:\s*\{\s*modules:\s*new\s+Set\(\s*\)\s*,\s*flags:\s*new\s+Set\(\s*\)\s*\}/;

describe('P0-A2B-VERIFY-CONTRACT-02 — additive-grant cross-surface parity', () => {
  it('GREEN CONTROL: echo-hub is a real, permanently grant-only ModuleId (never in any tier floor)', () => {
    expect(isModuleId('echo-hub')).toBe(true);
    expect(MODULE_CLASSIFICATION['echo-hub']).toBe('grant_only');
    for (const t of TIERS) {
      const floorOnly = buildCommercialContext({ tier: t, snapshot: { modules: new Set(), flags: new Set() } });
      expect({ t, hasEchoHub: floorOnly.modules.has('echo-hub') }).toEqual({ t, hasEchoHub: false });
    }
  });

  it('EXPECTED RED: ModuleTabBar consumes the shared snapshot-aware commercial adapter (useCommercialAccess), never a hardcoded empty-snapshot capability context', () => {
    const usesSharedSnapshotAwareAdapter = USES_SHARED_SNAPSHOT_AWARE_ADAPTER.test(MODULE_TAB_BAR_SRC_FOR_SNAPSHOT_CONTRACT);
    const hasHardcodedEmptySnapshot = HARDCODED_EMPTY_SNAPSHOT_CAPABILITY_CONTEXT.test(MODULE_TAB_BAR_SRC_FOR_SNAPSHOT_CONTRACT);

    // EXPECTED RED: ModuleTabBar.tsx today imports buildCommercialContext/
    // decideCapability directly and builds its own capability AccessContext
    // with a literal `{ modules: new Set(), flags: new Set() }` snapshot —
    // it does not call useCommercialAccess() and does not consume the shop's
    // live entitlement snapshot. This fails until ModuleTabBar.tsx is
    // corrected to route through the shared snapshot-aware adapter and drop
    // the hardcoded empty snapshot.
    expect({ usesSharedSnapshotAwareAdapter, hasHardcodedEmptySnapshot }).toEqual({
      usesSharedSnapshotAwareAdapter: true,
      hasHardcodedEmptySnapshot: false,
    });
  });
});
