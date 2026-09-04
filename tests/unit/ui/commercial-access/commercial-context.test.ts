// tests/unit/ui/commercial-access/commercial-context.test.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2B — TEST STRATEGY / RED
// ============================================================
// B1  — a frontend commercial-access adapter builds the AccessContext
//       { tier, modules: Set, flags: Set } = modulesForTier(tier) ∪ snapshot,
//       and every decision comes from evaluateAccess() (no duplicated
//       tier/module/feature logic — no private TIER_ORDER / PLAN_FEATURES copy).
// B18 — an unknown / missing CapabilityId resolves to a CLOSED decision, never
//       a Growth fallback.
//
// Pure test — no React render. The `frontend` Jest project cannot import
// `@lasyncro/commercial-policy` from source (no `.js`-extension resolver), so
// the engine-side semantics live in the CONTRACT-layer specs
// (commercial-route-enforcement.contract.test.ts B11/B13/B18). This file only
// asserts the FRONTEND ADAPTER exists and wires the shared engine.
//
// RED here is a clean assertion failure (adapter absent), never a
// module-resolution crash: the adapter is probed with try/require.

import * as fs from 'fs';
import * as path from 'path';

const ADAPTER_CANDIDATES = [
  'commercial/commercialContext',
  'commercial/commercialAccess',
  'navigation/commercialContext',
  'hooks/useCommercialAccess',
  'runtime/commercialContext',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: any = undefined;
for (const rel of ADAPTER_CANDIDATES) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    adapter = require(`../../../../apps/frontend/src/${rel}`);
    if (adapter) break;
  } catch {
    /* not this path — RED is asserted below, not thrown here */
  }
}

const buildContext =
  adapter?.buildCommercialContext ??
  adapter?.toAccessContext ??
  adapter?.commercialContextFromSnapshot ??
  adapter?.default;

const decideCapability =
  adapter?.decideCapability ?? adapter?.evaluateCapability ?? adapter?.can;

/** Source text of the adapter file if one exists, else ''. */
function adapterSource(): string {
  const root = path.resolve(__dirname, '../../../..');
  for (const rel of ADAPTER_CANDIDATES) {
    for (const ext of ['.ts', '.tsx']) {
      const p = path.join(root, 'apps/frontend/src', rel + ext);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
  }
  return '';
}

// The canonical Growth standard module/flag floor, mirrored as literal data
// (see nav-surface-parity.test.tsx for why the frontend project mirrors).
const GROWTH_MODULES = [
  'overview', 'order-nexus', 'fulfillment', 'alerts', 'shopify_integration',
  'specter_sdk_free', 'wms', 'barcodes', 'suppliers-portal', 'returns', 'products',
  'problem-center', 'customers', 'finances', 'demand', 'specter', 'floor-planning',
];
const GROWTH_FLAGS = [
  'wms.analytics', 'demand.forecasting', 'alerts.rules', 'returns.analysis',
  'exports.column_selection', 'specter.full_capture',
];

// ===========================================================================
// B1 — frontend commercial-access adapter
// ===========================================================================
describe('B1 — frontend commercial-access adapter', () => {
  it('EXPECTED RED: a frontend adapter file exists and imports the shared engine', () => {
    const src = adapterSource();
    expect(src.length).toBeGreaterThan(0);
    expect(/@lasyncro\/commercial-policy/.test(src)).toBe(true);
    expect(/evaluateAccess/.test(src)).toBe(true);
    expect(/modulesForTier/.test(src) && /flagsForTier/.test(src)).toBe(true);
    // No re-implemented tier/module/feature logic.
    expect(/^\s*(?:export\s+)?const\s+TIER_ORDER\b/m.test(src)).toBe(false);
    expect(/PLAN_FEATURES/.test(src)).toBe(false);
  });

  it('EXPECTED RED: adapter exposes a context builder', () => {
    expect(typeof buildContext).toBe('function');
  });

  it('EXPECTED RED: context modules = tier floor ∪ snapshot.modules (additive)', () => {
    expect(typeof buildContext).toBe('function'); // RED gate — clean failure
    const ctx = buildContext({ tier: 'growth', snapshot: { modules: new Set(['echo-hub']), flags: new Set() } });
    const modules: Set<string> = ctx.modules;
    expect(ctx.tier).toBe('growth');
    for (const m of GROWTH_MODULES) expect({ m, has: modules.has(m) }).toEqual({ m, has: true });
    expect(modules.has('echo-hub')).toBe(true);
  });

  it('EXPECTED RED: context flags = tier floor ∪ snapshot.flags (additive)', () => {
    expect(typeof buildContext).toBe('function');
    const ctx = buildContext({ tier: 'growth', snapshot: { modules: new Set(), flags: new Set(['custom.flag']) } });
    const flags: Set<string> = ctx.flags;
    expect(ctx.tier).toBe('growth');
    for (const f of GROWTH_FLAGS) expect({ f, has: flags.has(f) }).toEqual({ f, has: true });
    expect(flags.has('custom.flag')).toBe(true);
  });

  it('EXPECTED RED: zero-snapshot still yields the tier floor (no rows-only regression)', () => {
    expect(typeof buildContext).toBe('function');
    const ctx = buildContext({ tier: 'growth', snapshot: { modules: new Set(), flags: new Set() } });
    expect(ctx.tier).toBe('growth');
    expect(ctx.modules).toBeInstanceOf(Set);
    expect(ctx.flags).toBeInstanceOf(Set);
    expect((ctx.modules as Set<string>).size).toBeGreaterThan(0);
    expect((ctx.modules as Set<string>).has('floor-planning')).toBe(true);
  });
});

// ===========================================================================
// B18 — unknown capability fails closed (never a Growth fallback)
// ===========================================================================
describe('B18 — unknown CapabilityId fails closed', () => {
  it('EXPECTED RED: adapter exposes a capability decision function', () => {
    expect(typeof decideCapability).toBe('function');
  });

  it('EXPECTED RED: an unknown capability id resolves to a closed decision, not an allow, not a Growth step', () => {
    expect(typeof decideCapability).toBe('function'); // RED gate
    const ctx = (buildContext ?? (() => ({})))({ tier: 'scale', snapshot: { modules: new Set(), flags: new Set() } });
    const d = decideCapability('warehouse.__not_a_real_capability__', ctx);
    expect(d?.allowed).toBe(false);
    expect(d?.requiredTier).not.toBe('growth');
  });
});
