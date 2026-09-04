// COMMERCIAL-ACCESS-ARCH-01 / COMMERCIAL-ACCESS-COVERAGE-01 — Slice P0-A0
// =====================================================================
// Permanent wiring contract for @lasyncro/commercial-policy.
//
// Proves that there is exactly ONE physical shared commercial-policy package
// and that every consumer toolchain (Node/contract Jest, frontend Jest, Vite,
// frontend tsc, backend tsc, backend runtime) resolves to that SAME package —
// so P0-A1 can implement Tier / ModuleId / CapabilityId / evaluateAccess()
// once, physically, for both sides.
//
// This does NOT test commercial policy behavior (that is P0-A1). It only
// guards the architectural spine against regressing into duplicated
// frontend/backend policy modules.
//
// Assertions are semantic (path shape + resolved identity), not line-numbered.

import fs from 'fs';
import path from 'path';

// Real import through the package name — proves this Jest project resolves it.
import {
  COMMERCIAL_POLICY_PACKAGE,
  COMMERCIAL_POLICY_WIRING_OK,
} from '@lasyncro/commercial-policy';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));

const PKG_DIR = 'packages/commercial-policy';
const PKG_SRC = `${PKG_DIR}/src/index.ts`;
const PKG_NAME = '@lasyncro/commercial-policy';

describe('P0-A0 — @lasyncro/commercial-policy package wiring', () => {
  it('the package resolves through its name in this (node/contract) Jest project', () => {
    expect(COMMERCIAL_POLICY_PACKAGE).toBe(PKG_NAME);
    expect(COMMERCIAL_POLICY_WIRING_OK).toBe(true);
  });

  it('exactly one physical package directory exists, with src + built dist + exports', () => {
    expect(exists(PKG_DIR)).toBe(true);
    expect(exists(PKG_SRC)).toBe(true);
    expect(exists(`${PKG_DIR}/dist/index.js`)).toBe(true);
    expect(exists(`${PKG_DIR}/dist/index.d.ts`)).toBe(true);

    const pkg = JSON.parse(read(`${PKG_DIR}/package.json`));
    expect(pkg.name).toBe(PKG_NAME);
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.exports['.'].default).toBe('./dist/index.js');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
    // pure package — no framework / db runtime deps
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('root build:deps builds the package into the production dependency chain', () => {
    const root = JSON.parse(read('package.json'));
    expect(root['scripts']['build:deps']).toContain(
      `npm --workspace ./${PKG_DIR} run build`,
    );
  });

  it('both apps declare the package as a workspace dependency (compiled-runtime + packaging)', () => {
    const be = JSON.parse(read('apps/backend/package.json'));
    const fe = JSON.parse(read('apps/frontend/package.json'));
    expect(be.dependencies[PKG_NAME]).toBeDefined();
    expect(fe.dependencies[PKG_NAME]).toBeDefined();
    // same version convention as the other internal @lasyncro packages
    expect(be.dependencies[PKG_NAME]).toBe(be.dependencies['@lasyncro/backend-core']);
  });

  it('the npm workspace link points at the one physical package', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const link = lock.packages?.['node_modules/@lasyncro/commercial-policy'];
    expect(link).toBeDefined();
    expect(link.resolved).toBe(PKG_DIR);
    expect(link.link).toBe(true);
  });

  it('every toolchain alias/mapping/path points at the SAME packages/commercial-policy source', () => {
    const jestCfg = read('jest.config.js');
    const vite = read('apps/frontend/vite.config.ts');
    const feTs = read('apps/frontend/tsconfig.json');

    // Jest — node projects mapper AND frontend project mapper
    const jestHits = [
      ...jestCfg.matchAll(
        /['"]\^@lasyncro\/commercial-policy\$['"]\s*:\s*['"]([^'"]+)['"]/g,
      ),
    ].map((m) => m[1]);
    expect(jestHits.length).toBeGreaterThanOrEqual(2);
    for (const target of jestHits) {
      expect(target).toBe('<rootDir>/packages/commercial-policy/src/index.ts');
    }

    // Vite alias
    const viteMatch = vite.match(
      /['"]@lasyncro\/commercial-policy['"]\s*:\s*path\.resolve\(__dirname,\s*['"]([^'"]+)['"]\)/,
    );
    expect(viteMatch?.[1]).toBe('../../packages/commercial-policy/src/index.ts');

    // Frontend tsconfig path
    const tsMatch = feTs.match(
      /"@lasyncro\/commercial-policy":\s*\[\s*"([^"]+)"\s*\]/,
    );
    expect(tsMatch?.[1]).toBe('../../../packages/commercial-policy/src/index.ts');
  });

  it('no duplicate frontend/backend commercial-policy implementation exists', () => {
    // The whole point: one physical package, not a frontend copy + a backend copy.
    expect(exists('apps/frontend/src/commercial-policy')).toBe(false);
    expect(exists('apps/backend/src/commercial-policy')).toBe(false);
    expect(exists('packages/backend-core/src/commercial-policy')).toBe(false);
    expect(exists('packages/backend-core/src/access')).toBe(false);

    const grepDirs = ['apps/frontend/src', 'apps/backend/src'];
    for (const d of grepDirs) {
      const hasLocalPolicyFile = fs.existsSync(path.join(REPO, d))
        ? walk(path.join(REPO, d)).some((f) =>
            /commercial[-_]?policy.*\.(ts|tsx)$/i.test(f) &&
            !/\.test\.tsx?$/.test(f),
          )
        : false;
      expect(hasLocalPolicyFile).toBe(false);
    }
  });
});

/** Shallow recursive file list (skips node_modules / dist). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
