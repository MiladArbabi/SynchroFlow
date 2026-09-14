// tests/contract/commercial-remodel-align.contract.test.ts
//
// COMMERCIAL-REMODEL-ALIGN-01 — permanent contracts for the ratified commercial
// remodel. PURE / CONTRACT layer: evaluates the canonical policy engine and
// reads production source as text. No React, no DB, no server.
// ===========================================================================
// Scope note. This file adds ONLY the contracts the remodel newly requires.
// Deliberately NOT duplicated here, because strong permanent owners already
// exist and re-stating them would create two sources of truth:
//
//   C1  tier monotonicity ............ commercial-access-policy C1
//                                      commercial-policy-engine A1-C2 / A1-C3
//   C5  Starter WMS boundary ......... commercial-policy-engine A1-C8 matrix
//                                      commercial-access-policy C11
//                                      returns-commercial-access (returns.intake)
//   C6  canonical standard limits .... commercial-policy-ownership A1-C13
//   C7  fulfilled-order allowance .... tests/integration/wms/
//                                      shipped-order-commercial-enforcement
//                                      (MON-ALLOW-04 COMMERCIAL-01…05)
//   C10 legacy containment ........... commercial-policy-ownership A1-C11
//
// LEGACY_MODULES_BY_TIER is deliberately NOT asserted anywhere in this file. It
// stays frozen by ratified decision; canonical modulesForTier() is access truth.

import fs from 'fs';
import path from 'path';

import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const ORDER_INGEST_HANDLER = 'apps/backend/src/api/shopify/handlers/handleOrderCreated.ts';
const ENTITLEMENTS_SERVICE = 'packages/backend-core/src/services/entitlements.service.ts';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
const TIERS: Tier[] = ['starter', 'core', 'growth', 'scale'];

/** Widened view of the frozen registry so a not-yet-existing id can be asserted about. */
const REGISTRY = CP.CAPABILITY_REQUIREMENTS as unknown as
  Record<string, CP.AccessRequirement | undefined>;

/**
 * The registry row for `id`, proven to exist FIRST.
 *
 * Load-bearing: evaluateAccess(undefined, ctx) returns ALLOWED by design ("a
 * nullish requirement means no gate"), so without this guard every ALLOW row in
 * a matrix for a missing capability would pass vacuously.
 */
function requirementOrFail(id: string): CP.AccessRequirement {
  const req = REGISTRY[id];
  expect(req).toBeDefined();
  return req as CP.AccessRequirement;
}

function decide(id: string, tier: Tier): CP.AccessDecision {
  return CP.evaluateAccess(requirementOrFail(id), CP.standardContextForTier(tier));
}

const modules = (t: Tier): ReadonlySet<string> => CP.modulesForTier(t);

// ===========================================================================
// C2 — ACTIVE STANDARD MODULE MATRIX
// ===========================================================================

/** Paused or deprecated product areas. Never a standard commercial grant. */
const NON_ACTIVE_MODULES = ['finances', 'customers', 'specter'] as const;

describe('CRA-C2 — active standard module matrix', () => {
  it('GREEN CONTROL: Starter carries the active Starter operational set', () => {
    // The Starter foundation: overview, inventory/products, and alert inbox.
    for (const m of [
      'overview',
      'products',
      'alerts',
    ]) {
      expect(modules('starter').has(m)).toBe(true);
    }
  });

  it('EXPECTED RED: Starter has no full Orders Flow, WMS/barcode execution, or Returns', () => {
    for (const m of ['order-nexus', 'fulfillment', 'wms', 'barcodes', 'returns']) {
      expect(modules('starter').has(m)).toBe(false);
    }
  });

  it('EXPECTED RED: Starter has NO Purchasing — suppliers-portal is Growth+', () => {
    // Ratified remodel: Starter has no Purchasing surface at all.
    expect(modules('starter').has('suppliers-portal')).toBe(false);
  });

  it('EXPECTED RED: Core adds orders, WMS, returns and exports foundations', () => {
    for (const m of ['order-nexus', 'fulfillment', 'wms', 'returns']) {
      expect(modules('core').has(m)).toBe(true);
    }
    expect(decide('exports.core', 'core').allowed).toBe(true);
  });

  it('GREEN CONTROL: Growth adds optimization, intelligence and purchasing surfaces', () => {
    for (const m of ['demand', 'floor-planning', 'problem-center', 'suppliers-portal']) {
      expect(modules('growth').has(m)).toBe(true);
    }
  });

  it('EXPECTED RED: Scale adds no commercial module wall over Growth', () => {
    // Scale is "everything Growth has, without limits" — never a distinct
    // module set. Compared as sorted arrays so the failure prints the delta.
    expect([...modules('scale')].sort()).toEqual([...modules('growth')].sort());
  });

  it.each(NON_ACTIVE_MODULES)(
    'EXPECTED RED: `%s` is NEVER a standard grant at ANY tier',
    (moduleId) => {
      // The critical rule of the remodel. A paused or deprecated area must not
      // be sold, at any tier, even implicitly through a tier module set.
      for (const t of TIERS) {
        expect({ tier: t, module: moduleId, granted: modules(t).has(moduleId) }).toEqual({
          tier: t,
          module: moduleId,
          granted: false,
        });
      }
    },
  );
});

