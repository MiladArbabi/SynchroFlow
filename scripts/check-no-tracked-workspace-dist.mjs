#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const tracked = execFileSync(
  'git',
  ['ls-files'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const trackedDist = tracked.filter((file) =>
  /^(packages|modules)\/[^/]+\/dist\//.test(file)
);

let failed = false;

if (trackedDist.length > 0) {
  failed = true;
  console.error(
    `FAIL: ${trackedDist.length} generated workspace dist file(s) are tracked by Git:`
  );

  for (const file of trackedDist) {
    console.error(`  ${file}`);
  }
} else {
  console.log('TRACKED_WORKSPACE_DIST=0');
}

const ignoreProbes = [
  'packages/__build_guard__/dist/__generated__.js',
  'modules/__build_guard__/dist/__generated__.js',
];

for (const probe of ignoreProbes) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '-q', '--', probe],
    {
      cwd: ROOT,
      stdio: 'ignore',
    }
  );

  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL: generated workspace artifact is not ignored: ${probe}`);
  } else {
    console.log(`IGNORED=${probe}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('GENERATED_ARTIFACT_OWNERSHIP=PASS');
