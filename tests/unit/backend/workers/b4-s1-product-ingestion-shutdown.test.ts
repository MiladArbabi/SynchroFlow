const mockConsume = jest.fn();
const mockCancel = jest.fn();
const mockAck = jest.fn();
const mockAddSetup = jest.fn();
const mockInsert = jest.fn();
const mockWithTenant = jest.fn();

const mockChannel = {
  consume: mockConsume,
  cancel: mockCancel,
  ack: mockAck,
  addSetup: mockAddSetup,
};

jest.mock('api-src/queue', () => ({
  getQueueChannel: jest.fn(() => mockChannel),
}));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  withTenant: mockWithTenant,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type ProductModule = {
  startProductIngestionWorker: () => Promise<void>;
  stopProductIngestionWorker: () => Promise<void>;
};

function loadLifecycle(): ProductModule {
  return require('api-src/workers/product-ingestion.worker') as ProductModule;
}

function message() {
  return {
    content: Buffer.from(JSON.stringify({
      shopId: 7,
      platform: 'shopify',
      rawProduct: { id: 'gid://shopify/Product/123', title: 'B4-S1 product' },
    })),
  };
}

describe('B4-S1 product-ingestion consumer shutdown', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAddSetup.mockResolvedValue(undefined);
    mockConsume.mockResolvedValue({ consumerTag: 'product-consumer-b4-s1' });
    mockCancel.mockResolvedValue(undefined);
    mockInsert.mockResolvedValue(1);
    mockWithTenant.mockImplementation(async (_shopId: number, callback: (trx: any) => unknown) => callback(
      jest.fn(() => ({ insert: mockInsert }))
    ));
  });

  afterEach(() => jest.restoreAllMocks());

  async function start(worker: ProductModule) {
    await worker.startProductIngestionWorker();
    expect(mockConsume).toHaveBeenCalledTimes(1);
    return mockConsume.mock.calls[0][1] as (msg: ReturnType<typeof message>) => Promise<void>;
  }

  it('reuses start/stop, cancels only its owned tag, and never duplicates an active consumer', async () => {
    const worker = loadLifecycle();
    await start(worker);
    await worker.startProductIngestionWorker();
    expect(mockConsume).toHaveBeenCalledTimes(1);

    await Promise.all([
      worker.stopProductIngestionWorker(),
      worker.stopProductIngestionWorker(),
    ]);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('product-consumer-b4-s1');

    mockConsume.mockResolvedValueOnce({ consumerTag: 'product-consumer-restarted' });
    await worker.startProductIngestionWorker();
    expect(mockConsume).toHaveBeenCalledTimes(2);
    await worker.stopProductIngestionWorker();
    expect(mockCancel).toHaveBeenLastCalledWith('product-consumer-restarted');
  });

  it('stop during asynchronous attachment cancels the late consumer without leaking it', async () => {
    const worker = loadLifecycle();
    const attachment = deferred<{ consumerTag: string }>();
    mockConsume.mockReturnValueOnce(attachment.promise);

    const starting = worker.startProductIngestionWorker();
    await Promise.resolve();
    let stopped = false;
    const stopping = worker.stopProductIngestionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    attachment.resolve({ consumerTag: 'late-product-consumer' });
    await Promise.all([starting, stopping]);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('late-product-consumer');
  });

  it('awaits in-flight domain-event persistence and ACK while preserving the catalog payload', async () => {
    const worker = loadLifecycle();
    const insertGate = deferred<number>();
    mockInsert.mockReturnValueOnce(insertGate.promise);
    const delivery = await start(worker);
    const activeMessage = message();
    delivery(activeMessage);
    await Promise.resolve();

    let stopped = false;
    const stopping = worker.stopProductIngestionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    insertGate.resolve(1);
    await stopping;
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      shop_id: 7,
      event_type: 'catalog/product_sync_received',
      event_payload: expect.objectContaining({ id: '123', title: 'B4-S1 product' }),
      event_version: 1,
      external_event_id: 'catalog_sync:7:gid://shopify/Product/123',
    }));
    expect(mockInsert.mock.invocationCallOrder[0]).toBeLessThan(
      mockAck.mock.invocationCallOrder[0]
    );
    expect(mockAck).toHaveBeenCalledWith(activeMessage);
  });

  it('preserves ACK-after-error behavior and stop waits for that delivery decision', async () => {
    const worker = loadLifecycle();
    const insertGate = deferred<void>();
    mockInsert.mockImplementationOnce(async () => {
      await insertGate.promise;
      throw new Error('synthetic product persistence failure');
    });
    const delivery = await start(worker);
    const failedMessage = message();
    delivery(failedMessage);
    await Promise.resolve();

    let stopped = false;
    const stopping = worker.stopProductIngestionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    insertGate.resolve();
    await stopping;
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith(failedMessage);
  });

  it('owns startup before addSetup so simultaneous starts and stop cannot leak attachment', async () => {
    const worker = loadLifecycle();
    const setupGate = deferred<void>();
    mockAddSetup.mockReturnValue(setupGate.promise);

    const firstStart = worker.startProductIngestionWorker();
    const secondStart = worker.startProductIngestionWorker();
    const stopping = worker.stopProductIngestionWorker();
    await Promise.resolve();
    expect(mockAddSetup).toHaveBeenCalledTimes(1);
    expect(mockConsume).not.toHaveBeenCalled();

    setupGate.resolve();
    await Promise.all([firstStart, secondStart, stopping]);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('fails startup visibly when consume does not return a nonempty consumer tag', async () => {
    const worker = loadLifecycle();
    mockConsume.mockResolvedValueOnce({ consumerTag: '' });
    await expect(worker.startProductIngestionWorker()).rejects.toThrow('consumerTag');
  });

  it('serializes a start requested while cancellation is still pending', async () => {
    const worker = loadLifecycle();
    await start(worker);
    const cancelGate = deferred<void>();
    mockCancel.mockReturnValueOnce(cancelGate.promise);

    const stopping = worker.stopProductIngestionWorker();
    const restarting = worker.startProductIngestionWorker();
    await Promise.resolve();
    expect(mockConsume).toHaveBeenCalledTimes(1);

    cancelGate.resolve();
    await Promise.all([stopping, restarting]);
    expect(mockConsume).toHaveBeenCalledTimes(2);
  });

  it('rejects graceful stop when a tracked delivery fails before its ACK decision', async () => {
    const worker = loadLifecycle();
    mockAck.mockImplementationOnce(() => { throw new Error('synthetic product ACK failure'); });
    const delivery = await start(worker);
    const callbackResult = delivery(message());
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(callbackResult).toBeUndefined();
    await expect(worker.stopProductIngestionWorker()).rejects.toThrow('synthetic product ACK failure');
  });
});
