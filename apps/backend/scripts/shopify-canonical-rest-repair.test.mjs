import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planShopifyHistoricalCanonicalRepair,
} from '../src/services/shopify/historicalCanonicalRepair.service.ts';

const ORDER_ID =
  '11111111-1111-4111-8111-111111111111';

const PRODUCT_ID =
  '22222222-2222-4222-8222-222222222222';

const VARIANT_ID =
  '33333333-3333-4333-8333-333333333333';

const EXTERNAL_PRODUCT_ID = '7001';
const EXTERNAL_VARIANT_ID = '9001';

function lineItem(overrides = {}) {
  return {
    id: 5001,
    product_id: Number(EXTERNAL_PRODUCT_ID),
    variant_id: Number(EXTERNAL_VARIANT_ID),
    title: 'Historical Product',
    sku: 'HIST-1',
    quantity: 1,
    price: '30.00',
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    id: 1001,
    currency: 'USD',
    total_price: '30.00',
    subtotal_price: '30.00',
    total_tax: '0.00',
    created_at: '2026-06-26T10:00:00Z',
    updated_at: '2026-06-26T10:00:01Z',
    shipping_address: null,
    line_items: [lineItem()],
    ...overrides,
  };
}

function orderRow(overrides = {}) {
  return {
    lasyncro_order_id: ORDER_ID,
    shop_id: 1,
    payment_state: 'paid',

    shipping_name: null,
    shipping_address1: null,
    shipping_address2: null,
    shipping_city: null,
    shipping_zip: null,
    shipping_phone: null,
    shipping_province: null,
    shipping_country_code: null,

    ...overrides,
  };
}

function storedLine(overrides = {}) {
  return {
    external_line_item_id: '5001',
    lasyncro_variant_id: VARIANT_ID,
    quantity: 1,
    unit_price: '30.00',
    ...overrides,
  };
}

function makeFakeTrx({
  sourcePayload = payload(),
  order = orderRow(),
  orderIdentity = true,
  orderExists = true,
  storedLineItems = [],
  variantIdentity = true,
  variantExists = true,
  revenueUnits = 0,
  batchMemberships = 0,
  inventoryTruth = {
    on_hand_quantity: 0,
    reserved_quantity: 0,
  },
  inventoryMovements = [],
} = {}) {
  const sourceEvent = {
    id: '101',
    event_time: '2026-06-26T10:00:00.000Z',
    event_payload: sourcePayload,
  };

  function rowsFor(table, where) {
    if (table === 'external_order_identity_map') {
      return orderIdentity
        ? [{ lasyncro_order_id: ORDER_ID }]
        : [];
    }

    if (table === 'external_product_identity_map') {
      return variantIdentity
        ? [{ lasyncro_variant_id: VARIANT_ID }]
        : [];
    }

    if (table === 'orders') {
      return orderExists ? [order] : [];
    }

    if (table === 'order_line_items') {
      return storedLineItems;
    }

    if (table === 'variants') {
      return variantExists
        ? [{
            lasyncro_variant_id: VARIANT_ID,
            lasyncro_product_id: PRODUCT_ID,
            sku: 'HIST-1',
            title: 'Default Title',
          }]
        : [];
    }

    if (table === 'inventory_truth') {
      return inventoryTruth
        ? [inventoryTruth]
        : [];
    }

    if (table === 'inventory_movements') {
      return inventoryMovements;
    }

    if (table === 'order_revenue_units') {
      return Array.from(
        { length: revenueUnits },
        (_, index) => ({ id: index + 1 })
      );
    }

    if (table === 'pick_batch_orders') {
      return Array.from(
        { length: batchMemberships },
        (_, index) => ({ id: index + 1 })
      );
    }

    throw new Error(`UNEXPECTED_TEST_TABLE:${table}`);
  }

  const trx = (table) => {
    let where = {};
    let countMode = false;

    const query = {
      where(criteria) {
        where = {
          ...where,
          ...criteria,
        };
        return query;
      },

      select() {
        return query;
      },

      count() {
        countMode = true;
        return query;
      },

      async first() {
        const rows = rowsFor(table, where);

        if (countMode) {
          return {
            count: String(rows.length),
          };
        }

        return rows[0];
      },

      then(resolve, reject) {
        const rows = rowsFor(table, where);

        return Promise.resolve(
          countMode
            ? [{ count: String(rows.length) }]
            : rows
        ).then(resolve, reject);
      },
    };

    return query;
  };

  trx.raw = async () => ({
    rows: [sourceEvent],
  });

  return trx;
}

