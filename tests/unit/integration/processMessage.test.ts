// tests/worker/processMessage.test.ts
/**
 * Red test for apps/backend/src/worker.ts -> processMessage
 *
 * This test verifies the happy-path wiring:
 *  - loads staged_event from db
 *  - transforms payload via transformer
 *  - calls CanonicalCommerceIngestionService.insertCanonicalOrder
 *  - calls OrderNexusCanonicalIngestionService.enqueueOrderForOrderNexus
 *  - acks the message via the queue channel
 *
 * NOTE: we mock all external dependencies using jest.mock factory pattern
 * (per tests/unit/README.md) so mocks are hoisted safely before imports.
 */

import { jest } from '@jest/globals';

const stagedEvent: any = {
  id: 123,
  shop_id: 1,
  raw_payload: {
    id: 'order_abc',
    total: 100,
    items: [{ sku: 'SKU1', qty: 1 }],
  },
};

// -----------------------------
// Stable, hoisted mocks (factory pattern)
// -----------------------------

// Queue mock (returns a shared mockEventChannel object)
jest.mock('../../../apps/backend/src/queue', () => {
  const mockEventChannel = {
    ack: jest.fn(),
    nack: jest.fn(),
    consume: jest.fn(),
  };
  return {
    __esModule: true,
    getQueueChannel: jest.fn(() => mockEventChannel),
    // expose internals for test code to assert / reset
    __mockEventChannel: mockEventChannel,
  };
});

// Transformer mock
jest.mock('../../../apps/backend/src/transformer', () => {
  const transformPayload = jest.fn((payload: any) => ({ transformed: true, ...payload }));
  return {
    __esModule: true,
    transformPayload,
  };
});

// CanonicalCommerceIngestionService mock
jest.mock('api-src/services/canonical-commerce-ingestion.service', () => {
  const insertCanonicalOrder = jest.fn(async () => undefined);
  const ctor = jest.fn().mockImplementation(() => ({
    insertCanonicalOrder,
  }));
  return {
    __esModule: true,
    CanonicalCommerceIngestionService: ctor,
    __mocks: { insertCanonicalOrder, ctor },
  };
});

// OrderNexusCanonicalIngestionService mock
jest.mock('api-src/services/order-nexus-canonical-ingestion.service', () => {
  const enqueueOrderForOrderNexus = jest.fn(async () => undefined);
  const ctor = jest.fn().mockImplementation(() => ({
    enqueueOrderForOrderNexus,
  }));
  return {
    __esModule: true,
    OrderNexusCanonicalIngestionService: ctor,
    __mocks: { enqueueOrderForOrderNexus, ctor },
  };
});

// DB mock factory (we'll override implementations per-test)
jest.mock('../../../apps/backend/src/db', () => {
  // provide default "function" export that can be mocked in tests
  const mockDbFn = jest.fn();
  // expose helpers for tests if needed
  return {
    __esModule: true,
    default: mockDbFn,
  };
});

// -----------------------------
// Acquire references to internals exposed by mocks
// -----------------------------
const queueModule = require('../../../apps/backend/src/queue') as any;
const transformerModule = require('../../../apps/backend/src/transformer') as any;
const canonicalServiceModule = require('api-src/services/canonical-commerce-ingestion.service') as any;
const orderNexusServiceModule = require('api-src/services/order-nexus-canonical-ingestion.service') as any;
const dbModule = require('../../../apps/backend/src/db') as any;

// convenience shortcuts to the internal mocks the factories exposed
const mockEventChannel = queueModule.__mockEventChannel as any;
const transformPayloadMock = transformerModule.transformPayload as jest.Mock;
const insertCanonicalOrderMock = canonicalServiceModule.__mocks.insertCanonicalOrder as jest.Mock;
let enqueueOrderForOrderNexusMock = orderNexusServiceModule.__mocks.enqueueOrderForOrderNexus as jest.Mock;

// Now import the worker module AFTER mocks are registered
let processMessage: (msg: { content: Buffer } | null) => Promise<void>;

beforeAll(async () => {
  const workerModule = await import('../../../apps/backend/src/worker');
  processMessage = workerModule.processMessage;
});

