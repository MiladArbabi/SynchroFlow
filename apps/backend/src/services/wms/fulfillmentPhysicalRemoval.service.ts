import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { resolveShopifyOpeningBaselineAt } from '../inventory/resolveShopifyOpeningBaseline.js';

const FULFILLMENT_REMOVAL_NAMESPACE =
  'da62cc94-65a7-4afb-a819-e79ce724d86e';

export type FulfillmentPhysicalLocationConflictCode =
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_AMBIGUOUS';

export type FulfillmentPhysicalCandidateLocation = {
  location_code: string;
  on_hand_quantity: string;
};

/**
 * Structured diagnostic for Shopify fulfillment when commerce truth is known
 * but one safe LaSyncro physical location cannot be established.
 *
 * The Error message deliberately preserves the historical contract used by
 * existing direct-service regression tests and operational logs.
 */
export class FulfillmentPhysicalLocationConflict extends Error {
  readonly code: FulfillmentPhysicalLocationConflictCode;
  readonly lasyncroLineItemId: string;
  readonly lasyncroVariantId: string;
  readonly quantity: number;
  readonly candidateLocations: FulfillmentPhysicalCandidateLocation[];

  constructor(input: {
    code: FulfillmentPhysicalLocationConflictCode;
    lasyncroLineItemId: string;
    lasyncroVariantId: string;
    quantity: number;
    candidateLocations: FulfillmentPhysicalCandidateLocation[];
  }) {
    super(
      `[FULFILLMENT_PHYSICAL_REMOVAL] ${input.code} line=${input.lasyncroLineItemId}`
    );

    this.name = 'FulfillmentPhysicalLocationConflict';
    this.code = input.code;
    this.lasyncroLineItemId = input.lasyncroLineItemId;
    this.lasyncroVariantId = input.lasyncroVariantId;
    this.quantity = input.quantity;
    this.candidateLocations = input.candidateLocations;
  }
}

/**
 * Physical inventory semantics must match rebuildInventoryProjection.
 *
 * Economic order-ingestion `sale` rows are not physical debits.
 * Historical pre-0147 pick_scan sales remain the compatibility exception.
 * Canonical-repair bookkeeping compensators are physically neutral.
 */
const PHYSICAL_ON_HAND_CASE_SQL = `
  CASE
    WHEN movement_type = 'sale'
      AND triggered_by = 'pick_scan'
      THEN quantity_delta

    WHEN movement_type = 'reconciliation_correction'
      AND COALESCE(reference_type, '') <> 'canonical_repair'
      AND NOT (
        COALESCE(triggered_by, '') = 'inv_sale_backfill_01'
        AND reference_type = 'inventory_movement'
      )
      THEN quantity_delta

    WHEN movement_type IN (
      'inbound_purchase',
      'refund_return',
      'manual_adjustment',
      'opening_balance',
      'location_transfer',
      'pick_removal',
      'fulfillment_removal',
      'damage',
      'shrinkage'
    )
      THEN quantity_delta

    ELSE 0
  END
`;

