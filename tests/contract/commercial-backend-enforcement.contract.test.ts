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
    const bad = fs
      .readdirSync(migDir)
      .filter((f) => /capabilit|effective.*entitlement|entitlement.*deny|deny.*entitlement/i.test(f));
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
  /** The source slice from `requireCapability`'s declaration to end of its body. */
  const capBody = (): string => {
    const src = capMwSource();
    const m = src.match(/(?:function|const)\s+requireCapability[\s\S]*/);
    return m ? m[0] : '';
  };

  it('EXPECTED RED: requireCapability resolves tier from the request (req.user.tier), not a DB call', () => {
    const body = capBody();
    expect(body.length).toBeGreaterThan(0); // RED today — no requireCapability
    expect(/req\.user(\?\.)?\.tier|resolveTier\(req\)/.test(body)).toBe(true);
  });

  it('EXPECTED RED: requireCapability does not import resolveTierForShop / read shop_subscriptions', () => {
    const body = capBody();
    expect(body.length).toBeGreaterThan(0); // RED today
    expect(/resolveTierForShop|shop_subscriptions/.test(body)).toBe(false);
  });
});
