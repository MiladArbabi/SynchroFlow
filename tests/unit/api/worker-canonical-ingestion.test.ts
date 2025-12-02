// tests/unit/api/worker-canonical-ingestion.test.ts

/**
 * Goal (RED):
 * When processMessage consumes a staged Shopify order event,
 * it MUST persist the canonical order via CanonicalCommerceIngestionService.
 *
 * This will fail initially because worker.ts does not yet call the service.
 */

// ❌ REMOVE the import!
// import { processMessage } from 'api-src/worker';

// ---- Mocks ----

// 1) Queue channel (RabbitMQ) – we only care about ack/nack
jest.mock('api-src/queue', () => {
  const mockChannel = {
    ack: jest.fn(),
    nack: jest.fn(),
    consume: jest.fn(),
  };

  const getQueueChannel = jest.fn(() => mockChannel);

  return {
    __esModule: true,
    getQueueChannel,
    mockChannel,
  };
});

// 2) DB – factory pattern, knex-like
jest.mock('api-src/db', () => {
  const mockDbInstance: any = {
    // chainable
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),

    // terminal
    first: jest.fn(),
    then: jest.fn(), // for awaited query builders
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };

  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn,
    mockDbInstance,
  };
});

// 3) Canonical ingestion service – we assert this is called
jest.mock('api-src/services/canonical-commerce-ingestion.service', () => {
  const mockInsertCanonicalOrder = jest.fn();

  const CanonicalCommerceIngestionService = jest
    .fn()
    .mockImplementation(() => ({
      insertCanonicalOrder: mockInsertCanonicalOrder,
    }));

  return {
    __esModule: true,
    // Support both default and named import styles
    default: CanonicalCommerceIngestionService,
    CanonicalCommerceIngestionService,
    mockInsertCanonicalOrder,
  };
});

// 4) OrderNexus canonical ingestion – we assert this is called too
jest.mock('api-src/services/order-nexus-canonical-ingestion.service', () => {
  const mockEnqueueOrderForOrderNexus = jest.fn();

  const OrderNexusCanonicalIngestionService = jest
    .fn()
    .mockImplementation(() => ({
      enqueueOrderForOrderNexus: mockEnqueueOrderForOrderNexus,
    }));

  return {
    __esModule: true,
    default: OrderNexusCanonicalIngestionService,
    OrderNexusCanonicalIngestionService,
    mockEnqueueOrderForOrderNexus,
  };
});

describe('worker – canonical commerce ingestion', () => {
  const canonicalOrder = {
    id: 'order-123',
    shopId: 42,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    currency: 'USD',
    totalPrice: 100,
    subtotalPrice: 100,
    totalTax: 0,
    shippingLines: [],
    lineItems: [],
    platform: 'shopify',
    platformOrderId: 'order-123',
  };

  const { mockDbInstance } = require('api-src/db');
  const { mockChannel } = require('api-src/queue');
  const {
    CanonicalCommerceIngestionService,
    mockInsertCanonicalOrder,
  } = require('api-src/services/canonical-commerce-ingestion.service');
  const {
    OrderNexusCanonicalIngestionService,
    mockEnqueueOrderForOrderNexus,
  } = require('api-src/services/order-nexus-canonical-ingestion.service');

  beforeEach(() => {
    jest.clearAllMocks();

    // reset chainable behavior
    Object.keys(mockDbInstance).forEach((key) => {
      if (
        typeof mockDbInstance[key] === 'function' &&
        !['first', 'then'].includes(key)
      ) {
        mockDbInstance[key].mockReturnValue(mockDbInstance);
      }
    });

    // 1) staged_events lookup → returns one staged event with canonical payload
    mockDbInstance.first.mockResolvedValueOnce({
      id: 1,
      shop_id: 42,
      raw_payload: canonicalOrder,
    });

    // 2) data_mapping_rules lookup → we don't care, just return empty rules
    mockDbInstance.then.mockImplementation((onFulfilled: any) =>
      Promise.resolve(onFulfilled([]))
    );

    mockEnqueueOrderForOrderNexus.mockReset();
  });

  it('should persist canonical order via CanonicalCommerceIngestionService and ack the message (RED)', async () => {
    // ⬇️ Lazy-load worker AFTER mocks and after clearAllMocks
    const { processMessage } = require('api-src/worker');

    const msg = {
      content: Buffer.from(JSON.stringify({ staged_event_id: 1 })),
    } as any;

    await processMessage(msg);

    // Service is constructed once (when worker is imported)
    expect(CanonicalCommerceIngestionService).toHaveBeenCalledTimes(1);

    // Canonical order is passed through exactly once
    expect(mockInsertCanonicalOrder).toHaveBeenCalledTimes(1);
    expect(mockInsertCanonicalOrder).toHaveBeenCalledWith(canonicalOrder);

    // OrderNexus canonical ingestion service is used
    expect(OrderNexusCanonicalIngestionService).toHaveBeenCalledTimes(1);
    expect(mockEnqueueOrderForOrderNexus).toHaveBeenCalledTimes(1);
    expect(mockEnqueueOrderForOrderNexus).toHaveBeenCalledWith(42, 'order-123');

    // Queue message is acked, not nacked
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
