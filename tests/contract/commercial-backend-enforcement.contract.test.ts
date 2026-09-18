// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2A
// =======================================
// RED contracts for backend capability enforcement + the canonical tier
// comparator. STATIC layer: reads production middleware/route source as text
// and imports the pure engine. No DB, no server boot.
//
// P0-A2A scope: EntitlementsService effective tier-floor union, the
// requireCapability() middleware, requireTier/meetsTier via tierAtLeast, the
// first backend route migration (suppliers / WMS base / WMS analytics / WMS
// problem-center / floor-planning / demand), and the normalized
// COMMERCIAL_ACCESS_DENIED response. Frontend (nav / tabs / CommercialGate /
// modal / DEV bypass) is P0-A2B and stays RED elsewhere.

import fs from 'fs';
import path from 'path';
import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));

const ENT_SERVICE = 'packages/backend-core/src/services/entitlements.service.ts';
const ENT_MW = 'apps/backend/src/middleware/require-entitlement.middleware.ts';
const CAP_MW = 'apps/backend/src/middleware/require-capability.middleware.ts';
const SUPPLIERS_ROUTES = 'apps/backend/src/api/suppliers/suppliers.routes.ts';
const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';
const FP_ROUTES = 'apps/backend/src/api/floor-planning/floor-planning.routes.ts';
const DEMAND_ROUTES = 'apps/backend/src/api/demand/demand.routes.ts';

/** Source of `requireCapability`, wherever P0-A2A puts it. */
const capMwSource = (): string =>
  (exists(CAP_MW) ? read(CAP_MW) : '') + '\n' + read(ENT_MW);

