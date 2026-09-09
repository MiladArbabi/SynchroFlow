// tests/contract/commercial-inventory-products-access.contract.test.ts
//
// P0-A3-4 — Inventory / Products commercial access. PURE / CONTRACT layer:
// evaluates the canonical policy engine and reads production source as text.
// No React, no DB, no server.
// ===========================================================================
// RATIFIED
//   inventory.core = moduleId `products` + minimumTier `core`
//   Starter DENY · Core/Growth/Scale ALLOW
//
//   WMS EXCEPTION: products `/wms-readiness` belongs to warehouse.operations,
//   NOT inventory.core, so a Starter shop with canonical WMS access keeps it.
//   Inventory recount belongs to inventory.core.
//
// Deliberately NOT duplicated here — existing permanent owners:
//   Starter/Core operator-summary alias parity (both mounts, incl. the
//   malformed-query case) ... tests/integration/entitlement-mounts.test.ts
//   (CONTRACT-ENT-MOUNT-01, 5 tests). Those are real regression evidence and
//   are neither rewritten nor weakened by this file.

import fs from 'fs';
import path from 'path';

import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const PRODUCTS_LEGACY_ROUTES = 'apps/backend/src/api/products/products.routes.ts';
const PRODUCTS_FT2_ROUTES = 'apps/backend/src/api/products/products.ft2.routes.ts';
const OPERATOR_CONTROLLER = 'apps/backend/src/api/products/products.operator.controller.ts';
const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';
const NAV_BOOTSTRAP = 'apps/frontend/src/runtime/navBootstrap.ts';
const INVENTORY_TABS = 'apps/frontend/src/pages/ft2-pages/inventoryModuleTabs.ts';
const INVENTORY_PAGE = 'apps/frontend/src/pages/ft2-pages/ProductsFT2Page.tsx';
const TOPNAV = 'apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx';
const ALERTS_PAGE = 'apps/frontend/src/pages/ft2-pages/AlertsPage.tsx';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
const TIERS: Tier[] = ['starter', 'core', 'growth', 'scale'];

const REGISTRY = CP.CAPABILITY_REQUIREMENTS as unknown as
  Record<string, CP.AccessRequirement | undefined>;

/**
 * VACUOUS-ALLOW SAFETY. `evaluateAccess(undefined, ctx)` returns ALLOWED by
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
 * Bounded source slice for ONE route registration: from the `router.<verb>(`
 * owning the given path literal up to the next registration or `export default`.
 * Narrower than a whole-file scan, so a match can only come from THIS route.
 */
