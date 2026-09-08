/**
 * GH-1052 — authoritative projection worker supervision.
 *
 * A fatal rejection from startDbProjectionWorker must never leave the
 * process alive with the projection loop permanently stopped.
 *
 * The projection worker owns deterministic projection state, so its
 * supervisor must:
 *   1. own/recover the rejected promise;
 *   2. log the failure;
 *   3. delay before retrying;
 *   4. start the worker again.
 *
 * The HTTP process itself must remain alive — server.ts deliberately
 * contains unrelated background-worker failures after the v270 outage.
 */

import { superviseProjectionWorker } from 'api-src/workers/projectionWorkerSupervisor';

describe('GH-1052 — projection worker supervision', () => {
  it('restarts the authoritative projection worker after a fatal rejection', async () => {
    const fatal = new Error('synthetic projection fatal');

    const start = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(fatal)
      .mockResolvedValueOnce(undefined);

    const sleep = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    const logFatal = jest.fn();

    await superviseProjectionWorker(start, {
      restartDelayMs: 1000,
      sleep,
      logFatal,
      maxRestarts: 1,
    });

    expect(start).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(logFatal).toHaveBeenCalledTimes(1);
    expect(logFatal).toHaveBeenCalledWith(fatal);
  });
});

describe('GH-1052 — runtime ownership wiring', () => {
  it('routes the authoritative worker through supervision and makes fatal runs restartable', () => {
    const fs = require('fs');
    const path = require('path');

    const workerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/backend/src/worker.ts'),
      'utf8'
    );

    const projectionSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'apps/backend/src/workers/projection.db.worker.ts'
      ),
      'utf8'
    );

    // The transport worker must own the supervisor promise. Reintroducing the
    // old detached dynamic start would recreate GH-1052.
    expect(workerSource).toContain(
      "import { startProjectionWorkerSupervisor } from './workers/projectionWorkerSupervisor.js';"
    );
    expect(workerSource).toContain(
      'void startProjectionWorkerSupervisor().catch'
    );
    expect(workerSource).not.toContain(
      '.then(({ startDbProjectionWorker }) =>'
    );

    // A fatal run must release the module-level latch before rejection reaches
    // the supervisor; otherwise its retry returns immediately through
    // `if (running) return`.
    const fatalStart = projectionSource.indexOf(
      "console.error('[projection-db-worker][FATAL]', err);"
    );
    const reset = projectionSource.indexOf('running = false;', fatalStart);
    const rethrow = projectionSource.indexOf('throw err;', fatalStart);

    expect(fatalStart).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(fatalStart);
    expect(rethrow).toBeGreaterThan(reset);
  });
});
