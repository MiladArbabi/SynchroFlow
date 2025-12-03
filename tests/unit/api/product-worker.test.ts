// tests/unit/api/product-worker.test.ts

import { processProductMessage, ProductIngestionMessage } from 'api-src/workers/product-worker';
import { ProductNormalizationService } from 'api-src/services/product-normalization.service';

// Mock db (same pattern as your other tests)
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

// Optional: mock normalizer if you want to isolate worker
jest.mock('api-src/services/product-normalization.service', () => {
  const normalizeShopifyProduct = jest.fn(() => ({
    shopId: 42,
    platform: 'shopify' as const,
    platformProductId: '123',
    platformVariantId: null,
    sku: 'SKU-1',
    title: 'Test Product',
    status: 'active' as const,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }));

  return {
    __esModule: true,
    ProductNormalizationService: jest.fn().mockImplementation(() => ({
      normalizeShopifyProduct,
    })),
    __mocks: { normalizeShopifyProduct },
  };
});

const mockDb = require('api-src/db').default as jest.Mock;
const mockDbInstance = mockDb() as any;
const normalizerModule = require('api-src/services/product-normalization.service') as any;
const normalizeShopifyProductMock = normalizerModule.__mocks.normalizeShopifyProduct as jest.Mock;

describe('processProductMessage (canonical products)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
  });

  it('upserts canonical product row for Shopify message', async () => {
    const msg: ProductIngestionMessage = {
      shopId: 42,
      platform: 'shopify',
      rawProduct: { id: 123 },
    };

    await processProductMessage(msg);

    expect(normalizeShopifyProductMock).toHaveBeenCalledWith(msg.rawProduct, msg.shopId);
    expect(mockDb).toHaveBeenCalledWith('canonical_products');
    expect(mockDbInstance.insert).toHaveBeenCalledTimes(1);
    expect(mockDbInstance.onConflict).toHaveBeenCalledWith([
      'shop_id',
      'platform',
      'platform_product_id',
      'platform_variant_id',
    ]);
    expect(mockDbInstance.merge).toHaveBeenCalledTimes(1);
  });

  // Updated test cases with correct types
  it('handles non-Shopify platform messages by returning early', async () => {
    // For this test, we need to bypass TypeScript's type checking since we're testing
    // the runtime behavior with an invalid platform
    const msg = {
      shopId: 42,
      platform: 'woocommerce' as any, // Force TypeScript to accept this for testing
      rawProduct: { id: 123 },
    };

    await processProductMessage(msg as ProductIngestionMessage);

    expect(normalizeShopifyProductMock).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('calls db upsert with correct fields and null handling', async () => {
    const msg: ProductIngestionMessage = {
      shopId: 42,
      platform: 'shopify',
      rawProduct: { id: 123 },
    };

    // Override the mock to return specific values
    normalizeShopifyProductMock.mockReturnValueOnce({
      shopId: 42,
      platform: 'shopify' as const,
      platformProductId: '12345',
      platformVariantId: null,
      sku: null,
      title: 'Test Product',
      status: 'inactive' as const,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });

    await processProductMessage(msg);

    expect(mockDbInstance.insert).toHaveBeenCalledWith({
      shop_id: 42,
      platform: 'shopify',
      platform_product_id: '12345',
      platform_variant_id: null,
      sku: null,
      title: 'Test Product',
      status: 'inactive',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    });

    expect(mockDbInstance.merge).toHaveBeenCalledWith({
      sku: null,
      title: 'Test Product',
      status: 'inactive',
      updated_at: '2025-01-01T00:00:00Z',
    });
  });

  it('passes correct parameters to normalizer', async () => {
    const rawProduct = { 
      id: 99999, 
      title: 'Complex Product',
      variants: [{ sku: 'TEST-SKU' }],
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z'
    };
    
    const msg: ProductIngestionMessage = {
      shopId: 99,
      platform: 'shopify',
      rawProduct,
    };

    await processProductMessage(msg);

    expect(normalizeShopifyProductMock).toHaveBeenCalledWith(rawProduct, 99);
  });

  it('propagates errors from normalizer', async () => {
    const msg: ProductIngestionMessage = {
      shopId: 42,
      platform: 'shopify',
      rawProduct: { id: 123 },
    };

    // Mock the normalizer to throw an error
    normalizeShopifyProductMock.mockImplementationOnce(() => {
      throw new Error('Normalization failed');
    });

    await expect(processProductMessage(msg)).rejects.toThrow('Normalization failed');
    
    // Verify DB was not called after error
    expect(mockDbInstance.insert).not.toHaveBeenCalled();
  });

  it('handles platformVariantId undefined by setting to null', async () => {
    const msg: ProductIngestionMessage = {
      shopId: 42,
      platform: 'shopify',
      rawProduct: { id: 123 },
    };

    normalizeShopifyProductMock.mockReturnValueOnce({
      shopId: 42,
      platform: 'shopify' as const,
      platformProductId: '123',
      platformVariantId: undefined, // Testing undefined
      sku: 'SKU-1',
      title: 'Test Product',
      status: 'active' as const,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });

    await processProductMessage(msg);

    expect(mockDbInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        platform_variant_id: null
      })
    );
  });

  it('handles default status when not provided', async () => {
    const msg: ProductIngestionMessage = {
      shopId: 42,
      platform: 'shopify',
      rawProduct: { id: 123 },
    };

    normalizeShopifyProductMock.mockReturnValueOnce({
      shopId: 42,
      platform: 'shopify' as const,
      platformProductId: '123',
      platformVariantId: null,
      sku: 'SKU-1',
      title: 'Test Product',
      // status is undefined
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });

    await processProductMessage(msg);

    // Verify default 'active' status is used
    expect(mockDbInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active'
      })
    );
  });
});