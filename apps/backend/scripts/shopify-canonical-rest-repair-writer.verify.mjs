import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

dotenv.config({
  path: path.resolve(
    __dirname,
    '../../../.env'
  ),
});

/**
 * DB import MUST happen after dotenv configuration.
 * backend-core validates PGUSER / PGDATABASE during module evaluation.
 */
const {
  withTenant,
} = await import(
  '@lasyncro/backend-core/db.js'
);

const {
  planShopifyHistoricalCanonicalRepair,
  applyShopifyHistoricalCanonicalRepair,
} = await import(
  '../src/services/shopify/historicalCanonicalRepair.service.ts'
);

const SHOP_ID = 1;
const ROOT_LOCATION = `WH-${SHOP_ID}-ROOT`;

const ROLLBACK_SENTINEL =
  'SHOPIFY_CANONICAL_REPAIR_VERIFY_ROLLBACK';

function calculateLedger(rows) {
  let onHand = 0;
  let reserved = 0;

  for (const row of rows) {
    const quantity =
      Number(row.quantity_delta ?? 0);

    if (
      [
        'inbound_purchase',
        'refund_return',
        'manual_adjustment',
        'reconciliation_correction',
        'opening_balance',
        'sale',
        'damage',
        'shrinkage',
      ].includes(row.movement_type)
    ) {
      onHand += quantity;
    }

    if (
      row.movement_type === 'reservation_hold' ||
      row.movement_type === 'reservation_release'
    ) {
      reserved += quantity;
    }
  }

  return {
    onHand,
    reserved,
  };
}

async function inventorySnapshot(
  trx,
  variantId
) {
  const truth = await trx('inventory_truth')
    .where({
      shop_id: SHOP_ID,
      lasyncro_variant_id: variantId,
      location_code: ROOT_LOCATION,
    })
    .select(
      'on_hand_quantity',
      'reserved_quantity',
      'available_quantity',
      'sellable_quantity'
    )
    .first();

  const movements =
    await trx('inventory_movements')
      .where({
        shop_id: SHOP_ID,
        lasyncro_variant_id: variantId,
        location_code: ROOT_LOCATION,
      })
      .select(
        'lasyncro_inventory_movement_id',
        'movement_type',
        'quantity_delta',
        'reference_type',
        'reference_id'
      )
      .orderBy('created_at', 'asc');

  const ledger =
    calculateLedger(movements);

  return {
    truth: {
      onHand: Number(
        truth?.on_hand_quantity ?? 0
      ),
      reserved: Number(
        truth?.reserved_quantity ?? 0
      ),
      available: Number(
        truth?.available_quantity ?? 0
      ),
      sellable: Number(
        truth?.sellable_quantity ?? 0
      ),
    },

    ledger,

    movementCount:
      movements.length,
  };
}

async function createSyntheticVariantFixture(trx) {
  /**
   * SELF-CONTAINED WRITER FIXTURE
   * -----------------------------
   * Do not depend on existing local catalog or inventory state.
   *
   * The product + variant live only inside the outer verification
   * transaction and are rolled back when verification completes.
   *
   * Starting state:
   * - no inventory_truth row
   * - no inventory movements
   *
   * Therefore physical truth and ledger both resolve to zero.
   */
  const lasyncroProductId =
    crypto.randomUUID();

  const lasyncroVariantId =
    crypto.randomUUID();

  const sku =
    `REPAIR-VERIFY-${crypto.randomUUID()}`;

  await trx('products').insert({
    lasyncro_product_id:
      lasyncroProductId,

    shop_id: SHOP_ID,

    sku,

    title:
      'Historical Canonical Repair Verification Product',

    status: 'active',

    product_type: 'physical',
  });

  await trx('variants').insert({
    lasyncro_variant_id:
      lasyncroVariantId,

    lasyncro_product_id:
      lasyncroProductId,

    shop_id: SHOP_ID,

    sku,

    title:
      'Historical Canonical Repair Verification Variant',

    unit_cost: 4.25,

    status: 'active',
  });

  return {
    lasyncro_product_id:
      lasyncroProductId,

    lasyncro_variant_id:
      lasyncroVariantId,

    sku,

    title:
      'Historical Canonical Repair Verification Variant',

    unit_cost: 4.25,
  };
}

function uniqueNumericId(suffix) {
  const timestamp =
    String(Date.now());

  const random =
    String(
      Math.floor(
        Math.random() * 9000
      ) + 1000
    );

  return `99${timestamp}${random}${suffix}`;
}