async function plan(fixture = {}) {
  return planShopifyHistoricalCanonicalRepair(
    makeFakeTrx(fixture),
    1
  );
}

test(
  'complete source address with empty stored address requires shipping repair',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        line_items: [],
        shipping_address: {
          name: 'Russell Winfield',
          address1: '105 Victoria St',
          address2: null,
          city: 'Toronto',
          zip: 'M5C 1N7',
          phone: null,
          province_code: 'ON',
          country_code: 'CA',
        },
      }),
    });

    assert.equal(result.summary.candidateCount, 1);

    const candidate = result.candidates[0];

    assert.equal(
      candidate.shippingRepairRequired,
      true
    );

    assert.equal(
      candidate.sourceShippingComplete,
      true
    );

    assert.equal(
      candidate.sourceShipping.address1,
      '105 Victoria St'
    );

    assert.equal(candidate.repairable, true);
  }
);

test(
  'partial source address remains incomplete while preserving source fields',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        line_items: [],
        shipping_address: {
          name: 'Incomplete Customer',
          address1: '',
          address2: null,
          city: '',
          zip: null,
          phone: null,
          province_code: null,
          country_code: 'US',
        },
      }),
    });

    const candidate = result.candidates[0];

    assert.equal(
      candidate.shippingRepairRequired,
      true
    );

    assert.equal(
      candidate.sourceShippingComplete,
      false
    );

    assert.equal(
      candidate.sourceShipping.name,
      'Incomplete Customer'
    );

    assert.equal(
      candidate.sourceShipping.address1,
      null
    );

    assert.equal(
      candidate.sourceShipping.countryCode,
      'US'
    );
  }
);

test(
  'source quantity three with zero persisted lines requires line-item repair',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        line_items: [
          lineItem({
            quantity: 3,
            price: '598.45',
          }),
        ],
      }),
      storedLineItems: [],
    });

    const candidate = result.candidates[0];

    assert.equal(
      candidate.lineItemRepairRequired,
      true
    );

    assert.equal(candidate.sourceLineItemCount, 1);
    assert.equal(candidate.storedLineItemCount, 0);

    assert.equal(candidate.sourceQuantityTotal, 3);
    assert.equal(candidate.storedQuantityTotal, 0);

    assert.equal(
      candidate.sourceLineItems[0].quantity,
      3
    );

    assert.equal(
      candidate.sourceLineItems[0].unitPrice,
      598.45
    );

    assert.equal(candidate.repairable, true);
  }
);

test(
  'matching persisted canonical state produces no repair candidate',
  async () => {
    const result = await plan({
      sourcePayload: payload(),
      storedLineItems: [
        storedLine(),
      ],
    });

    assert.equal(result.summary.candidateCount, 0);
    assert.deepEqual(result.candidates, []);
  }
);

test(
  'partial persisted line-item state fails closed',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        total_price: '60.00',
        subtotal_price: '60.00',
        line_items: [
          lineItem({
            id: 5001,
          }),
          lineItem({
            id: 5002,
          }),
        ],
      }),

      storedLineItems: [
        storedLine({
          external_line_item_id: '5001',
        }),
      ],
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.includes(
        'PARTIAL_LINE_ITEM_STATE'
      )
    );
  }
);

