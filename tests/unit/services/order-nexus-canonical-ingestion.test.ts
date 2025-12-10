// tests/unit/services/order-nexus-canonical-ingestion.test.ts
describe('OrderNexusCanonicalIngestionService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('FT1 & FT2: publishes normalized message and records canonical.ingested event', async () => {
    // Arrange: mock channel
    const sendToQueue = jest.fn();
    const mockChannel = { sendToQueue };
    jest.doMock('api-src/queue', () => ({ getQueueChannel: () => mockChannel }));

    // Arrange: mock appendEvent
    const mockAppendEvent = jest.fn().mockResolvedValue(undefined);
    jest.doMock('modules-specter/store/session-store', () => ({ appendEvent: mockAppendEvent }));

    // Arrange: stub db to return an order row and line items
    const orderRow = {
      id: 'ord-1',
      shop_id: 11,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      processed_at: null,
      currency: 'USD',
      total_price: 100,
      subtotal_price: 90,
      total_tax: 10,
      source: null,
      referrer_medium: null,
      platform: 'shopify',
      platform_order_id: '1001'
    };

    const lineItems = [
      {
        line_item_id: 'li-1',
        order_id: 'ord-1',
        shop_id: 11,
        product_id: 'prod-1',
        variant_id: 'var-1',
        title: 'Product 1',
        sku: 'SKU1',
        quantity: 2,
        unit_price: 45,
        total_price: 90,
        platform: 'shopify',
        platform_line_item_id: 'pli-1'
      }
    ];

    const mockDb = jest.fn(() => ({
      from: (table: string) => ({
        where: (_q: any) => {
          if (table === 'canonical_orders') {
            return { first: async () => orderRow };
          }
          if (table === 'canonical_order_line_items') {
            return Promise.resolve(lineItems);
          }
          return { first: async () => null };
        }
      })
    }));
    jest.doMock('api-src/db', () => mockDb);

    // Act: import service and call method
    const { OrderNexusCanonicalIngestionService } = await import('api-src/services/order-nexus-canonical-ingestion.service');
    const svc = new OrderNexusCanonicalIngestionService();
    await svc.enqueueOrderForOrderNexus(11, 'ord-1');

    // Assert: queue called with expected normalized payload
    expect(sendToQueue).toHaveBeenCalledTimes(1);
    const [[queueName, buffer]] = (sendToQueue.mock.calls as any);
    expect(queueName).toBe('order_nexus_ingestion');
    const payload = JSON.parse(buffer.toString());

    expect(payload).toMatchObject({
      shopId: 11,
      orderId: 'ord-1',
      topic: 'orders/create',
      order: {
        id: 'ord-1',
        shopId: 11,
        currency: 'USD',
        totalPrice: 100,
        subtotalPrice: 90,
        totalTax: 10,
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            quantity: 2,
            price: 45
          }
        ]
      }
    });

    // Assert: specter appendEvent recorded
    expect(mockAppendEvent).toHaveBeenCalledWith(11, expect.objectContaining({
      type: 'canonical.ingested',
      canonicalOrderId: 'ord-1'
    }));
  });

  test('FT0: no-op when canonical order missing', async () => {
    const sendToQueue = jest.fn();
    jest.doMock('api-src/queue', () => ({ getQueueChannel: () => ({ sendToQueue }) }));
    // stub db to return null for canonical_orders
    const mockDb = jest.fn(() => ({
      from: (table: string) => ({
        where: (_q: any) => {
          if (table === 'canonical_orders') {
            return { first: async () => null };
          }
          return Promise.resolve([]);
        }
      })
    }));
    jest.doMock('api-src/db', () => mockDb);
    jest.doMock('modules-specter/store/session-store', () => ({ appendEvent: jest.fn() }));

    const { OrderNexusCanonicalIngestionService } = await import('api-src/services/order-nexus-canonical-ingestion.service');
    const svc = new OrderNexusCanonicalIngestionService();
    await svc.enqueueOrderForOrderNexus(99, 'missing-order');

    expect(sendToQueue).not.toHaveBeenCalled();
  });
});
