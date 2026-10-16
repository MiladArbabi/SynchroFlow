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
  it('retains one supervised start and stopWorker awaits that owned operation', async () => {
    jest.resetModules();
    let finishSupervisor!: () => void;
    const supervisorRun = new Promise<void>((resolve) => { finishSupervisor = resolve; });
    const startSupervisor = jest.fn(() => supervisorRun);
    const stopSupervisor = jest.fn().mockResolvedValue(undefined);
    const channel = { addSetup: jest.fn() };

    jest.doMock('api-src/workers/projectionWorkerSupervisor', () => ({
      startProjectionWorkerSupervisor: startSupervisor,
      stopProjectionWorkerSupervisor: stopSupervisor,
    }));
    jest.doMock('api-src/queue', () => ({
      getQueueChannel: jest.fn(() => channel),
    }));
    jest.doMock('api-src/projection/projection.engine', () => ({
      projectDomainEventFromMessage: jest.fn(),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const worker = require('api-src/worker') as {
      startWorker: () => void;
      stopWorker: () => Promise<void>;
    };
    worker.startWorker();
    worker.startWorker();
    expect(startSupervisor).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopWorker().then(() => { stopped = true; });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(stopSupervisor).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);

    finishSupervisor();
    await stopping;
    expect(stopped).toBe(true);
    jest.restoreAllMocks();
  });
});