function routeChunk(src: string, verb: string, pathLiteral: string): string {
  const esc = pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`router\\.${verb}\\(\\s*\\n?\\s*'${esc}'`).exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.search(/\n\s*router\.(get|post|patch|put|delete)\(|\nexport default/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Bounded slice for one registerNavItem({...}) block, by its `id:`. */
function navItemChunk(src: string, id: string): string {
  return src.split('registerNavItem(').find((c) => c.includes(`id: '${id}'`)) ?? '';
}

// ===========================================================================
// C1 — inventory.core canonical policy
// ===========================================================================
describe('IPA-C1 — inventory.core is products + Core+', () => {
  it('requirement is exactly { moduleId: products, minimumTier: core }', () => {
    const req = requirementOrFail('inventory.core');
    expect(req.moduleId).toBe('products');
    expect(req.minimumTier).toBe('core');
  });

  it.each<[Tier, boolean]>([
    ['starter', false],
    ['core', true],
    ['growth', true],
    ['scale', true],
  ])('inventory.core @ %s => %s', (tier, allowed) => {
    expect(decide('inventory.core', tier).allowed).toBe(allowed);
  });

  it('CONTROL: inventory.core and warehouse.operations are different boundaries', () => {
    // The WMS exception only means something if these two genuinely differ:
    // Starter holds warehouse.operations but must not hold inventory.core.
    expect(decide('warehouse.operations', 'starter').allowed).toBe(true);
    expect(decide('inventory.core', 'starter').allowed).toBe(false);
  });
});

// ===========================================================================
// C1B — inventory.live_map canonical policy
// ===========================================================================

describe('IPA-C1B — inventory.live_map is Products + Growth+', () => {
  it('requirement is exactly { moduleId: products, minimumTier: growth }', () => {
    const req = requirementOrFail('inventory.live_map');
    expect(req.moduleId).toBe('products');
    expect(req.minimumTier).toBe('growth');
    expect(req.feature).toBeUndefined();
  });

  it.each<[Tier, boolean]>([
    ['starter', false],
    ['core', false],
    ['growth', true],
    ['scale', true],
  ])('inventory.live_map @ %s => %s', (tier, allowed) => {
    expect(decide('inventory.live_map', tier).allowed).toBe(allowed);
  });

  it('CONTROL: Core Inventory does not imply access to the live map', () => {
    expect(decide('inventory.core', 'core').allowed).toBe(true);
    expect(decide('inventory.live_map', 'core').allowed).toBe(false);
  });
});

// ===========================================================================
// C2 — Inventory navigation
//
// INHERITANCE, not duplication. The ratified boundary is owned ONCE by the
// Inventory parent; Intelligence / Catalog / Costs / Data Quality inherit it.
//
// That inheritance is real, not assumed: resolveNavVisibility only evaluates a
// commercial decision `if (capabilityId && context)`, and ModuleTabBar computes
// `tab.capabilityId ? decide(tab.capabilityId) : null`. A child carrying NO
// capability therefore contributes no gate of its own and is bounded by its
// parent (sidenav) and by the subtree CommercialGate for direct URLs (IPA-C3).
//
// So the contract is: the parent OWNS inventory.core, and no standard child
// introduces a CONTRADICTORY raw module/tier gate. Requiring each child to
// re-declare inventory.core would be duplication the model does not need — and
// would drift the moment the parent's capability changed.
// ===========================================================================

/** The four standard Inventory children/tabs that inherit the parent boundary. */
const INHERITING_NAV_CHILDREN = [
  'products-intelligence',
  'products-catalog',
  'products-costs',
  'data-quality',
] as const;
const INHERITING_TABS = ['intelligence', 'catalog', 'costs', 'data-quality'] as const;

/** A nav child's single-line declaration. */
function navChildLine(id: string): string {
  const line = read(NAV_BOOTSTRAP)
    .split('\n')
    .find((l) => l.includes(`id: '${id}'`) && l.includes('path:'));
  expect(line).toBeDefined();
  return line as string;
}

/** One INVENTORY_MODULE_TABS entry. */
function tabEntry(id: string): string {
  const m = new RegExp(`\\{[^{}]*id:\\s*'${id}'[^{}]*\\}`, 's').exec(read(INVENTORY_TABS));
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[0];
}

describe('IPA-C2 — Inventory nav resolves inventory.core', () => {
  it('EXPECTED RED: the Inventory nav parent OWNS capabilityId inventory.core', () => {
    const chunk = navItemChunk(read(NAV_BOOTSTRAP), 'inventory');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/capabilityId:\s*'inventory\.core'/.test(chunk)).toBe(true);
  });

  it('EXPECTED RED: the Inventory parent no longer gates on a raw requiredModuleId', () => {
    // A raw module id is precisely why an ADDITIVE persisted `products` grant
    // can unlock Inventory for a Starter shop — see the dedicated case below.
    const chunk = navItemChunk(read(NAV_BOOTSTRAP), 'inventory');
    const head = chunk.split('children:')[0];
    expect(/requiredModuleId:\s*'products'/.test(head)).toBe(false);
  });

  it.each(INHERITING_NAV_CHILDREN)(
    'nav child %s introduces no contradictory raw module/tier gate (inherits the parent)',
    (id) => {
      const line = navChildLine(id);
      expect(/requiredModuleId:/.test(line)).toBe(false);
      expect(/requiredTier:/.test(line)).toBe(false);
      // If it declares a capability at all, it may only be inventory.core —
      // a narrower or different one would silently contradict the parent.
      const declared = /capabilityId:\s*'([^']+)'/.exec(line);
      if (declared) expect(declared[1]).toBe('inventory.core');
    },
  );

  it.each(INHERITING_TABS)(
    'inventory module tab %s introduces no contradictory raw module/tier gate',
    (id) => {
      const entry = tabEntry(id);
      expect(/requiredModuleId:/.test(entry)).toBe(false);
      expect(/requiredTier:/.test(entry)).toBe(false);
      const declared = /capabilityId:\s*'([^']+)'/.exec(entry);
      if (declared) expect(declared[1]).toBe('inventory.core');
    },
  );

  it('GREEN CONTROL: Demand is the deliberate exception — its own demand.forecasting, in nav', () => {
    // Demand is NOT URL-nested under /inventory and is a Growth capability, so
    // it must NOT inherit the Core boundary. Its explicit capability is correct.
    expect(/capabilityId:\s*'demand\.forecasting'/.test(navChildLine('demand'))).toBe(true);
  });

  it('GREEN CONTROL: Demand is the deliberate exception — its own demand.forecasting, in tabs', () => {
    expect(/capabilityId:\s*'demand\.forecasting'/.test(tabEntry('demand'))).toBe(true);
  });

  it('GREEN CONTROL: inheritance is real — a child with no capability contributes no gate', () => {
    // The mechanism the inheritance contract above depends on. If either
    // evaluator ever started defaulting an absent capability to something, the
    // "inherits the parent" reasoning would silently stop holding.
    expect(/if\s*\(capabilityId\s*&&\s*context\)/.test(
      read('apps/frontend/src/navigation/resolveNavVisibility.ts'),
    )).toBe(true);
    expect(/tab\.capabilityId\s*\?\s*decide\(tab\.capabilityId\)\s*:\s*null/.test(
      read('apps/frontend/src/components/ModuleTabBar.tsx'),
    )).toBe(true);
  });

  it('GREEN CONTROL: an additive `products` module grant does NOT unlock Inventory for Starter', () => {
    // The ratified boundary is CAPABILITY, not module membership. A Starter shop
    // holding a bespoke/persisted `products` module row still fails the tier
    // wall — this is the case a raw requiredModuleId gate gets wrong.
    const starterPlusProducts: CP.AccessContext = {
      tier: 'starter',
      modules: new Set([...CP.modulesForTier('starter'), 'products']),
      flags: new Set(CP.flagsForTier('starter')),
    };
    const decision = CP.evaluateAccess(requirementOrFail('inventory.core'), starterPlusProducts);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('TIER_TOO_LOW');
  });
});

