#!/usr/bin/env node
// SF-CI-CUTOVER-ISOLATION-001 — decides whether a change range needs the
// opening-inventory cutover verification job.
//
//   node scripts/ci/cutover-impact.js [--mode=ci|release] <base> <head>
//
// Prints the matching reasons and ends with CUTOVER_REQUIRED=true|false.
// Fails closed: any error, unknown base or unexpected state prints
// CUTOVER_REQUIRED=true.
//
//   ci (default) — CI job selection: production impact plus anything that
//                  changes what the cutover job verifies (CI_ONLY_PATTERNS).
//   release      — Fly release gate: production impact only.
//
// A shipped file is cutover-sensitive when it is:
//   1. in the live static import closure of the cutover suites (computed from
//      the checked-out tree, so new dependencies are picked up automatically);
//   2. or a shipped runtime input outside that closure (RUNTIME_PATTERNS).
// createApp() mounts every router, but the suites drive only the routes in
// EXERCISED_ROUTES; other routers are prefix-isolated and their boot health is
// covered by the general job. An unknown /api/v1 prefix in a suite falls back
// to the full createApp() fan-out.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// Must stay in step with the cutover job's --testPathPatterns.
const SUITE_PATTERNS = [
  /^tests\/integration\/inventory\/[^/]*cutover[^/]*\.test\.ts$/,
  /^tests\/integration\/wms\/stow-shopify-push-trigger-contract\.test\.ts$/,
  /^tests\/integration\/wms\/stow-inventory-credit-enqueue\.contract\.test\.ts$/,
];

// Shipped runtime inputs: schema, shared inventory packages, dependency
// manifests/lockfile, build and runtime configuration. Both modes.
const RUNTIME_PATTERNS = [
  /^apps\/backend\/migrations\//,
  /^apps\/backend\/(package\.json|tsconfig[^/]*\.json|knexfile[^/]*)$/,
  /^apps\/backend\/src\/scripts\/runMigrations/,
  /^packages\/(backend-core|commercial-policy|epistemic)\//,
  /^modules\/shared\/(package\.json|tsconfig[^/]*\.json)$/,
  /^(package\.json|package-lock\.json|tsconfig[^/]*\.json|Dockerfile|\.dockerignore|fly\.toml)$/,
];

// Verification-only inputs: they change what the cutover job proves, not what
// production runs. They select the cutover job (ci mode) but never make a
// release cutover-sensitive (release mode). Evidence produced at commit C
// stays valid for C's shipped code whatever later CI edits do.
const CI_ONLY_PATTERNS = [
  /^tests\/integration\/inventory\//,
  /^tests\/setup\//,
  /^tests\/__mocks__\//,
  /^scripts\/(with-test-db|test-db-safety|shopify-reconnect-prerequisites)\.js$/,
  /^scripts\/check-conflict-usage\.sh$/,
  /^scripts\/ci\//,
  /^\.github\/workflows\/ci-security\.yml$/,
  /^(jest\.config\.js|jest\.[^/]+\.js|babel\.config\.js)$/,
];

const EXPRESS = 'apps/backend/src/bootstrap/express.ts';
const EXERCISED_ROUTES = {
  'settings/shop': 'apps/backend/src/api/settings/shopSettings.routes.ts',
  wms: 'apps/backend/src/api/wms/wms.routes.ts',
};
const APP_MIDDLEWARE = [
  'packages/backend-core/src/middleware/auth.middleware.ts',
  'apps/backend/src/middleware/require-action.middleware.ts',
];

