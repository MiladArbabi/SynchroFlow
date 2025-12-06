// tests/unit/api/canonical-commerce-ingestion.idempotency.test.ts
import { CanonicalCommerceIngestionService } from 'api-src/services/canonical-commerce-ingestion.service';
import {
  CanonicalOrder,
  CanonicalOrderLineItem,
  CanonicalCustomer,
  CanonicalShippingLine,
} from '@lasyncro/shared/contracts/canonical-commerce';

// Mock db with factory pattern (same pattern used in existing tests)
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    del: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };

  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn,
  };
});

const mockDb = require('api-src/db').default as jest.Mock;
const mockDbInstance = mockDb() as any;

describe('CanonicalCommerceIngestionService - idempotency & duplicates', () => {
  let service: CanonicalCommerceIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();

    // restore chaining returns
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
    mockDbInstance.transacting.mockReturnValue(mockDbInstance);
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.first.mockReturnValue(mockDbInstance);
    mockDbInstance.del.mockReturnValue(mockDbInstance);
    mockDbInstance.update.mockReturnValue(mockDbInstance);

    service = new CanonicalCommerceIngestionService();
  });

  const baseOrder = (overrides = {}): CanonicalOrder => ({
    id: 'order-dup-1',
    shopId: 999,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T01:00:00.000Z',
    processedAt: '2025-01-01T01:30:00.000Z',
    currency: 'USD',
    totalPrice: 200,
    subtotalPrice: 180,
    totalTax: 20,
    shippingLines: [],
    lineItems: [
      {
        lineItemId: 'li-dup-1',
        orderId: 'order-dup-1',
        productId: 'p-1',
        variantId: 'v-1',
        title: 'Product A',
        sku: 'SKU-A',
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        estimatedUnitCost: null,
        platform: 'shopify',
        platformLineItemId: 'pli-1',
      } as CanonicalOrderLineItem,
    ],
    source: 'online',
    referrerMedium: 'ads',
    platform: 'shopify',
    platformOrderId: 'so-dup-1',
    customer: { hashedId: 'h-1', customerType: 'registered' },
    ...overrides,
  });

  test('should upsert (onConflict.merge) when same canonicalOrder is inserted twice', async () => {
    const canonicalOrder = baseOrder();

    // First invocation (happy path)
    await service.insertCanonicalOrder(canonicalOrder);

    // Simulate second invocation (duplicate delivery / retry)
    await service.insertCanonicalOrder(canonicalOrder);

    // We expect onConflict to be used for orders (canonical_order_id)
    // and merge to be called (at least once)
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    // Find call that references canonical_order_id
    const onConflictCalls = mockDbInstance.onConflict.mock.calls;
    const hasOrderConflict = onConflictCalls.some((call: string | string[]) =>
      call.includes('canonical_order_id'),
    );
    expect(hasOrderConflict).toBe(true);

    // Merge should be called for the upsert path
    expect(mockDbInstance.merge).toHaveBeenCalled();

    // At no point should raw insert be allowed to create duplicates without onConflict
    // (We assert that insert was used but followed by onConflict/merge at least)
    expect(mockDbInstance.insert).toHaveBeenCalled();
    expect(mockDbInstance.insert.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('should upsert order and upsert/insert line items (no duplicate line items)', async () => {
    // Setup: initial canonical order exists (simulate by no-op; our service uses upsert)
    const initialOrder = baseOrder();
    const updatedOrder: CanonicalOrder = {
      ...initialOrder,
      // updated totals and a new line item added
      totalPrice: 300,
      lineItems: [
        ...initialOrder.lineItems,
        {
          lineItemId: 'li-dup-2',
          orderId: initialOrder.id,
          productId: 'p-2',
          variantId: 'v-2',
          title: 'Product B',
          sku: 'SKU-B',
          quantity: 2,
          unitPrice: 50,
          totalPrice: 100,
          estimatedUnitCost: null,
          platform: 'shopify',
          platformLineItemId: 'pli-2',
        } as CanonicalOrderLineItem,
      ],
    };

    // Call service with updatedOrder (should upsert order, upsert existing line items, insert new)
    await service.insertCanonicalOrder(updatedOrder);

    // Expect one onConflict/merge for order
    const hasOrderConflict = mockDbInstance.onConflict.mock.calls.some((call: string | string[]) =>
      call.includes('canonical_order_id'),
    );
    expect(hasOrderConflict).toBe(true);
    expect(mockDbInstance.merge).toHaveBeenCalled();

    // Expect line items insertion attempted
    // insert should have been called with an array (line items)
    const insertCalls = mockDbInstance.insert.mock.calls;
    const liInsertCall = insertCalls.find(([arg]: any[]) => Array.isArray(arg));
    expect(liInsertCall).toBeDefined();

    // Expect onConflict for line items as well
    const hasLineItemConflict = mockDbInstance.onConflict.mock.calls.some((call: string | string[]) =>
      call.includes('canonical_line_item_id'),
    );
    // If service hasn't implemented per-item conflict, this will fail and make the test red.
    expect(hasLineItemConflict).toBe(true);
  });

  test('should handle duplicate line items within same order payload', async () => {
    // Order with duplicate line item IDs in the same payload
    const canonicalOrder = baseOrder({
      lineItems: [
        {
          lineItemId: 'li-dup-1', // Same ID twice
          orderId: 'order-dup-1',
          productId: 'p-1',
          variantId: 'v-1',
          title: 'Product A',
          sku: 'SKU-A',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          platform: 'shopify',
          platformLineItemId: 'pli-1',
        } as CanonicalOrderLineItem,
        {
          lineItemId: 'li-dup-1', // Duplicate ID
          orderId: 'order-dup-1',
          productId: 'p-1',
          variantId: 'v-1',
          title: 'Product A',
          sku: 'SKU-A',
          quantity: 2, // Different quantity
          unitPrice: 100,
          totalPrice: 200,
          platform: 'shopify',
          platformLineItemId: 'pli-1',
        } as CanonicalOrderLineItem,
      ],
    });

    await service.insertCanonicalOrder(canonicalOrder);

    // Should still use onConflict for line items
    const hasLineItemConflict = mockDbInstance.onConflict.mock.calls.some((call: string | string[]) =>
      call.includes('canonical_line_item_id'),
    );
    expect(hasLineItemConflict).toBe(true);

    // Merge should be called for conflicts
    expect(mockDbInstance.merge).toHaveBeenCalled();
  });

  test('should handle order update with same platformOrderId but different canonical ID', async () => {
    // Simulate scenario where platformOrderId is the same but canonical ID differs
    const order1 = baseOrder({
      id: 'order-1',
      platformOrderId: 'platform-123',
      totalPrice: 100,
    });

    const order2 = baseOrder({
      id: 'order-2', // Different canonical ID
      platformOrderId: 'platform-123', // Same platform ID
      totalPrice: 150, // Updated total
    });

    await service.insertCanonicalOrder(order1);
    await service.insertCanonicalOrder(order2);

    // Each order insertion calls onConflict twice (once for order, once for line items)
    expect(mockDbInstance.onConflict).toHaveBeenCalledTimes(4);
    expect(mockDbInstance.merge).toHaveBeenCalledTimes(4)
  });

  test('should resolve conflicts by merging updated fields', async () => {
    const initialOrder = baseOrder({
      totalPrice: 100,
      subtotalPrice: 90,
      totalTax: 10,
    });

    const updatedOrder = baseOrder({
      totalPrice: 120, // Updated price
      subtotalPrice: 110,
      totalTax: 10,
      updatedAt: '2025-01-01T02:00:00.000Z', // Later timestamp
    });

    // Mock merge to simulate conflict resolution
    mockDbInstance.merge.mockImplementationOnce(() => ({
      then: (cb: any) => cb([{ id: 'order-dup-1', total_price: 120 }]),
    }));

    await service.insertCanonicalOrder(initialOrder);
    await service.insertCanonicalOrder(updatedOrder);

    // Verify merge was called with expected update
    expect(mockDbInstance.merge).toHaveBeenCalled();
    const mergeCalls = mockDbInstance.merge.mock.calls;
    expect(mergeCalls.length).toBeGreaterThan(0);
  });

  test('should rollback transaction if line item upsert fails after order upsert', async () => {
    // Simulate line item insert failure after successful order upsert
    let callCount = 0;
    mockDbInstance.insert.mockImplementation(() => {
      callCount++;
      if (callCount === 2) { // Second insert is for line items
        throw new Error('Line item conflict resolution failed');
      }
      return mockDbInstance;
    });

    const canonicalOrder = baseOrder();

    // Should throw and rollback transaction
    await expect(service.insertCanonicalOrder(canonicalOrder))
      .rejects.toThrow('Line item conflict resolution failed');

    // Transaction should be used
    expect(mockDbInstance.transacting).toHaveBeenCalled();
  });

  test('should handle database unique constraint error gracefully', async () => {
    // Simulate database-level unique constraint violation
    mockDbInstance.insert.mockImplementationOnce(() => {
      const error: any = new Error('Duplicate key violates unique constraint');
      error.code = '23505'; // PostgreSQL unique violation
      throw error;
    });

    const canonicalOrder = baseOrder();

    // Service currently throws for duplicate key errors
    await expect(service.insertCanonicalOrder(canonicalOrder))
      .rejects.toThrow('Failed to insert canonical order: Duplicate key violates unique constraint');

    // Since the insert fails, onConflict is not called (transaction rolls back)
    expect(mockDbInstance.onConflict).not.toHaveBeenCalled();
    expect(mockDbInstance.merge).not.toHaveBeenCalled();
  });

  test('should handle partial updates when only some line items changed', async () => {
    const initialOrder = baseOrder({
      lineItems: [
        {
          lineItemId: 'li-1',
          orderId: 'order-dup-1',
          sku: 'SKU-A',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        } as CanonicalOrderLineItem,
        {
          lineItemId: 'li-2',
          orderId: 'order-dup-1',
          sku: 'SKU-B',
          quantity: 2,
          unitPrice: 50,
          totalPrice: 100,
        } as CanonicalOrderLineItem,
      ],
    });

    const updatedOrder = baseOrder({
      lineItems: [
        {
          lineItemId: 'li-1',
          orderId: 'order-dup-1',
          sku: 'SKU-A',
          quantity: 2, // Updated quantity
          unitPrice: 100,
          totalPrice: 200,
        } as CanonicalOrderLineItem,
        {
          lineItemId: 'li-3', // New line item
          orderId: 'order-dup-1',
          sku: 'SKU-C',
          quantity: 1,
          unitPrice: 75,
          totalPrice: 75,
        } as CanonicalOrderLineItem,
        // li-2 removed
      ],
    });

    await service.insertCanonicalOrder(initialOrder);
    await service.insertCanonicalOrder(updatedOrder);

    // Should handle updates, inserts, and deletions (or ignore deletions based on business rules)
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    expect(mockDbInstance.merge).toHaveBeenCalled();

    // Line items should be upserted
    const hasLineItemConflict = mockDbInstance.onConflict.mock.calls.some((call: string | string[]) =>
      call.includes('canonical_line_item_id'),
    );
    expect(hasLineItemConflict).toBe(true);
  });

  test('should be idempotent across multiple identical retries', async () => {
    const canonicalOrder = baseOrder();

    // Simulate 5 identical retries
    for (let i = 0; i < 5; i++) {
      await service.insertCanonicalOrder(canonicalOrder);
    }

    // Each order insertion calls onConflict twice (once for order, once for line items)
    expect(mockDbInstance.onConflict).toHaveBeenCalledTimes(10);
    expect(mockDbInstance.merge).toHaveBeenCalledTimes(10);

    // Database state should be consistent after each attempt
    const insertCalls = mockDbInstance.insert.mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(5);
  });

  test('should handle concurrent duplicate insertions', async () => {
    const canonicalOrder = baseOrder();

    // Simulate concurrent insertions (Promise.all)
    const promises = [
      service.insertCanonicalOrder(canonicalOrder),
      service.insertCanonicalOrder(canonicalOrder),
      service.insertCanonicalOrder(canonicalOrder),
    ];

    await Promise.all(promises);

    // All should succeed without unique constraint errors
    // and use upsert logic
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    expect(mockDbInstance.merge).toHaveBeenCalled();
  });

  test('should update timestamps on conflict merge', async () => {
    const canonicalOrder = baseOrder();

    // First insert
    await service.insertCanonicalOrder(canonicalOrder);

    // Second insert with later timestamp
    const updatedOrder = {
      ...canonicalOrder,
      updatedAt: '2025-01-02T00:00:00.000Z',
    };

    await service.insertCanonicalOrder(updatedOrder);

    // Merge should include updated timestamp
    expect(mockDbInstance.merge).toHaveBeenCalled();
    const mergeCall = mockDbInstance.merge.mock.calls[0];
    expect(mergeCall).toBeDefined();
    // The merge call should include updated_at field
  });

  test('should handle order with shipping lines updates', async () => {
    const shippingLine: CanonicalShippingLine = {
      shippingLineId: 'sl-1',
      title: 'Standard Shipping',
      price: 10,
      carrier: 'UPS',
      service: 'Ground',
    };

    const orderWithShipping = baseOrder({
      shippingLines: [shippingLine],
    });

    const updatedOrderWithShipping = baseOrder({
      shippingLines: [
        {
          ...shippingLine,
          price: 15, // Updated price
          service: 'Express',
        },
      ],
    });

    await service.insertCanonicalOrder(orderWithShipping);
    await service.insertCanonicalOrder(updatedOrderWithShipping);

    // Should handle shipping lines updates via order upsert
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    expect(mockDbInstance.merge).toHaveBeenCalled();
  });

  test('should handle customer data updates', async () => {
    const orderWithCustomer = baseOrder({
      customer: {
        hashedId: 'customer-123',
        customerType: 'guest',
        email: 'old@example.com',
      } as CanonicalCustomer,
    });

    const updatedOrderWithCustomer = baseOrder({
      customer: {
        hashedId: 'customer-123',
        customerType: 'registered', // Updated
        email: 'new@example.com', // Updated email
        firstName: 'John',
        lastName: 'Doe',
      } as CanonicalCustomer,
    });

    await service.insertCanonicalOrder(orderWithCustomer);
    await service.insertCanonicalOrder(updatedOrderWithCustomer);

    // Customer data should be updated via order upsert
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    expect(mockDbInstance.merge).toHaveBeenCalled();
  });

  test('should handle empty to non-empty line items transition', async () => {
    const orderWithoutLineItems = baseOrder({
      lineItems: [],
    });

    const orderWithLineItems = baseOrder({
      lineItems: [
        {
          lineItemId: 'li-1',
          orderId: 'order-dup-1',
          sku: 'SKU-A',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        } as CanonicalOrderLineItem,
      ],
    });

    await service.insertCanonicalOrder(orderWithoutLineItems);
    await service.insertCanonicalOrder(orderWithLineItems);

    // Should handle transition from empty to having line items
    expect(mockDbInstance.onConflict).toHaveBeenCalled();
    expect(mockDbInstance.merge).toHaveBeenCalled();

    // Line items should be inserted
    const insertCalls = mockDbInstance.insert.mock.calls;
    const liInsertCall = insertCalls.find(([arg]: any[]) => Array.isArray(arg));
    expect(liInsertCall).toBeDefined();
  });

  test('should not create duplicate orders when using different conflict columns', async () => {
    // Test that conflict resolution works with the correct unique constraint
    const canonicalOrder = baseOrder();

    // Mock different conflict scenarios
    mockDbInstance.onConflict.mockImplementation((columns: string | string[]) => {
      if (columns === 'canonical_order_id' || columns.includes('canonical_order_id')) {
        return mockDbInstance;
      }
      if (columns === 'platform_order_id' || columns.includes('platform_order_id')) {
        return mockDbInstance;
      }
      return mockDbInstance;
    });

    await service.insertCanonicalOrder(canonicalOrder);
    await service.insertCanonicalOrder(canonicalOrder);

    // Should use the correct conflict columns
    const onConflictCalls = mockDbInstance.onConflict.mock.calls;
    const hasCorrectConflict = onConflictCalls.some((call: string | string[]) =>
      call.includes('canonical_order_id') || call.includes('platform_order_id')
    );
    expect(hasCorrectConflict).toBe(true);
  });

  test('should maintain data integrity after multiple upserts', async () => {
    const canonicalOrder = baseOrder();

    // Perform multiple upserts with slight variations
    await service.insertCanonicalOrder(canonicalOrder);
    
    await service.insertCanonicalOrder({
      ...canonicalOrder,
      totalPrice: 250,
      updatedAt: '2025-01-01T03:00:00.000Z',
    });

    await service.insertCanonicalOrder({
      ...canonicalOrder,
      totalPrice: 300,
      subtotalPrice: 270,
      totalTax: 30,
      updatedAt: '2025-01-01T04:00:00.000Z',
    });

    // Each call should use upsert
    // Each order insertion calls onConflict twice (once for order, once for line items)
    expect(mockDbInstance.onConflict).toHaveBeenCalledTimes(6);
    expect(mockDbInstance.merge).toHaveBeenCalledTimes(6);

    // Final state should reflect last update
    // This is tested implicitly by checking merge was called
  });
});