// ===========================================================================
// C3 — LIFECYCLE: paused vs deprecated
// ===========================================================================

/** Widened catalog view — `paused`/`deprecated` do not exist in the type yet. */
const CATALOG = CP.CAPABILITY_CATALOG as unknown as
  Record<string, { status: string; requirement?: CP.AccessRequirement; note?: string } | undefined>;

const ACTIVE_IDS = (CP.ACTIVE_CAPABILITY_IDS ?? []) as readonly string[];

describe('CRA-C3 — commercial lifecycle distinguishes paused from deprecated', () => {
  it('EXPECTED RED: the catalog expresses a `paused` status', () => {
    // Finances may return in a future release — materially different from
    // Customers/Specter, which are not expected to return. One `legacy` bucket
    // cannot carry that distinction, and the difference drives whether cleanup
    // is ever scheduled.
    const statuses = new Set(Object.values(CATALOG).map((e) => e?.status));
    expect([...statuses]).toContain('paused');
  });

  it('EXPECTED RED: the catalog expresses a `deprecated` status', () => {
    const statuses = new Set(Object.values(CATALOG).map((e) => e?.status));
    expect([...statuses]).toContain('deprecated');
  });

  it('EXPECTED RED: Finances is PAUSED (may return)', () => {
    const financeEntries = Object.entries(CATALOG).filter(([id]) => id.startsWith('finances.'));
    expect(financeEntries.length).toBeGreaterThan(0);
    for (const [, entry] of financeEntries) {
      expect(entry?.status).toBe('paused');
    }
  });

  it('EXPECTED RED: Customers is DEPRECATED (not expected to return)', () => {
    const customerEntries = Object.entries(CATALOG).filter(([id]) => id.startsWith('customers.'));
    expect(customerEntries.length).toBeGreaterThan(0);
    for (const [, entry] of customerEntries) {
      expect(entry?.status).toBe('deprecated');
    }
  });

  it('EXPECTED RED: Specter is DEPRECATED and has a catalog entry at all', () => {
    const specterEntries = Object.entries(CATALOG).filter(([id]) => id.startsWith('specter.'));
    expect(specterEntries.length).toBeGreaterThan(0);
    for (const [, entry] of specterEntries) {
      expect(entry?.status).toBe('deprecated');
    }
  });

  it.each(['finances', 'customers', 'specter'])(
    'EXPECTED RED: no ACTIVE capability belongs to the paused/deprecated area `%s`',
    (area) => {
      // Absent from ACTIVE_CAPABILITY_IDS...
      expect(ACTIVE_IDS.filter((id) => id.startsWith(`${area}.`))).toEqual([]);
      // ...and carrying no live AccessRequirement, so nothing can evaluate them
      // as if they were a live paid gate.
      const live = Object.keys(REGISTRY).filter((id) => id.startsWith(`${area}.`));
      expect(live).toEqual([]);
    },
  );

  it('GREEN CONTROL: paused/deprecated entries carry no AccessRequirement in the catalog', () => {
    for (const [id, entry] of Object.entries(CATALOG)) {
      if (!entry || entry.status === 'active') continue;
      expect({ id, hasRequirement: entry.requirement !== undefined })
        .toEqual({ id, hasRequirement: false });
    }
  });
});

// ===========================================================================
// C4 — PURCHASING SPLIT
// ===========================================================================

