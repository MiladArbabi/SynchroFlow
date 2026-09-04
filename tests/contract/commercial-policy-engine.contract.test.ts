// COMMERCIAL-ACCESS-ARCH-01 / COMMERCIAL-ACCESS-COVERAGE-01 — Slice P0-A1
// =====================================================================
// RED contracts for the PURE canonical commercial-policy engine.
//
// P0-A1 makes @lasyncro/commercial-policy own:
//   Tier · TIERS · TIER_ORDER · tierAtLeast()
//   modulesForTier() · flagsForTier() · standard plan limits
//   ModuleId · FeatureKey · CapabilityId registries
//   AccessRequirement · AccessContext · AccessDecision · evaluateAccess()
//   CAPABILITY_REQUIREMENTS  (one requirement per ACTIVE capability)
//
// It does NOT roll policy into nav / tabs / routes / middleware — that is
// P0-A2/A3 (commercial-route-enforcement + nav-surface-parity stay RED).
//
// The package physically exists (P0-A0) and resolves; a namespace import
// never throws on a missing member, so every assertion below fails with a
// clean "received undefined" rather than a module-resolution crash. All of
// this file is EXPECTED RED until P0-A1 implements the engine.
//
// Ratified inputs (this brief — treat as CLOSED):
//   starter(0) < core(1) < growth(2) < scale(3); higher satisfies lower.
//   Standard module/flag sets are monotonic; Scale has every standard
//   capability; Scale standard limits are Infinity.
//   Active capability policy: the ACTIVE_CAPABILITY_POLICY table below.
//   Finances / Cash Flow are DISABLED / LEGACY, not active paid capabilities.
//   Warehouse Analytics => { moduleId:'wms', minimumTier:'growth',
//   feature:'wms.analytics' } — NEVER feature 'wms.pick_batches'.

import * as CP from '@lasyncro/commercial-policy';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
const ALL_TIERS: Tier[] = ['starter', 'core', 'growth', 'scale'];
const RANK: Record<Tier, number> = { starter: 0, core: 1, growth: 2, scale: 3 };

// ---------------------------------------------------------------------------
// Ratified ACTIVE capability policy (this IS the contract P0-A1 must satisfy)
// minTier omitted => Starter+ (no tier wall). feature omitted => module/tier only.
// ---------------------------------------------------------------------------
interface CapPolicy {
  moduleId?: string; // exports.* are tier-only, no module (ratified §6)
  minTier?: Tier;
  feature?: string;
}
const ACTIVE_CAPABILITY_POLICY: Record<string, CapPolicy> = {
  'overview.core':               { moduleId: 'overview' },
  'overview.live_map':           { moduleId: 'overview',        minTier: 'growth' },
  'orders.core':                 { moduleId: 'order-nexus' },
  'inventory.core':              { moduleId: 'products',        minTier: 'core' },
  'demand.forecasting':          { moduleId: 'demand',          minTier: 'growth', feature: 'demand.forecasting' },
  'alerts.inbox':                { moduleId: 'alerts' },
  'alerts.rules':                { moduleId: 'alerts',          minTier: 'growth', feature: 'alerts.rules' },
  'returns.core':                { moduleId: 'returns',         minTier: 'core' },
  'returns.analysis':            { moduleId: 'returns',         minTier: 'growth', feature: 'returns.analysis' },
  'warehouse.operations':        { moduleId: 'wms' },
  'warehouse.analytics':         { moduleId: 'wms',             minTier: 'growth', feature: 'wms.analytics' },
  'warehouse.floor_planning':    { moduleId: 'floor-planning',  minTier: 'growth' },
  'warehouse.problem_center':    { moduleId: 'problem-center',  minTier: 'core' },
  'purchasing.core':             { moduleId: 'suppliers-portal' },
  'exports.core':                {                             minTier: 'core' },
  'exports.column_selection':    {                             minTier: 'growth', feature: 'exports.column_selection' },
  'specter.full_capture':        { moduleId: 'specter',         minTier: 'growth', feature: 'specter.full_capture' },
};
const ACTIVE_CAPABILITY_IDS = Object.keys(ACTIVE_CAPABILITY_POLICY);

const REQUIRED_CANONICAL_MODULES = [
  'overview', 'order-nexus', 'products', 'returns', 'demand', 'wms',
  'floor-planning', 'problem-center', 'suppliers-portal', 'alerts', 'specter',
];
const REQUIRED_CANONICAL_FEATURES: Record<string, Tier> = {
  'wms.analytics':             'growth',
  'demand.forecasting':        'growth',
  'alerts.rules':              'growth',
  'returns.analysis':          'growth',
  'exports.column_selection':  'growth',
  'specter.full_capture':      'growth',
};

