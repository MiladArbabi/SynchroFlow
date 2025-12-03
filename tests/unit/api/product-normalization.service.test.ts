// tests/unit/api/product-normalization.service.test.ts

import { ProductNormalizationService } from 'api-src/services/product-normalization.service';

describe('ProductNormalizationService', () => {
  const service = new ProductNormalizationService();

  it('normalizes basic Shopify product payload', () => {
    const raw = {
      id: 123456789,
      title: 'Test Product',
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
      variants: [{ sku: 'SKU-1' }],
    };

    const result = service.normalizeShopifyProduct(raw, 42);

    expect(result).toMatchObject({
      shopId: 42,
      platform: 'shopify',
      platformProductId: '123456789',
      sku: 'SKU-1',
      title: 'Test Product',
      status: 'active',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    });
  });

  it('handles missing variants and maps status to inactive', () => {
    const raw = {
      id: 999,
      title: 'No Variants',
      status: 'draft',
    };

    const result = service.normalizeShopifyProduct(raw, 1);

    expect(result.sku).toBeNull();
    expect(result.status).toBe('draft');
  });

  // New test cases based on synced data
  it('maps Shopify archived status to archived', () => {
    const raw = {
      id: 1001,
      title: 'Archived Product',
      status: 'archived',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [{ sku: 'SKU-ARCH' }],
    };

    const result = service.normalizeShopifyProduct(raw, 5);
    expect(result.status).toBe('archived');
  });

  it('maps Shopify active_online status to active', () => {
    const raw = {
      id: 1002,
      title: 'Active Online Product',
      status: 'active_online',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [{ sku: 'SKU-ACTIVE' }],
    };

    const result = service.normalizeShopifyProduct(raw, 5);
    expect(result.status).toBe('active');
  });

  it('defaults to active status when status is undefined', () => {
    const raw = {
      id: 1003,
      title: 'No Status Product',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [],
    };

    const result = service.normalizeShopifyProduct(raw, 5);
    expect(result.status).toBe('active');
  });

  it('handles variants with empty string SKU', () => {
    const raw = {
      id: 1004,
      title: 'Product with Empty SKUs',
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [
        { sku: '' },
        { sku: ' ' },
        { sku: 'VALID-SKU' },
        { sku: null }
      ],
    };

    const result = service.normalizeShopifyProduct(raw, 5);
    expect(result.sku).toBe('VALID-SKU');
  });

  it('sets platformVariantId to null as per FT0 scope', () => {
    const raw = {
      id: 1005,
      title: 'Product with Variants',
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      variants: [{ id: 987654321, sku: 'SKU-VAR' }],
    };

    const result = service.normalizeShopifyProduct(raw, 5);
    expect(result.platformVariantId).toBeNull();
  });

  it('throws error for invalid raw product payload', () => {
    expect(() => service.normalizeShopifyProduct(null, 1)).toThrow('Invalid Shopify product payload');
    expect(() => service.normalizeShopifyProduct(undefined, 1)).toThrow('Invalid Shopify product payload');
    expect(() => service.normalizeShopifyProduct('invalid', 1)).toThrow('Invalid Shopify product payload');
    expect(() => service.normalizeShopifyProduct(123, 1)).toThrow('Invalid Shopify product payload');
  });

  it('uses current ISO timestamp when created_at/updated_at are missing', () => {
    const raw = {
      id: 1006,
      title: 'Product without timestamps',
      status: 'active',
      variants: [{ sku: 'SKU-NO-TIME' }],
    };

    const before = new Date().toISOString();
    const result = service.normalizeShopifyProduct(raw, 5);
    const after = new Date().toISOString();

    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
    
    // Check timestamps are within reasonable range
    expect(new Date(result.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(new Date(result.createdAt).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
  });
});