describe('CRA-C4 — purchasing.core and purchasing.sourcing are Growth+', () => {
  it('EXPECTED RED: purchasing.core requires module suppliers-portal at minimumTier growth', () => {
    const req = requirementOrFail('purchasing.core');
    expect(req.moduleId).toBe('suppliers-portal');
    expect(req.minimumTier).toBe('growth');
  });

  it('EXPECTED RED: purchasing.sourcing exists and requires suppliers-portal at growth', () => {
    // ADVANCED SOURCING — recommendations, worklist, supplier-product preference
    // intelligence, reorder/MOQ accumulation intelligence.
    expect(CP.isCapabilityId('purchasing.sourcing')).toBe(true);
    const req = requirementOrFail('purchasing.sourcing');
    expect(req.moduleId).toBe('suppliers-portal');
    expect(req.minimumTier).toBe('growth');
  });

  const MATRIX: Record<string, Record<Tier, boolean>> = {
    'purchasing.core': { starter: false, core: false, growth: true, scale: true },
    'purchasing.sourcing': { starter: false, core: false, growth: true, scale: true },
  };

  for (const capabilityId of Object.keys(MATRIX)) {
    for (const tier of TIERS) {
      const expected = MATRIX[capabilityId][tier];
      it(`EXPECTED RED: ${capabilityId} @ ${tier} => ${expected ? 'ALLOW' : 'DENY'}`, () => {
        expect(decide(capabilityId, tier).allowed).toBe(expected);
      });
    }
  }

  // -------------------------------------------------------------------------
  // P0-A3-5 / PUR-C1 — an ADDITIVE module grant is not a tier upgrade.
  //
  // `suppliers-portal` is the module BOTH purchasing capabilities require, and
  // it is grantable additively (persisted shop_module_entitlements union with
  // the tier floor). Holding the module must never unlock either capability
  // below its ratified minimum tier: evaluateAccess is FIRST-FAILURE-WINS and
  // checks minimumTier before moduleId, so the denial must stay TIER_TOO_LOW.
  // -------------------------------------------------------------------------
  /** Context for `tier` with suppliers-portal additively granted on top of the floor. */
  function tierFloorPlusSuppliersPortal(tier: Tier): CP.AccessContext {
    const base = CP.standardContextForTier(tier);
    return { ...base, modules: new Set([...base.modules, 'suppliers-portal']) };
  }

  it('GREEN CONTROL: an additive suppliers-portal grant does not unlock purchasing.core below Growth', () => {
    const d = CP.evaluateAccess(requirementOrFail('purchasing.core'), tierFloorPlusSuppliersPortal('starter'));
    expect({ allowed: d.allowed, reason: d.reason, requiredTier: d.requiredTier })
      .toEqual({ allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'growth' });
  });

  it.each<[Tier]>([['starter'], ['core']])(
    'GREEN CONTROL: an additive suppliers-portal grant does not unlock purchasing.sourcing at %s',
    (tier) => {
      const d = CP.evaluateAccess(requirementOrFail('purchasing.sourcing'), tierFloorPlusSuppliersPortal(tier));
      expect({ allowed: d.allowed, reason: d.reason, requiredTier: d.requiredTier })
        .toEqual({ allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'growth' });
    },
  );

  it('GREEN CONTROL: the additive grant is genuinely present (the DENY above is a tier wall, not a missing module)', () => {
    for (const tier of TIERS) {
      expect({ tier, has: tierFloorPlusSuppliersPortal(tier).modules.has('suppliers-portal') })
        .toEqual({ tier, has: true });
    }
    // ...and the Starter/Core FLOOR genuinely lacks it — Purchasing is Growth+.
    expect(modules('starter').has('suppliers-portal')).toBe(false);
    expect(modules('core').has('suppliers-portal')).toBe(false);
    expect(modules('growth').has('suppliers-portal')).toBe(true);
  });
});

// ===========================================================================
// C7 (gap only) — INGESTION IS NEVER BLOCKED BY A COMMERCIAL LIMIT
//
// The fulfilled/WMS-completed allowance is already owned end-to-end by
// tests/integration/wms/shipped-order-commercial-enforcement.test.ts. The one
// genuinely uncovered half is the ingestion side: Shopify order truth must
// always land, because dropping orders at a plan limit creates an
// unrecoverable history gap while the webhook still reports success.
// ===========================================================================