// ---------------------------------------------------------------------------
// Thin helpers over the (not-yet-existing) engine. Optional chaining keeps
// every failure a clean assertion failure, never a thrown resolution error.
// ---------------------------------------------------------------------------
function modulesForTier(t: Tier): Set<string> {
  const v = (CP as any).modulesForTier?.(t);
  return v instanceof Set ? v : new Set(Array.isArray(v) ? v : []);
}
function flagsForTier(t: Tier): Set<string> {
  const v = (CP as any).flagsForTier?.(t);
  return v instanceof Set ? v : new Set(Array.isArray(v) ? v : []);
}
/** Context for a shop on `tier` holding exactly that tier's standard grants. */
function standardContext(tier: Tier) {
  return { tier, modules: modulesForTier(tier), flags: flagsForTier(tier) };
}
function decide(reqName: string, ctx: unknown): { allowed?: boolean; reason?: string } {
  const req = (CP as any).CAPABILITY_REQUIREMENTS?.[reqName];
  const d = (CP as any).evaluateAccess?.(req, ctx);
  return d ?? {};
}

// ===========================================================================
// A1-C1 — CANONICAL TIER SOURCE
// ===========================================================================
describe('A1-C1 — canonical tier source', () => {
  it('EXPECTED RED: exports Tier list, TIER_ORDER and tierAtLeast()', () => {
    expect((CP as any).TIERS).toEqual(['starter', 'core', 'growth', 'scale']);
    expect((CP as any).TIER_ORDER).toEqual({ starter: 0, core: 1, growth: 2, scale: 3 });
    expect(typeof (CP as any).tierAtLeast).toBe('function');
  });

  it('EXPECTED RED: tierAtLeast is a correct monotonic comparator', () => {
    const at = (CP as any).tierAtLeast;
    for (const a of ALL_TIERS) {
      for (const b of ALL_TIERS) {
        expect(at?.(a, b)).toBe(RANK[a] >= RANK[b]);
      }
    }
  });
});

// ===========================================================================
// A1-C2 — PLAN MONOTONICITY (standard modules + features)
// ===========================================================================
describe('A1-C2 — plan monotonicity', () => {
  it('EXPECTED RED: modules(starter) ⊆ core ⊆ growth ⊆ scale', () => {
    const chain = ALL_TIERS.map(modulesForTier);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i - 1].size).toBeGreaterThan(0);
      for (const m of chain[i - 1]) expect(chain[i].has(m)).toBe(true);
    }
  });

  it('EXPECTED RED: standard features(starter) ⊆ core ⊆ growth ⊆ scale', () => {
    const chain = ALL_TIERS.map(flagsForTier);
    // Growth must actually carry the standard flag set (guards against a stub
    // that returns empty sets for every tier).
    expect(chain[RANK.growth].size).toBeGreaterThan(0);
    expect(chain[RANK.scale].size).toBe(chain[RANK.growth].size);
    for (let i = 1; i < chain.length; i++) {
      for (const f of chain[i - 1]) expect(chain[i].has(f)).toBe(true);
    }
  });
});

// ===========================================================================
// A1-C3 — SCALE SUPREMACY (table-driven from the registry)
// ===========================================================================
describe('A1-C3 — Scale satisfies every active standard capability', () => {
  it.each(ACTIVE_CAPABILITY_IDS)('EXPECTED RED: %s allowed for a standard Scale shop', (cap) => {
    const d = decide(cap, standardContext('scale'));
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('ALLOWED');
  });
});

// ===========================================================================
// A1-C4 — SCALE UNLIMITED
// ===========================================================================
describe('A1-C4 — Scale standard limits are unlimited', () => {
  it('EXPECTED RED: no finite standard Scale limit', () => {
    const limits = (CP as any).standardLimits?.('scale') ?? (CP as any).PLAN_LIMITS?.scale;
    expect(limits).toBeDefined();
    expect(limits?.monthlyOrderCap).toBe(Infinity);
    expect(limits?.shippedOrderCap).toBe(Infinity);
    expect(limits?.seatLimit).toBe(Infinity);
    expect(limits?.specterSessionCap).toBe(Infinity);
  });
});

// ===========================================================================
// A1-C5 — MODULE-ID INTEGRITY
// ===========================================================================
describe('A1-C5 — canonical ModuleId registry', () => {
  it('EXPECTED RED: contains `wms` and `suppliers-portal`, never `wms-lite`', () => {
    const ids: string[] = (CP as any).MODULE_IDS ?? Object.keys((CP as any).MODULE_REGISTRY ?? {});
    expect(ids).toContain('wms');
    expect(ids).toContain('suppliers-portal');
    expect(ids).not.toContain('wms-lite');
  });

  it('EXPECTED RED: `suppliers-portal` is a Starter standard module (inherited by all higher tiers)', () => {
    for (const t of ALL_TIERS) {
      expect(modulesForTier(t).has('suppliers-portal')).toBe(true);
    }
  });

  it('EXPECTED RED: every active-capability moduleId is a canonical ModuleId', () => {
    const ids = new Set<string>((CP as any).MODULE_IDS ?? Object.keys((CP as any).MODULE_REGISTRY ?? {}));
    expect(ids.size).toBeGreaterThan(0);
    for (const cap of ACTIVE_CAPABILITY_IDS) {
      const mod = ACTIVE_CAPABILITY_POLICY[cap].moduleId;
      if (mod) expect(ids.has(mod)).toBe(true);
    }
  });
});

