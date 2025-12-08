// tests/unit/api/order-nexus-canonical-ingestion.service.test.ts

/**
 * Goal (RED):
 * Given a CanonicalOrder persisted in canonical tables,
 * OrderNexusCanonicalIngestionService MUST:
 *
 * - Load the canonical order + line items from DB
 * - Map them to a NormalizedOrder (OrderNexus contract)
 * - Enqueue an OrderQueueMessage on the OrderNexus ingestion queue
 */

jest.mock('api-src/db', () => {
  const mockDbInstance: any = {
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

    first: jest.fn(),
    then: jest.fn(),
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

// Minimal queue abstraction for OrderNexus ingestion
jest.mock('api-src/queue', () => {
  const mockOrderNexusChannel = {
    sendToQueue: jest.fn(),
  };

  const getQueueChannel = jest.fn((queueName: string) => {
    if (queueName === 'order_nexus_ingestion') {
      return mockOrderNexusChannel;
    }
    throw new Error(`Unexpected queue requested in test: ${queueName}`);
  });

  return {
    __esModule: true,
    getQueueChannel,
    mockOrderNexusChannel,
  };
});

// We’ll import the service lazily after mocks
describe('OrderNexusCanonicalIngestionService', () => {
  const { mockDbInstance } = require('api-src/db');
  const { mockOrderNexusChannel } = require('api-src/queue');

  const canonicalOrderRow = {
    id: 'order-123',
    shop_id: 42,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    processed_at: null,
    currency: 'USD',
    total_price: 100.0,
    subtotal_price: 100.0,
    total_tax: 0.0,
    source: 'web',
    referrer_medium: 'paid',
    platform: 'shopify',
    platform_order_id: 'order-123',
  };

  const canonicalLineItems = [
    {
      line_item_id: 'li-1',
      order_id: 'order-123',
      shop_id: 42,
      product_id: 'prod-1',
      variant_id: 'var-1',
      title: 'Test product',
      sku: 'SKU-1',
      quantity: 2,
      unit_price: 25.0,
      total_price: 50.0,
      platform: 'shopify',
      platform_line_item_id: 'li-1',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    Object.keys(mockDbInstance).forEach((key) => {
      if (
        typeof mockDbInstance[key] === 'function' &&
        !['first', 'then'].includes(key)
      ) {
        mockDbInstance[key].mockReturnValue(mockDbInstance);
      }
    });

    // 1) canonical_orders lookup
    mockDbInstance.first.mockResolvedValueOnce(canonicalOrderRow);

    // 2) canonical_order_line_items query
    mockDbInstance.then.mockImplementation((onFulfilled: any) =>
      Promise.resolve(onFulfilled(canonicalLineItems))
    );
  });

  it('should map CanonicalOrder into NormalizedOrder and enqueue to OrderNexus ingestion queue (RED)', async () => {
    const {
      OrderNexusCanonicalIngestionService,
    } = require('api-src/services/order-nexus-canonical-ingestion.service');

    const service = new OrderNexusCanonicalIngestionService();

    await service.enqueueOrderForOrderNexus(42, 'order-123');

    // Verify DB access – canonical_orders
    expect(mockDbInstance.from).toHaveBeenCalledWith('canonical_orders');
    expect(mockDbInstance.where).toHaveBeenCalledWith({
      shop_id: 42,
      id: 'order-123',
    });

    // Verify DB access – canonical_order_line_items
    expect(mockDbInstance.from).toHaveBeenCalledWith(
      'canonical_order_line_items'
    );

    // Verify queue call – one message to order_nexus_ingestion
    expect(mockOrderNexusChannel.sendToQueue).toHaveBeenCalledTimes(1);
    const [queueName, payloadBuffer] =
      mockOrderNexusChannel.sendToQueue.mock.calls[0];

    expect(queueName).toBe('order_nexus_ingestion');

    const payload = JSON.parse(payloadBuffer.toString());

    // Shape of OrderQueueMessage as per blueprint
    expect(payload).toEqual(
      expect.objectContaining({
        shopId: 42,
        orderId: 'order-123',
        topic: 'orders/create',
        order: expect.objectContaining({
          id: 'order-123',
          shopId: 42,
          currency: 'USD',
          totalPrice: 100.0,
          subtotalPrice: 100.0,
          totalTax: 0.0,
          lineItems: expect.arrayContaining([
            expect.objectContaining({
              productId: 'prod-1',
              variantId: 'var-1',
              quantity: 2,
              price: 25.0,
            }),
          ]),
        }),
      })
    );
  });
});