async function createFixture(
  trx,
  variant,
  suffix
) {
  const lasyncroOrderId =
    crypto.randomUUID();

  const externalOrderId =
    uniqueNumericId(suffix);

  const externalLineItemId =
    uniqueNumericId(
      `${suffix}7`
    );

  const externalProductNumericId =
    uniqueNumericId(
      `${suffix}3`
    );

  const externalVariantNumericId =
    uniqueNumericId(
      `${suffix}5`
    );

  await trx(
  'external_product_identity_map'
).insert({
  id: crypto.randomUUID(),

  lasyncro_variant_id:
    variant.lasyncro_variant_id,

  shop_id: SHOP_ID,

  platform: 'shopify',

  external_product_id:
    `gid://shopify/Product/${externalProductNumericId}`,

  external_variant_id:
    `gid://shopify/ProductVariant/${externalVariantNumericId}`,

  external_inventory_item_id:
    null,

  external_sku:
    variant.sku ?? null,

  barcode: null,
});

  const eventTime =
    new Date(
      '2026-08-08T08:00:00.000Z'
    );

  await trx('orders').insert({
    lasyncro_order_id:
      lasyncroOrderId,

    shop_id: SHOP_ID,

    payment_state: 'paid',

    currency: 'USD',

    total_price: 20,
    subtotal_price: 20,
    total_tax: 0,

    order_created_at:
      eventTime,

    order_updated_at:
      eventTime,

    order_processed_at:
      eventTime,

    aggregate_version: 2,
    last_projected_version: 0,

    shipping_name: null,
    shipping_address1: null,
    shipping_address2: null,
    shipping_city: null,
    shipping_zip: null,
    shipping_phone: null,
    shipping_province: null,
    shipping_country_code: null,

    created_at: eventTime,
    updated_at: eventTime,
  });

  await trx(
    'external_order_identity_map'
  ).insert({
    lasyncro_order_id:
      lasyncroOrderId,

    shop_id: SHOP_ID,

    platform: 'shopify',

    external_order_id:
      externalOrderId,
  });

  const inserted =
    await trx('domain_events')
      .insert({
        shop_id: SHOP_ID,

        event_type:
          'orders/create',

        event_payload: {
          id: externalOrderId,

          currency: 'USD',

          total_price: '20.00',
          subtotal_price: '20.00',
          total_tax: '0.00',

          created_at:
            eventTime.toISOString(),

          updated_at:
            eventTime.toISOString(),

          shipping_address: {
            name:
              'Historical Repair Test',

            address1:
              '100 Verification Street',

            address2: null,

            city: 'Toronto',

            zip: 'M5H 2N2',

            phone: null,

            province_code: 'ON',

            country_code: 'CA',
          },

          line_items: [
            {
              id:
                externalLineItemId,

              product_id:
                '9000000001',

              variant_id:
                externalVariantNumericId,

              title:
                'Historical Repair Test',

              sku:
                variant.sku,

              quantity: 2,

              price: '10.00',
            },
          ],
        },

        event_time:
          eventTime,

        event_version: 1,

        external_event_id:
          `writer-verify-source:${crypto.randomUUID()}`,
      })
      .returning('id');

  return {
    lasyncroOrderId,
    externalOrderId,
    externalLineItemId,
    domainEventId:
      Number(inserted[0].id),
  };
}