// ===========================================================================
// C3 — Direct URL protection
// ===========================================================================
describe('IPA-C3 — the Inventory route subtree is gated, not just its nav entries', () => {
  it('EXPECTED RED: the Inventory page wraps its subtree in CommercialGate inventory.core', () => {
    // Nav presentation is not a security boundary: /inventory,
    // /inventory/catalog, /inventory/costs and /inventory/data-quality are all
    // served by this one subtree router (LifecycleRouteHost: /inventory/*), so
    // a direct URL must resolve the same AccessDecision as a nav click.
    const src = read(INVENTORY_PAGE);
    expect(/CommercialGate/.test(src)).toBe(true);
    expect(/capabilityId=["']inventory\.core["']/.test(src)).toBe(true);
  });
});

// ===========================================================================
// C4 / C7 — Products APIs + alias parity
// ===========================================================================
const INVENTORY_ROUTES: Array<[string, string]> = [
  ['get', '/ft2'],
  ['get', '/operator-summary'],
  ['get', '/catalog'],
  ['get', '/variants/costs'],
  ['patch', '/variants/:variantId/cost'],
  ['post', '/variants/costs/bulk'],
];

describe('IPA-C4 — Products APIs require inventory.core', () => {
  it.each(INVENTORY_ROUTES)(
    'EXPECTED RED: canonical mount %s %s requires inventory.core',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(PRODUCTS_FT2_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'inventory\.core'\s*\)/.test(chunk)).toBe(true);
    },
  );
});

describe('IPA-C7 — the two mounted aliases cannot disagree commercially', () => {
  // /api/v1/products/... and /api/v1/modules/products/... are BOTH mounted
  // (bootstrap/express.ts). While that is true, a caller must not be able to
  // pick the cheaper door.
  it.each(['/ft2', '/operator-summary'])(
    'EXPECTED RED: legacy-alias GET %s carries the same inventory.core gate',
    (pathLiteral) => {
      const chunk = routeChunk(read(PRODUCTS_LEGACY_ROUTES), 'get', pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'inventory\.core'\s*\)/.test(chunk)).toBe(true);
    },
  );

  it('EXPECTED RED: neither alias file gates Inventory surfaces on a raw tier', () => {
    for (const rel of [PRODUCTS_LEGACY_ROUTES, PRODUCTS_FT2_ROUTES]) {
      expect({ file: rel, requireTierCount: (read(rel).match(/requireTier\(/g) ?? []).length })
        .toEqual({ file: rel, requireTierCount: 0 });
    }
  });
});

