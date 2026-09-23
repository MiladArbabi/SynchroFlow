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
       * IMPORTANT — quantity_delta is PRE-SIGNED at the ledger layer.
       * The inventory_movements sign constraint enforces:
       *   inbound_purchase / refund_return / manual_adjustment / reservation_hold > 0
       *   sale / damage / shrinkage / reservation_release /
       *   pick_removal / fulfillment_removal < 0
       *   opening_balance / reconciliation_correction / location_transfer <> 0
       *
       * Physical on-hand reconstruction excludes economic `sale`.
       * Historical pre-0147 WMS picks are the compatibility exception:
       * sale + triggered_by='pick_scan' remains a physical outbound movement.
       *
       * Positive compensators written by inv_sale_backfill_01 and
       * historical canonical repair are bookkeeping-only and therefore
       * excluded from physical reconstruction.
       *
       * New physical outbound quantity comes from pick_removal,
       * fulfillment_removal, damage, and shrinkage and is summed AS-IS.
      */
      .sum({
        on_hand: trx.raw(`
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
              'opening_inventory_reconcile',
              'location_transfer'
            ) THEN quantity_delta

            WHEN movement_type IN (
              'pick_removal',
              'fulfillment_removal',
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

    const variantsWithLedgerRows = new Set<string>(
      rows.map((r: any) => r.lasyncro_variant_id)
    );

    const inserts = [
      ...rows.map((r: any) => {
        const onHand = Number(r.on_hand ?? 0);
        const reserved = Number(r.reserved ?? 0);
        // PROJ-004: on_hand stores TRUE value (may be negative = sold without
        // recorded receiving = "phantom stock" signal). available/sellable are
        // clamped at 0 — you cannot sell negative stock. The negative survives
        // only on on_hand_quantity, which downstream surfaces flag, not sum blindly.
        const available = Math.max(0, onHand - reserved);

        return {
          shop_id: r.shop_id,
          lasyncro_variant_id: r.lasyncro_variant_id,
          location_code: r.location_code,
          on_hand_quantity: onHand,
          reserved_quantity: reserved,
          // PROJ-002: committed_quantity is deprecated (no commit movement type exists;
          // commitment is expressed via reservation_hold/release → reserved_quantity).
          // Kept at 0 for schema stability. sellable_quantity is DB-derived from available_quantity.
          committed_quantity: 0,
          available_quantity: available,
          last_evaluated_at: now,
        };
      }),
      ...variantIds
        .filter((variantId) => !variantsWithLedgerRows.has(variantId))
        .map((variantId) => ({
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          location_code: 'WH-' + shopId + '-ROOT',
          on_hand_quantity: 0,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity: 0,
          last_evaluated_at: now,
        })),
    ];

    await trx('inventory_truth')
      .insert(inserts)
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('EXCLUDED.on_hand_quantity'),
        reserved_quantity: trx.raw('EXCLUDED.reserved_quantity'),
        committed_quantity: trx.raw('EXCLUDED.committed_quantity'),
        available_quantity: trx.raw('EXCLUDED.available_quantity'),
        last_evaluated_at: trx.raw('EXCLUDED.last_evaluated_at'),
      });
  };
