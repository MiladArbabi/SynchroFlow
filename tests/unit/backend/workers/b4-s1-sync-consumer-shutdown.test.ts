const mockConsume = jest.fn();
const mockCancel = jest.fn();
const mockAck = jest.fn();
const mockNack = jest.fn();
const mockRaw = jest.fn();
const mockWithTenant = jest.fn();
const mockResolveCredential = jest.fn();
const mockPerformSmartSync = jest.fn();

const mockChannel = {
  consume: mockConsume,
  cancel: mockCancel,
  ack: mockAck,
  nack: mockNack,
};

jest.mock('api-src/queue', () => ({
  getQueueChannel: jest.fn(() => mockChannel),
}));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: mockRaw },
  systemQuery: (query: unknown) => query,
  withTenant: mockWithTenant,
}));
jest.mock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  resolveShopifyAdminCredentialForConsumer: mockResolveCredential,
}));
jest.mock('api-src/services/shopify-sync-orchestrator.service', () => ({
  performSmartSync: mockPerformSmartSync,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type SyncModule = {
  startSyncWorker: () => void | Promise<void>;
  stopSyncWorker?: () => Promise<void>;
};

function loadLifecycle(): Required<SyncModule> {
  const worker = require('api-src/sync.worker') as SyncModule;
  expect(typeof worker.stopSyncWorker).toBe('function');
  return worker as Required<SyncModule>;
}

function message() {
  return { content: Buffer.from(JSON.stringify({ integrationId: 41 })) };
}

describe('B4-S1 sync consumer shutdown', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockConsume.mockResolvedValue({ consumerTag: 'sync-consumer-b4-s1' });
    mockCancel.mockResolvedValue(undefined);
    mockRaw.mockResolvedValue({ rows: [{ shop_id: 7 }] });
    mockWithTenant.mockImplementation(async (_shopId: number, callback: (trx: any) => unknown) => {
      const query = {
        where: jest.fn(),
        select: jest.fn(),
        first: jest.fn().mockResolvedValue({
        id: 41, shop_id: 7, platform: 'shopify', platform_shop_name: 'b4-s1.myshopify.com',
        }),
        update: jest.fn().mockResolvedValue(1),
      };
      query.where.mockReturnValue(query);
      query.select.mockReturnValue(query);
      const trx = jest.fn(() => query);
      return callback(trx);
    });
    mockResolveCredential.mockResolvedValue({
      kind: 'READY',
      accessToken: 'synthetic-token',
      shopDomain: 'b4-s1.myshopify.com',
      installationId: 5,
      generation: '4',
    });
    mockPerformSmartSync.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  async function start(worker: Required<SyncModule>) {
    await Promise.resolve(worker.startSyncWorker());
    await Promise.resolve();
    expect(mockConsume).toHaveBeenCalledTimes(1);
    return mockConsume.mock.calls[0][1] as (msg: ReturnType<typeof message>) => Promise<void>;
  }

  it('retains its consumer tag, cancels only that consumer, and repeated stops are safe', async () => {
    const worker = loadLifecycle();
    await start(worker);

    await Promise.all([worker.stopSyncWorker(), worker.stopSyncWorker()]);

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('sync-consumer-b4-s1');
  });

  it('stop during asynchronous attachment cancels the late consumer without leaking it', async () => {
    const worker = loadLifecycle();
    const attachment = deferred<{ consumerTag: string }>();
    mockConsume.mockReturnValueOnce(attachment.promise);

    const starting = Promise.resolve(worker.startSyncWorker());
    await Promise.resolve();
    let stopped = false;
    const stopping = worker.stopSyncWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    attachment.resolve({ consumerTag: 'late-sync-consumer' });
    await Promise.all([starting, stopping]);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('late-sync-consumer');
  });

  it('rejects post-cancel deliveries and awaits active sync through its ACK decision', async () => {
    const worker = loadLifecycle();
    const syncGate = deferred<void>();
    mockPerformSmartSync.mockReturnValueOnce(syncGate.promise);
    const delivery = await start(worker);
    const activeMessage = message();
    delivery(activeMessage);
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(mockPerformSmartSync).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopSyncWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    await delivery(message());
    expect(mockPerformSmartSync).toHaveBeenCalledTimes(1);

    syncGate.resolve();
    await stopping;
    expect(mockPerformSmartSync.mock.invocationCallOrder[0]).toBeLessThan(
      mockAck.mock.invocationCallOrder[0]
    );
    expect(mockNack).not.toHaveBeenCalled();
  });

  it('does not report a slow sync drained while it remains active at the process deadline boundary', async () => {
    jest.useFakeTimers();
    const worker = loadLifecycle();
    const syncGate = deferred<void>();
    mockPerformSmartSync.mockReturnValueOnce(syncGate.promise);
    const delivery = await start(worker);
    delivery(message());
    await jest.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = worker.stopSyncWorker().then(() => { stopped = true; });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    syncGate.resolve();
    await stopping;
    jest.useRealTimers();
  });

  it('fails startup visibly when consume does not return a nonempty consumer tag', async () => {
    const worker = loadLifecycle();
    mockConsume.mockResolvedValueOnce({ consumerTag: '' });
    await expect(worker.startSyncWorker()).rejects.toThrow('consumerTag');
  });

  it('serializes a start requested while cancellation is still pending', async () => {
    const worker = loadLifecycle();
    await start(worker);
    const cancelGate = deferred<void>();
    mockCancel.mockReturnValueOnce(cancelGate.promise);

    const stopping = worker.stopSyncWorker();
    const restarting = worker.startSyncWorker();
    await Promise.resolve();
    expect(mockConsume).toHaveBeenCalledTimes(1);

    cancelGate.resolve();
    await Promise.all([stopping, restarting]);
    expect(mockConsume).toHaveBeenCalledTimes(2);
  });

  it('rejects graceful stop when a tracked delivery reaches neither ACK nor NACK', async () => {
    const worker = loadLifecycle();
    mockAck.mockImplementationOnce(() => { throw new Error('synthetic ACK failure'); });
    mockNack.mockImplementationOnce(() => { throw new Error('synthetic NACK failure'); });
    const delivery = await start(worker);
    const callbackResult = delivery(message());
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(callbackResult).toBeUndefined();
    await expect(worker.stopSyncWorker()).rejects.toThrow('synthetic NACK failure');
  });
});
