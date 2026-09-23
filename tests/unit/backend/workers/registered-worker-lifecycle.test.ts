function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const inactive = [
  'workers/product-ingestion.worker', 'workers/wms.batch.auto-release.worker',
  'workers/projections/shopSnapshotJob.dispatcher', 'workers/stockProtectionReconciliation.worker',
  'workers/wms.idle.alert.worker', 'workers/reviewer-activity-refresh.worker',
  'workers/trial-expiry.worker', 'workers/shopifyUninstallGrace.worker',
  'workers/shopifyBillingReconciliation.worker', 'workers/margin-snapshot-integrity.worker',
  'workers/carrier-stall-detection.worker', 'workers/carrier-tracking-reconciliation.worker',
  'workers/morning-brief.worker', 'workers/exchange-rate.worker',
  'workers/reconciliation/reconciliation.consumer', 'execution/execution.registry',
  'execution/handlers/proceed_fulfillment.handler', 'execution/handlers/resolve_operational_block.handler',
  'execution/handlers/resolve_inventory_block.handler', 'execution/handlers/resolve_customer_block.handler',
  'workers/execution.worker', 'workers/execution.dispatcher.worker', 'workers/commands.consumer',
];

describe('registered worker lifecycle', () => {
  const startA = jest.fn();
  const startB = jest.fn();
  const stopA = jest.fn();
  const stopB = jest.fn();
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const module of inactive) jest.doMock(`api-src/${module}`, () => ({}));
    jest.doMock('api-src/worker', () => ({ startWorker: startA, stopWorker: stopA }));
    jest.doMock('api-src/sync.worker', () => ({ startSyncWorker: startB, stopSyncWorker: stopB }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('concurrent stops share one operation and invoke each callback once', async () => {
    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    const gate = deferred();
    stopA.mockReturnValue(gate.promise);
    const a = workers.stopWorkers();
    const b = workers.stopWorkers();
    gate.resolve();
    await Promise.all([a, b]);
    expect(a).toBe(b);
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
  });
  it('requests B while A remains deferred', async () => {
    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    const gate = deferred();
    stopA.mockReturnValue(gate.promise);
    const stopped = workers.stopWorkers();
    await Promise.resolve();
    await Promise.resolve();
    const callsBeforeRelease = stopB.mock.calls.length;
    gate.resolve();
    await stopped;
    expect(callsBeforeRelease).toBe(1);
  });
  it('surfaces rejection after requesting other stops', async () => {
    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    stopA.mockRejectedValue(new Error('stop A failed'));
    await expect(workers.stopWorkers()).rejects.toThrow();
    expect(stopB).toHaveBeenCalledTimes(1);
  });
  it('stop before startup and repeated stop are safe', async () => {
    const workers = await import('api-src/bootstrap/workers');
    await workers.stopWorkers();
    await workers.stopWorkers();
    expect(stopA).not.toHaveBeenCalled();
    expect(stopB).not.toHaveBeenCalled();
  });
  it('stop while the first lazy import is pending prevents a late start', async () => {
    const workers = await import('api-src/bootstrap/workers');
    const starting = workers.startWorkers();
    await workers.stopWorkers();
    await starting;
    expect(startA).not.toHaveBeenCalled();
    expect(startB).not.toHaveBeenCalled();
  });
  it('owns a partially failed awaited start and already-started workers', async () => {
    const stopProduct = jest.fn();
    jest.doMock('api-src/workers/product-ingestion.worker', () => ({
      startProductIngestionWorker: jest.fn().mockRejectedValue(new Error('partially attached')),
      stopProductIngestionWorker: stopProduct,
    }));
    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    await workers.stopWorkers();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(stopProduct).toHaveBeenCalledTimes(1);
  });
  it('waits for an owned finite start and blocks later starts during shutdown', async () => {
    const gate = deferred();
    const entered = deferred();
    const stopProduct = jest.fn();
    const lateStart = jest.fn();
    jest.doMock('api-src/workers/product-ingestion.worker', () => ({
      startProductIngestionWorker: () => { entered.resolve(); return gate.promise; },
      stopProductIngestionWorker: stopProduct,
    }));
    jest.doMock('api-src/workers/wms.batch.auto-release.worker', () => ({ startWmsBatchAutoReleaseWorker: lateStart }));
    const workers = await import('api-src/bootstrap/workers');
    const starting = workers.startWorkers();
    await entered.promise;
    let settled = false;
    const stopped = workers.stopWorkers().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const prematurelySettled = settled;
    gate.resolve();
    await Promise.all([starting, stopped]);
    expect(prematurelySettled).toBe(false);
    expect(stopProduct).toHaveBeenCalledTimes(1);
    expect(lateStart).not.toHaveBeenCalled();
  });
});
