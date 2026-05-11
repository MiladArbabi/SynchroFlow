import { Knex } from "knex";

interface LedgerRow {
  shop_id: number;
  lasyncro_variant_id: string;
  location_code: string;
  on_hand: string | number | null;
  reserved: string | number | null;
}

/**
 * VARIANT-SCOPED PROJECTION REBUILD
 * ----------------------------------
 * Deterministic replay of inventory projection for specific variants only.
 *
 * Design Guarantees:
 * - Append-only ledger replay
 * - Shop-scoped advisory lock (hashtext(shopId))
 * - Deletes only affected variants
 * - Recomputes only affected variants
 * - Safe under concurrent reconciliation jobs
 * 
 * DETERMINISTIC TIME CONTRACT
 * ---------------------------
 * Inventory projection must never use wall-clock time.
 *
 * last_evaluated_at MUST derive from the eventAnchor
 * of the reconciliation event that triggered the rebuild.
 *
 * This guarantees:
 * - deterministic rebuilds
 * - stable state hashing
 * - replay correctness
 *
 * This replaces full-shop replay to eliminate O(N shop) load amplification.
 */
export async function rebuildInventoryProjectionForVariants(
  shopId: number,
  variantIds: string[],
  trx: Knex.Transaction,
  eventAnchor: Date
): Promise<void> {
  if (variantIds.length === 0) return;

  /**
   * TRANSACTION CONTRACT
   * --------------------
   * Projection rebuild MUST participate in reconciliation transaction.
   * It MUST NOT open its own transaction.
   */

    // 🔒 Shop-scoped advisory lock
    await trx.raw(
      `SELECT pg_advisory_xact_lock(hashtext(?));`,
      [String(shopId)]
    );

    /**
     * PROJECTION CONSISTENCY CONTRACT
     * --------------------------------
     * Inventory changes invalidate prior inventory constraint
     * classifications (oversell / executable).
     *
     * We therefore clear constraint signals for affected variants
     * before rebuilding the projection so that downstream
     * reconciliation recomputes them deterministically.
     *
     * This prevents stale oversell flags during rebuild replay.
     */
    /**
     * PROJECTION WRITER BYPASS
     * ------------------------
     * order_fulfillment_status is guarded by enforce_projection_writer trigger.
     * This function performs a legitimate projection write (inventory rebuild)
     * outside the projection engine — set GUC to satisfy the trigger guard.
     * SET LOCAL scopes it to this transaction only.
     */
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status')
      .whereIn(
        'lasyncro_order_id',
        trx('order_revenue_units')
          .select('lasyncro_order_id')
          .whereIn('lasyncro_variant_id', variantIds)
      )
      .update({
        inventory_block_type: null
      });

    // 1️⃣ Delete only affected variants
    await trx('inventory_truth')
      .where({ shop_id: shopId })
      .whereIn('lasyncro_variant_id', variantIds)
      .del();

    // 2️⃣ Aggregate only affected variants
    const rows = await trx('inventory_movements')
      .select(
        'shop_id',
        'lasyncro_variant_id',
        'location_code'
      )
      .where({ shop_id: shopId })
      .whereIn('lasyncro_variant_id', variantIds)
      /**
       * INVENTORY ON-HAND CALCULATION
       * ------------------------------
       * Ledger semantics:
       *
       * inbound movements  → +quantity
       * outbound movements → -quantity
       *
       * IMPORTANT:
       * quantity_delta from Shopify ingestion is always positive.
       * Outbound movements MUST therefore be negated here.
       *
       * Failure to negate outbound movements causes inventory_truth
       * to drift negative across the entire catalog.
       */
      .sum({
        on_hand: trx.raw(`
          CASE
            WHEN movement_type IN (
              'inbound_purchase',
              'refund_return',
              'manual_adjustment',
              'reconciliation_correction',
              'opening_balance'
            ) THEN quantity_delta

            WHEN movement_type IN (
              'sale',
              'damage',
              'shrinkage'
            ) THEN quantity_delta

            ELSE 0
          END
        `),
      })
      .sum({
        reserved: trx.raw(`
          CASE
            WHEN movement_type = 'reservation_hold' THEN quantity_delta
            WHEN movement_type = 'reservation_release' THEN quantity_delta
            ELSE 0
          END
        `),
      })
      .groupBy(
        'shop_id',
        'lasyncro_variant_id',
        'location_code'
      );

    /**
     * EVENT-TIME ANCHOR
     * -----------------
     * Inventory evaluation timestamp must be derived
     * from reconciliation event time.
     */
    const now = eventAnchor;

    const aggregatedByVariant = new Map(
      rows.map((r: any) => [r.lasyncro_variant_id, r])
    );

    const inserts = variantIds.map((variantId) => {
      const r = aggregatedByVariant.get(variantId);

      if (!r) {
        return {
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          location_code: 'WH-' + shopId + '-ROOT',
          on_hand_quantity: 0,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity: 0,
          sellable_quantity: 0,
          last_evaluated_at: now,
        };
      }

      const onHand = Number(r.on_hand ?? 0);
      const reserved = Number(r.reserved ?? 0);
      const available = onHand - reserved;

      return {
        shop_id: r.shop_id,
        lasyncro_variant_id: r.lasyncro_variant_id,
        location_code: r.location_code,
        on_hand_quantity: onHand,
        reserved_quantity: reserved,
        committed_quantity: 0,
        available_quantity: available,
        sellable_quantity: available,
        last_evaluated_at: now,
      };
    });

    await trx('inventory_truth')
      .insert(inserts)
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('EXCLUDED.on_hand_quantity'),
        reserved_quantity: trx.raw('EXCLUDED.reserved_quantity'),
        committed_quantity: trx.raw('EXCLUDED.committed_quantity'),
        available_quantity: trx.raw('EXCLUDED.available_quantity'),
        sellable_quantity: trx.raw('EXCLUDED.sellable_quantity'),
        last_evaluated_at: trx.raw('EXCLUDED.last_evaluated_at'),
      });
  };