async function runSuccessVerification(
  outer,
  variant
) {
  let verified = false;

  try {
    await outer.transaction(
      async (trx) => {
        const fixture =
          await createFixture(
            trx,
            variant,
            '1'
          );

        const beforeInventory =
          await inventorySnapshot(
            trx,
            variant.lasyncro_variant_id
          );

        const beforePlan =
          await planShopifyHistoricalCanonicalRepair(
            trx,
            SHOP_ID
          );

        const candidate =
          beforePlan.candidates.find(
            (row) =>
              row.domainEventId ===
              fixture.domainEventId
          );

        assert.ok(
          candidate,
          'fixture must appear in repair plan'
        );

        assert.equal(
          candidate.repairable,
          true
        );

        assert.equal(
          candidate.lineItemRepairRequired,
          true
        );

        assert.equal(
          candidate.shippingRepairRequired,
          true
        );

        const result =
          await applyShopifyHistoricalCanonicalRepair(
            trx,
            SHOP_ID,
            [
              fixture.domainEventId,
            ]
          );

        assert.equal(
          result.repaired.length,
          1
        );

        assert.deepEqual(
          result.alreadyClean,
          []
        );

        const applied =
          result.repaired[0];

        assert.equal(
          applied.insertedLineItems,
          1
        );

        assert.equal(
          applied.shippingRestored,
          true
        );

        assert.equal(
          applied.revenueUnitsMaterialized,
          1
        );

        assert.equal(
          applied.neutralityCorrectionsWritten,
          1
        );

        const order =
          await trx('orders')
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            })
            .first();

        assert.equal(
          Number(order.aggregate_version),
          3
        );

        assert.equal(
          order.shipping_address1,
          '100 Verification Street'
        );

        assert.equal(
          order.shipping_city,
          'Toronto'
        );

        assert.equal(
          order.shipping_zip,
          'M5H 2N2'
        );

        assert.equal(
          order.shipping_country_code,
          'CA'
        );

        const lines =
          await trx('order_line_items')
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            });

        assert.equal(
          lines.length,
          1
        );

        assert.equal(
          String(
            lines[0]
              .external_line_item_id
          ),
          fixture.externalLineItemId
        );

        assert.equal(
          Number(lines[0].quantity),
          2
        );

        assert.equal(
          Number(lines[0].unit_price),
          10
        );

        const revenueUnits =
          await trx(
            'order_revenue_units'
          )
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            });

        assert.equal(
          revenueUnits.length,
          1
        );

        assert.equal(
          Number(
            revenueUnits[0].quantity
          ),
          2
        );

        const revenueUnitId =
          revenueUnits[0]
            .lasyncro_revenue_unit_id;

        const economicMovements =
          await trx(
            'inventory_movements'
          )
            .where({
              shop_id: SHOP_ID,

              lasyncro_variant_id:
                variant.lasyncro_variant_id,

              reference_id:
                revenueUnitId,
            })
            .whereIn(
              'movement_type',
              [
                'sale',
                'reconciliation_correction',
              ]
            )
            .select(
              'movement_type',
              'quantity_delta',
              'reference_type',
              'reference_id',
              'location_code',
              'occurred_at'
            )
            .orderBy(
              'movement_type',
              'asc'
            );

        assert.equal(
          economicMovements.length,
          2
        );

        const sale =
          economicMovements.find(
            (row) =>
              row.movement_type ===
              'sale'
          );

        const correction =
          economicMovements.find(
            (row) =>
              row.movement_type ===
              'reconciliation_correction'
          );

        assert.ok(sale);
        assert.ok(correction);

        assert.equal(
          Number(
            sale.quantity_delta
          ),
          -2
        );

        assert.equal(
          Number(
            correction.quantity_delta
          ),
          2
        );

        assert.equal(
          correction.reference_type,
          'canonical_repair'
        );

        assert.equal(
          sale.location_code,
          ROOT_LOCATION
        );

        assert.equal(
          correction.location_code,
          ROOT_LOCATION
        );

        assert.equal(
          new Date(
            correction.occurred_at
          ).toISOString(),
          new Date(
            sale.occurred_at
          ).toISOString()
        );

        const afterInventory =
          await inventorySnapshot(
            trx,
            variant.lasyncro_variant_id
          );

        assert.deepEqual(
          afterInventory.truth,
          beforeInventory.truth
        );

        assert.equal(
          afterInventory.ledger.onHand,
          beforeInventory.ledger.onHand
        );

        assert.equal(
          afterInventory.ledger.reserved,
          beforeInventory.ledger.reserved
        );

        assert.equal(
          afterInventory.movementCount,
          beforeInventory.movementCount + 2
        );

        const repairEvents =
          await trx('domain_events')
            .where({
              shop_id: SHOP_ID,

              event_type:
                'orders/canonical_data_repaired',

              external_event_id:
                `canonical_data_repair:${fixture.domainEventId}`,
            });

        assert.equal(
          repairEvents.length,
          1
        );

        assert.equal(
          String(
            repairEvents[0]
              .event_payload.id
          ),
          fixture.externalOrderId
        );

        const afterPlan =
          await planShopifyHistoricalCanonicalRepair(
            trx,
            SHOP_ID
          );

        assert.equal(
          afterPlan.candidates.some(
            (row) =>
              row.domainEventId ===
              fixture.domainEventId
          ),
          false
        );

        const secondApply =
          await applyShopifyHistoricalCanonicalRepair(
            trx,
            SHOP_ID,
            [
              fixture.domainEventId,
            ]
          );

        assert.equal(
          secondApply.repaired.length,
          0
        );

        assert.deepEqual(
          secondApply.alreadyClean,
          [
            fixture.domainEventId,
          ]
        );

        const repairEventsAfterSecondRun =
          await trx('domain_events')
            .where({
              shop_id: SHOP_ID,

              external_event_id:
                `canonical_data_repair:${fixture.domainEventId}`,
            });

        assert.equal(
          repairEventsAfterSecondRun.length,
          1
        );

        verified = true;

        throw new Error(
          ROLLBACK_SENTINEL
        );
      }
    );
  } catch (error) {
    if (
      error?.message !==
      ROLLBACK_SENTINEL
    ) {
      throw error;
    }
  }

  assert.equal(
    verified,
    true
  );

  console.log(
    'WRITER_SUCCESS_PATH=PASS'
  );
}