// ===========================================================================
// A2A-C6 — NO MIGRATION / NO DENY DEPENDENCY
// ===========================================================================
describe('A2A-C6 — effective union is a derived resolver, no schema / no deny row', () => {
  it('GREEN CONTROL: modulesForTier / flagsForTier are pure exports of the canonical engine', () => {
    expect(typeof (CP as any).modulesForTier).toBe('function');
    expect(typeof (CP as any).flagsForTier).toBe('function');
    expect((CP as any).modulesForTier('growth').size).toBeGreaterThan(0);
  });

  it('GREEN CONTROL: no migration introduces a capability / effective-entitlement / deny table', () => {
    const migDir = path.join(REPO, 'apps/backend/migrations');
    const forbidden =
      /capabilit|effective.*entitlement|entitlement.*deny|deny.*entitlement/i;

    const bad = fs
      .readdirSync(migDir)
      .filter((f) => /\.(?:ts|js)$/.test(f))
      .flatMap((f) => {
        const src = fs.readFileSync(path.join(migDir, f), 'utf8');

        const knexCreatedTables = Array.from(
          src.matchAll(
            /\bcreateTable(?:IfNotExists)?\s*\(\s*['"`]([^'"`]+)['"`]/g,
          ),
          (match) => match[1],
        );

        const rawSqlCreatedTables = Array.from(
          src.matchAll(
            /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["`]?([A-Za-z0-9_.-]+)["`]?/gi,
          ),
          (match) => match[1],
        );

        return [...knexCreatedTables, ...rawSqlCreatedTables]
          .filter((tableName) => forbidden.test(tableName))
          .map((tableName) => `${f}:${tableName}`);
      });

    expect(bad).toEqual([]);
  });

  it('EXPECTED RED: EntitlementsService derives the tier floor from commercial-policy', () => {
    const src = read(ENT_SERVICE);
    expect(/from\s+['"]@lasyncro\/commercial-policy['"]/.test(src)).toBe(true);
    expect(/modulesForTier|flagsForTier/.test(src)).toBe(true);
  });

  it('EXPECTED RED: the resolver no longer early-returns an empty snapshot on zero rows', () => {
    const src = read(ENT_SERVICE);
    // rows-only today: `if (!rows || rows.length === 0) return { … modules: [], flags: [] }`
    const emptyEarlyReturn =
      /rows\.length === 0[\s\S]{0,120}modules:\s*\[\s*\][\s\S]{0,60}flags:\s*\[\s*\]/.test(src);
    expect(emptyEarlyReturn).toBe(false);
  });
});

// ===========================================================================
// A2A-C7 — requireCapability EXISTS and consumes the canonical engine
// ===========================================================================
describe('A2A-C7 — requireCapability(capabilityId)', () => {
  it('EXPECTED RED: a requireCapability middleware is exported', () => {
    const src = capMwSource();
    expect(/export\s+(?:function|const)\s+requireCapability\b/.test(src)).toBe(true);
  });

  it('EXPECTED RED: it imports evaluateAccess / CAPABILITY_REQUIREMENTS / modulesForTier / flagsForTier from the package', () => {
    const src = capMwSource();
    expect(/from\s+['"]@lasyncro\/commercial-policy['"]/.test(src)).toBe(true);
    for (const sym of ['evaluateAccess', 'CAPABILITY_REQUIREMENTS', 'modulesForTier', 'flagsForTier']) {
      expect(new RegExp(`\\b${sym}\\b`).test(src)).toBe(true);
    }
  });

  it('GREEN GUARD: it must not redefine a local capability requirement table (import from the package)', () => {
    const src = capMwSource();
    expect(/const\s+CAPABILITY_REQUIREMENTS\s*[:=]/.test(src)).toBe(false);
  });
});

// ===========================================================================
// A2A-C8 — requireTier / meetsTier use the canonical comparator
// ===========================================================================
describe('A2A-C8 — canonical tier comparator', () => {
  it('EXPECTED RED: require-entitlement.middleware defines no private TIER_ORDER map', () => {
    expect(/const\s+TIER_ORDER\s*[:=]/.test(read(ENT_MW))).toBe(false);
  });

  it('EXPECTED RED: it delegates tier comparison to tierAtLeast from commercial-policy', () => {
    const src = read(ENT_MW);
    expect(/tierAtLeast/.test(src)).toBe(true);
    expect(/from\s+['"]@lasyncro\/commercial-policy['"]/.test(src)).toBe(true);
  });
});

// ===========================================================================
// A2A-C9 — normalized COMMERCIAL_ACCESS_DENIED response
// ===========================================================================
describe('A2A-C9 — commercial denial contract', () => {
  it('EXPECTED RED: requireCapability emits a COMMERCIAL_ACCESS_DENIED 403 body', () => {
    const src = capMwSource();
    expect(/COMMERCIAL_ACCESS_DENIED/.test(src)).toBe(true);
    expect(/status\(403\)/.test(src)).toBe(true);
    for (const field of ['reason', 'capabilityId', 'currentTier']) {
      expect(new RegExp(`${field}`).test(src)).toBe(true);
    }
  });

  it('EXPECTED RED: requireCapability never emits ROLE_FORBIDDEN (that stays with requireAction)', () => {
    const src = exists(CAP_MW) ? read(CAP_MW) : '';
    // once the file exists it must not mention ROLE_FORBIDDEN; today the file
    // does not exist, so this is RED via the C7 existence check — assert the
    // marker directly for when it lands.
    if (src) expect(/ROLE_FORBIDDEN/.test(src)).toBe(false);
    expect(exists(CAP_MW) || /export function requireCapability/.test(read(ENT_MW))).toBe(true);
  });
});

// ===========================================================================
// ROUTE MIGRATION CONTRACT (static wiring for C10–C15)
// ===========================================================================
describe('A2A route migration — capability references on the first backend set', () => {
  it('EXPECTED RED: suppliers.routes carries requireCapability(\'purchasing.core\')', () => {
    expect(/requireCapability\(\s*['"]purchasing\.core['"]\s*\)/.test(read(SUPPLIERS_ROUTES))).toBe(true);
  });

  it('EXPECTED RED: wms.routes carries warehouse.operations + warehouse.analytics + warehouse.problem_center', () => {
    const src = read(WMS_ROUTES);
    expect(/requireCapability\(\s*['"]warehouse\.operations['"]\s*\)/.test(src)).toBe(true);
    expect(/requireCapability\(\s*['"]warehouse\.analytics['"]\s*\)/.test(src)).toBe(true);
    expect(/requireCapability\(\s*['"]warehouse\.problem_center['"]\s*\)/.test(src)).toBe(true);
  });

  it('EXPECTED RED: wms.routes base no longer uses requireTier(\'starter\'); analytics no longer requireTier(\'growth\')', () => {
    const src = read(WMS_ROUTES);
    expect((src.match(/requireTier\('starter'\)/g) || []).length).toBe(0);
    expect((src.match(/requireTier\('growth'\)/g) || []).length).toBe(0);
  });

  it('GREEN CONTROL: /recount* stays on requireTier(\'core\') in P0-A2A (no warehouse.recount capability)', () => {
    const src = read(WMS_ROUTES);
    expect(/recount[\s\S]{0,120}requireTier\('core'\)/.test(src) || /requireTier\('core'\)[\s\S]{0,160}recount/i.test(src)).toBe(true);
    expect(/requireCapability\(\s*['"]warehouse\.recount['"]/.test(src)).toBe(false);
  });

  it('EXPECTED RED: floor-planning.routes uses requireCapability(\'warehouse.floor_planning\') and drops requireTier(\'starter\')', () => {
    const src = read(FP_ROUTES);
    expect(/requireCapability\(\s*['"]warehouse\.floor_planning['"]\s*\)/.test(src)).toBe(true);
    expect((src.match(/requireTier\('starter'\)/g) || []).length).toBe(0);
  });

  it('EXPECTED RED: demand.routes uses requireCapability(\'demand.forecasting\')', () => {
    const src = read(DEMAND_ROUTES);
    expect(/requireCapability\(\s*['"]demand\.forecasting['"]\s*\)/.test(src)).toBe(true);
  });
});

// ===========================================================================
// A2A-C16 — middleware order: requireCapability BEFORE requireAction
// ===========================================================================
describe('A2A-C16 — commercial gate precedes RBAC', () => {
  it.each([SUPPLIERS_ROUTES, WMS_ROUTES, FP_ROUTES])('EXPECTED RED: %s chains requireCapability before requireAction', (file) => {
    const src = read(file);
    const hasBoth = /requireCapability\(/.test(src) && /requireAction\(/.test(src);
    expect(hasBoth).toBe(true);
    // at least one chain with requireCapability(...) then requireAction(...) and none the other way inside a single router.<verb>( ... ) call
    const capThenAction =
      /requireCapability\([^)]*\)[\s\S]{0,200}?requireAction\(/.test(src);
    expect(capThenAction).toBe(true);
  });
});

// ===========================================================================
// A2A-C18 — JWT tier boundary (documented + enforced-by-absence-of-DB-fetch)
// ===========================================================================
describe('A2A-C18 — requireCapability reads req.user.tier, no new DB tier fetch', () => {
  /**
   * Explicit source slice for one top-level function: from its declaration
   * to the start of the next top-level `function` declaration (or EOF).
   * Deliberately narrower than a whole-file regex so a match can only come
   * from THIS function's own body, not an unrelated function elsewhere in
   * the file that happens to also call resolveTier(req).
   */
  const sliceFunction = (src: string, name: string): string => {
    const declRe = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`);
    const m = declRe.exec(src);
    if (!m) return '';
    const start = m.index;
    const rest = src.slice(start + m[0].length);
    const next = /\n(?:export\s+)?function\s+\w+\s*\(/.exec(rest);
    const end = next ? start + m[0].length + next.index : src.length;
    return src.slice(start, end);
  };

  const requireCapabilityBody = (): string => sliceFunction(capMwSource(), 'requireCapability');
  const resolveCapabilityDecisionBody = (): string => sliceFunction(capMwSource(), 'resolveCapabilityDecision');

  it('EXPECTED RED: requireCapability delegates its tier decision to resolveCapabilityDecision(req, ...), or resolves req.user.tier/resolveTier(req) directly; whichever helper does the resolving does it from the request, not a DB call', () => {
    const reqCapBody = requireCapabilityBody();
    expect(reqCapBody.length).toBeGreaterThan(0); // RED today — no requireCapability

    const delegatesToHelper = /resolveCapabilityDecision\(\s*req\s*,/.test(reqCapBody);
    const resolvesDirectly = /req\.user(\?\.)?\.tier|resolveTier\(req\)/.test(reqCapBody);
    expect(delegatesToHelper || resolvesDirectly).toBe(true);

    // If requireCapability delegates, the delegate itself must resolve tier
    // from the request boundary — the RED condition can't be satisfied by
    // requireCapability merely calling a helper that fetches from a DB.
    if (delegatesToHelper) {
      const helperBody = resolveCapabilityDecisionBody();
      expect(helperBody.length).toBeGreaterThan(0);
      expect(/req\.user(\?\.)?\.tier|resolveTier\(req\)/.test(helperBody)).toBe(true);
    }
  });

  it('EXPECTED RED: neither requireCapability nor resolveCapabilityDecision import resolveTierForShop / read shop_subscriptions', () => {
    const reqCapBody = requireCapabilityBody();
    expect(reqCapBody.length).toBeGreaterThan(0); // RED today
    expect(/resolveTierForShop|shop_subscriptions/.test(reqCapBody)).toBe(false);

    const helperBody = resolveCapabilityDecisionBody();
    if (helperBody.length > 0) {
      expect(/resolveTierForShop|shop_subscriptions/.test(helperBody)).toBe(false);
    }
  });
});

// ###########################################################################
// P0-A3-5 — PURCHASING / SOURCING BACKEND ROUTE OWNERSHIP
// ###########################################################################
// Ratified split (COMMERCIAL-REMODEL-ALIGN-01 / P0-A3-5):
//
//   purchasing.core     (Core+)    BASIC purchasing — variant search for PO
//                                  creation, supplier CRUD, purchase-order
//                                  CRUD/status/receive, receive-job workflows.
//   purchasing.sourcing (Growth+)  ADVANCED SOURCING — worklist,
//                                  recommendations, never-ordered,
//                                  supplier-product preferences, reorder/MOQ
//                                  accumulator.
//
// Both families live in the SAME router file, so the ownership boundary is a
// per-route contract, not a per-file one. requireFt2 (lifecycle) and
// requireAction (RBAC) are separate concerns and are deliberately NOT asserted
// as commercial authority here — A2A-C16 above already owns the ordering
// contract.

/**
 * Parse every `router.<verb>('<path>', ...middleware..., handler)` registration
 * out of the suppliers router source, capturing the capability id each one
 * declares. Reads the REAL route file — no mirrored route table.
 */
function parseSuppliersRoutes(): Array<{ method: string; routePath: string; capability: string | null }> {
  const src = read(SUPPLIERS_ROUTES);
  const re = /router\.(get|post|patch|put|delete)\(\s*'([^']+)'([\s\S]*?)\n\);/g;
  const out: Array<{ method: string; routePath: string; capability: string | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const cap = /requireCapability\(\s*['"]([^'"]+)['"]\s*\)/.exec(m[3]);
    out.push({ method: m[1].toUpperCase(), routePath: m[2], capability: cap ? cap[1] : null });
  }
  return out;
}

/** The 11 ratified ADVANCED SOURCING routes, as `METHOD path`. */
const ADVANCED_SOURCING_ROUTES = [
  'GET /sourcing-worklist',
  'GET /sourcing-recommendations/never-ordered',
  'GET /sourcing-recommendations/:variantId',
  'GET /preferences',
  'POST /preferences',
  'PATCH /preferences/:id',
  'DELETE /preferences/:id',
  'POST /reorder-requests/convert',
  'GET /reorder-requests',
  'POST /reorder-requests',
  'DELETE /reorder-requests/:id',
] as const;

/** Representative BASIC purchasing routes owned by purchasing.core. */
const BASIC_PURCHASING_ROUTES = [
  'GET /variants/search',
  'GET /',
  'POST /',
  'PATCH /:id',
  'DELETE /:id',
  'GET /purchase-orders',
  'POST /purchase-orders',
  'GET /purchase-orders/:poId/line-items',
  'PATCH /purchase-orders/:poId/status',
  'PATCH /purchase-orders/:poId',
  'POST /purchase-orders/:poId/receive',
  'GET /receive-jobs',
  'POST /purchase-orders/:poId/receive-jobs',
  'GET /receive-jobs/:jobId',
  'PATCH /receive-jobs/:jobId/assignment',
  'POST /receive-jobs/:jobId/claim',
  'PATCH /receive-jobs/:jobId/lines/:lineId/progress',
  'POST /receive-jobs/:jobId/inspect',
  'POST /receive-jobs/:jobId/close',
  'POST /receive-jobs/:jobId/exception',
] as const;

describe('PUR-C5 — BASIC purchasing routes are owned by purchasing.core', () => {
  it('GREEN CONTROL: the suppliers router parses into the full registered route set', () => {
    const routes = parseSuppliersRoutes();
    expect(routes.length).toBe(BASIC_PURCHASING_ROUTES.length + ADVANCED_SOURCING_ROUTES.length);
  });

  it('GREEN CONTROL: every BASIC purchasing route declares requireCapability(purchasing.core)', () => {
    const byKey = new Map(parseSuppliersRoutes().map((r) => [`${r.method} ${r.routePath}`, r.capability]));
    const wrong = BASIC_PURCHASING_ROUTES
      .map((key) => [key, byKey.get(key)] as const)
      .filter(([, cap]) => cap !== 'purchasing.core');
    expect(wrong).toEqual([]);
  });

  it('GREEN CONTROL: no BASIC purchasing route is moved onto purchasing.sourcing', () => {
    const byKey = new Map(parseSuppliersRoutes().map((r) => [`${r.method} ${r.routePath}`, r.capability]));
    const leaked = BASIC_PURCHASING_ROUTES.filter((key) => byKey.get(key) === 'purchasing.sourcing');
    expect(leaked).toEqual([]);
  });
});

describe('PUR-C6 — ADVANCED SOURCING routes are owned by purchasing.sourcing', () => {
  it('GREEN CONTROL: exactly the 11 ratified advanced sourcing routes are registered', () => {
    const registered = new Set(parseSuppliersRoutes().map((r) => `${r.method} ${r.routePath}`));
    const missing = ADVANCED_SOURCING_ROUTES.filter((key) => !registered.has(key));
    expect(missing).toEqual([]);
    expect(ADVANCED_SOURCING_ROUTES.length).toBe(11);
  });

  it.each(ADVANCED_SOURCING_ROUTES)(
    'EXPECTED RED: %s declares requireCapability(purchasing.sourcing)',
    (key) => {
      const byKey = new Map(parseSuppliersRoutes().map((r) => [`${r.method} ${r.routePath}`, r.capability]));
      expect({ key, capability: byKey.get(key) }).toEqual({ key, capability: 'purchasing.sourcing' });
    },
  );

  it('EXPECTED RED: the router declares purchasing.sourcing exactly 11 times', () => {
    const count = (read(SUPPLIERS_ROUTES).match(/requireCapability\(\s*['"]purchasing\.sourcing['"]\s*\)/g) || []).length;
    expect(count).toBe(11);
  });

  it('GREEN CONTROL: requireFt2 and requireAction remain on every advanced sourcing route (separate lifecycle / RBAC concerns)', () => {
    const src = read(SUPPLIERS_ROUTES);
    const re = /router\.(get|post|patch|put|delete)\(\s*'([^']+)'([\s\S]*?)\n\);/g;
    const advanced = new Set<string>(ADVANCED_SOURCING_ROUTES);
    const missing: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      if (!advanced.has(key)) continue;
      if (!/requireFt2/.test(m[3]) || !/requireAction\(/.test(m[3])) missing.push(key);
    }
    expect(missing).toEqual([]);
  });
});
