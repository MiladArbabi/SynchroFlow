import type { ProjectionStepResult } from 'api-src/workers/projection.db.worker';

const mockRaw = jest.fn();
const mockTransaction = jest.fn();
const mockWithTenant = jest.fn();

jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: mockRaw, transaction: mockTransaction },
  systemQuery: (query: unknown) => query,
  withTenant: mockWithTenant,
  runWithTenantContext: (_shopId: number, fn: () => unknown) => fn(),
  setTenantContext: jest.fn(),
}));
jest.mock('api-src/projection/projection.engine', () => ({ projectDomainEventCore: jest.fn() }));
jest.mock('api-src/projection/projection.utils', () => ({ debugLog: jest.fn() }));
jest.mock('api-src/workers/reconciliation/reconciliation.handlers', () => ({
  reconcileOrderFulfillment: jest.fn(),
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type ProjectionModule = {
  startDbProjectionWorker: (step?: () => Promise<ProjectionStepResult>) => Promise<void>;
  stopDbProjectionWorker?: () => Promise<void>;
};

function loadProjectionLifecycle(): Required<ProjectionModule> {
  const worker = require('api-src/workers/projection.db.worker') as ProjectionModule;
  expect(typeof worker.stopDbProjectionWorker).toBe('function');
  return worker as Required<ProjectionModule>;
}

describe('B4-S1-03 projection cycle-boundary shutdown', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRaw.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (fn: (trx: unknown) => unknown) => fn(jest.fn()));
    mockWithTenant.mockImplementation(async (_shopId: number, fn: (trx: unknown) => unknown) => fn(jest.fn()));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits for the current projection and reconciliation cycle and creates no further poll', async () => {
    const worker = loadProjectionLifecycle();
    const stepGate = deferred<ProjectionStepResult>();
    const step = jest.fn(() => stepGate.promise);
    const running = worker.startDbProjectionWorker(step);
    await jest.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopDbProjectionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    stepGate.resolve({ status: 'idle' });
    await stopping;
    await running;
    expect(mockRaw).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(step).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('B4-S1-04 projection supervisor intentional stop', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not log or restart a worker rejection caused after shutdown was requested', async () => {
    const runGate = deferred<void>();
    const stopWorker = jest.fn(() => {
      runGate.reject(new Error('projection stopped'));
      return Promise.resolve();
    });
    const startWorker = jest.fn(() => runGate.promise);
    jest.doMock('api-src/workers/projection.db.worker', () => ({
      startDbProjectionWorker: startWorker,
      stopDbProjectionWorker: stopWorker,
    }));

    const supervisor = require('api-src/workers/projectionWorkerSupervisor') as {
      startProjectionWorkerSupervisor: () => Promise<void>;
      stopProjectionWorkerSupervisor?: () => Promise<void>;
    };
    expect(typeof supervisor.stopProjectionWorkerSupervisor).toBe('function');

    const running = supervisor.startProjectionWorkerSupervisor();
    for (let turn = 0; turn < 10 && startWorker.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(startWorker).toHaveBeenCalledTimes(1);
    await supervisor.stopProjectionWorkerSupervisor!();
    await running;

    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(startWorker).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not launch projection work when stop is requested at the lazy-import boundary', async () => {
    const startWorker = jest.fn().mockResolvedValue(undefined);
    const stopWorker = jest.fn().mockResolvedValue(undefined);
    jest.doMock('api-src/workers/projection.db.worker', () => ({
      startDbProjectionWorker: startWorker,
      stopDbProjectionWorker: stopWorker,
    }));

    const supervisor = require('api-src/workers/projectionWorkerSupervisor') as {
      startProjectionWorkerSupervisor: () => Promise<void>;
      stopProjectionWorkerSupervisor: () => Promise<void>;
    };

    const running = supervisor.startProjectionWorkerSupervisor();
    const stopping = supervisor.stopProjectionWorkerSupervisor();
    await stopping;
    await running;

    expect(startWorker).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
