const mockConsume = jest.fn();
const mockCancel = jest.fn();
const mockAck = jest.fn();
const mockNack = jest.fn();
const mockSendToQueue = jest.fn(() => Promise.resolve(true));
const mockAddSetup = jest.fn();
const mockFirst = jest.fn();
const mockUpdate = jest.fn();
const mockHandler = jest.fn();
const mockValidate = jest.fn();
const mockMarkStarted = jest.fn();
const mockMarkSuccess = jest.fn();
const mockMarkFailure = jest.fn();

const mockChannel = {
  consume: mockConsume,
  cancel: mockCancel,
  ack: mockAck,
  nack: mockNack,
  sendToQueue: mockSendToQueue,
  addSetup: mockAddSetup,
};
const mockQuery: any = {
  where: jest.fn(), first: mockFirst, update: mockUpdate,
};
mockQuery.where.mockImplementation(() => mockQuery);
const mockDb: any = jest.fn(() => mockQuery);
mockDb.fn = { now: () => new Date('2026-10-16T00:00:00.000Z') };

jest.mock('api-src/queue', () => ({
  getQueueChannel: jest.fn(() => mockChannel),
}));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: mockDb,
  withTenant: jest.fn(async (_shopId: number, callback: (trx: unknown) => unknown) => callback(mockDb)),
}));
jest.mock('api-src/execution/execution.guard', () => ({
  validateExecution: mockValidate,
}));
jest.mock('api-src/execution/execution.registry', () => ({
  getExecutionHandler: jest.fn(() => mockHandler),
}));
jest.mock('api-src/domain/decision/decision.repository', () => ({
  DecisionRepository: {
    markStarted: mockMarkStarted,
    markSuccess: mockMarkSuccess,
    markFailure: mockMarkFailure,
  },
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type ConsumerModule = {
  startExecutionWorker: () => void | Promise<void>;
  stopExecutionWorker?: () => Promise<void>;
};

function loadLifecycle(): Required<ConsumerModule> {
  const worker = require('api-src/workers/execution.worker') as ConsumerModule;
  expect(typeof worker.stopExecutionWorker).toBe('function');
  return worker as Required<ConsumerModule>;
}

const job = {
  decision_id: 'b4-s1-decision',
  entity_id: 'b4-s1-order',
  shop_id: 7,
  aggregate_version: 1,
  action_type: 'resolve_operational_block',
  payload: {},
  execution_mode: 'automated',
};

function message() {
  return {
    content: Buffer.from(JSON.stringify(job)),
    properties: { headers: { 'x-retry-count': 0 } },
  };
}

describe('B4-S1 execution consumer shutdown', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockConsume.mockResolvedValue({ consumerTag: 'execution-consumer-b4-s1' });
    mockSendToQueue.mockResolvedValue(true);
    mockQuery.where.mockImplementation(() => mockQuery);
    mockDb.mockImplementation(() => mockQuery);
    mockCancel.mockResolvedValue(undefined);
    mockFirst.mockResolvedValue({ status: 'pending' });
    mockUpdate.mockResolvedValue(1);
    mockHandler.mockResolvedValue(undefined);
    mockValidate.mockResolvedValue(undefined);
    mockMarkStarted.mockResolvedValue(undefined);
    mockMarkSuccess.mockResolvedValue(undefined);
    mockMarkFailure.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  async function start(worker: Required<ConsumerModule>) {
    await Promise.resolve(worker.startExecutionWorker());
    await Promise.resolve();
    expect(mockConsume).toHaveBeenCalledTimes(1);
    return mockConsume.mock.calls[0][1] as (msg: ReturnType<typeof message>) => Promise<void>;
  }

  it('exposes an idempotent stop and cancels only its owned consumer tag', async () => {
    const worker = loadLifecycle();
    await start(worker);

    await Promise.all([worker.stopExecutionWorker(), worker.stopExecutionWorker()]);

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('execution-consumer-b4-s1');
  });

  it('rejects post-cancel deliveries while preserving and awaiting the in-flight callback', async () => {
    const worker = loadLifecycle();
    const handlerGate = deferred<void>();
    mockHandler.mockReturnValueOnce(handlerGate.promise);
    const delivery = await start(worker);
    const activeMessage = message();
    delivery(activeMessage);
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(mockHandler).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopExecutionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(mockCancel).toHaveBeenCalledWith('execution-consumer-b4-s1');
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    await delivery(message());
    expect(mockHandler).toHaveBeenCalledTimes(1);

    handlerGate.resolve();
    await stopping;
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith(activeMessage);
  });

  it('does not resolve stop or ACK an abrupt unacked delivery before durable completion settles', async () => {
    const worker = loadLifecycle();
    const durableGate = deferred<void>();
    mockMarkSuccess.mockReturnValueOnce(durableGate.promise);
    const delivery = await start(worker);
    delivery(message());
    await Promise.resolve();
    await Promise.resolve();

    let stopped = false;
    const stopping = worker.stopExecutionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockAck).not.toHaveBeenCalled();

    durableGate.resolve();
    await stopping;
    expect(mockMarkSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      mockAck.mock.invocationCallOrder[0]
    );
  });

  it('preserves failure retry ordering: enqueue succeeds before ACK and stop awaits the decision', async () => {
    const worker = loadLifecycle();
    const failureGate = deferred<void>();
    mockHandler.mockImplementationOnce(async () => {
      await failureGate.promise;
      throw new Error('synthetic retryable failure');
    });
    const delivery = await start(worker);
    const failedMessage = message();
    delivery(failedMessage);
    await Promise.resolve();

    let stopped = false;
    const stopping = worker.stopExecutionWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mockSendToQueue).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();

    failureGate.resolve();
    await stopping;

    expect(mockSendToQueue).toHaveBeenCalledWith(
      'execution.jobs.v1',
      failedMessage.content,
      expect.objectContaining({
        persistent: true,
        headers: expect.objectContaining({ 'x-retry-count': 1 }),
        expiration: '1000',
      })
    );
    expect(mockSendToQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mockAck.mock.invocationCallOrder[0]
    );
    expect(mockAck).toHaveBeenCalledWith(failedMessage);
  });

  it('fails startup visibly when consume does not return a nonempty consumer tag', async () => {
    const worker = loadLifecycle();
    mockConsume.mockResolvedValueOnce({ consumerTag: '' });
    await expect(worker.startExecutionWorker()).rejects.toThrow('consumerTag');
  });

  it('serializes a start requested while cancellation is still pending', async () => {
    const worker = loadLifecycle();
    await start(worker);
    const cancelGate = deferred<void>();
    mockCancel.mockReturnValueOnce(cancelGate.promise);

    const stopping = worker.stopExecutionWorker();
    const restarting = worker.startExecutionWorker();
    await Promise.resolve();
    expect(mockConsume).toHaveBeenCalledTimes(1);

    cancelGate.resolve();
    await Promise.all([stopping, restarting]);
    expect(mockConsume).toHaveBeenCalledTimes(2);
  });

  it('rejects graceful stop when a tracked delivery fails before its ACK decision', async () => {
    const worker = loadLifecycle();
    mockAck.mockImplementation(() => { throw new Error('synthetic ACK failure'); });
    const delivery = await start(worker);
    const callbackResult = delivery(message());
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(callbackResult).toBeUndefined();
    await expect(worker.stopExecutionWorker()).rejects.toThrow('synthetic ACK failure');
  });

  it('awaits retry publication confirmation before ACK', async () => {
    const worker = loadLifecycle();
    mockHandler.mockRejectedValueOnce(new Error('synthetic retryable failure'));
    const confirmation = deferred<boolean>();
    mockSendToQueue.mockReturnValueOnce(confirmation.promise);
    const delivery = await start(worker);
    delivery(message());
    for (let turn = 0; turn < 50 && mockSendToQueue.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }

    let stopped = false;
    const stopping = worker.stopExecutionWorker().then(() => { stopped = true; });
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockNack).not.toHaveBeenCalled();
    expect(stopped).toBe(false);

    confirmation.resolve(true);
    await stopping;
    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it('leaves a rejected retry publication unacknowledged and rejects graceful stop', async () => {
    const worker = loadLifecycle();
    mockHandler.mockRejectedValueOnce(new Error('synthetic retryable failure'));
    mockSendToQueue.mockRejectedValueOnce(new Error('synthetic publication failure'));
    const delivery = await start(worker);
    const callbackResult = delivery(message());
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(callbackResult).toBeUndefined();
    await expect(worker.stopExecutionWorker()).rejects.toThrow('synthetic publication failure');
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockNack).not.toHaveBeenCalled();
  });

  it('ACKs after the wrapper confirms publication with false backpressure status', async () => {
    const worker = loadLifecycle();
    mockHandler.mockRejectedValueOnce(new Error('synthetic retryable failure'));
    mockSendToQueue.mockResolvedValueOnce(false);
    const delivery = await start(worker);
    delivery(message());

    await worker.stopExecutionWorker();
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockNack).not.toHaveBeenCalled();
  });
});
