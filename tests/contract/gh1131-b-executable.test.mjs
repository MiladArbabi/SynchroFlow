import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const executable = 'scripts/dev-backend-supervisor.mjs';

function run(args) {
  return spawnSync(
    process.execPath,
    [executable, ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 4000,
    }
  );
}

test('check mode validates executable without starting services', () => {
  const result = run(['--check']);

  assert.ifError(result.error);

  assert.equal(
    result.status,
    0,
    result.stderr
  );

  assert.match(
    result.stdout,
    /GH1131_B_EXECUTABLE_CHECK=PASS/
  );

  assert.doesNotMatch(
    result.stdout + result.stderr,
    /Server listening|Worker runtime|npm run build:dev/
  );
});

test('unsupported executable arguments fail closed', () => {
  const result = run(['--unsupported']);

  assert.ifError(result.error);

  assert.equal(result.status, 2);

  assert.match(
    result.stderr,
    /Usage:/
  );
});
