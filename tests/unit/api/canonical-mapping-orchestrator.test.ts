// tests/unit/api/canonical-mapping-orchestrator.test.ts
// RED tests for CanonicalMappingOrchestrator (TDD)

/**
 * These tests describe the expected behaviour of the CanonicalMappingOrchestrator.
 * Implementation does not yet exist — these tests should fail (red) until the
 * orchestrator is implemented to satisfy them.
 *
 * Conventions: tests use plain JS objects for mapping rules. Real implementation
 * can adopt a stricter MappingRule type.
 */

import { jest } from '@jest/globals';

// The orchestrator function we expect to implement. Using this import path
// follows the existing project alias convention for backend services.
import { buildCanonicalOrder } from 'api-src/services/canonical-mapping-orchestrator';

// Match the actual MappingRule type from the implementation
type MappingRule = {
  source?: string | null; // JSON path into raw payload (dot notation). If null and literal provided, use literal.
  target: string; // dot-notation path into canonical order (arrays allowed)
  required?: boolean;
  literal?: any;
  value?: any; // legacy support
};

// Type for test results - flexible since mapping can create any structure
type TestCanonicalResult = Record<string, any>;

describe('CanonicalMappingOrchestrator (RED tests)', () => {
  describe('Basic field mapping', () => {
    test('should map simple top-level fields', async () => {
      const raw = { id: 'so-1', total: 42 };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'total', target: 'total_price' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.total_price).toBe(42);
    });

    test('should map nested fields using JSON path', async () => {
      const raw = { 
        id: 'so-1',
        customer: { email: 'me@example.com' }, 
        meta: { tags: ['x'] } 
      };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'customer.email', target: 'customer_email' },
        { source: 'meta.tags', target: 'tags' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.customer_email).toBe('me@example.com');
      expect(Array.isArray(result.tags)).toBe(true);
      expect(result.tags).toEqual(['x']);
    });

    test('should handle dot notation with arrays in source path', async () => {
      const raw = {
        id: 'so-1',
        line_items: [
          { sku: 'SKU1', price: 10 },
          { sku: 'SKU2', price: 20 }
        ]
      };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'line_items.0.sku', target: 'first_item_sku' },
        { source: 'line_items.1.price', target: 'second_item_price' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.first_item_sku).toBe('SKU1');
      expect(result.second_item_price).toBe(20);
    });
  });

  describe('Literal values and null source', () => {
    test('should apply literal values when mappingRule.source is null', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: null, target: 'platform', literal: 'shopify' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.platform).toBe('shopify');
    });

    test('should support legacy value property for literals', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: null, target: 'platform', value: 'shopify' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.platform).toBe('shopify');
    });

    test('should handle null literal values', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: null, target: 'optional_field', literal: null },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.optional_field).toBeNull();
    });

    test('should handle falsy literals (0, false, empty string)', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: null, target: 'zero_value', literal: 0 },
        { source: null, target: 'false_value', literal: false },
        { source: null, target: 'empty_string', literal: '' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.zero_value).toBe(0);
      expect(result.false_value).toBe(false);
      expect(result.empty_string).toBe('');
    });
  });

  describe('Required field validation', () => {
    test('should throw when required canonical fields are missing', async () => {
      const raw = { foo: 'bar' };
      const rules: MappingRule[] = [
        // intentionally do not map canonical_order_id which is required
        { source: 'foo', target: 'some_field' },
      ];

      await expect(buildCanonicalOrder(raw, rules)).rejects.toThrow(
        /Missing required field: canonical_order_id/i,
      );
    });

    test('should throw when explicitly required fields are missing', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'missing_field', target: 'required_field', required: true },
      ];

      await expect(buildCanonicalOrder(raw, rules)).rejects.toThrow(
        /Missing required field: required_field/i,
      );
    });

    test('should not throw when required field has falsy value (0, false, empty string)', async () => {
      const raw = { id: 'so-1', zero: 0, bool: false, empty: '' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'zero', target: 'zero_value', required: true },
        { source: 'bool', target: 'false_value', required: true },
        { source: 'empty', target: 'empty_string', required: true },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.zero_value).toBe(0);
      expect(result.false_value).toBe(false);
      expect(result.empty_string).toBe('');
    });

    test('should throw when required field is explicitly null', async () => {
      const raw = { id: 'so-1', nullField: null };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'nullField', target: 'required_field', required: true },
      ];

      await expect(buildCanonicalOrder(raw, rules)).rejects.toThrow(
        /Missing required field: required_field/i,
      );
    });

    test('should throw when required field is undefined', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'undefinedField', target: 'required_field', required: true },
      ];

      await expect(buildCanonicalOrder(raw, rules)).rejects.toThrow(
        /Missing required field: required_field/i,
      );
    });
  });

  describe('Array handling', () => {
    test('should support mapping arrays (line items)', async () => {
      const raw = {
        id: 'order-array-1',
        line_items: [
          { sku: 'SKU1', qty: 2, title: 'P1' },
          { sku: 'SKU2', qty: 1, title: 'P2' },
        ],
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        // Map the entire array
        { source: 'line_items', target: 'items' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ sku: 'SKU1', qty: 2, title: 'P1' });
      expect(result.items[1]).toMatchObject({ sku: 'SKU2', qty: 1, title: 'P2' });
    });

    test('should handle nested arrays in source', async () => {
      const raw = {
        id: 'so-1',
        nested: {
          items: [
            { name: 'Item1', categories: ['cat1', 'cat2'] },
            { name: 'Item2', categories: ['cat3'] },
          ]
        }
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'nested.items.0.categories', target: 'first_item_categories' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(Array.isArray(result.first_item_categories)).toBe(true);
      expect(result.first_item_categories).toEqual(['cat1', 'cat2']);
    });

    test('should handle empty arrays', async () => {
      const raw = {
        id: 'so-1',
        empty_items: []
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'empty_items', target: 'items' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(0);
    });

    test('should create nested arrays when target path includes indices', async () => {
      const raw = {
        id: 'so-1',
        sku1: 'ITEM1',
        price1: 10,
        sku2: 'ITEM2',
        price2: 20
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'sku1', target: 'line_items.0.sku' },
        { source: 'price1', target: 'line_items.0.price' },
        { source: 'sku2', target: 'line_items.1.sku' },
        { source: 'price2', target: 'line_items.1.price' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(Array.isArray(result.line_items)).toBe(true);
      expect(result.line_items).toHaveLength(2);
      expect((result.line_items as any[])[0]).toEqual({ sku: 'ITEM1', price: 10 });
      expect((result.line_items as any[])[1]).toEqual({ sku: 'ITEM2', price: 20 });
    });
  });

  describe('Complex nested structures', () => {
    test('should build deeply nested canonical structures', async () => {
      const raw = {
        id: 'so-1',
        customer: {
          contact: {
            email: 'test@example.com',
            phone: '123-456-7890'
          },
          billing: {
            address: {
              street: '123 Main St',
              city: 'Anytown',
              country: 'US'
            }
          }
        }
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'customer.contact.email', target: 'customer.email' },
        { source: 'customer.contact.phone', target: 'customer.phone' },
        { source: 'customer.billing.address.street', target: 'customer.billing_address.street' },
        { source: 'customer.billing.address.city', target: 'customer.billing_address.city' },
        { source: 'customer.billing.address.country', target: 'customer.billing_address.country_code' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.customer?.email).toBe('test@example.com');
      expect(result.customer?.phone).toBe('123-456-7890');
      expect(result.customer?.billing_address?.street).toBe('123 Main St');
      expect(result.customer?.billing_address?.city).toBe('Anytown');
      expect(result.customer?.billing_address?.country_code).toBe('US');
    });

    test('should handle mixed array and object structures', async () => {
      const raw = {
        id: 'so-1',
        items: [
          { id: 'i1', variants: [{ id: 'v1' }, { id: 'v2' }] },
          { id: 'i2', variants: [{ id: 'v3' }] }
        ]
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'items.0.id', target: 'line_items.0.product_id' },
        { source: 'items.0.variants.0.id', target: 'line_items.0.variant_id' },
        { source: 'items.1.id', target: 'line_items.1.product_id' },
        { source: 'items.1.variants.0.id', target: 'line_items.1.variant_id' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect((result.line_items as any[])[0]?.product_id).toBe('i1');
      expect((result.line_items as any[])[0]?.variant_id).toBe('v1');
      expect((result.line_items as any[])[1]?.product_id).toBe('i2');
      expect((result.line_items as any[])[1]?.variant_id).toBe('v3');
    });
  });

  describe('Edge cases and error handling', () => {
    test('should throw error for invalid raw payload (null)', async () => {
      const raw = null;
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
      ];

      await expect(buildCanonicalOrder(raw as any, rules)).rejects.toThrow(
        /Invalid raw payload/i,
      );
    });

    test('should throw error for invalid raw payload (string)', async () => {
      const raw = 'not an object';
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
      ];

      await expect(buildCanonicalOrder(raw as any, rules)).rejects.toThrow(
        /Invalid raw payload/i,
      );
    });

    test('should handle empty rules array', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [];

      await expect(buildCanonicalOrder(raw, rules)).rejects.toThrow(
        /Missing required field: canonical_order_id/i,
      );
    });

    test('should handle undefined source with no literal (skip assignment)', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'undefined_field', target: 'optional_field' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.optional_field).toBeUndefined();
    });

    test('should handle null source with no literal (skip assignment)', async () => {
      const raw = { id: 'so-1' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: null, target: 'optional_field' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.optional_field).toBeUndefined();
    });

    test('should handle conflicting mappings (later rules overwrite earlier)', async () => {
      const raw = { id: 'so-1', total: 100, adjusted_total: 90 };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'total', target: 'final_price' },
        { source: 'adjusted_total', target: 'final_price' }, // Overwrites previous
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.final_price).toBe(90); // Should use adjusted_total, not total
    });

    test('should handle large number of rules efficiently', async () => {
      const raw: Record<string, any> = { id: 'so-1' };
      const rules: MappingRule[] = [{ source: 'id', target: 'canonical_order_id' }];

      // Add 1000 rules
      for (let i = 0; i < 1000; i++) {
        raw[`field${i}`] = `value${i}`;
        rules.push({ source: `field${i}`, target: `mapped_field${i}` });
      }

      const startTime = Date.now();
      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;
      const endTime = Date.now();

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.mapped_field0).toBe('value0');
      expect(result.mapped_field999).toBe('value999');
      
      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000); // 1 second
    });
  });

  describe('Type coercion and falsy values', () => {
    test('should preserve number 0 as valid value', async () => {
      const raw = { id: 'so-1', zero: 0 };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'zero', target: 'zero_value' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.zero_value).toBe(0);
    });

    test('should preserve boolean false as valid value', async () => {
      const raw = { id: 'so-1', active: false };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'active', target: 'is_active' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.is_active).toBe(false);
    });

    test('should preserve empty string as valid value', async () => {
      const raw = { id: 'so-1', notes: '' };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'notes', target: 'order_notes' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.order_notes).toBe('');
    });
  });

  describe('Business logic scenarios', () => {
    test('should return fully shaped canonical order object', async () => {
      const raw = { id: 'so-2', customer: { id: 'c-1' }, total: 10 };
      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'customer.id', target: 'customer_hashed_id' },
        { source: 'total', target: 'total_price' },
        // Provide literal platform
        { source: null, target: 'platform', literal: 'shopify' },
        // Default values
        { source: null, target: 'currency', literal: 'USD' },
        { source: null, target: 'source', literal: 'online' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      // verify presence of core canonical fields
      expect(result).toMatchObject({
        canonical_order_id: 'so-2',
        customer_hashed_id: 'c-1',
        total_price: 10,
        platform: 'shopify',
        currency: 'USD',
        source: 'online',
      });
    });

    test('should handle complex e-commerce payload transformation', async () => {
      const raw = {
        order_id: 'ORD-12345',
        customer: {
          email: 'john.doe@example.com',
          first_name: 'John',
          last_name: 'Doe',
          billing_address: {
            street: '456 Oak Ave',
            city: 'Metropolis',
            state: 'NY',
            zip: '10001',
            country: 'USA'
          }
        },
        line_items: [
          { sku: 'PROD-001', quantity: 2, price: 29.99, name: 'Product 1' },
          { sku: 'PROD-002', quantity: 1, price: 99.99, name: 'Product 2' }
        ],
        totals: {
          subtotal: 159.97,
          tax: 14.40,
          shipping: 9.99,
          total: 184.36
        },
        payment: {
          method: 'credit_card',
          status: 'paid'
        }
      };

      const rules: MappingRule[] = [
        { source: 'order_id', target: 'canonical_order_id' },
        { source: 'customer.email', target: 'customer.email', required: true },
        { source: 'customer.first_name', target: 'customer.first_name' },
        { source: 'customer.last_name', target: 'customer.last_name' },
        { source: 'customer.billing_address.street', target: 'billing_address.line1' },
        { source: 'customer.billing_address.city', target: 'billing_address.city' },
        { source: 'customer.billing_address.state', target: 'billing_address.state' },
        { source: 'customer.billing_address.zip', target: 'billing_address.postal_code' },
        { source: 'customer.billing_address.country', target: 'billing_address.country' },
        { source: 'line_items', target: 'line_items' },
        { source: 'totals.subtotal', target: 'subtotal_price' },
        { source: 'totals.tax', target: 'total_tax' },
        { source: 'totals.shipping', target: 'shipping_price' },
        { source: 'totals.total', target: 'total_price' },
        { source: 'payment.method', target: 'payment_method' },
        { source: 'payment.status', target: 'payment_status' },
        { source: null, target: 'platform', literal: 'woocommerce' },
        { source: null, target: 'currency', literal: 'USD' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('ORD-12345');
      expect(result.customer?.email).toBe('john.doe@example.com');
      expect(result.customer?.first_name).toBe('John');
      expect(result.customer?.last_name).toBe('Doe');
      expect(result.billing_address?.city).toBe('Metropolis');
      expect(result.billing_address?.country).toBe('USA');
      expect(Array.isArray(result.line_items)).toBe(true);
      expect(result.line_items).toHaveLength(2);
      expect(result.subtotal_price).toBe(159.97);
      expect(result.total_tax).toBe(14.40);
      expect(result.shipping_price).toBe(9.99);
      expect(result.total_price).toBe(184.36);
      expect(result.payment_method).toBe('credit_card');
      expect(result.payment_status).toBe('paid');
      expect(result.platform).toBe('woocommerce');
      expect(result.currency).toBe('USD');
    });

    test('should handle partial data with defaults', async () => {
      const raw = {
        id: 'partial-order',
        total: 50
        // Missing customer data
      };

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'total', target: 'total_price' },
        // Default values for missing data
        { source: null, target: 'platform', literal: 'custom' },
        { source: null, target: 'customer.email', literal: 'unknown@example.com' },
        { source: null, target: 'source', literal: 'manual_entry' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('partial-order');
      expect(result.total_price).toBe(50);
      expect(result.platform).toBe('custom');
      expect(result.customer?.email).toBe('unknown@example.com');
      expect(result.source).toBe('manual_entry');
    });
  });

  describe('Performance and scalability', () => {
    test('should handle deep nesting without stack overflow', async () => {
      // Create deeply nested structure
      let raw: Record<string, any> = { id: 'so-1' };
      let current = raw;
      
      // Create 20 levels of nesting
      for (let i = 0; i < 20; i++) {
        current[`level${i}`] = {};
        current = current[`level${i}`];
      }
      current['value'] = 'deep_value';

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'level0.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12.level13.level14.level15.level16.level17.level18.level19.value', 
          target: 'deeply_nested_value' },
      ];

      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;

      expect(result.canonical_order_id).toBe('so-1');
      expect(result.deeply_nested_value).toBe('deep_value');
    });

    test('should handle many array elements efficiently', async () => {
      const raw: Record<string, any> = { id: 'so-1' };
      const lineItems = [];
      
      // Create 500 line items
      for (let i = 0; i < 500; i++) {
        lineItems.push({
          sku: `SKU-${i}`,
          quantity: i + 1,
          price: (i + 1) * 10
        });
      }
      
      raw.line_items = lineItems;

      const rules: MappingRule[] = [
        { source: 'id', target: 'canonical_order_id' },
        { source: 'line_items', target: 'line_items' },
      ];

      const startTime = Date.now();
      const result = await buildCanonicalOrder(raw, rules) as TestCanonicalResult;
      const endTime = Date.now();

      expect(result.canonical_order_id).toBe('so-1');
      expect(Array.isArray(result.line_items)).toBe(true);
      expect(result.line_items).toHaveLength(500);
      expect((result.line_items as any[])[0]?.sku).toBe('SKU-0');
      expect((result.line_items as any[])[499]?.sku).toBe('SKU-499');
      
      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(2000); // 2 seconds
    });
  });
});