async function runAtomicRollbackVerification(
  outer,
  variant
) {
  let verified = false;

  try {
    await outer.transaction(
      async (fixtureTrx) => {
        const fixture =
          await createFixture(
            fixtureTrx,
            variant,
            '2'
          );

        const beforeInventory =
          await inventorySnapshot(
            fixtureTrx,
            variant.lasyncro_variant_id
          );

        const beforeOrder =
          await fixtureTrx('orders')
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            })
            .first();

        /**
         * Deliberately reserve the exact idempotency key the writer
         * tries to insert LAST.
         *
         * This forces a unique violation only after:
         * - line item insert
         * - order update
         * - revenue unit insert
         * - sale movement insert
         * - neutrality correction insert
         *
         * Running apply inside a nested transaction then proves all of
         * those earlier writes roll back together.
         */
        await fixtureTrx(
          'domain_events'
        ).insert({
          shop_id: SHOP_ID,

          event_type:
            'orders/canonical_data_repaired',

          event_payload: {
            id:
              fixture.externalOrderId,

            verification_conflict:
              true,
          },

          event_time:
            new Date(),

          event_version: 1,

          external_event_id:
            `canonical_data_repair:${fixture.domainEventId}`,
        });

        let failure = null;

        try {
          await fixtureTrx.transaction(
            async (repairTrx) => {
              await applyShopifyHistoricalCanonicalRepair(
                repairTrx,
                SHOP_ID,
                [
                  fixture.domainEventId,
                ]
              );
            }
          );

          assert.fail(
            'repair unexpectedly succeeded despite final event collision'
          );
        } catch (error) {
          failure = error;
        }

        assert.ok(
          failure,
          'expected repair failure'
        );

        assert.equal(
          failure.code,
          '23505'
        );

        const afterOrder =
          await fixtureTrx('orders')
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            })
            .first();

        assert.equal(
          Number(
            afterOrder.aggregate_version
          ),
          Number(
            beforeOrder.aggregate_version
          )
        );

        assert.equal(
          afterOrder.shipping_address1,
          null
        );

        const lineCount =
          await fixtureTrx(
            'order_line_items'
          )
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            })
            .count('* as count')
            .first();

        assert.equal(
          Number(lineCount.count),
          0
        );

        const revenueCount =
          await fixtureTrx(
            'order_revenue_units'
          )
            .where({
              lasyncro_order_id:
                fixture.lasyncroOrderId,
            })
            .count('* as count')
            .first();

        assert.equal(
          Number(revenueCount.count),
          0
        );

        const afterInventory =
          await inventorySnapshot(
            fixtureTrx,
            variant.lasyncro_variant_id
          );

        assert.deepEqual(
          afterInventory,
          beforeInventory
        );

        const conflictEvents =
          await fixtureTrx(
            'domain_events'
          )
            .where({
              shop_id: SHOP_ID,

              external_event_id:
                `canonical_data_repair:${fixture.domainEventId}`,
            });

        /**
         * The pre-created collision remains.
         * No second repair event survived the failed savepoint.
         */
        assert.equal(
          conflictEvents.length,
          1
        );

        assert.equal(
          conflictEvents[0]
            .event_payload
            .verification_conflict,
          true
        );

        verified = true;

        throw new Error(
          ROLLBACK_SENTINEL
        );
      }
    );
  } catch (error) {
    if (
      error?.message !==
      ROLLBACK_SENTINEL
    ) {
      throw error;
    }
  }

  assert.equal(
    verified,
    true
  );

  console.log(
    'WRITER_ATOMIC_ROLLBACK=PASS'
  );
}