test(
  'existing revenue units fail closed',
  async () => {
    const result = await plan({
      storedLineItems: [],
      revenueUnits: 1,
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.includes(
        'EXISTING_REVENUE_UNITS'
      )
    );
  }
);

test(
  'existing batch membership fails closed',
  async () => {
    const result = await plan({
      storedLineItems: [],
      batchMemberships: 1,
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.includes(
        'ORDER_ALREADY_BATCHED'
      )
    );
  }
);

test(
  'unresolved Shopify variant identity fails closed',
  async () => {
    const result = await plan({
      storedLineItems: [],
      variantIdentity: false,
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.includes(
        'LINE_5001_VARIANT_IDENTITY_MISSING'
      )
    );
  }
);

test(
  'planner is naturally idempotent once canonical state matches source',
  async () => {
    const before = await plan({
      sourcePayload: payload({
        shipping_address: {
          name: 'Repair Customer',
          address1: '1 Repair Street',
          address2: null,
          city: 'Toronto',
          zip: 'M5V 1A1',
          phone: null,
          province_code: 'ON',
          country_code: 'CA',
        },
      }),
      storedLineItems: [],
    });

    assert.equal(
      before.summary.candidateCount,
      1
    );

    const after = await plan({
      sourcePayload: payload({
        shipping_address: {
          name: 'Repair Customer',
          address1: '1 Repair Street',
          address2: null,
          city: 'Toronto',
          zip: 'M5V 1A1',
          phone: null,
          province_code: 'ON',
          country_code: 'CA',
        },
      }),

      order: orderRow({
        shipping_name: 'Repair Customer',
        shipping_address1: '1 Repair Street',
        shipping_address2: null,
        shipping_city: 'Toronto',
        shipping_zip: 'M5V 1A1',
        shipping_phone: null,
        shipping_province: 'ON',
        shipping_country_code: 'CA',
      }),

      storedLineItems: [
        storedLine(),
      ],
    });

    assert.equal(
      after.summary.candidateCount,
      0
    );

    assert.deepEqual(after.candidates, []);
  }
);

test(
  'divergent persisted shipping state fails closed instead of overwriting it',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        line_items: [],
        shipping_address: {
          name: 'Historical Customer',
          address1: '10 Old Street',
          address2: null,
          city: 'Toronto',
          zip: 'M5V 1A1',
          phone: null,
          province_code: 'ON',
          country_code: 'CA',
        },
      }),

      order: orderRow({
        shipping_name: 'Operator Corrected Customer',
        shipping_address1: '99 New Street',
        shipping_city: 'Toronto',
        shipping_zip: 'M5H 2N2',
        shipping_province: 'ON',
        shipping_country_code: 'CA',
      }),
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.includes(
        'DIVERGENT_STORED_SHIPPING_STATE'
      )
    );
  }
);

test(
  'duplicate source lines resolving to one variant fail closed',
  async () => {
    const result = await plan({
      sourcePayload: payload({
        total_price: '60.00',
        subtotal_price: '60.00',
        line_items: [
          lineItem({
            id: 5001,
          }),
          lineItem({
            id: 5002,
          }),
        ],
      }),
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.ok(
      candidate.blockers.some((blocker) =>
        blocker.startsWith(
          'DUPLICATE_SOURCE_VARIANT:'
        )
      )
    );
  }
);

test(
  'inventory truth and ledger mismatch fails closed before repair',
  async () => {
    const result = await plan({
      inventoryTruth: {
        on_hand_quantity: 5,
        reserved_quantity: 0,
      },

      inventoryMovements: [
        {
          movement_type: 'opening_balance',
          quantity_delta: 4,
        },
      ],
    });

    const candidate = result.candidates[0];

    assert.equal(candidate.repairable, false);

    assert.equal(
      candidate.inventoryNeutralityChecks.length,
      1
    );

    assert.equal(
      candidate.inventoryNeutralityChecks[0].consistent,
      false
    );

    assert.ok(
      candidate.blockers.some((blocker) =>
        blocker.startsWith(
          'INVENTORY_TRUTH_LEDGER_MISMATCH:'
        )
      )
    );
  }
);
