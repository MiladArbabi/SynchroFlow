// tests/contract/returns-commercial-access.contract.test.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-3 — TEST STRATEGY / RED
// ===============================================================
// RED regression contracts for the ratified Returns commercial model.
//
// This file is PURE / CONTRACT layer: it evaluates the pure policy engine and
// reads production source as text. It never renders React, never touches a DB,
// never boots a server.
//
// Ratified model (P0-A3-3):
//   returns.intake   -> Core+     returns receiving/intake workflow
//   returns.core     -> Core+     returns control/resolution workflow
//   returns.analysis -> Growth+   returns analytical intelligence
//   Scale inherits every lower capability.
//
// Structure mirrors the established contracts in this directory:
//   - commercial-access-policy.contract.test.ts   (namespace import of the
//     policy package so a missing member goes RED rather than throwing a
//     module-resolution error)
//   - overview-live-map-commercial-access.contract.test.ts  (bounded source
//     slices per route/declaration, never whole-file literal counting)
//
// `returns.intake` does not exist in the CapabilityId union yet, so it is
// addressed here as a plain string through a widened view of the frozen
// registry. Production source is NOT edited to make these tests compile.

import fs from 'fs';
import path from 'path';

import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const RETURNS_ROUTES = 'apps/backend/src/api/returns/returns.routes.ts';
const NAV_BOOTSTRAP = 'apps/frontend/src/runtime/navBootstrap.ts';
const RETURNS_SUB_TABS = 'apps/frontend/src/pages/ft2-pages/returnsSubTabs.tsx';
const RETURNS_FT2_PAGE = 'apps/frontend/src/pages/ft2-pages/ReturnsFT2Page.tsx';
const RETURNS_OVERVIEW_PAGE = 'apps/frontend/src/pages/ft2-pages/ReturnsOverviewPage.tsx';
const RETURNS_SUPPLIERS_PAGE = 'apps/frontend/src/pages/ft2-pages/ReturnsSuppliersPage.tsx';
const RETURNS_CORRELATION_HOOK = 'apps/frontend/src/pages/returns/useReturnsCorrelation.ts';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
const TIERS_ORDERED: Tier[] = ['starter', 'core', 'growth', 'scale'];

/**
 * Widened view of the frozen canonical registry so a not-yet-existing
 * capability id can be *asserted about* without editing production types.
 */
const REGISTRY = CP.CAPABILITY_REQUIREMENTS as unknown as
  Record<string, CP.AccessRequirement | undefined>;

/**
 * The registry row for `id`, proven to exist first.
 *
 * This guard is load-bearing: `evaluateAccess(undefined, ctx)` returns ALLOWED
 * by design ("a nullish requirement means no gate"). Without it, every
 * returns.intake ALLOW row below would pass VACUOUSLY while the capability is
 * still missing — a false GREEN, not a contract.
 */
function requirementOrFail(id: string): CP.AccessRequirement {
  const req = REGISTRY[id];
  expect(req).toBeDefined();
  return req as CP.AccessRequirement;
}

function decideForStandardTier(id: string, tier: Tier): CP.AccessDecision {
  return CP.evaluateAccess(requirementOrFail(id), CP.standardContextForTier(tier));
}

/**
 * Bounded source slice for ONE route registration: from the `router.<verb>(`
 * that owns the given path literal, up to the next registration or the
 * module's `export default`. Deliberately narrower than a whole-file regex so
 * a match can only come from THIS route.
 */
