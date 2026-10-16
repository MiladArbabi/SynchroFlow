const mockListPending = jest.fn();
const mockEnqueue = jest.fn();
const mockUpdate = jest.fn();
const mockFirst = jest.fn();

jest.mock('@lasyncro/backend-core/services/pre-tenant.service.js', () => ({
  listPendingDecisionExecutions: mockListPending,
}));
jest.mock('api-src/queues/execution.queue', () => ({
  enqueueExecutionJob: mockEnqueue,
}));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  runWithTenantContext: (_shopId: number, fn: () => unknown) => fn(),
  withTenant: (_shopId: number, fn: (trx: unknown) => unknown) => fn(
    Object.assign(jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      first: mockFirst,
      update: mockUpdate,
    })), { fn: { now: jest.fn() } })
  ),
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type DispatcherModule = {
  startExecutionDispatcher: () => Promise<void>;
  stopExecutionDispatcher?: () => Promise<void>;
};

function loadLifecycle(): Required<DispatcherModule> {
  const worker = require('api-src/workers/execution.dispatcher.worker') as DispatcherModule;
  expect(typeof worker.stopExecutionDispatcher).toBe('function');
  return worker as Required<DispatcherModule>;
}

describe('B4-S1-02 execution dispatcher shutdown', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockListPending.mockResolvedValue([]);
    mockFirst.mockResolvedValue({
      id: 'decision-1', shop_id: 7, aggregate_version: 1,
      entity_id: 'order-1',
      recommended_action: {
        type: 'resolve_operational_block', execution_mode: 'automated', payload: {},
      },
    });
    mockEnqueue.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(1);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stop prevents future polls and resolves the active dispatcher run', async () => {
    const worker = loadLifecycle();
    const running = worker.startExecutionDispatcher();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockListPending).toHaveBeenCalledTimes(1);

    await worker.stopExecutionDispatcher();
    await running;
    await jest.advanceTimersByTimeAsync(5_000);

    expect(mockListPending).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stop awaits the active DB to RabbitMQ to durable status-update operation', async () => {
    const worker = loadLifecycle();
    const enqueueGate = deferred<void>();
    mockListPending.mockResolvedValueOnce([{
      id: 'queue-1', decision_id: 'decision-1', shop_id: 7,
      status: 'pending', created_at: '2026-10-16T00:00:00.000Z',
    }]);
    mockEnqueue.mockReturnValueOnce(enqueueGate.promise);

    const running = worker.startExecutionDispatcher();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopExecutionDispatcher().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();

    enqueueGate.resolve();
    await stopping;
    await running;
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'dispatched' });
  });

  it('repeated stop is safe and start after stop begins a new polling run', async () => {
    const worker = loadLifecycle();
    const firstRun = worker.startExecutionDispatcher();
    await jest.advanceTimersByTimeAsync(0);
    await Promise.all([
      worker.stopExecutionDispatcher(),
      worker.stopExecutionDispatcher(),
    ]);
    await firstRun;

    const pollsAfterFirstRun = mockListPending.mock.calls.length;
    const secondRun = worker.startExecutionDispatcher();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockListPending).toHaveBeenCalledTimes(pollsAfterFirstRun + 1);
    await worker.stopExecutionDispatcher();
    await secondRun;
  });
});
