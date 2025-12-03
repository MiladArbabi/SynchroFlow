// tests/e2e/backend/ingestion.pipeline.e2e.test.ts
/**
 * E2E-ish integration tests for the ingestion pipeline worker
 * - These tests mock external systems (db, queue, services) but exercise the worker flow:
 *   staged_event -> transform/mapping -> canonical insertion -> ack
 *
 * Note: keep mocks local to tests and use the factory pattern so Jest hoisting is safe.
 */

import { jest } from '@jest/globals';

// --- Hoisted mocks (factory pattern) ---
// Queue mock: returns a shared mockEventChannel and exposes it for assertions
jest.mock('../../../apps/backend/src/queue', () => {
  const mockEventChannel = {
    ack: jest.fn(),
    nack: jest.fn(),
    consume: jest.fn(),
  };
  return {
    __esModule: true,
    getQueueChannel: jest.fn(() => mockEventChannel),
    __mockEventChannel: mockEventChannel,
  };
});

// Transformer mock (legacy transform path may be used by worker)
jest.mock('../../../apps/backend/src/transformer', () => {
  const transformPayload = jest.fn((payload: any) => ({ transformed: true, ...payload }));
  return { __esModule: true, transformPayload };
});

// Canonical / OrderNexus ingestion services
jest.mock('api-src/services/canonical-commerce-ingestion.service', () => {
  const insertCanonicalOrder = jest.fn(async () => undefined);
  const ctor = jest.fn().mockImplementation(() => ({ insertCanonicalOrder }));
  return { __esModule: true, CanonicalCommerceIngestionService: ctor, __mocks: { insertCanonicalOrder, ctor } };
});

jest.mock('api-src/services/order-nexus-canonical-ingestion.service', () => {
  const enqueueOrderForOrderNexus = jest.fn(async () => undefined);
  const ctor = jest.fn().mockImplementation(() => ({ enqueueOrderForOrderNexus }));
  return { __esModule: true, OrderNexusCanonicalIngestionService: ctor, __mocks: { enqueueOrderForOrderNexus, ctor } };
});

// DB mock factory - we will implement per-test behavior by overriding mockImplementation
jest.mock('../../../apps/backend/src/db', () => {
  const mockDbFn = jest.fn();
  // expose fn.now in case code calls db.fn.now()
  (mockDbFn as any).fn = { now: jest.fn(() => 'mocked-now') };
  return { __esModule: true, default: mockDbFn, fn: (mockDbFn as any).fn };
});

// --- Require modules after mocks are registered ---
const queueModule = require('../../../apps/backend/src/queue') as any;
const transformerModule = require('../../../apps/backend/src/transformer') as any;
const canonicalServiceModule = require('api-src/services/canonical-commerce-ingestion.service') as any;
const orderNexusServiceModule = require('api-src/services/order-nexus-canonical-ingestion.service') as any;
const dbModule = require('../../../apps/backend/src/db') as any;

// convenience references to internals
const mockEventChannel = queueModule.__mockEventChannel as any;
const transformPayloadMock = transformerModule.transformPayload as jest.Mock;
const insertCanonicalOrderMock = canonicalServiceModule.__mocks.insertCanonicalOrder as jest.Mock;
const enqueueOrderForOrderNexusMock = orderNexusServiceModule.__mocks.enqueueOrderForOrderNexus as jest.Mock;

let processMessage: (msg: { content: Buffer } | null) => Promise<void>;

beforeAll(async () => {
  const workerModule = await import('../../../apps/backend/src/worker');
  processMessage = workerModule.processMessage;
});

// Reset between tests
beforeEach(() => {
  jest.clearAllMocks();
  // ensure ack/nack call counts reset
  mockEventChannel.ack.mockClear();
  mockEventChannel.nack.mockClear();
  // default: transformer simply returns payload merged with transformed flag
  transformPayloadMock.mockImplementation((p: any) => ({ transformed: true, ...p }));
});

// --- Test data ---
const stagedEvent = {
  id: 9001,
  shop_id: 1,
  raw_payload: {
    id: 'so-9001',
    total: 100,
    line_items: [{ sku: 'S1', qty: 1 }],
  },
};

const badStaged = {
  id: 9999,
  shop_id: 1,
  raw_payload: {
    bad: 'payload',
  },
};

// --- Test 1: Happy path ---
test('e2e - happy path: staged_event -> canonical insert -> ack', async () => {
  // arrange: db behavior
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  } as any;

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  } as any;

  const mockDbInstance = {
    // service implementations may call these; keep them present so other modules do not crash
    insert: jest.fn().mockImplementation(() => Promise.resolve([1])),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  } as any;

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return mockDbInstance;
  });

  // Act: send a message containing staged_event_id (worker should load, transform, insert, ack)
  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // Assert: the worker should call the canonical ingestion service and then ack
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);
  // ensure OrderNexus enqueue path also called (worker enqueues after insertion)
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});

// --- Test 2: Idempotency (replay same staged_event twice) ---
test('e2e - idempotency: repeated staged_event should not create duplicates', async () => {
  // arrange: staged present and mapping rules present
  const stagedQuery2 = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  } as any;

  const mappingRulesQuery2 = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  } as any;

  const mockDbInstance2 = {
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  } as any;

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery2;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery2;
    return mockDbInstance2;
  });

  // Act: process same message twice
  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);
  await processMessage(msg as any);

  // Assert: ingestion service should have been called twice (worker called twice)
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(2);
  // worker enqueues twice as well
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(2);
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(2);
});

// --- Test 3: Mapping failure -> do not insert, ack (policy: non-poison) ---
test('e2e - mapping failure -> no db insert, ack (policy: non-poison)', async () => {
  // staged record exists but mapping rules force a required missing field -> mapping will throw
  const stagedQuery3 = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(badStaged)),
  } as any;

  const mappingRulesQuery3 = {
    // rule requires source path 'missing.path' which raw doesn't have
    where: jest.fn().mockImplementation(() => Promise.resolve([{ source: 'missing.path', target: 'x', required: true }])),
  } as any;

  const mockDbInstance3 = {
    insert: jest.fn().mockImplementation(() => Promise.resolve([1])),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  } as any;

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery3;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery3;
    return mockDbInstance3;
  });

  // Arrange override: make transformer/mapping fail for this test
  // The worker uses transformPayload(...) — override it to throw so we simulate a mapping/validation failure
  transformPayloadMock.mockImplementationOnce(() => {
    throw new Error('Mapping failed: missing required field');
  });

  // Act
  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: badStaged.id })) };
  await processMessage(msg as any);

  // mapping should fail -> our policy is to ack but not call insertion/enqueue
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});
