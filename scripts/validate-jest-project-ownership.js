#!/usr/bin/env node
/* scripts/validate-jest-project-ownership.js
 *
 * TEST-INFRA-FOUNDATION — Jest project ownership validator.
 *
 * Read-only. Verifies that every Jest test candidate under tests/**\/*.test.ts
 * and tests/**\/*.test.tsx, plus mobile .test.ts(x) candidates, belongs
 * to exactly one root project or the isolated mobile runner. Every collection discovers at
 * least one test (so a project can't silently target a directory that no
 * longer exists — the api-ui/tests/unit/api mistake this replaces).
 *
 * Playwright *.spec.ts files are outside this contract and are never touched.
 *
 * Usage:
 *   node scripts/validate-jest-project-ownership.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');
const MOBILE_DIR = path.join(ROOT_DIR, 'apps/mobile');
const MOBILE_TESTS_DIR = path.join(MOBILE_DIR, '__tests__');
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Recursively collect every tests/**\/*.test.ts(x) candidate as an absolute path. */
function collectCandidates(dir) {
  const results = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read tests directory "${dir}": ${err.message}`);
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectCandidates(full));
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      results.push(path.resolve(full));
    }
  }

  return results;
}

/** Load the configured Jest project display names from jest.config.js. */
function loadConfiguredProjectNames() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const jestConfig = require(path.join(ROOT_DIR, 'jest.config.js'));
  const projects = jestConfig.projects || [];

  return projects
    .map((project) => project.displayName)
    .filter((name) => typeof name === 'string' && name.length > 0);
}

/** Ask the real Jest CLI which test files a given project discovers. */
function discoverProjectTests(projectName) {
  let stdout;
  try {
    stdout = execFileSync(
      'npx',
      ['--no-install', 'jest', '--listTests', '--selectProjects', projectName, '--no-cache', '--no-watchman'],
      { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    throw new Error(
      `jest --listTests failed for project "${projectName}": ${err.stderr || err.message}`
    );
  }

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => TEST_FILE_PATTERN.test(line))
    .map((line) => path.resolve(line));
}

function relativeToRoot(absPath) {
  return path.relative(ROOT_DIR, absPath);
}

function discoverMobileTests() {
  try {
    return JSON.parse(execFileSync(process.execPath, [
      path.join(MOBILE_DIR, 'node_modules/jest/bin/jest.js'),
      '--config', path.join(MOBILE_DIR, 'jest.config.js'),
      '--listTests', '--json', '--runInBand', '--no-cache', '--no-watchman',
    ], { cwd: MOBILE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (err) {
    throw new Error(`Mobile jest --listTests failed: ${err.stderr || err.message}`);
  }
}

function isWithin(file, dir) {
  return file.startsWith(`${dir}${path.sep}`);
}

function main() {
  const candidates = [...collectCandidates(TESTS_DIR), ...collectCandidates(MOBILE_TESTS_DIR)];
  const candidateSet = new Set(candidates);

  const projectNames = loadConfiguredProjectNames();

  if (projectNames.length === 0) {
    console.error('FATAL: jest.config.js declares no projects with a displayName.');
    process.exit(1);
  }
  if (projectNames.includes('mobile')) throw new Error('Root project name collides with mobile.');
  const collectionNames = [...projectNames, 'mobile'];

  /** @type {Map<string, Set<string>>} absolute test path -> set of owning project names */
  const ownership = new Map();
  /** @type {Record<string, number>} */
  const perProjectCounts = {};
  const zeroDiscoveryProjects = [];
  const rootMobileClaims = [];
  const mobileOutsideClaims = [];

  for (const projectName of collectionNames) {
    const discovered = projectName === 'mobile'
      ? discoverMobileTests() : discoverProjectTests(projectName);
    perProjectCounts[projectName] = discovered.length;

    if (discovered.length === 0) {
      zeroDiscoveryProjects.push(projectName);
    }

    for (const filePath of discovered) {
      if (projectName !== 'mobile' && isWithin(filePath, MOBILE_TESTS_DIR)) {
        rootMobileClaims.push(`${projectName}: ${relativeToRoot(filePath)}`);
      }
      if (projectName === 'mobile' && !isWithin(filePath, MOBILE_TESTS_DIR)) {
        mobileOutsideClaims.push(relativeToRoot(filePath));
      }
      candidateSet.add(filePath); // union, in case discovery finds something the fs walk missed
      if (!ownership.has(filePath)) ownership.set(filePath, new Set());
      ownership.get(filePath).add(projectName);
    }
  }

  const unowned = [];
  const multiOwned = [];

  for (const filePath of candidateSet) {
    const owners = ownership.get(filePath) || new Set();
    if (owners.size === 0) unowned.push(filePath);
    else if (owners.size > 1) multiOwned.push(filePath);
  }

  unowned.sort();
  multiOwned.sort();

  for (const projectName of collectionNames) {
    console.log(`PROJECT=${projectName} TEST_COUNT=${perProjectCounts[projectName]}`);
  }
  console.log(`UNOWNED=${unowned.length}`);
  console.log(`MULTI_OWNED=${multiOwned.length}`);
  console.log(`ROOT_MOBILE_CLAIMS=${rootMobileClaims.length}`);
  console.log(`MOBILE_OUTSIDE_CLAIMS=${mobileOutsideClaims.length}`);

  let failed = false;
  if (rootMobileClaims.length || mobileOutsideClaims.length) {
    failed = true;
    console.error('Runner isolation violations:');
    for (const claim of [...rootMobileClaims, ...mobileOutsideClaims]) console.error(`  ${claim}`);
  }

  if (unowned.length > 0) {
    failed = true;
    console.error('\nUNOWNED test candidates (belong to zero configured projects):');
    for (const filePath of unowned) console.error(`  ${relativeToRoot(filePath)}`);
  }

  if (multiOwned.length > 0) {
    failed = true;
    console.error('\nMULTI_OWNED test candidates (belong to more than one configured project):');
    for (const filePath of multiOwned) {
      const owners = Array.from(ownership.get(filePath)).sort().join(', ');
      console.error(`  ${relativeToRoot(filePath)}  [${owners}]`);
    }
  }

  // Every currently configured project is required to discover at least one
  // test. This is intentionally derived from jest.config.js rather than a
  // hardcoded name list: once backend-legacy is fully drained in a future
  // slice, it (and this requirement) simply won't be present in the config
  // anymore — "backend-legacy may only be required non-zero while legacy
  // remains" falls out of that automatically.
  if (zeroDiscoveryProjects.length > 0) {
    failed = true;
    console.error('\nConfigured projects with zero discovered tests:');
    for (const projectName of zeroDiscoveryProjects) console.error(`  ${projectName}`);
  }

  if (failed) {
    process.exit(1);
  }
}

main();
