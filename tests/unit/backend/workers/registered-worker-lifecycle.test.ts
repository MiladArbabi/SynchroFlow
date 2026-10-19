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
  'workers/notification-delivery.worker',
  'services/notifications/notificationDeliveryTransport.service',
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
  const startShopify = jest.fn();
  const stopShopify = jest.fn();
  const startGeneric = jest.fn();
  const originalWorkerRuntime = process.env.WORKER_RUNTIME;
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    delete process.env.WORKER_RUNTIME;
    jest.doMock('api-src/workers/domain-event-outbox.dispatcher', () => ({
      startShopifySyncIntentDispatcher: startShopify,
      stopShopifySyncIntentDispatcher: stopShopify,
      startDomainEventOutboxDispatcher: startGeneric,
    }));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const module of inactive) jest.doMock(`api-src/${module}`, () => ({}));
    jest.doMock('api-src/worker', () => ({ startWorker: startA, stopWorker: stopA }));
    jest.doMock('api-src/sync.worker', () => ({ startSyncWorker: startB, stopSyncWorker: stopB }));
  });
  afterEach(() => {
    if (originalWorkerRuntime === undefined) delete process.env.WORKER_RUNTIME;
    else process.env.WORKER_RUNTIME = originalWorkerRuntime;
    jest.restoreAllMocks();
  });

  it('owns exactly one Shopify-only app loop and waits for its drain', async () => {
    const workers = await import('api-src/bootstrap/workers');
    await Promise.all([workers.startWorkers(), workers.startWorkers()]);
    expect(startShopify).toHaveBeenCalledTimes(1);
    expect(startGeneric).not.toHaveBeenCalled();
    const gate = deferred();
    stopShopify.mockReturnValue(gate.promise);
    let drained = false;
    const stopping = workers.stopWorkers().then(() => { drained = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopShopify).toHaveBeenCalledTimes(1);
    expect(drained).toBe(false);
    gate.resolve();
    await stopping;
    expect(drained).toBe(true);
  });

  it('leaves Shopify dispatch to worker-entry when WORKER_RUNTIME=true', async () => {
    process.env.WORKER_RUNTIME = 'true';
    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    await workers.stopWorkers();
    expect(startShopify).not.toHaveBeenCalled();
    expect(stopShopify).not.toHaveBeenCalled();
    expect(startGeneric).not.toHaveBeenCalled();
  });

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
  it('composes notification delivery transport once and owns its awaited stop', async () => {
    const transport = jest.fn();
    const createTransport = jest.fn(() => transport);
    const startNotification = jest.fn();
    const stopNotification = jest.fn();

    jest.doMock(
      'api-src/workers/notification-delivery.worker',
      () => ({
        startNotificationDeliveryWorker: startNotification,
        stopNotificationDeliveryWorker: stopNotification,
      }),
    );

    jest.doMock(
      'api-src/services/notifications/notificationDeliveryTransport.service',
      () => ({
        createNotificationDeliveryTransport: createTransport,
      }),
    );

    const workers = await import('api-src/bootstrap/workers');

    await workers.startWorkers();

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(startNotification).toHaveBeenCalledTimes(1);
    expect(startNotification).toHaveBeenCalledWith(transport);

    const gate = deferred();
    stopNotification.mockReturnValue(gate.promise);

    let settled = false;
    const stopping = workers.stopWorkers().then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(stopNotification).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    gate.resolve();
    await stopping;

    expect(settled).toBe(true);
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

  it('owns and awaits the existing projection owner without duplicate supervisor startup', async () => {
    const projectionGate = deferred();
    const startProjection = jest.fn();
    jest.doMock('api-src/workers/projectionWorkerSupervisor', () => ({
      startProjectionWorkerSupervisor: startProjection,
    }));

    const realOwner = jest.requireActual('api-src/worker') as {
      startWorker: () => unknown;
      stopWorker?: () => Promise<void>;
    };
    expect(typeof realOwner.startWorker).toBe('function');
    expect(typeof realOwner.stopWorker).toBe('function');

    stopA.mockReturnValue(projectionGate.promise);

    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();

    expect(startA).toHaveBeenCalledTimes(1);
    expect(startProjection).not.toHaveBeenCalled();

    let settled = false;
    const stopping = workers.stopWorkers().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    projectionGate.resolve();
    await stopping;
    expect(settled).toBe(true);
  });

  it('starts sync and product consumers once and awaits both registered drains', async () => {
    const syncGate = deferred();
    const productGate = deferred();
    const startProduct = jest.fn();
    const stopProduct = jest.fn(() => productGate.promise);
    stopB.mockReturnValue(syncGate.promise);
    jest.doMock('api-src/workers/product-ingestion.worker', () => ({
      startProductIngestionWorker: startProduct,
      stopProductIngestionWorker: stopProduct,
    }));

    const workers = await import('api-src/bootstrap/workers');
    await workers.startWorkers();
    expect(startB).toHaveBeenCalledTimes(1);
    expect(startProduct).toHaveBeenCalledTimes(1);

    let settled = false;
    const stopping = workers.stopWorkers().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(stopProduct).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    syncGate.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    productGate.resolve();
    await stopping;
    expect(settled).toBe(true);
  });
});

describe('GH-1262 D1 — real Shopify loop during deferred bootstrap', () => {
  const query = jest.fn();
  const originalWorkerRuntime = process.env.WORKER_RUNTIME;

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
    delete process.env.WORKER_RUNTIME;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const module of inactive) jest.doMock(`api-src/${module}`, () => ({}));
    jest.doMock('api-src/worker', () => ({}));
    jest.doMock('api-src/sync.worker', () => ({}));
    jest.doMock('api-src/workers/domain-event-outbox.dispatcher', () =>
      jest.requireActual('api-src/workers/domain-event-outbox.dispatcher'));
    jest.doMock('@lasyncro/backend-core/db.js', () => ({
      __esModule: true,
      default: { raw: (sql: string) => ({ sql }) },
      systemQuery: (statement: { sql: string }) => query(statement),
    }));
    jest.doMock('api-src/api/billing/stripe.meter.service', () => ({
      deliverStripeOverageEvent: jest.fn(),
    }));
    jest.doMock('api-src/api/billing/shopify.events.service', () => ({
      deliverShopifyOverageEvent: jest.fn(),
    }));
    jest.doMock('api-src/queue', () => ({
      getQueueChannel: () => { throw new Error('UNEXPECTED_PUBLISH_FOR_IDLE_INTENT'); },
    }));
    query.mockResolvedValue({ rows: [] });
  });

  afterEach(async () => {
    const dispatcher = await import('api-src/workers/domain-event-outbox.dispatcher');
    await dispatcher.stopShopifySyncIntentDispatcher();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalWorkerRuntime === undefined) delete process.env.WORKER_RUNTIME;
    else process.env.WORKER_RUNTIME = originalWorkerRuntime;
  });

  it('initiates zero new claims after stop while product initialization is deferred', async () => {
    const entered = deferred();
    const initialization = deferred();
    const stopProduct = jest.fn();
    jest.doMock('api-src/workers/product-ingestion.worker', () => ({
      startProductIngestionWorker: () => { entered.resolve(); return initialization.promise; },
      stopProductIngestionWorker: stopProduct,
    }));
    const workers = await import('api-src/bootstrap/workers');
    const starting = workers.startWorkers();
    await entered.promise;
    await jest.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(1);
    const claimsBeforeStop = query.mock.calls.length;
    const stopping = workers.stopWorkers();
    expect(workers.stopWorkers()).toBe(stopping);
    expect(workers.startWorkers()).toBe(starting);
    try {
      await jest.advanceTimersByTimeAsync(1000);
      const newClaimsWhileStopping = query.mock.calls.length - claimsBeforeStop;
      expect(newClaimsWhileStopping).toBe(0);
      expect(query.mock.calls.every(([statement]) =>
        statement.sql === 'SELECT * FROM public.claim_shopify_sync_dispatch_outbox()')).toBe(true);
    } finally {
      initialization.resolve();
      await Promise.all([starting, stopping]);
    }
    expect(stopProduct).toHaveBeenCalledTimes(1);
    await workers.stopWorkers();
    await jest.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(claimsBeforeStop);
  });

  it('retains a stop hook registered after shutdown was requested', async () => {
    const entered = deferred();
    const initialization = deferred();
    const stopExchange = jest.fn();
    jest.doMock('api-src/workers/exchange-rate.worker', () => ({
      startExchangeRateWorker: () => { entered.resolve(); return initialization.promise; },
      stopExchangeRateWorker: stopExchange,
    }));
    const workers = await import('api-src/bootstrap/workers');
    const starting = workers.startWorkers();
    await entered.promise;
    await jest.advanceTimersByTimeAsync(0);
    const claimsBeforeStop = query.mock.calls.length;
    const stopping = workers.stopWorkers();
    try {
      expect(stopExchange).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);
      expect(query).toHaveBeenCalledTimes(claimsBeforeStop);
    } finally {
      initialization.resolve();
      await Promise.all([starting, stopping]);
    }
    expect(stopExchange).toHaveBeenCalledTimes(1);
  });

  it('awaits the original in-flight claim after pending bootstrap has finished', async () => {
    const entered = deferred();
    const initialization = deferred();
    const claim = deferred();
    query.mockImplementation(() => claim.promise.then(() => ({ rows: [] })));
    jest.doMock('api-src/workers/product-ingestion.worker', () => ({
      startProductIngestionWorker: () => { entered.resolve(); return initialization.promise; },
      stopProductIngestionWorker: jest.fn(),
    }));
    const workers = await import('api-src/bootstrap/workers');
    const starting = workers.startWorkers();
    await entered.promise;
    await jest.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(1);
    let drained = false;
    const stopping = workers.stopWorkers().then(() => { drained = true; });
    try {
      initialization.resolve();
      await starting;
      await jest.advanceTimersByTimeAsync(1000);
      expect(drained).toBe(false);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      initialization.resolve();
      claim.resolve();
      await Promise.all([starting, stopping]);
    }
    expect(drained).toBe(true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
