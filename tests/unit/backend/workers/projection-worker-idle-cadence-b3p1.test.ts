import type { ProjectionStepResult } from 'api-src/workers/projection.db.worker';

// Exercise the real loop, sweep and scheduling with no database connection.
// Cursor/quarantine/RLS behavior remains covered by the neighboring real-DB suite.
const mockRaw = jest.fn();
const mockTransaction = jest.fn();
const mockWithTenant = jest.fn();
const mockReconcile = jest.fn();

jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: mockRaw, transaction: mockTransaction },
  systemQuery: (query: unknown) => query,
  withTenant: mockWithTenant,
  runWithTenantContext: (_shopId: number, fn: () => unknown) => fn(),
  setTenantContext: jest.fn(),
}));
jest.mock('api-src/projection/projection.engine', () => ({
  projectDomainEventCore: jest.fn(),
}));
jest.mock('api-src/projection/projection.utils', () => ({ debugLog: jest.fn() }));
jest.mock('api-src/workers/reconciliation/reconciliation.handlers', () => ({
  reconcileOrderFulfillment: mockReconcile,
}));

const DISCOVERY_SQL = 'SELECT * FROM public.list_reconciliation_intent_tenants()';
const STOP = new Error('synthetic end of controlled worker run');

describe('GATE 0-B3-P1 projection worker idle cadence', () => {
  let startWorker: typeof import('api-src/workers/projection.db.worker').startDbProjectionWorker;
  let step: jest.Mock<Promise<ProjectionStepResult>, []>;
  let intent: Record<string, unknown> | undefined;
  let order: Record<string, unknown> | undefined;
  let trx: jest.Mock & { raw: jest.Mock };

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    intent = undefined;
    order = undefined;
    trx = Object.assign(jest.fn((table: string) => ({
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      first: jest.fn(async () => table === 'order_reconciliation_intents' ? intent : order),
      delete: jest.fn(async () => 1),
    })), { raw: jest.fn(async () => ({ rows: [] })) });
    mockRaw.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(trx));
    mockWithTenant.mockImplementation(async (_shopId: number, fn: (t: unknown) => unknown) => fn(trx));
    mockReconcile.mockResolvedValue(undefined);
    step = jest.fn<Promise<ProjectionStepResult>, []>().mockRejectedValue(STOP);
    ({ startDbProjectionWorker: startWorker } = require('api-src/workers/projection.db.worker'));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Attach the rejection handler immediately; the next step deliberately fails
  // to terminate the infinite loop through its existing fatal/latch-reset path.
  function runWorker(): Promise<unknown> {
    return startWorker(step).then(
      () => { throw new Error('worker unexpectedly returned normally'); },
      (error: unknown) => error,
    );
  }

  async function expectCadence(result: ProjectionStepResult, delay: number): Promise<void> {
    step.mockResolvedValueOnce(result);
    const completion = runWorker();
    await jest.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(1);
    expect(mockRaw.mock.calls).toEqual([[DISCOVERY_SQL], [DISCOVERY_SQL]]);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(step).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(step).toHaveBeenCalledTimes(2);
    expect(await completion).toBe(STOP);
    expect(jest.getTimerCount()).toBe(0);
  }

  it('P1-01: a fully idle successful cycle waits 1,000 ms', async () => {
    await expectCadence({ status: 'idle' }, 1000);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('P1-02: projected waits 200 ms', async () => {
    await expectCadence({ status: 'projected', domainEventId: 1 }, 200);
  });

  it('P1-02: skipped waits 200 ms', async () => {
    await expectCadence({ status: 'skipped', domainEventId: 1, reason: 'duplicate' }, 200);
  });

  it('P1-02: quarantined waits 200 ms', async () => {
    await expectCadence({ status: 'quarantined', domainEventId: 1, errorTag: 'synthetic' }, 200);
  });

  it('P1-02: noop (including a transient sequence gap) waits 200 ms', async () => {
    await expectCadence({ status: 'noop' }, 200);
  });

  it('P1-03: discovering an intent retains 200 ms even if tenant refetch finds no row', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [{ reconciliation_intent_id: 'intent-1', shop_id: 7 }] });
    await expectCadence({ status: 'idle' }, 200);
    expect(mockWithTenant).toHaveBeenCalledWith(7, expect.any(Function));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('P1-03/04: reconciliation stays between initial discovery and final check and retains 200 ms', async () => {
    intent = {
      reconciliation_intent_id: 'intent-1', shop_id: 7,
      lasyncro_order_id: 'order-1', aggregate_version: 3,
      created_at: '2026-10-15T00:00:00.000Z',
    };
    order = { aggregate_version: 3 };
    mockRaw.mockResolvedValueOnce({ rows: [{ reconciliation_intent_id: 'intent-1', shop_id: 7 }] });
    await expectCadence({ status: 'idle' }, 200);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledWith('order-1', 3, undefined, intent.created_at, 7);
    expect(step.mock.invocationCallOrder[0]).toBeLessThan(mockRaw.mock.invocationCallOrder[0]);
    expect(mockRaw.mock.invocationCallOrder[0]).toBeLessThan(mockReconcile.mock.invocationCallOrder[0]);
    expect(mockReconcile.mock.invocationCallOrder[0]).toBeLessThan(mockRaw.mock.invocationCallOrder[1]);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(trx.raw).toHaveBeenCalledWith("SET LOCAL app.current_tenant = '7'");
  });

  it('P1-01/04: no sleep is scheduled until the final backlog check completes', async () => {
    let finishCheck!: (result: { rows: unknown[] }) => void;
    const finalCheck = new Promise<{ rows: unknown[] }>((resolve) => { finishCheck = resolve; });
    mockRaw.mockResolvedValueOnce({ rows: [] }).mockReturnValueOnce(finalCheck);
    step.mockResolvedValueOnce({ status: 'idle' });
    const completion = runWorker();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRaw.mock.calls).toEqual([[DISCOVERY_SQL], [DISCOVERY_SQL]]);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(1);

    finishCheck({ rows: [] });
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(step).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await completion).toBe(STOP);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('P1-04/05: remaining backlog fails hard without sleeping and releases the running latch', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}] });
    step.mockResolvedValueOnce({ status: 'idle' });
    const failure = await runWorker();
    expect(failure).toEqual(new Error('[RECONCILIATION_BACKLOG_VIOLATION] remaining_intents=1'));
    expect(mockRaw.mock.calls).toEqual([[DISCOVERY_SQL], [DISCOVERY_SQL]]);
    expect(console.error).toHaveBeenCalledWith('[projection-db-worker][FATAL]', failure);
    expect(jest.getTimerCount()).toBe(0);
    expect(await runWorker()).toBe(STOP);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('P1-05: initial discovery failure propagates without a polling sleep', async () => {
    const failure = new Error('synthetic initial discovery failure');
    step.mockResolvedValueOnce({ status: 'idle' });
    mockRaw.mockRejectedValueOnce(failure);
    expect(await runWorker()).toBe(failure);
    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('P1-05: final discovery failure propagates without a polling sleep', async () => {
    const failure = new Error('synthetic final discovery failure');
    step.mockResolvedValueOnce({ status: 'idle' });
    mockRaw.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure);
    expect(await runWorker()).toBe(failure);
    expect(mockRaw.mock.calls).toEqual([[DISCOVERY_SQL], [DISCOVERY_SQL]]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('P1-05: the real supervisor restarts a fatal run, which can then schedule a successful idle cycle', async () => {
    const { superviseProjectionWorker } = require('api-src/workers/projectionWorkerSupervisor');
    const failure = new Error('synthetic projection failure');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const logFatal = jest.fn();
    step.mockRejectedValueOnce(failure).mockResolvedValueOnce({ status: 'idle' });
    const completion = superviseProjectionWorker(() => startWorker(step), {
      sleep, logFatal, maxRestarts: 1,
    }).then(
      () => { throw new Error('supervisor unexpectedly returned normally'); },
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(logFatal).toHaveBeenCalledTimes(1);
    expect(logFatal).toHaveBeenCalledWith(failure);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(step).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(step).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(await completion).toBe(STOP);
    expect(step).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });
});
