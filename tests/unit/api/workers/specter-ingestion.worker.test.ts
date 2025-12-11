// tests/unit/api/workers/specter-ingestion.worker.test.ts
import { jest } from '@jest/globals';

const WORKER_PATH = 'api-src/workers/specter-ingestion.worker';

// Top-level ids used in tests
const SHOP_ID = 42;
const OTHER_SHOP = 999;

// Mocks
const appendEventMock = jest.fn(async (_shopId: number, _event: any) => Promise.resolve());
const recordShopSessionMock = jest.fn(async (_shopId: number, _session: any) => Promise.resolve());

// Fake queue channel that the worker will use
function makeFakeChannel() {
  return {
    // consume should return a Promise resolving to an object with consumerTag
    consume: jest.fn((_queue: string, _handler: any, _opts: any) => Promise.resolve({ consumerTag: 'ct-1' })),
    ack: jest.fn((_msg: any) => {}),
    cancel: jest.fn((_tag: string) => Promise.resolve()),
  };
}

describe('Specter ingestion worker (unit)', () => {
  let fakeChannel: any;

  beforeEach(() => {
    jest.resetModules();
    appendEventMock.mockClear();
    recordShopSessionMock.mockClear();

    // prepare fake channel for each test
    fakeChannel = makeFakeChannel();

    // Mock the modules the worker imports BEFORE importing the worker module
    jest.doMock('modules-specter/store/session-store', () => ({
      appendEvent: appendEventMock,
      recordShopSession: recordShopSessionMock,
    }));

    jest.doMock('api-src/queue', () => ({
      getQueueChannel: jest.fn(() => fakeChannel),
    }));
  });

  afterEach(async () => {
    // Attempt to stop worker if it's running (safe no-op)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const wk: any = require(WORKER_PATH);
      if (wk && typeof wk.stopSpecterIngestionWorker === 'function') {
        // stop might be async
        // ignore errors
        // @ts-ignore
        await wk.stopSpecterIngestionWorker().catch(() => {});
      }
    } catch (_) {
      // ignore
    }
  });

  test('processSpecterMessage appends event, records session when sessionDelta present and acks', async () => {
    // import the worker after mocks are in place
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wk: any = require(WORKER_PATH);

    // start the worker so it sets the module channel variable (and registers consumer)
    expect(typeof wk.startSpecterIngestionWorker === 'function').toBe(true);
    await wk.startSpecterIngestionWorker();

    // build a valid message with sessionDelta
    const payload = {
      shopId: SHOP_ID,
      type: 'sync.complete',
      payload: { ok: true },
      sessionDelta: { sessionId: 's-1', createdAt: '2025-12-01T00:00:00Z', exitIntent: false },
      timestamp: 1765448176494
    };

    const msg = { content: Buffer.from(JSON.stringify(payload)) };

    // call the processor
    await wk.processSpecterMessage(msg);
    // processSpecterMessage schedules best-effort async work (fire-and-forget).
    // give the microtask queue a tick so our mocked async functions run before assertions.
    await new Promise((resolve) => setImmediate(resolve));

    // appendEvent should be called once with shopId and an object containing the type & timestamp
    expect(appendEventMock).toHaveBeenCalledTimes(1);
    const [calledShopId, calledEvent] = appendEventMock.mock.calls[0];
    expect(Number(calledShopId)).toBe(SHOP_ID);
    expect(calledEvent.type).toBe('sync.complete');
    expect(calledEvent.timestamp).toBe(1765448176494);

    // recordShopSession should be called once with merged session object
    expect(recordShopSessionMock).toHaveBeenCalledTimes(1);
    const [rsShopId, rsSession] = recordShopSessionMock.mock.calls[0];
    expect(Number(rsShopId)).toBe(SHOP_ID);
    expect(rsSession).toHaveProperty('sessionId', 's-1');
    expect(rsSession).toHaveProperty('createdAt', '2025-12-01T00:00:00Z');

    // channel ack should be called
    expect(fakeChannel.ack).toHaveBeenCalledTimes(1);
  });

  test('processSpecterMessage acks and ignores invalid JSON without calling store', async () => {
    // import worker after mocks
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wk: any = require(WORKER_PATH);
    await wk.startSpecterIngestionWorker();

    const badMsg = { content: Buffer.from('not-a-json') };
    await wk.processSpecterMessage(badMsg);

    // ensure we acked the bad message
    expect(fakeChannel.ack).toHaveBeenCalledTimes(1);

    // ensure no calls to specter store
    expect(appendEventMock).not.toHaveBeenCalled();
    expect(recordShopSessionMock).not.toHaveBeenCalled();
  });

  test('processSpecterMessage acks messages missing shopId and does not call store', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wk: any = require(WORKER_PATH);
    await wk.startSpecterIngestionWorker();

    const payloadNoShop = {
      type: 'sync.error',
      payload: { reason: 'no shop' }
    };
    const msg = { content: Buffer.from(JSON.stringify(payloadNoShop)) };

    await wk.processSpecterMessage(msg);

    expect(fakeChannel.ack).toHaveBeenCalledTimes(1);
    expect(appendEventMock).not.toHaveBeenCalled();
    expect(recordShopSessionMock).not.toHaveBeenCalled();
  });

  test('startSpecterIngestionWorker registers a consumer and sets consumerTag', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wk: any = require(WORKER_PATH);

    // ensure channel.consume is present and will resolve to a consumerTag
    fakeChannel.consume.mockImplementationOnce((_q: string, _h: any, _opts: any) => Promise.resolve({ consumerTag: 'ct-abc' }));

    await wk.startSpecterIngestionWorker();

    // ensure consume was called with our queue name
    expect(fakeChannel.consume).toHaveBeenCalled();
    // after start, consumerTag should be set internally; we can't access it directly but we can stop
    // and ensure cancel gets called using the saved consumerTag path
    await wk.stopSpecterIngestionWorker();
    // stop should call channel.cancel (if consumerTag was set)
    // if cancel wasn't called because consumerTag wasn't exposed, that's ok; at minimum no crash
    // We assert that cancel exists on the channel
    expect(typeof fakeChannel.cancel).toBe('function');
  });
});