// ===========================================================================
// A1-C6 — FEATURE INTEGRITY
// ===========================================================================
describe('A1-C6 — canonical FeatureKey registry', () => {
  it.each(Object.entries(REQUIRED_CANONICAL_FEATURES))(
    'EXPECTED RED: feature %s has exactly one minimum tier = %s',
    (key, minTier) => {
      const map = (CP as any).FEATURE_MIN_TIER ?? {};
      const fn = (CP as any).featureMinTier;
      const resolved = typeof fn === 'function' ? fn(key) : map[key];
      expect(resolved).toBe(minTier);
    },
  );

  it('EXPECTED RED: Warehouse Analytics feature is wms.analytics, not wms.pick_batches', () => {
    const req = (CP as any).CAPABILITY_REQUIREMENTS?.['warehouse.analytics'];
    expect(req?.feature).toBe('wms.analytics');
    expect(req?.feature).not.toBe('wms.pick_batches');
  });
});

// ===========================================================================
// A1-C7 — CAPABILITY REQUIREMENT INTEGRITY
// ===========================================================================
describe('A1-C7 — every active capability resolves to exactly one clean requirement', () => {
  it.each(ACTIVE_CAPABILITY_IDS)('EXPECTED RED: %s — single canonical, non-contradictory requirement', (cap) => {
    const reg = (CP as any).CAPABILITY_REQUIREMENTS ?? {};
    const req = reg[cap];
    const expected = ACTIVE_CAPABILITY_POLICY[cap];

    expect(req).toBeDefined();
    expect(req?.moduleId).toBe(expected.moduleId);
    expect(req?.minimumTier).toBe(expected.minTier); // undefined === undefined for Starter+
    expect(req?.feature).toBe(expected.feature);

    // canonical id references only
    const modIds = new Set<string>((CP as any).MODULE_IDS ?? []);
    if (modIds.size && req?.moduleId) expect(modIds.has(req.moduleId)).toBe(true);

    // no contradiction: a feature's own min tier cannot exceed the requirement's min tier
    if (req?.feature && req?.minimumTier) {
      const fmt = (CP as any).featureMinTier?.(req.feature) ?? (CP as any).FEATURE_MIN_TIER?.[req.feature];
      if (fmt) expect(RANK[fmt as Tier]).toBeLessThanOrEqual(RANK[req.minimumTier as Tier]);
    }
  });
});

// ===========================================================================
// A1-C8 — RATIFIED TIER MATRIX  (deterministic capability × tier truth table)
// ===========================================================================
describe('A1-C8 — ratified capability × tier matrix', () => {
  const cases: Array<[string, Tier, 'ALLOW' | 'DENY']> = [];
  for (const cap of ACTIVE_CAPABILITY_IDS) {
    const min = ACTIVE_CAPABILITY_POLICY[cap].minTier;
    for (const tier of ALL_TIERS) {
      const allow = !min || RANK[tier] >= RANK[min];
      cases.push([cap, tier, allow ? 'ALLOW' : 'DENY']);
    }
  }
  it.each(cases)('EXPECTED RED: %s @ %s => %s', (cap, tier, expected) => {
    const d = decide(cap, standardContext(tier));
    expect(d.allowed).toBe(expected === 'ALLOW');
    if (expected === 'DENY') expect(d.reason).toBe('TIER_TOO_LOW');
  });
});