export async function applyFulfillmentPhysicalRemoval(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string,
  fulfilledAt: Date
): Promise<void> {
  const lines = await trx('order_line_items')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select(
      'lasyncro_line_item_id',
      'lasyncro_variant_id',
      'quantity'
    );

  for (const line of lines) {
    const lasyncroLineItemId = String(line.lasyncro_line_item_id);
    const lasyncroVariantId = String(line.lasyncro_variant_id);
    const orderedQuantity = Number(line.quantity);

    /**
     * SHOPIFY → LASYNCRO PHYSICAL AUTHORITY CUTOVER
     * ---------------------------------------------
     * Initial Shopify sync establishes the variant's opening baseline — the
     * Shopify opening_balance (legacy) or the opening expectation's
     * observed_at (v2), see resolveShopifyOpeningBaseline. Fulfillments whose event-time predates that
     * baseline are historical Shopify truth already reflected in the baseline.
     *
     * Replaying their physical debit would double-apply history.
     *
     * We still reconstruct the warehouse/order state as shipped, but we do not
     * infer a LaSyncro bin/location or write fulfillment_removal.
     */
    const shopifyBaselineAt = await resolveShopifyOpeningBaselineAt(
      trx,
      shopId,
      lasyncroVariantId
    );

    if (
      shopifyBaselineAt &&
      fulfilledAt.getTime() < shopifyBaselineAt.getTime()
    ) {
      console.info('[FULFILLMENT_PRE_BASELINE_PHYSICAL_SKIP]', {
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId,
        lasyncroVariantId,
        fulfilledAt,
        shopifyBaselineAt,
      });

      await markLineShipped(
        trx,
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId,
        fulfilledAt
      );

      continue;
    }

    const warehouseState =
      await trx('order_line_item_warehouse_status')
        .where({
          shop_id: shopId,
          lasyncro_line_item_id: lasyncroLineItemId,
        })
        .forUpdate()
        .first('status');

    if (warehouseState?.status === 'shipped') {
      continue;
    }

    const pickedRow = await trx('pick_scan_log')
      .where({
        shop_id: shopId,
        lasyncro_line_item_id: lasyncroLineItemId,
        status: 'confirmed',
      })
      .sum<{ quantity: string }>('quantity_confirmed as quantity')
      .first();

    const pickedQuantity = Number(pickedRow?.quantity ?? 0);

    const priorFulfillmentRemovalRow =
      await trx('inventory_movements')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: lasyncroVariantId,
          reference_type: 'order_line_item',
          reference_id: lasyncroLineItemId,
          movement_type: 'fulfillment_removal',
        })
        .sum<{ quantity: string }>('quantity_delta as quantity')
        .first();

    const alreadyRemovedByFulfillment =
      Math.abs(Number(priorFulfillmentRemovalRow?.quantity ?? 0));

    let remainingQuantity =
      orderedQuantity -
      pickedQuantity -
      alreadyRemovedByFulfillment;

    if (remainingQuantity <= 0) {
      await markLineShipped(
        trx,
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId,
        fulfilledAt
      );
      continue;
    }

    const allocations =
      await trx('pick_reservation_allocations')
        .where({
          shop_id: shopId,
          lasyncro_line_item_id: lasyncroLineItemId,
        })
        .select(
          'allocation_id',
          'lasyncro_variant_id',
          'location_code',
          'quantity'
        );

    const scannedAllocationIds =
      await trx('pick_scan_log')
        .where({
          shop_id: shopId,
          lasyncro_line_item_id: lasyncroLineItemId,
          status: 'confirmed',
        })
        .whereNotNull('reservation_allocation_id')
        .pluck('reservation_allocation_id');

    const scannedAllocationSet =
      new Set<string>(
        scannedAllocationIds.map((id: unknown) => String(id))
      );

    const releasableAllocations =
      allocations.filter(
        (allocation: any) =>
          !scannedAllocationSet.has(String(allocation.allocation_id))
      );

    for (const allocation of releasableAllocations) {
      if (remainingQuantity <= 0) {
        break;
      }

      const allocationQuantity = Number(allocation.quantity);

      if (allocationQuantity > remainingQuantity) {
        throw new Error(
          `[FULFILLMENT_PHYSICAL_REMOVAL] PARTIAL_ALLOCATION_UNSUPPORTED allocation=${allocation.allocation_id}`
        );
      }

      const removalQuantity = allocationQuantity;

      const releaseInserted =
        await trx('inventory_movements')
          .insert({
            lasyncro_inventory_movement_id: randomUUID(),
            lasyncro_variant_id: lasyncroVariantId,
            shop_id: shopId,
            movement_type: 'reservation_release',
            quantity_delta: -removalQuantity,
            location_code: allocation.location_code,
            reference_type: 'pick_reservation_allocation',
            reference_id: allocation.allocation_id,
            platform: 'shopify',
            occurred_at: fulfilledAt,
            operator_id: null,
            triggered_by: 'shopify_fulfillment',
          })
          .onConflict([
            'shop_id',
            'reference_type',
            'reference_id',
            'lasyncro_variant_id',
            'location_code',
            'movement_type',
          ])
          .ignore()
          .returning('lasyncro_inventory_movement_id');

      if (releaseInserted.length === 1) {
        const removalInserted =
          await insertFulfillmentRemoval(
            trx,
            shopId,
            lasyncroLineItemId,
            lasyncroVariantId,
            allocation.location_code,
            removalQuantity,
            fulfilledAt
          );

        if (removalInserted) {
          /**
           * INV-REPLAY-FULFILL-41: upsert, not update. Under REBUILD_MODE the
           * inventory_truth row does not exist yet — the projection is being
           * rebuilt from zero — so an update matched 0 rows and the guard
           * threw fatally, killing the replay.
           *
           * The engine does NOT rebuild the inventory projection after an
           * event (projection.engine.ts: "inventory projection is DISABLED →
           * MUST NOT call"), so this patch is the only runtime writer of
           * inventory_truth on fulfilment. It cannot be removed.
           *
           * Compounding is impossible: rebuildInventoryProjection merges with
           * EXCLUDED.on_hand_quantity — an absolute overwrite from the ledger
           * sum, not an accumulate — so any provisional value written here is
           * discarded when that variant is next derived.
           */
          await trx('inventory_truth')
            .insert({
              shop_id: shopId,
              lasyncro_variant_id: lasyncroVariantId,
              location_code: allocation.location_code,
              on_hand_quantity: -removalQuantity,
              reserved_quantity: 0,
              committed_quantity: 0,
              available_quantity: 0,
              last_evaluated_at: fulfilledAt,
              updated_at: fulfilledAt,
            })
            .onConflict([
              'shop_id',
              'lasyncro_variant_id',
              'location_code',
            ])
            .merge({
              on_hand_quantity: trx.raw(
                'inventory_truth.on_hand_quantity - ?',
                [removalQuantity]
              ),
              reserved_quantity: trx.raw(
                'GREATEST(0, inventory_truth.reserved_quantity - ?)',
                [removalQuantity]
              ),
              last_evaluated_at: fulfilledAt,
              updated_at: fulfilledAt,
            });
        }
      }

      await trx('pick_reservation_allocations')
        .where({
          shop_id: shopId,
          allocation_id: allocation.allocation_id,
        })
        .delete();

      remainingQuantity -= removalQuantity;
    }

    if (remainingQuantity > 0) {
      /**
       * INV-REPLAY-FULFILL-41: resolved from inventory_movements, not
       * inventory_truth. Under REBUILD_MODE the projection is being rebuilt
       * from zero rows, so querying it here asks where stock is in a world
       * that does not exist yet — the replay died fatally on the first
       * fulfilled order with no prior stow events (there are none in the
       * event stream; opening_balance is written outside it).
       *
       * The ledger is append-only and complete at every replay position, so
       * this answers identically during replay and at runtime. No REBUILD_MODE
       * branch, and no second code path to keep in sync.
       *
       * available_quantity is deliberately dropped: it is a projection concept
       * (on_hand minus reserved) with no ledger equivalent. Reservations are
       * already consumed by the allocation loop above — reaching this fallback
       * means there were none for this line.
       *
       * quantity_delta is PRE-SIGNED at the ledger layer
       * (rebuildInventoryProjection.ts), so a plain SUM is correct.
       */
      const stockLocations =
        await trx('inventory_movements')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: lasyncroVariantId,
          })
          /**
           * EVENT-TIME CAUSALITY
           * --------------------
           * Future stock must never be used to explain an earlier fulfillment.
           */
          .andWhere('occurred_at', '<=', fulfilledAt)
          .groupBy('location_code')
          .havingRaw(
            `SUM(${PHYSICAL_ON_HAND_CASE_SQL}) >= ?`,
            [remainingQuantity]
          )
          .select<{ location_code: string; on_hand_quantity: string }[]>(
            'location_code',
            trx.raw(
              `SUM(${PHYSICAL_ON_HAND_CASE_SQL}) as on_hand_quantity`
            )
          );

      if (stockLocations.length === 0) {
        throw new FulfillmentPhysicalLocationConflict({
          code: 'LOCATION_NOT_FOUND',
          lasyncroLineItemId,
          lasyncroVariantId,
          quantity: remainingQuantity,
          candidateLocations: stockLocations,
        });
      }

      if (stockLocations.length > 1) {
        throw new FulfillmentPhysicalLocationConflict({
          code: 'LOCATION_AMBIGUOUS',
          lasyncroLineItemId,
          lasyncroVariantId,
          quantity: remainingQuantity,
          candidateLocations: stockLocations,
        });
      }

      const [stockLocation] = stockLocations;

      const removalInserted =
        await insertFulfillmentRemoval(
          trx,
          shopId,
          lasyncroLineItemId,
          lasyncroVariantId,
          stockLocation.location_code,
          remainingQuantity,
          fulfilledAt
        );

      if (removalInserted) {
        // INV-REPLAY-FULFILL-41: upsert for the same reason as the allocation
        // path above. available_quantity is clamped at 0 to match
        // rebuildInventoryProjection's Math.max(0, onHand - reserved) — only
        // on_hand_quantity carries a negative, as the phantom-stock signal.
        await trx('inventory_truth')
          .insert({
            shop_id: shopId,
            lasyncro_variant_id: lasyncroVariantId,
            location_code: stockLocation.location_code,
            on_hand_quantity: -remainingQuantity,
            reserved_quantity: 0,
            committed_quantity: 0,
            available_quantity: 0,
            last_evaluated_at: fulfilledAt,
            updated_at: fulfilledAt,
          })
          .onConflict([
            'shop_id',
            'lasyncro_variant_id',
            'location_code',
          ])
          .merge({
            on_hand_quantity: trx.raw(
              'inventory_truth.on_hand_quantity - ?',
              [remainingQuantity]
            ),
            available_quantity: trx.raw(
              'GREATEST(0, inventory_truth.available_quantity - ?)',
              [remainingQuantity]
            ),
            last_evaluated_at: fulfilledAt,
            updated_at: fulfilledAt,
          });
      }
    }

    await markLineShipped(
      trx,
      shopId,
      lasyncroOrderId,
      lasyncroLineItemId,
      fulfilledAt
    );
  }
}

