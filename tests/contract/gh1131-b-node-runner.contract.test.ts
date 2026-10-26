import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../..');

function runNodeSuite(file: string) {
  const result = spawnSync(
    process.execPath,
    ['--test', file],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env: process.env
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `Node regression failed: ${file}`,
        `EXIT=${result.status}`,
        String(result.error ?? ''),
        result.stdout,
        result.stderr
      ].join('\n').slice(-9000)
    );
  }
}

describe('GH-1131-B — Node behavioral regression coverage', () => {
  it('executes the seven supervisor-core regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-supervisor-behavior.test.mjs'
    );
  });

  it('executes the runtime coordination regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-runtime.test.mjs'
    );
  });

  it('executes the process lifecycle regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-process-adapter.test.mjs'
    );
  });

  it('verifies disposable real Node process termination', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-real-process.test.mjs'
    );
  });

  it('executes filesystem watcher regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-watcher.test.mjs'
    );
  });

  it('executes CLI failure-safety regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-cli-safety.test.mjs'
    );
  });

  it('executes end-to-end lifecycle wiring regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-assembly.test.mjs'
    );
  });

  it('executes real entry-point adapter regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-entry.test.mjs'
    );
  });

  it('executes active compiler cancellation regressions', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-compile-cancel.test.mjs'
    );
  });

  it('verifies compiler process-tree termination', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-process-tree.test.mjs'
    );
  });

  it('verifies executable startup safety contracts', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-executable.test.mjs'
    );
  });

  it('verifies real watcher and SIGTERM lifecycle', () => {
    runNodeSuite(
      'tests/contract/gh1131-b-controlled-lifecycle.test.mjs'
    );
  });
});