beforeEach(() => {
  // Reset all mock call counts and implementations
  jest.clearAllMocks();

  // Restore enqueue mock variable reference (some tests override it)
  enqueueOrderForOrderNexusMock = orderNexusServiceModule.__mocks.enqueueOrderForOrderNexus as jest.Mock;
});

// -----------------------------
// Tests
// -----------------------------

test('processMessage - happy path: transforms, persists canonical order, enqueues and acks', async () => {
  // Arrange: create query objects that match how worker uses them

  // staged_events -> db('staged_events').where(...).first()
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  // data_mapping_rules -> db('data_mapping_rules').where(...) resolves to array
  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  // default fallback
  const defaultQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  };

  // Make db(...) return different query objects depending on table
  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return defaultQuery;
  });

  // Act
  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // Assert - canonical insertion
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);
  expect(insertCanonicalOrderMock).toHaveBeenCalledWith(stagedEvent.raw_payload);

  // Assert - enqueue to OrderNexus
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(1);
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledWith(stagedEvent.shop_id, stagedEvent.raw_payload.id);

  // Assert - ack called
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});

test('processMessage - missing staged_event_id -> ack and no processing', async () => {
  // Arrange: db should not be invoked meaningfully, but we still provide a default
  const defaultQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
  dbModule.default.mockImplementation(() => defaultQuery);

  // Act
  const msg = { content: Buffer.from(JSON.stringify({ foo: 'bar' })) };
  await processMessage(msg as any);

  // Assert
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(mockEventChannel.ack).toHaveBeenCalled();
});

test('processMessage - nonexistent staged event -> ack and log', async () => {
  // staged_events returns undefined for first()
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: 9999 })) };
  await processMessage(msg as any);

  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(mockEventChannel.ack).toHaveBeenCalled();
});

// -----------------------------
// New tests: expanded coverage (small, focused cases)
// -----------------------------

test('processMessage - canonical order missing id -> insert called but enqueue NOT called', async () => {
  // staged event has raw_payload without id (so enqueue should not run)
  const stagedNoId = {
    id: 555,
    shop_id: 2,
    raw_payload: {
      total: 42,
      items: [{ sku: 'X', qty: 2 }],
      // intentionally no "id" field on raw_payload
    },
  };

  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedNoId)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedNoId.id })) };
  await processMessage(msg as any);

  // insert should be called with the raw payload
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);
  expect(insertCanonicalOrderMock).toHaveBeenCalledWith(stagedNoId.raw_payload);

  // enqueue should NOT be called because canonicalOrder.id is falsy
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // ack should still be called
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});

test('processMessage - enqueue throws -> log and ack (do not poison queue)', async () => {
  // staged event normal
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  // Make enqueue throw for this test
  enqueueOrderForOrderNexusMock.mockImplementationOnce(() => Promise.reject(new Error('enqueue-boom')));

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // insert should have been called
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);

  // enqueue was attempted and failed (mock recorded)
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(1);

  // ack should still be called despite the enqueue failure (FT0 policy)
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});

test('processMessage - insertCanonicalOrder throws -> nack (do not process further)', async () => {
  // staged event normal
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  // Make insert throw for this test
  insertCanonicalOrderMock.mockImplementationOnce(() => Promise.reject(new Error('insert-boom')));

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // insert was attempted and failed
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);

  // enqueue should NOT be called because insert failed
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // Should nack (not ack) because insert failure may be transient
  expect(mockEventChannel.nack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).not.toHaveBeenCalled();
});