async function insertFulfillmentRemoval(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroLineItemId: string,
  lasyncroVariantId: string,
  locationCode: string,
  quantity: number,
  fulfilledAt: Date
): Promise<boolean> {
  const deviceEventId = uuidv5(
    [
      shopId,
      lasyncroLineItemId,
      lasyncroVariantId,
      locationCode,
      quantity,
      'fulfillment_removal',
    ].join(':'),
    FULFILLMENT_REMOVAL_NAMESPACE
  );

  const inserted =
    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: uuidv5(
          `${deviceEventId}:inventory`,
          FULFILLMENT_REMOVAL_NAMESPACE
        ),
        lasyncro_variant_id: lasyncroVariantId,
        shop_id: shopId,
        movement_type: 'fulfillment_removal',
        quantity_delta: -quantity,
        location_code: locationCode,
        reference_type: 'order_line_item',
        reference_id: lasyncroLineItemId,
        device_event_id: deviceEventId,
        platform: 'shopify',
        occurred_at: fulfilledAt,
        operator_id: null,
        triggered_by: 'shopify_fulfillment',
      })
      .onConflict(['device_event_id'])
      .ignore()
      .returning('lasyncro_inventory_movement_id');

  return inserted.length === 1;
}

async function markLineShipped(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string,
  lasyncroLineItemId: string,
  shippedAt: Date
): Promise<void> {
  await trx('order_line_item_warehouse_status')
    .insert({
      lasyncro_line_item_id: lasyncroLineItemId,
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      status: 'shipped',
      status_updated_at: shippedAt,
      created_at: shippedAt,
      updated_at: shippedAt,
    })
    .onConflict(['lasyncro_line_item_id'])
    .merge({
      status: 'shipped',
      status_updated_at: shippedAt,
      updated_at: shippedAt,
    });
}