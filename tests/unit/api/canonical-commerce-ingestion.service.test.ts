//tests/unit/api/canonical-commerce-ingestion.service.test.ts
import { CanonicalCommerceIngestionService } from 'api-src/services/canonical-commerce-ingestion.service';
import {
  CanonicalOrder,
  CanonicalOrderLineItem,
} from '@synchroflow/shared/contracts/canonical-commerce';

// 1) Mock db with factory pattern
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
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

describe('CanonicalCommerceIngestionService', () => {
  let service: CanonicalCommerceIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();

    // reset chaining
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
    mockDbInstance.transacting.mockReturnValue(mockDbInstance);

    service = new CanonicalCommerceIngestionService();
  });

  describe('insertCanonicalOrder', () => {
    it('should persist canonical order and line items into canonical tables', async () => {
      const canonicalOrder: CanonicalOrder = {
        id: '123',
        shopId: 42,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T01:00:00.000Z',
        processedAt: '2025-01-01T01:30:00.000Z',
        currency: 'USD',
        totalPrice: 100,
        subtotalPrice: 80,
        totalTax: 20,
        shippingLines: [],
        lineItems: [
          {
            lineItemId: 'li-1',
            orderId: '123',
            productId: 'p-1',
            variantId: 'v-1',
            title: 'Test product',
            sku: 'SKU-1',
            quantity: 2,
            unitPrice: 50,
            totalPrice: 100,
            estimatedUnitCost: null,
            platform: 'shopify',
            platformLineItemId: 'pli-1',
          } as CanonicalOrderLineItem,
        ],
        source: 'online',
        referrerMedium: 'ads',
        platform: 'shopify',
        platformOrderId: 'so-123',
        customer: {
          hashedId: 'hashed-abc',
          customerType: 'registered',
        },
      };

      await service.insertCanonicalOrder(canonicalOrder);

      // Assert: first call to db() is canonical_orders
      expect(mockDb).toHaveBeenCalledWith('canonical_orders');
      // Some call also for canonical_order_line_items
      expect(mockDb).toHaveBeenCalledWith('canonical_order_line_items');

      // Assert insert for orders uses mapped fields
      const orderInsertCall = mockDbInstance.insert.mock.calls.find(
        ([arg]: any[]) => arg && arg.canonical_order_id === '123'
      );
      expect(orderInsertCall).toBeDefined();

      const orderRow = orderInsertCall[0];
      expect(orderRow).toMatchObject({
        shop_id: 42,
        canonical_order_id: '123',
        platform: 'shopify',
        platform_order_id: 'so-123',
        currency: 'USD',
        total_price: 100,
        subtotal_price: 80,
        total_tax: 20,
        source: 'online',
        referrer_medium: 'ads',
        customer_hashed_id: 'hashed-abc',
        order_created_at: canonicalOrder.createdAt,
        order_updated_at: canonicalOrder.updatedAt,
        order_processed_at: canonicalOrder.processedAt,
      });

      // Assert insert for line items
      const liInsertCall = mockDbInstance.insert.mock.calls.find(
        ([arg]: any[]) =>
          Array.isArray(arg) &&
          arg[0] &&
          arg[0].canonical_line_item_id === 'li-1'
      );
      expect(liInsertCall).toBeDefined();

      const liRow = liInsertCall[0][0];
      expect(liRow).toMatchObject({
        shop_id: 42,
        canonical_line_item_id: 'li-1',
        canonical_order_id: '123',
        canonical_product_id: 'p-1',
        canonical_variant_id: 'v-1',
        platform: 'shopify',
        platform_order_id: 'so-123',
        platform_line_item_id: 'pli-1',
        title: 'Test product',
        sku: 'SKU-1',
        quantity: 2,
        unit_price: 50,
        total_price: 100,
        estimated_unit_cost: null,
      });
    });
  });
});