// ===========================================================================
// A1-C9 — DENIAL REASON ORDERING (first failure wins: tier → module → feature → role)
// ===========================================================================
describe('A1-C9 — first failure wins', () => {
  const req = { moduleId: 'demand', minimumTier: 'growth' as Tier, feature: 'demand.forecasting' };

  it('EXPECTED RED: Starter + missing module + missing feature => TIER_TOO_LOW', () => {
    const d = (CP as any).evaluateAccess?.(req, { tier: 'starter', modules: new Set(), flags: new Set() }) ?? {};
    expect(d.reason).toBe('TIER_TOO_LOW');
  });

  it('EXPECTED RED: Scale + missing module + missing feature => MODULE_NOT_INCLUDED', () => {
    const d = (CP as any).evaluateAccess?.(req, { tier: 'scale', modules: new Set(), flags: new Set() }) ?? {};
    expect(d.reason).toBe('MODULE_NOT_INCLUDED');
  });

  it('EXPECTED RED: Scale + module present + missing feature => FEATURE_NOT_INCLUDED', () => {
    const d = (CP as any).evaluateAccess?.(req, { tier: 'scale', modules: new Set(['demand']), flags: new Set() }) ?? {};
    expect(d.reason).toBe('FEATURE_NOT_INCLUDED');
  });

  it('EXPECTED RED: Scale + full commercial access + disallowed action => ROLE_FORBIDDEN', () => {
    // commercial-policy does not own the shop-configurable role→action map;
    // the caller supplies the resolved allowedActions set. Empty set here => the
    // user may not perform suppliers:write.
    const roleReq = { moduleId: 'suppliers-portal', action: 'suppliers:write' };
    const d = (CP as any).evaluateAccess?.(roleReq, {
      tier: 'scale', modules: new Set(['suppliers-portal']), flags: new Set(),
      allowedActions: new Set<string>(),
    }) ?? {};
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ROLE_FORBIDDEN');
  });

  it('EXPECTED RED: full standard access => ALLOWED', () => {
    const d = (CP as any).evaluateAccess?.(req, standardContext('growth')) ?? {};
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('ALLOWED');
  });
});

// ===========================================================================
// A1-C10 — DISABLED / LEGACY CLASSIFICATION
// ===========================================================================
describe('A1-C10 — disabled / legacy surfaces are not active paid capabilities', () => {
  it('EXPECTED RED: Finances / Cash Flow are not in the ACTIVE capability registry', () => {
    const active = new Set<string>(Object.keys((CP as any).CAPABILITY_REQUIREMENTS ?? {}));
    // engine must be present for this assertion to be meaningful
    expect((CP as any).CAPABILITY_REQUIREMENTS).toBeDefined();
    expect(active.has('finances.core')).toBe(false);
    expect(active.has('finances.cashflow')).toBe(false);
    expect(active.has('cashflow.revenue_buckets')).toBe(false);
  });

  it('EXPECTED RED: the catalog explicitly classifies Finances/Cash Flow as disabled/legacy', () => {
    const catalog = (CP as any).CAPABILITY_CATALOG ?? (CP as any).CATALOG;
    expect(catalog).toBeDefined();
    const entry =
      catalog?.['finances.core'] ?? catalog?.['finances.cashflow'] ?? catalog?.['cashflow.revenue_buckets'];
    expect(entry).toBeDefined();
    const status = entry?.status ?? entry?.classification;
    expect(['disabled', 'legacy']).toContain(status);
  });

  it('EXPECTED RED: internal / grant-only module ids are classified, not silently dropped', () => {
    const cls = (CP as any).MODULE_CLASSIFICATION ?? {};
    expect((CP as any).MODULE_CLASSIFICATION).toBeDefined();
    expect(cls['echo-hub']).toBe('grant_only');
    expect(cls['shopify_integration']).toBe('internal');
    expect(cls['specter_sdk_free']).toBe('internal');
    expect(cls['barcodes']).toBe('internal');
    expect(['standard']).toContain(cls['wms']);
    expect(['standard']).toContain(cls['suppliers-portal']);
  });
});

// ===========================================================================
// A1-C14 — ACTIVE CATALOG INVENTORY
// ===========================================================================
describe('A1-C14 — active catalog contains every ratified active capability', () => {
  it('EXPECTED RED: CAPABILITY_REQUIREMENTS covers all ratified active CapabilityIds', () => {
    const reg = (CP as any).CAPABILITY_REQUIREMENTS ?? {};
    for (const cap of ACTIVE_CAPABILITY_IDS) {
      expect(Object.prototype.hasOwnProperty.call(reg, cap)).toBe(true);
    }
  });

  it('EXPECTED RED: no active CapabilityId is a free-form string outside the typed registry', () => {
    // Every key of the registry must also be a member of the exported CapabilityId union proxy.
    const known: string[] = (CP as any).CAPABILITY_IDS ?? Object.keys((CP as any).CAPABILITY_REQUIREMENTS ?? {});
    expect(known.length).toBeGreaterThan(0);
    for (const cap of Object.keys((CP as any).CAPABILITY_REQUIREMENTS ?? {})) {
      expect(known).toContain(cap);
    }
  });
});

// ===========================================================================
// A1-C15 — NO UNKNOWN POLICY IN ACTIVE REGISTRY
// ===========================================================================
describe('A1-C15 — active capabilities have a resolved business policy', () => {
  it.each(ACTIVE_CAPABILITY_IDS)('EXPECTED RED: %s carries no openDecision flag', (cap) => {
    const req = (CP as any).CAPABILITY_REQUIREMENTS?.[cap];
    expect(req).toBeDefined();
    expect(req?.openDecision).toBeFalsy();
  });
});
