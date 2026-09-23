import type { Knex } from 'knex';
import { pickableLocationCondition } from './pickableLocation.js';

/**
 * RELEASE CAPACITY — SINGLE QUANTITY DEFINITION (GH-1145-A1)
 * ----------------------------------------------------------
 * Release capacity for a variant is inventory_truth.available_quantity at
 * canonical pickable locations (active pick bins + warehouse root, see
 * pickableLocation.ts). One definition, three consumers:
 *
 *   - inventoryConstraintEvaluator    (is the order eligible?)
 *   - pickBatch release precheck      (can this order go in the batch?)
 *   - batchReservation                (FOR UPDATE lock + allocation)
 *
 * Why inventory_truth is the right source for A1:
 *   - v2 Shopify opening expectations never enter inventory_truth
 *     (shopify_opening_inventory_expectations only);
 *   - legacy tenants intentionally keep their opening_balance baseline
 *     until A2 physically verifies it;
 *   - physical writers (Receive, Recount, WMS, return restock) all land in
 *     inventory_truth.
 *
 * Quantity capacity deliberately does NOT read inventory_units, LSU/LSP
 * identity, variants.barcode, label_printed_at or print state. Physically
 * established quantity is capacity even with zero units and no label.
 * Scan readiness is a separate Pick execution concern (GH-1145-D).
 *
 * Only rows with available_quantity > 0 are capacity rows. The projection
 * rebuild clamps available at >= 0, and a zero row can never be allocated,
 * so this is the same set the reservation lock has always taken.
 */

export type ReleaseCapacityLock = 'none' | 'for_update';

export interface ReleaseCapacityRow {
  lasyncroVariantId: string;
  locationCode: string;
  /** 0 = pick bin, 1 = warehouse root. Bins are consumed first. */
  locationRank: number;
  availableQuantity: number;
}

export async function readReleaseCapacity(
  trx: Knex.Transaction,
  input: {
    shopId: number;
    variantIds: string[];
    lock: ReleaseCapacityLock;
  }
): Promise<ReleaseCapacityRow[]> {
  const { shopId, variantIds, lock } = input;

  if (variantIds.length === 0) return [];

  const query = trx('inventory_truth as it')
    .join('warehouse_locations as wl', function () {
      this.on('wl.location_code', '=', 'it.location_code')
        .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
        .andOnVal('wl.active', true)
        .andOn(pickableLocationCondition(trx));
    })
    .where('it.shop_id', shopId)
    .whereIn('it.lasyncro_variant_id', variantIds)
    .where('it.available_quantity', '>', 0)
    .select(
      'it.lasyncro_variant_id',
      'it.location_code',
      'it.available_quantity',
      trx.raw(`CASE wl.type WHEN 'bin' THEN 0 ELSE 1 END as location_rank`)
    )
    // Deterministic order: stable lock acquisition across concurrent
    // releases, and bins before ROOT for allocation.
    .orderBy('it.lasyncro_variant_id', 'asc')
    .orderBy('location_rank', 'asc')
    .orderBy('it.location_code', 'asc');

  /**
   * FOR UPDATE locks the inventory_truth rows whose quantity is returned —
   * exactly the rows the reservation then decrements — plus their joined
   * location rows, identical to the lock reservation has always taken.
   */
  const rows =
    lock === 'for_update' ? await query.forUpdate() : await query;

  return rows.map(
    (row: {
      lasyncro_variant_id: string;
      location_code: string;
      available_quantity: number | string;
      location_rank: number | string;
    }) => ({
      lasyncroVariantId: row.lasyncro_variant_id,
      locationCode: row.location_code,
      locationRank: Number(row.location_rank),
      availableQuantity: Number(row.available_quantity),
    })
  );
}

/** Total release capacity per variant. Variants with none are absent (= 0). */
export function sumReleaseCapacityByVariant(
  rows: ReleaseCapacityRow[]
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(
      row.lasyncroVariantId,
      (totals.get(row.lasyncroVariantId) ?? 0) + row.availableQuantity
    );
  }

  return totals;
}