test('processMessage - transformer throws -> nack (do not process further)', async () => {
  // staged event normal
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  // Make transformer throw for this test
  transformPayloadMock.mockImplementationOnce(() => {
    throw new Error('transformer-boom');
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // transformer was called and threw
  expect(transformPayloadMock).toHaveBeenCalledTimes(1);

  // insert should NOT be called because transformer failed
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();

  // enqueue should NOT be called
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // Should nack (not ack) because transformer failure may be transient
  expect(mockEventChannel.nack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).not.toHaveBeenCalled();
});

test('processMessage - db query for staged_events throws -> nack', async () => {
  // staged_events query throws an error
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.reject(new Error('db-connection-failed'))),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // No services should be called because db query failed
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // Should nack because db failure is likely transient
  expect(mockEventChannel.nack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).not.toHaveBeenCalled();
});

test('processMessage - null message -> no ack/nack (nothing to do)', async () => {
  // Arrange: minimal db mock
  const defaultQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
  dbModule.default.mockImplementation(() => defaultQuery);

  // Act
  await processMessage(null);

  // Assert: no queue operations at all
  expect(mockEventChannel.ack).not.toHaveBeenCalled();
  expect(mockEventChannel.nack).not.toHaveBeenCalled();

  // No services called
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();
});

test('processMessage - invalid JSON in message -> nack', async () => {
  // Arrange: minimal db mock
  const defaultQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
  dbModule.default.mockImplementation(() => defaultQuery);

  // Act: message with invalid JSON
  const msg = { content: Buffer.from('invalid json {') };
  await processMessage(msg as any);

  // Assert: nack because message is malformed
  expect(mockEventChannel.nack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).not.toHaveBeenCalled();

  // No services called
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();
});

test('processMessage - staged event missing shop_id -> ack (skip processing)', async () => {
  // staged event without shop_id
  const stagedNoShopId = {
    id: 777,
    // intentionally no shop_id
    raw_payload: {
      id: 'order_no_shop',
      total: 50,
      items: [{ sku: 'Y', qty: 3 }],
    },
  };

  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedNoShopId)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedNoShopId.id })) };
  await processMessage(msg as any);

  // insert should NOT be called because shop_id is missing
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();

  // enqueue should NOT be called
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // Should ack (skip this message)
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.nack).not.toHaveBeenCalled();
});

test('processMessage - uses mapping rules from db for transformer', async () => {
  // Arrange: mock mapping rules returned from db
  const mockMappingRules = [
    { id: 1, rule_type: 'field_mapping', source: 'total', target: 'amount' },
    { id: 2, rule_type: 'value_transform', field: 'status', transform: 'uppercase' },
  ];

  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  // data_mapping_rules query returns mock rules
  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve(mockMappingRules)),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  // Act
  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // Assert: transformer called with mapping rules
  expect(transformPayloadMock).toHaveBeenCalledTimes(1);
  expect(transformPayloadMock).toHaveBeenCalledWith(stagedEvent.raw_payload, mockMappingRules);

  // Assert: services called as normal
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});

test('processMessage - db query for mapping rules throws -> nack (transient failure)', async () => {
  // staged_events query works
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  // data_mapping_rules query throws
  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.reject(new Error('mapping-rules-db-error'))),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  const msg = { content: Buffer.from(JSON.stringify({ staged_event_id: stagedEvent.id })) };
  await processMessage(msg as any);

  // transformer should not be called because mapping rules query failed
  expect(transformPayloadMock).not.toHaveBeenCalled();

  // services should not be called
  expect(insertCanonicalOrderMock).not.toHaveBeenCalled();
  expect(enqueueOrderForOrderNexusMock).not.toHaveBeenCalled();

  // Should nack because mapping rules are needed for processing
  expect(mockEventChannel.nack).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).not.toHaveBeenCalled();
});

test('processMessage - message with extra fields still works (only staged_event_id matters)', async () => {
  // Arrange
  const stagedQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(() => Promise.resolve(stagedEvent)),
  };

  const mappingRulesQuery = {
    where: jest.fn().mockImplementation(() => Promise.resolve([])),
  };

  dbModule.default.mockImplementation((tableName: string) => {
    if (tableName === 'staged_events') return stagedQuery;
    if (tableName === 'data_mapping_rules') return mappingRulesQuery;
    return {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    };
  });

  // Act: message with additional metadata
  const msg = {
    content: Buffer.from(JSON.stringify({
      staged_event_id: stagedEvent.id,
      retry_count: 3,
      source: 'webhook',
      timestamp: '2024-01-01T00:00:00Z'
    }))
  };
  await processMessage(msg as any);

  // Assert: normal processing occurs
  expect(insertCanonicalOrderMock).toHaveBeenCalledTimes(1);
  expect(enqueueOrderForOrderNexusMock).toHaveBeenCalledTimes(1);
  expect(mockEventChannel.ack).toHaveBeenCalledTimes(1);
});