const ALIASES = [
  [/^api-src\/(.*)$/, 'apps/backend/src/$1'],
  [/^api-db$/, 'apps/backend/src/db.ts'],
  [/^api-types$/, 'apps/backend/src/types.ts'],
  [/^api-server$/, 'apps/backend/src/server.ts'],
];
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'];
// Comment-insensitive on purpose: a commented-out import over-selects, never under-selects.
const SPECIFIER = /(?:\bfrom|\bimport|\brequire|\bjest\.(?:mock|doMock|requireActual))\s*\(?\s*['"]([^'"]+)['"]/g;

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function workspacePackages() {
  const map = {};
  for (const group of ['packages', 'modules']) {
    for (const dir of fs.readdirSync(path.join(ROOT, group))) {
      const manifest = path.join(ROOT, group, dir, 'package.json');
      if (fs.existsSync(manifest)) map[JSON.parse(fs.readFileSync(manifest, 'utf8')).name] = `${group}/${dir}`;
    }
  }
  return map;
}

function existingFile(relative) {
  const candidates = EXTENSIONS.map((ext) => relative + ext);
  if (/\.js$/.test(relative)) candidates.push(...EXTENSIONS.map((ext) => relative.slice(0, -3) + ext));
  return candidates.find((c) => fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile());
}

// Returns { files: Set<repo-relative file>, prefixes: Set<repo-relative dir> }.
function importClosure(entries, leaves) {
  const packages = workspacePackages();
  const files = new Set();
  const prefixes = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx|js|jsx)$/.test(file) || leaves.has(file)) continue;
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, spec] of source.matchAll(SPECIFIER)) {
      let target;
      if (spec.startsWith('.')) {
        target = existingFile(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
      } else {
        const alias = ALIASES.find(([re]) => re.test(spec));
        const pkg = spec.match(/^(@lasyncro\/[^/]+)(\/.*)?$/);
        if (alias) {
          target = existingFile(spec.replace(alias[0], alias[1]));
        } else if (pkg && packages[pkg[1]]) {
          const dir = packages[pkg[1]];
          target = existingFile(`${dir}/src${pkg[2] || '/index'}`) || existingFile(`${dir}${pkg[2] || '/src/index'}`);
          if (!target) prefixes.add(`${dir}/`); // unresolvable workspace import: whole package
        }
      }
      if (target) stack.push(target);
    }
  }
  return { files, prefixes };
}

function suiteFiles() {
  return git('ls-files', 'tests/integration').split('\n').filter((f) => SUITE_PATTERNS.some((re) => re.test(f)));
}

function cutoverDependencies() {
  const suites = suiteFiles();
  if (suites.length === 0) throw new Error('no cutover suites found');
  const prefixes = new Set();
  for (const suite of suites) {
    const source = fs.readFileSync(path.join(ROOT, suite), 'utf8');
    for (const [, prefix] of source.matchAll(/\/api\/v1\/([a-z-]+(?:\/[a-z-]+)?)/g)) prefixes.add(prefix);
  }
  const known = Object.keys(EXERCISED_ROUTES);
  const unknown = [...prefixes].filter((p) => !known.some((k) => p === k || p.startsWith(`${k}/`) || k.startsWith(`${p}/`)));
  if (unknown.length) {
    console.log(`UNKNOWN_ROUTE_PREFIX=${unknown.join(',')} (using full createApp() closure)`);
    return importClosure(suites, new Set());
  }
  return importClosure([...suites, ...Object.values(EXERCISED_ROUTES), ...APP_MIDDLEWARE], new Set([EXPRESS]));
}

function classify(base, head, mode) {
  if (mode !== 'ci' && mode !== 'release') throw new Error(`unknown mode: ${mode}`);
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`head is not a full SHA: ${head}`);
  if (!base || /^0+$/.test(base)) throw new Error('no base commit');
  git('cat-file', '-e', `${base}^{commit}`);
  git('cat-file', '-e', `${head}^{commit}`);
  const changed = git('diff', '--name-only', '--no-renames', `${base}...${head}`).split('\n').filter(Boolean);
  const { files, prefixes } = cutoverDependencies();
  const reasons = [];
  for (const file of changed) {
    // Test files in the closure are verification inputs: they never ship.
    if (CI_ONLY_PATTERNS.some((re) => re.test(file)) || (files.has(file) && file.startsWith('tests/'))) {
      if (mode === 'ci') reasons.push(`${file} (cutover verification input)`);
    } else if (files.has(file)) reasons.push(`${file} (cutover import closure)`);
    else if ([...prefixes].some((p) => file.startsWith(p))) reasons.push(`${file} (unresolved workspace import)`);
    else if (RUNTIME_PATTERNS.some((re) => re.test(file))) reasons.push(`${file} (shipped runtime input)`);
  }
  console.log(`CUTOVER_MODE=${mode} CUTOVER_RANGE=${base}...${head} CHANGED_FILES=${changed.length} CLOSURE_FILES=${files.size}`);
  for (const reason of reasons) console.log(`CUTOVER_MATCH ${reason}`);
  return reasons.length > 0;
}

function main() {
  const args = process.argv.slice(2);
  const modeArg = args[0] && args[0].startsWith('--mode=') ? args.shift().slice('--mode='.length) : 'ci';
  const [base, head] = args;
  let required;
  try {
    required = classify(base, head, modeArg);
  } catch (error) {
    console.log(`CUTOVER_CLASSIFIER_FAIL_CLOSED reason=${String(error.message).split('\n')[0]}`);
    required = true;
  }
  console.log(`CUTOVER_REQUIRED=${required}`);
}

if (require.main === module) main();

module.exports = { cutoverDependencies };
