import db from "@lasyncro/backend-core/db.js";

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
 * This replaces full-shop replay to eliminate O(N shop) load amplification.
 */
export async function rebuildInventoryProjectionForVariants(
  shopId: number,
  variantIds: string[]
): Promise<void> {
  if (variantIds.length === 0) return;

  await db.transaction(async (trx) => {

    // 🔒 Shop-scoped advisory lock
    await trx.raw(
      `SELECT pg_advisory_xact_lock(hashtext(?));`,
      [String(shopId)]
    );

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
      .sum({
        on_hand: trx.raw(`
          CASE
            WHEN movement_type IN (
              'inbound_purchase',
              'refund_return',
              'manual_adjustment',
              'reconciliation_correction'
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

    if (rows.length === 0) return;

    const now = new Date();

    await trx('inventory_truth').insert(
      rows.map((r: any) => {
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
      })
    );
  });
}