// ===========================================================================
// C5 — WMS readiness exception
// ===========================================================================
describe('IPA-C5 — /wms-readiness is warehouse.operations, never inventory.core', () => {
  it('EXPECTED RED: /wms-readiness requires warehouse.operations', () => {
    const chunk = routeChunk(read(PRODUCTS_FT2_ROUTES), 'get', '/wms-readiness');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'warehouse\.operations'\s*\)/.test(chunk)).toBe(true);
  });

  it('GREEN CONTROL: /wms-readiness is NOT gated on inventory.core (Starter WMS stays valid)', () => {
    const chunk = routeChunk(read(PRODUCTS_FT2_ROUTES), 'get', '/wms-readiness');
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'inventory\.core'\s*\)/.test(chunk)).toBe(false);
  });
});

// ===========================================================================
// C6 — Inventory recount
// ===========================================================================
const RECOUNT_ROUTES: Array<[string, string]> = [
  ['post', '/recount-tasks'],
  ['get', '/recount-tasks'],
  ['get', '/recount-tasks/preview'],
];

describe('IPA-C6 — inventory recount resolves inventory.core', () => {
  it.each(RECOUNT_ROUTES)(
    'EXPECTED RED: %s %s requires inventory.core instead of a raw tier',
    (verb, pathLiteral) => {
      const chunk = routeChunk(read(WMS_ROUTES), verb, pathLiteral);
      expect(chunk.length).toBeGreaterThan(0);
      expect(/requireCapability\(\s*'inventory\.core'\s*\)/.test(chunk)).toBe(true);
      expect(/requireTier\(/.test(chunk)).toBe(false);
    },
  );

  it('GREEN CONTROL: recount keeps its own requireAction RBAC, separate from the commercial gate', () => {
    for (const [verb, pathLiteral] of RECOUNT_ROUTES) {
      const chunk = routeChunk(read(WMS_ROUTES), verb, pathLiteral);
      expect(/requireAction\(\s*'wms:recount:[a-z]+'\s*\)/.test(chunk)).toBe(true);
    }
  });
});

// ===========================================================================
// C8 — stale frontend links
// ===========================================================================
describe('IPA-C8 — active links target /inventory, never the retired /products', () => {
  it.each([
    ['TopnavbarContent', TOPNAV],
    ['AlertsPage', ALERTS_PAGE],
  ])('EXPECTED RED: %s missing_cogs routes to Inventory, not /products', (_name, rel) => {
    const line = read(rel)
      .split('\n')
      .find((l) => l.includes('missing_cogs'));
    expect(line).toBeDefined();
    // missing COGS is entered on the Costs surface.
    expect(/route:\s*'\/products'/.test(line as string)).toBe(false);
    expect(/route:\s*'\/inventory(\/[a-z-]+)?'/.test(line as string)).toBe(true);
  });
});

// ===========================================================================
// C9 — legacy containment on the OWNED surfaces only
// ===========================================================================
describe('IPA-C9 — owned Inventory/Products surfaces retire legacy commercial authority', () => {
  it('EXPECTED RED: the operator-summary controller holds no hand-rolled tier check', () => {
    // Today this controller answers 403 TIER_INSUFFICIENT from its own
    // meetsTier(req,'core') call — a private commercial decision that bypasses
    // the shared capability engine and returns a non-canonical denial body.
    const src = read(OPERATOR_CONTROLLER);
    expect(/meetsTier\(/.test(src)).toBe(false);
    expect(/TIER_INSUFFICIENT/.test(src)).toBe(false);
  });

  it('EXPECTED RED: the Inventory nav item declares no raw requiredModuleId', () => {
    const chunk = navItemChunk(read(NAV_BOOTSTRAP), 'inventory');
    expect(/requiredModuleId:/.test(chunk.split('children:')[0])).toBe(false);
  });

  it('EXPECTED RED: no owned Inventory surface reconstructs the boundary from a raw tier string', () => {
    for (const rel of [PRODUCTS_LEGACY_ROUTES, PRODUCTS_FT2_ROUTES, OPERATOR_CONTROLLER]) {
      expect({ file: rel, rawTierCompare: /tier\s*===\s*'(?:starter|core|growth|scale)'/.test(read(rel)) })
        .toEqual({ file: rel, rawTierCompare: false });
    }
  });
});
