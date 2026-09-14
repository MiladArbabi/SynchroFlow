// COMMERCIAL-ACCESS-ARCH-01 / COMMERCIAL-ACCESS-COVERAGE-01 — Slice P0-A1
// =====================================================================
// Architecture / static contracts for who OWNS commercial truth after P0-A1.
//
//   A1-C11 — @lasyncro/commercial-policy stays pure (zero runtime deps); the
//            compatibility direction is backend-core -> commercial-policy.
//   A1-C12 — backend-core consumers keep their public symbols, sourced FROM
//            commercial-policy (re-export), not owned independently.
//   A1-C13 — one canonical standard-limit source, with the backend-true values.
//
// GREEN GUARDS here (purity + symbol availability) must STAY green.
// RED assertions fail until P0-A1 converges backend-core onto the package.

import fs from 'fs';
import path from 'path';
import * as CP from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const readIf = (rel: string): string => (fs.existsSync(path.join(REPO, rel)) ? read(rel) : '');
const listTs = (dir: string): string[] => {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const CP_SRC = 'packages/commercial-policy/src';
const BACKEND_CORE_TIERS = 'packages/backend-core/src/config/tiers.ts';
const ROOT_PKG = 'package.json';
const BACKEND_CORE_PKG = 'packages/backend-core/package.json';

const FORBIDDEN_IMPORT =
  /from\s+['"](?:@lasyncro\/backend-core|.*\/packages\/backend-core|react|react-dom|express|knex|pg|ioredis|@lasyncro\/shared)['"]/;

// ===========================================================================
// A1-C11 — the policy package owns truth and stays pure
// ===========================================================================
describe('A1-C11 — commercial-policy purity & compatibility direction', () => {
  it('GREEN GUARD: no file under commercial-policy/src imports a framework / DB / backend-core', () => {
    const files = listTs(CP_SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect({ file: f, forbidden: FORBIDDEN_IMPORT.test(read(f)) }).toEqual({ file: f, forbidden: false });
    }
  });

  it('GREEN GUARD: commercial-policy/package.json declares zero runtime dependencies', () => {
    const pkg = JSON.parse(read('packages/commercial-policy/package.json'));
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('EXPECTED RED: backend-core tiers.ts sources its tier truth FROM @lasyncro/commercial-policy', () => {
    const src = read(BACKEND_CORE_TIERS);
    expect(/from\s+['"]@lasyncro\/commercial-policy['"]/.test(src)).toBe(true);
  });

  it('EXPECTED RED: the policy package exports the canonical tier + access surface', () => {
    for (const sym of ['TIERS', 'TIER_ORDER', 'tierAtLeast', 'evaluateAccess', 'CAPABILITY_REQUIREMENTS']) {
      expect(typeof (CP as any)[sym]).not.toBe('undefined');
    }
  });
});

// ===========================================================================
// A1-C12 — backend-core compatibility target (re-export, no forced migration)
// ===========================================================================
describe('A1-C12 — backend-core compatibility re-export', () => {
  it('GREEN GUARD: backend-core still publicly exports its established tier symbols', () => {
    // These stay importable for existing callers; P0-A1 changes their SOURCE, not their name.
    const src = read(BACKEND_CORE_TIERS);
    for (const sym of ['TIERS', 'TIER_CONFIG', 'getTierConfig', 'tierHasFlag', 'isValidTier']) {
      expect(new RegExp(`export (?:const|function|type) ${sym}\\b|export \\{[^}]*\\b${sym}\\b`).test(src)).toBe(true);
    }
  });

  it('EXPECTED RED: backend-core declares @lasyncro/commercial-policy as a dependency', () => {
    const pkg = JSON.parse(readIf(BACKEND_CORE_PKG) || '{}');
    expect(pkg.dependencies?.['@lasyncro/commercial-policy']).toBeDefined();
  });

  it('EXPECTED RED: build:deps builds commercial-policy BEFORE backend-core', () => {
    const deps = String(JSON.parse(read(ROOT_PKG)).scripts?.['build:deps'] ?? '');
    const iCp = deps.indexOf('packages/commercial-policy');
    const iBc = deps.indexOf('packages/backend-core');
    expect(iCp).toBeGreaterThan(-1);
    expect(iBc).toBeGreaterThan(-1);
    expect(iCp).toBeLessThan(iBc);
  });

  it('EXPECTED RED: the canonical Tier type/order is not independently redefined in backend-core', () => {
    const src = read(BACKEND_CORE_TIERS);
    // After convergence, TIERS is imported/re-exported, not a fresh literal array here.
    const ownsLiteral = /export const TIERS\s*=\s*\[\s*['"]starter['"]/.test(src);
    expect(ownsLiteral).toBe(false);
  });
});

// ===========================================================================
// A1-C13 — canonical commercial limits + economics
// ===========================================================================
describe('A1-C13 — canonical commercial limits + economics', () => {
  const limitsFor = (t: string): any =>
    (CP as any).standardLimits?.(t) ?? (CP as any).PLAN_LIMITS?.[t];

  it('GREEN GUARD: commercial-policy exposes canonical standard limits per tier', () => {
    for (const t of ['starter', 'core', 'growth', 'scale']) {
      expect(limitsFor(t)).toBeDefined();
    }
  });

  it('MON-REM-01B RED: processed-order allowances are 0 / 2000 / 7500 / 20000', () => {
    expect(limitsFor('starter')?.shippedOrderCap).toBe(0);
    expect(limitsFor('core')?.shippedOrderCap).toBe(2000);
    expect(limitsFor('growth')?.shippedOrderCap).toBe(7500);
    expect(limitsFor('scale')?.shippedOrderCap).toBe(20000);
  });

  it('MON-REM-01B RED: included non-owner seats are 0 / 3 / 10 / 25', () => {
    expect(limitsFor('starter')?.seatLimit).toBe(0);
    expect(limitsFor('core')?.seatLimit).toBe(3);
    expect(limitsFor('growth')?.seatLimit).toBe(10);
    expect(limitsFor('scale')?.seatLimit).toBe(25);
  });

  it('MON-REM-01B RED: warehouse-location allowances are 1 / 1 / 3 / 10', () => {
    expect(limitsFor('starter')?.locationLimit).toBe(1);
    expect(limitsFor('core')?.locationLimit).toBe(1);
    expect(limitsFor('growth')?.locationLimit).toBe(3);
    expect(limitsFor('scale')?.locationLimit).toBe(10);
  });

  it('MON-REM-01B RED: visible-history windows are 30 / 90 / 365 / 730 days', () => {
    expect(limitsFor('starter')?.historyDays).toBe(30);
    expect(limitsFor('core')?.historyDays).toBe(90);
    expect(limitsFor('growth')?.historyDays).toBe(365);
    expect(limitsFor('scale')?.historyDays).toBe(730);
  });

  it('MON-REM-01B RED: processed-order overage economics are canonical', () => {
    const rates = (CP as any).PLAN_PROCESSED_ORDER_OVERAGE_CENTS;
    expect(rates).toBeDefined();
    expect(rates?.starter).toBeNull();
    expect(rates?.core).toBe(8);
    expect(rates?.growth).toBe(6);
    expect(rates?.scale).toBe(4);
  });

  it('MON-REM-01B RED: canonical base-price anchors are Free / 99 / 249 / 599 USD', () => {
    const prices = (CP as any).PLAN_PRICING_CENTS;
    expect(prices?.starter).toBe(0);
    expect(prices?.core).toBe(9900);
    expect(prices?.growth).toBe(24900);
    expect(prices?.scale).toBe(59900);
  });

  it('GREEN CONTROL: ingestion remains telemetry rather than a commercial execution boundary', () => {
    expect(limitsFor('starter')?.monthlyOrderCap).toBeDefined();
    expect(limitsFor('growth')?.monthlyOrderCap).toBeDefined();
  });

  it('MON-REM-01B RED: history query window consumes canonical commercial-policy historyDays', () => {
    const historySrc = read('packages/backend-core/src/utils/tierDataWindow.ts');
    expect(/standardLimits/.test(historySrc)).toBe(true);
    expect(/const\s+WINDOW_DAYS/.test(historySrc)).toBe(false);
  });
});
