// tests/unit/integration/canonical-commerce-mapper.test.ts
import { describe, expect, it } from '@jest/globals';
import {
  mapShopifyOrderToCanonical,
  mapShopifyProductToCanonical
} from '../../../apps/integration-service/src/mappers/canonical-commerce-mapper';

describe('canonical commerce mapper - Shopify → Canonical', () => {
  const hashCustomerId = (shopId: number, rawCustomerId: string) =>
    `hash:${shopId}:${rawCustomerId}`;

  it('maps a basic Shopify order into a CanonicalOrder', () => {
    const rawOrder = {
      id: 12345,
      shop_id: 1,
      created_at: '2025-11-01T00:00:00Z',
      updated_at: '2025-11-01T01:00:00Z',
      processed_at: null,
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '80.00',
      total_tax: '20.00',
      shipping_lines: [
        {
          title: 'Standard',
          code: 'standard',
          price: '10.00'
        }
      ],
      line_items: [
        {
          id: 111,
          product_id: 222,
          variant_id: 333,
          name: 'Test Product',
          sku: 'SKU123',
          quantity: 2,
          price: '40.00'
        }
      ],
      customer: {
        id: 999
      },
      source_name: 'online_store'
    };

    const canonical = mapShopifyOrderToCanonical(rawOrder, { hashCustomerId });

    expect(canonical.id).toBe('12345');
    expect(canonical.shopId).toBe(1);
    expect(canonical.currency).toBe('USD');

    expect(canonical.totalPrice).toBe(100);
    expect(canonical.subtotalPrice).toBe(80);
    expect(canonical.totalTax).toBe(20);

    expect(canonical.shippingLines).toHaveLength(1);
    expect(canonical.shippingLines[0]).toMatchObject({
      title: 'Standard',
      code: 'standard',
      price: 10
    });

    expect(canonical.lineItems).toHaveLength(1);
    expect(canonical.lineItems[0]).toMatchObject({
      lineItemId: '111',
      orderId: '12345',
      productId: '222',
      variantId: '333',
      title: 'Test Product',
      sku: 'SKU123',
      quantity: 2,
      unitPrice: 40,
      totalPrice: 80
    });

    expect(canonical.customer).toBeDefined();
    expect(canonical.customer?.hashedId).toBe('hash:1:999');
    expect(canonical.source).toBe('online_store');
  });

  it('maps a basic Shopify product into a CanonicalProduct', () => {
    const rawProduct = {
      id: 222,
      title: 'Test Product',
      status: 'active',
      handle: 'test-product',
      created_at: '2025-11-01T00:00:00Z',
      updated_at: '2025-11-01T00:10:00Z',
      variants: [
        {
          id: 333,
          price: '40.00',
          sku: 'SKU123',
          inventory_quantity: 10,
          inventory_policy: 'continue'
        }
      ]
    };

    const canonical = mapShopifyProductToCanonical(1, rawProduct);

    expect(canonical.id).toBe('222');
    expect(canonical.shopId).toBe(1);
    expect(canonical.title).toBe('Test Product');
    expect(canonical.status).toBe('active');
    expect(canonical.handle).toBe('test-product');

    expect(canonical.currency).toBeDefined();
    expect(canonical.price).toBe(40);

    expect(canonical.sku).toBe('SKU123');
    expect(canonical.inventoryQuantity).toBe(10);
    expect(canonical.inventoryPolicy).toBe('continue');

    expect(canonical.platform).toBe('shopify');
    expect(canonical.platformProductId).toBe('222');
  });
});