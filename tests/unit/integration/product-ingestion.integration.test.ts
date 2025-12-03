// tests/unit/integration/product-ingestion.integration.test.ts

import { processProductMessage } from 'api-src/workers/product-worker';

// --- db mock (integration-style: we only mock DB, use real normalizer + worker) ---
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };

  return {
    __esModule: true,
    default: mockDb,
  };
});

const mockDb = require('api-src/db').default as jest.Mock;
const mockDbInstance = mockDb() as any;

describe('Product ingestion pipeline (integration-style)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
  });

  it('normalizes Shopify product and upserts canonical_products row with expected shape', async () => {
    const rawProduct = {
      id: 123456789,
      title: 'My Test Product',
      status: 'active',
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-02T12:00:00Z',
      variants: [
        { id: 1, sku: '' },
        { id: 2, sku: 'SKU-PRIMARY' }, // first non-empty SKU should be used
      ],
    };

    const msg = {
      shopId: 7,
      platform: 'shopify' as const,
      rawProduct,
    };

    await processProductMessage(msg as any);

    // Assert: we wrote to canonical_products
    expect(mockDb).toHaveBeenCalledWith('canonical_products');
    expect(mockDbInstance.insert).toHaveBeenCalledTimes(1);

    const [insertPayload] = mockDbInstance.insert.mock.calls[0];

    // Exact row shape
    expect(insertPayload).toEqual({
      shop_id: 7,
      platform: 'shopify',
      platform_product_id: String(rawProduct.id),
      platform_variant_id: null,
      sku: 'SKU-PRIMARY',
      title: 'My Test Product',
      status: 'active',
      created_at: rawProduct.created_at,
      updated_at: rawProduct.updated_at,
    });

    // Upsert semantics: correct conflict key + merge payload
    expect(mockDbInstance.onConflict).toHaveBeenCalledWith([
      'shop_id',
      'platform',
      'platform_product_id',
      'platform_variant_id',
    ]);

    const [mergePayload] = mockDbInstance.merge.mock.calls[0];
    expect(mergePayload).toEqual({
      sku: 'SKU-PRIMARY',
      title: 'My Test Product',
      status: 'active',
      updated_at: rawProduct.updated_at,
    });
  });

  it('is idempotent for repeated messages (upsert semantics)', async () => {
    const rawProduct = {
      id: 123456789,
      title: 'My Test Product',
      status: 'active',
      variants: [{ id: 2, sku: 'SKU-PRIMARY' }],
    };

    const msg = {
      shopId: 7,
      platform: 'shopify' as const,
      rawProduct,
    };

    // Call twice with same payload
    await processProductMessage(msg as any);
    await processProductMessage(msg as any);

    // We expect insert + onConflict.merge to be used each time
    expect(mockDb).toHaveBeenCalledWith('canonical_products');
    expect(mockDbInstance.insert).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.onConflict).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.merge).toHaveBeenCalledTimes(2);
  });
});