const OUTER_ROLLBACK_SENTINEL =
  'SHOPIFY_CANONICAL_REPAIR_VERIFY_OUTER_ROLLBACK';

let syntheticProductId = null;
let syntheticVariantId = null;
let outerVerificationCompleted = false;

try {
  await withTenant(
    SHOP_ID,
    async (outer) => {
      const variant =
        await createSyntheticVariantFixture(
          outer
        );

      syntheticProductId =
        variant.lasyncro_product_id;

      syntheticVariantId =
        variant.lasyncro_variant_id;

      console.log(
        'WRITER_FIXTURE_VARIANT'
      );

      console.log(
        JSON.stringify(
          {
            lasyncro_product_id:
              variant.lasyncro_product_id,

            lasyncro_variant_id:
              variant.lasyncro_variant_id,

            external_variant_id:
              'fixture-created-inside-rollback',

            unit_cost:
              variant.unit_cost,
          },
          null,
          2
        )
      );

      /**
       * Synthetic variant begins with no inventory projection
       * and no inventory ledger.
       *
       * inventorySnapshot intentionally normalizes both absent
       * states to zero.
       */
      const baseline =
        await inventorySnapshot(
          outer,
          variant.lasyncro_variant_id
        );

      assert.deepEqual(
        baseline.truth,
        {
          onHand: 0,
          reserved: 0,
          available: 0,
          sellable: 0,
        }
      );

      assert.deepEqual(
        baseline.ledger,
        {
          onHand: 0,
          reserved: 0,
        }
      );

      assert.equal(
        baseline.movementCount,
        0
      );

      await runSuccessVerification(
        outer,
        variant
      );

      /**
       * runSuccessVerification executes inside its own nested
       * transaction and deliberately rolls that fixture back.
       *
       * The synthetic catalog variant itself belongs to the
       * outer transaction and therefore remains available here.
       */
      const afterSuccessRollback =
        await inventorySnapshot(
          outer,
          variant.lasyncro_variant_id
        );

      assert.deepEqual(
        afterSuccessRollback,
        baseline
      );

      console.log(
        'SUCCESS_FIXTURE_ROLLBACK=PASS'
      );

      await runAtomicRollbackVerification(
        outer,
        variant
      );

      /**
       * The forced 23505 repair failure must also leave the
       * synthetic variant inventory exactly at baseline.
       */
      const afterFailureRollback =
        await inventorySnapshot(
          outer,
          variant.lasyncro_variant_id
        );

      assert.deepEqual(
        afterFailureRollback,
        baseline
      );

      console.log(
        'FAILURE_FIXTURE_ROLLBACK=PASS'
      );

      outerVerificationCompleted = true;

      /**
       * Roll back the synthetic product + variant themselves.
       * Nothing from this verification is allowed to persist.
       */
      throw new Error(
        OUTER_ROLLBACK_SENTINEL
      );
    }
  );

  assert.fail(
    'outer verification transaction unexpectedly committed'
  );
} catch (error) {
  if (
    error?.message !==
    OUTER_ROLLBACK_SENTINEL
  ) {
    throw error;
  }
}

assert.equal(
  outerVerificationCompleted,
  true
);

assert.ok(
  syntheticProductId
);

assert.ok(
  syntheticVariantId
);

/**
 * POST-ROLLBACK CATALOG VERIFICATION
 * ----------------------------------
 * Re-enter a fresh tenant transaction and prove the synthetic
 * product + variant from the writer verification do not exist.
 */
await withTenant(
  SHOP_ID,
  async (verifyTrx) => {
    const productCount =
      await verifyTrx('products')
        .where({
          lasyncro_product_id:
            syntheticProductId,
        })
        .count('* as count')
        .first();

    const variantCount =
      await verifyTrx('variants')
        .where({
          lasyncro_variant_id:
            syntheticVariantId,
        })
        .count('* as count')
        .first();

    assert.equal(
      Number(productCount?.count ?? 0),
      0
    );

    assert.equal(
      Number(variantCount?.count ?? 0),
      0
    );
  }
);

console.log(
  'SYNTHETIC_CATALOG_ROLLBACK=PASS'
);

console.log(
  'SHOPIFY_CANONICAL_REPAIR_WRITER_VERIFY=PASS'
);

process.exit(0);
