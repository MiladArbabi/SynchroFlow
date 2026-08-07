import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapShopifyOrderNodeToCanonical,
} from '../src/services/mappers/shopify-to-canonical-order.ts';

test('maps REST orders/create shipping address and line items', () => {
  const payload = {
    id: 17041162174834,
    currency: 'USD',
    total_price: '1795.35',
    subtotal_price: '1795.35',
    total_tax: '0.00',

    created_at: '2026-08-07T20:06:15Z',
    updated_at: '2026-08-07T20:06:17Z',

    shipping_address: {
      name: 'Webhook Test Customer',
      address1: '123 Test Street',
      address2: null,
      city: 'Toronto',
      zip: 'M5V 2T6',
      phone: null,
      province_code: 'ON',
      country_code: 'CA',
    },

    line_items: [
      {
        id: 45853735682418,
        product_id: 14838669181298,
        variant_id: 60837615501682,
        title: 'The Multi-managed Snowboard',
        sku: 'sku-managed-1',
        quantity: 3,
        price: '598.45',
      },
    ],
  };

  const canonical =
    mapShopifyOrderNodeToCanonical(payload, 1);

  assert.equal(canonical.id, '17041162174834');

  assert.deepEqual(canonical.shippingAddress, {
    name: 'Webhook Test Customer',
    address1: '123 Test Street',
    address2: null,
    city: 'Toronto',
    zip: 'M5V 2T6',
    phone: null,
    provinceCode: 'ON',
    countryCode: 'CA',
  });

  assert.equal(canonical.lineItems.length, 1);

  assert.deepEqual(canonical.lineItems[0], {
    lineItemId: '45853735682418',
    orderId: '17041162174834',
    productId: '14838669181298',
    variantId: '60837615501682',
    title: 'The Multi-managed Snowboard',
    sku: 'sku-managed-1',
    quantity: 3,
    unitPrice: 598.45,
    totalPrice: null,
    estimatedUnitCost: null,
    platform: 'shopify',
    platformLineItemId: '45853735682418',
  });
});

test('preserves GraphQL order shape support', () => {
  const payload = {
    id: 'gid://shopify/Order/12345',
    currencyCode: 'USD',

    totalPriceSet: {
      shopMoney: { amount: '100.00' },
    },
    subtotalPriceSet: {
      shopMoney: { amount: '90.00' },
    },
    totalTaxSet: {
      shopMoney: { amount: '10.00' },
    },

    shippingAddress: {
      name: 'GraphQL Customer',
      address1: '456 GraphQL Street',
      address2: null,
      city: 'Stockholm',
      zip: '11122',
      phone: null,
      provinceCode: 'AB',
      countryCode: 'SE',
    },

    lineItems: {
      edges: [
        {
          node: {
            id: 'gid://shopify/LineItem/999',
            product: {
              id: 'gid://shopify/Product/100',
            },
            variant: {
              id: 'gid://shopify/ProductVariant/200',
              title: 'Default',
              sku: 'graphql-sku',
            },
            quantity: 2,
            originalUnitPriceSet: {
              shopMoney: { amount: '45.00' },
            },
            originalTotalSet: {
              shopMoney: { amount: '90.00' },
            },
          },
        },
      ],
    },
  };

  const canonical =
    mapShopifyOrderNodeToCanonical(payload, 1);

  assert.equal(canonical.id, '12345');
  assert.equal(canonical.lineItems.length, 1);
  assert.equal(
    canonical.lineItems[0].variantId,
    'gid://shopify/ProductVariant/200'
  );
  assert.equal(canonical.lineItems[0].unitPrice, 45);
  assert.equal(canonical.lineItems[0].totalPrice, 90);
  assert.equal(
    canonical.shippingAddress?.countryCode,
    'SE'
  );
});