describe('CRA-C7 — Shopify ingestion is telemetry-gated, never commercially blocked', () => {
  /** The monthly-cap block inside the ingestion handler, bounded to itself. */
  function ingestionCapBlock(): string {
    const src = read(ORDER_INGEST_HANDLER);
    const start = src.indexOf('if (isFinite(monthlyOrderCap))');
    expect(start).toBeGreaterThan(-1);
    // Ends at the next top-level block comment in the handler.
    const rest = src.slice(start);
    const end = rest.indexOf('\n  /**');
    return end === -1 ? rest : rest.slice(0, end);
  }

  it('GREEN CONTROL: the monthly cap only warns — it never returns, throws or rejects', () => {
    const block = ingestionCapBlock();
    expect(/console\.warn/.test(block)).toBe(true);
    expect(/\breturn\b/.test(block)).toBe(false);
    expect(/\bthrow\b/.test(block)).toBe(false);
  });

  it('GREEN CONTROL: ingested_orders is incremented as telemetry, not enforced against', () => {
    const src = read(ORDER_INGEST_HANDLER);
    expect(/increment\('ingested_orders', 1\)/.test(src)).toBe(true);
  });

  it('GREEN CONTROL: monthlyOrderCap is documented as an allowance, not an ingestion boundary', () => {
    // The comment is contractual here: it is the standing instruction that stops
    // a future edit from "helpfully" enforcing the cap at ingestion.
    expect(/monthlyOrderCap is a commercial allowance, not an ingestion boundary/
      .test(read(ORDER_INGEST_HANDLER))).toBe(true);
  });
});

// ===========================================================================
// C8 — SCALE CAPABILITY / CAPACITY SEPARATION
// ===========================================================================
describe('CRA-C8 — finite Scale capacity never becomes a capability denial', () => {
  it('MON-REM-01B RED: Scale has the ratified finite operational allowances', () => {
    const limits = CP.standardLimits('scale') as unknown as Record<string, number>;
    expect(limits.shippedOrderCap).toBe(20000);
    expect(limits.seatLimit).toBe(25);
    expect(limits.locationLimit).toBe(10);
    expect(limits.historyDays).toBe(730);
  });

  it('GREEN CONTROL: Scale is ALLOWED for every active capability', () => {
    const denied = ACTIVE_IDS.filter((id) => !decide(id, 'scale').allowed);
    expect(denied).toEqual([]);
  });

  it('MON-REM-01B RED: finite Scale capacity does not alter capability grants', () => {
    const { shippedOrderCap, seatLimit } = CP.standardLimits('scale');
    expect(Number.isFinite(shippedOrderCap)).toBe(true);
    expect(Number.isFinite(seatLimit)).toBe(true);

    const denied = ACTIVE_IDS.filter((id) => !decide(id, 'scale').allowed);
    expect(denied).toEqual([]);
  });
});

// ===========================================================================
// C9 — FT2 FREE BASELINE LIFECYCLE SAFETY
//
// grantFt2FreeBaselineForShop is dormant but live code. Standard plan access
// is owned by modulesForTier()/flagsForTier(), so this compatibility entry
// point must not persist plan-materialization rows.
//
// Asserted at the lowest stable layer: the literal grant list in source. A DB
// integration test would need the whole entitlements stack to prove the same
// one fact about a function nothing currently calls.
// ===========================================================================

describe('CRA-C9 — the FT2 free baseline cannot grant a paused/deprecated surface', () => {
  /** module_key literals inside grantFt2FreeBaselineForShop, bounded to it. */
  function ft2BaselineModules(): string[] {
    const src = read(ENTITLEMENTS_SERVICE);
    const start = src.indexOf('static async grantFt2FreeBaselineForShop');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('\n  /**');
    const body = end === -1 ? rest : rest.slice(0, end);
    return [...body.matchAll(/module_key:\s*'([^']+)'/g)].map((m) => m[1]);
  }

  it('COMMERCIAL-DEAD-SURFACE-01D: the baseline persists no standard plan modules', () => {
    expect(ft2BaselineModules()).toEqual([]);
  });

  it.each(NON_ACTIVE_MODULES)(
    'EXPECTED RED: the FT2 free baseline does not grant the paused/deprecated module `%s`',
    (moduleId) => {
      expect(ft2BaselineModules()).not.toContain(moduleId);
    },
  );

  it('EXPECTED RED: every FT2 baseline module is a live standard grant at some tier', () => {
    // Anything the baseline hands out must be a real, currently-sold surface —
    // otherwise it is granting access the commercial model no longer defines.
    const grantable = new Set(TIERS.flatMap((t) => [...modules(t)]));
    for (const m of ft2BaselineModules()) {
      expect({ module: m, sold: grantable.has(m) }).toEqual({ module: m, sold: true });
    }
  });
});