function routeChunk(src: string, verb: string, pathLiteral: string): string {
  const needle = new RegExp(`router\\.${verb}\\(\\s*'${pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const m = needle.exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.search(/\n\nrouter\.|\nrouter\.|\nexport default/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Bounded slice for one `registerNavItem({ ... })` block, by its `id:`. */
function navItemChunk(src: string, id: string): string {
  return src.split('registerNavItem(').find((c) => c.includes(`id: '${id}'`)) ?? '';
}

/** Bounded slice for one nav CHILD entry `{ id: '<id>', ... }` on a single line. */
function navChildChunk(src: string, id: string): string {
  const line = src.split('\n').find((l) => l.includes(`id: '${id}'`) && l.includes('path:'));
  return line ?? '';
}

/** Bounded slice for one RETURNS_SUB_TABS entry, by its `id:`. */
function subTabChunk(src: string, id: string): string {
  const m = new RegExp(`\\{[^{}]*id:\\s*'${id}'[^{}]*\\}`, 's').exec(src);
  return m ? m[0] : '';
}

// ===========================================================================
// A — CANONICAL POLICY CONTRACT
// ===========================================================================

describe('RET-A1 — the canonical registry declares all three Returns capabilities', () => {
  it('EXPECTED RED: returns.intake exists in the CapabilityId registry', () => {
    expect(CP.isCapabilityId('returns.intake')).toBe(true);
    expect(REGISTRY['returns.intake']).toBeDefined();
  });

  it('EXPECTED RED: returns.intake requirement is { moduleId: returns, minimumTier: core }', () => {
    const req = requirementOrFail('returns.intake');
    expect(req.moduleId).toBe('returns');
    expect(req.minimumTier).toBe('core');
  });

  it('GREEN CONTROL: returns.core remains { moduleId: returns, minimumTier: core }', () => {
    const req = requirementOrFail('returns.core');
    expect(req.moduleId).toBe('returns');
    expect(req.minimumTier).toBe('core');
  });

  it('GREEN CONTROL: returns.analysis remains { moduleId: returns, minimumTier: growth, feature: returns.analysis }', () => {
    const req = requirementOrFail('returns.analysis');
    expect(req.moduleId).toBe('returns');
    expect(req.minimumTier).toBe('growth');
    expect(req.feature).toBe('returns.analysis');
  });
});

// ---------------------------------------------------------------------------
// The ratified standard-plan matrix.
//
//                     Starter   Core   Growth   Scale
//   returns.intake     DENY     ALLOW   ALLOW    ALLOW
//   returns.core       DENY     ALLOW   ALLOW    ALLOW
//   returns.analysis   DENY     DENY    ALLOW    ALLOW
// ---------------------------------------------------------------------------

const RATIFIED_MATRIX: Record<string, Record<Tier, boolean>> = {
  'returns.intake': { starter: false, core: true, growth: true, scale: true },
  'returns.core': { starter: false, core: true, growth: true, scale: true },
  'returns.analysis': { starter: false, core: false, growth: true, scale: true },
};

describe('RET-A2 — ratified standard-plan access matrix', () => {
  for (const capabilityId of Object.keys(RATIFIED_MATRIX)) {
    for (const tier of TIERS_ORDERED) {
      const expected = RATIFIED_MATRIX[capabilityId][tier];
      it(`${capabilityId} @ ${tier} => ${expected ? 'ALLOW' : 'DENY'}`, () => {
        expect(decideForStandardTier(capabilityId, tier).allowed).toBe(expected);
      });
    }
  }
});

describe('RET-A3 — Scale inherits every Returns capability', () => {
  it('no Returns capability denies Scale', () => {
    for (const capabilityId of Object.keys(RATIFIED_MATRIX)) {
      expect(decideForStandardTier(capabilityId, 'scale').allowed).toBe(true);
    }
  });
});

// ===========================================================================
// B — BACKEND ROUTE AUTHORITY CONTRACT
// ===========================================================================

const INTAKE_ROUTES: Array<[string, string]> = [
  ['get', '/jobs'],
  ['post', '/jobs'],
  ['get', '/jobs/:id'],
  ['post', '/jobs/:id/lines'],
  ['patch', '/jobs/:id/lines/:lineId'],
  ['post', '/jobs/:id/complete'],
];

const CORE_ROUTES: Array<[string, string]> = [
  ['get', '/'],
  ['get', '/settings'],
  ['patch', '/settings'],
  ['get', '/items'],
  ['patch', '/items/:id/decision'],
];

const ANALYSIS_ROUTES: Array<[string, string]> = [['get', '/correlation']];

describe('RET-B1 — returns.routes.ts declares the canonical capability per route class', () => {
  it.each(INTAKE_ROUTES)(
    'EXPECTED RED: %s %s requires returns.intake',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'returns\.intake'\s*\)/.test(chunk)).toBe(true);
    },
  );

  it.each(CORE_ROUTES)(
    'EXPECTED RED: %s %s requires returns.core',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'returns\.core'\s*\)/.test(chunk)).toBe(true);
    },
  );

  it.each(ANALYSIS_ROUTES)(
    'EXPECTED RED: %s %s requires returns.analysis',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'returns\.analysis'\s*\)/.test(chunk)).toBe(true);
    },
  );
});

describe('RET-B2 — no Returns route retains bespoke tier authority', () => {
  it('EXPECTED RED: zero requireTier(...) calls remain in returns.routes.ts', () => {
    const src = read(RETURNS_ROUTES);
    expect(src.match(/requireTier\(/g) ?? []).toHaveLength(0);
  });

  it('EXPECTED RED: requireTier is not imported by returns.routes.ts', () => {
    expect(/requireTier/.test(read(RETURNS_ROUTES))).toBe(false);
  });

  it('EXPECTED RED: no raw tier comparison is used as Returns route authority', () => {
    expect(/tier\s*===\s*'(?:starter|core|growth|scale)'/.test(read(RETURNS_ROUTES))).toBe(false);
  });
});

describe('RET-B3 — RBAC ownership is preserved, never absorbed by the commercial gate', () => {
  const ALL_ROUTES = [...INTAKE_ROUTES, ...CORE_ROUTES, ...ANALYSIS_ROUTES];

  it.each(ALL_ROUTES)(
    'GREEN CONTROL: %s %s keeps its own requireAction(...)',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireAction\(\s*'returns:[a-z:]+'\s*\)/.test(chunk)).toBe(true);
    },
  );

  it.each(ALL_ROUTES)(
    'EXPECTED RED: %s %s orders the chain requireCapability BEFORE requireAction',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      const capIdx = chunk.search(/requireCapability\(/);
      const actIdx = chunk.search(/requireAction\(/);
      expect(capIdx).toBeGreaterThan(-1);
      expect(actIdx).toBeGreaterThan(-1);
      expect(capIdx).toBeLessThan(actIdx);
    },
  );

  it.each(ALL_ROUTES)(
    'GREEN CONTROL: %s %s keeps authenticateToken + requireFt2 ahead of every gate',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(RETURNS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      const authIdx = chunk.search(/authenticateToken/);
      const ft2Idx = chunk.search(/requireFt2/);
      const actIdx = chunk.search(/requireAction\(/);
      expect(authIdx).toBeGreaterThan(-1);
      expect(ft2Idx).toBeGreaterThan(authIdx);
      expect(actIdx).toBeGreaterThan(ft2Idx);
    },
  );
});

// ===========================================================================
// D — FRONTEND NAVIGATION CONTRACT
// ===========================================================================

describe('RET-D1 — navBootstrap Returns nav declares canonical capability ids', () => {
  it('EXPECTED RED: the Returns parent declares capabilityId returns.core', () => {
    const chunk = navItemChunk(read(NAV_BOOTSTRAP), 'returns-resolution');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/capabilityId:\s*'returns\.core'/.test(chunk)).toBe(true);
  });

  it('EXPECTED RED: the Returns parent no longer declares a raw requiredTier', () => {
    const chunk = navItemChunk(read(NAV_BOOTSTRAP), 'returns-resolution');
    expect(chunk.length).toBeGreaterThan(0);
    // Bounded to the parent's own declaration, not the children lines below it.
    const parentHead = chunk.split('children:')[0];
    expect(/requiredTier:/.test(parentHead)).toBe(false);
  });

  it.each([
    ['returns', 'returns.core'],
    ['return-items', 'returns.core'],
    ['supplier-ratings', 'returns.analysis'],
  ])('EXPECTED RED: nav child %s declares capabilityId %s', (id, capabilityId) => {
    const chunk = navChildChunk(read(NAV_BOOTSTRAP), id);
    expect(chunk.length).toBeGreaterThan(0);
    expect(new RegExp(`capabilityId:\\s*'${capabilityId.replace('.', '\\.')}'`).test(chunk)).toBe(true);
  });

  it('EXPECTED RED: the Supplier Ratings nav child drops its raw requiredTier growth', () => {
    const chunk = navChildChunk(read(NAV_BOOTSTRAP), 'supplier-ratings');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requiredTier:\s*'growth'/.test(chunk)).toBe(false);
  });
});

describe('RET-D3 — the Returns route subtree is gated, not merely its nav entries', () => {
  it('EXPECTED RED: ReturnsFT2Page wraps its route subtree in CommercialGate returns.core', () => {
    // Nav/tab presentation is not a security boundary: ReturnsFT2Page mounts
    // ModuleTabBar + <Routes> with no gate, so a direct URL bypasses the
    // commercial decision entirely. CommercialGate exists precisely so a direct
    // URL resolves the SAME AccessDecision as the nav click.
    const src = read(RETURNS_FT2_PAGE);
    expect(/CommercialGate/.test(src)).toBe(true);
    expect(/capabilityId=["']returns\.core["']/.test(src)).toBe(true);
  });
});

describe('RET-D2 — returnsSubTabs declares canonical capability ids', () => {
  it.each([
    ['returns-overview', 'returns.core'],
    ['returns-items', 'returns.core'],
    ['returns-suppliers', 'returns.analysis'],
  ])('EXPECTED RED: sub-tab %s declares capabilityId %s', (id, capabilityId) => {
    const chunk = subTabChunk(read(RETURNS_SUB_TABS), id);
    expect(chunk.length).toBeGreaterThan(0);
    expect(new RegExp(`capabilityId:\\s*'${capabilityId.replace('.', '\\.')}'`).test(chunk)).toBe(true);
  });

  it('EXPECTED RED: no Returns sub-tab declares a raw requiredTier', () => {
    expect(/requiredTier:/.test(read(RETURNS_SUB_TABS))).toBe(false);
  });
});

// ===========================================================================
// G — LEGACY AUTHORITY RETIREMENT (Returns surfaces ONLY)
// ===========================================================================
//
// Deliberately scoped to the Returns surfaces. PlanGate / usePlanEntitlement
// still legitimately serve other unmigrated modules; other P0-A3 slices own
// their removal. Do NOT widen these into a global ban.

describe('RET-G1 — active Returns surfaces retire legacy commercial authority', () => {
  it.each([
    ['ReturnsOverviewPage', RETURNS_OVERVIEW_PAGE],
    ['ReturnsSuppliersPage', RETURNS_SUPPLIERS_PAGE],
  ])('EXPECTED RED: %s uses no PlanGate feature="returns.analysis"', (_name, rel) => {
    expect(/PlanGate[\s\S]{0,80}?feature=["']returns\.analysis["']/.test(read(rel))).toBe(false);
  });

  it.each([
    ['ReturnsOverviewPage', RETURNS_OVERVIEW_PAGE],
    ['ReturnsSuppliersPage', RETURNS_SUPPLIERS_PAGE],
  ])('EXPECTED RED: %s does not consume usePlanEntitlement for a Returns decision', (_name, rel) => {
    expect(/usePlanEntitlement/.test(read(rel))).toBe(false);
  });

  it.each([
    ['ReturnsOverviewPage', RETURNS_OVERVIEW_PAGE],
    ['ReturnsSuppliersPage', RETURNS_SUPPLIERS_PAGE],
  ])('EXPECTED RED: %s resolves returns.analysis through the canonical adapter', (_name, rel) => {
    const src = read(rel);
    expect(/useCommercialAccess|decideCapability|CommercialGate/.test(src)).toBe(true);
    expect(/returns\.analysis/.test(src)).toBe(true);
  });
});

// ===========================================================================
// H — DATA-ACQUISITION SEAM CONTRACT
// ===========================================================================

describe('RET-H1 — useReturnsCorrelation exposes a backward-compatible enable seam', () => {
  it('EXPECTED RED: the hook accepts an `enabled` parameter defaulting to true', () => {
    const src = read(RETURNS_CORRELATION_HOOK);
    expect(/export function useReturnsCorrelation\(\s*enabled\s*=\s*true\s*\)/.test(src)).toBe(true);
  });

  it('EXPECTED RED: `enabled` is forwarded into the React Query configuration', () => {
    const src = read(RETURNS_CORRELATION_HOOK);
    const options = /useQuery<[\s\S]*?>\(\{([\s\S]*?)\n\s*\}\);/.exec(src);
    expect(options).not.toBeNull();
    expect(/\benabled\b/.test((options as RegExpExecArray)[1])).toBe(true);
  });

  it('GREEN CONTROL: the acquisition contract of the hook is otherwise unchanged', () => {
    const src = read(RETURNS_CORRELATION_HOOK);
    expect(/queryKey:\s*\['returns',\s*'correlation'\]/.test(src)).toBe(true);
    expect(/'\/api\/v1\/modules\/returns\/correlation'/.test(src)).toBe(true);
    expect(/refetchInterval:\s*300_000/.test(src)).toBe(true);
    expect(/placeholderData:\s*\(prev\)\s*=>\s*prev/.test(src)).toBe(true);
  });
});

describe('RET-H2 — both Returns premium surfaces gate acquisition on the canonical decision', () => {
  it('EXPECTED RED: ReturnsOverviewPage passes an access boolean into useReturnsCorrelation', () => {
    const src = read(RETURNS_OVERVIEW_PAGE);
    const callSite = /useReturnsCorrelation\(([^)]*)\)/.exec(src);
    expect(callSite).not.toBeNull();
    expect((callSite as RegExpExecArray)[1].trim().length).toBeGreaterThan(0);
  });

  it('EXPECTED RED: ReturnsSuppliersPage consumes the SHARED hook and passes an access boolean', () => {
    // The suppliers page currently re-declares its own private copy of the
    // hook rather than importing the shared one, so an `enabled` seam added to
    // the shared hook would not reach this page at all.
    const src = read(RETURNS_SUPPLIERS_PAGE);
    expect(/function useReturnsCorrelation\(/.test(src)).toBe(false);
    expect(/import\s*\{[^}]*useReturnsCorrelation[^}]*\}\s*from/.test(src)).toBe(true);
    const callSite = /useReturnsCorrelation\(([^)]*)\)/.exec(src);
    expect(callSite).not.toBeNull();
    expect((callSite as RegExpExecArray)[1].trim().length).toBeGreaterThan(0);
  });
});
