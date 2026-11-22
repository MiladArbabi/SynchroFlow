import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../..');

// ENV-DB-PARITY-01 — runs the DB-free node:test suite inside test:contract,
// following the GH-1131-B node-runner precedent.
describe('ENV-DB-PARITY-01 — development migration parity', () => {
  it('executes the read-only parity and startup-gate regressions', () => {
    const file = 'tests/contract/env-db-parity-01.test.mjs';
    const result = spawnSync(process.execPath, ['--test', file], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env: process.env,
    });

    if (result.error || result.status !== 0) {
      throw new Error(
        [
          `Node regression failed: ${file}`,
          `EXIT=${result.status}`,
          String(result.error ?? ''),
          result.stdout,
          result.stderr,
        ].join('\n').slice(-9000)
      );
    }
  });
});
