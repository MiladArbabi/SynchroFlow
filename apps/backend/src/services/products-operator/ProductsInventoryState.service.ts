// apps/backend/src/services/products-operator/ProductsInventoryState.service.ts
//
// ProductsInventoryState
// ----------------------
// Canonical Inventory state read model for the Inventory Intelligence rail.
//
// DESIGN CONTRACT:
// - Read-only — never mutates inventory state
// - Snapshot, not period-scoped
// - Uses withTenant for RLS — caller passes shopId, service owns its own transaction
// - Returns null on failure — caller degrades gracefully; never fabricated zeros
//
// QUANTITIES — whole-shop inventory_truth, one SUM per canonical column:
// - No variant status / SKU / location-type filter. ROOT, storage,
//   quarantine, staging and returns stock are all physical inventory.
// - on_hand stays signed: a negative (phantom) row lowers the total.
// - available and reserved are summed from their own columns. available is
//   clamped per row by the projection writer, so SUM(available) is NOT
//   SUM(on_hand) − SUM(reserved) and must never be derived that way.
//
// TRUTH ESTABLISHMENT — hasInventoryTruth is true when at least one canonical
// inventory_truth row exists for the shop. It is what separates a confirmed
// physical zero (rows exist, sums 0) from no established truth (no rows);
// both report 0 / 0 / 0 quantities.
//
// NO VALID PICK LOCATION — distinct variants with on_hand > 0 somewhere and
// no on_hand > 0 row at an active pick bin (zone_type='pick', type='bin',
// active). Physical on_hand, not available: fully reserved stock still
// counts. ROOT is NOT a valid pick location here — this is deliberately not
// the WMS release predicate (pickableLocationCondition), and it is not the
// legacy warehouse.variants_with_stock_no_bin semantic. A variant with no
// inventory_truth row is Not received and never counts.

import { withTenant } from '@lasyncro/backend-core/db.js';

export type ProductsInventoryState = {
  /** SUM(inventory_truth.on_hand_quantity), signed */
  onHandUnits: number;
  /** SUM(inventory_truth.available_quantity) */
  availableUnits: number;
  /** SUM(inventory_truth.reserved_quantity) */
  reservedUnits: number;
  /** Variants with physical stock but none in an active pick bin */
  noValidPickLocationCount: number;
  /** At least one canonical inventory_truth row exists for the shop */
  hasInventoryTruth: boolean;
};

export async function getProductsInventoryState(
  shopId: number
): Promise<ProductsInventoryState | null> {
  try {
    return await withTenant(shopId, async (trx) => {

      // ── Quantity totals + truth establishment ─────────────────────────────
      const [totalsRow] = await trx('inventory_truth')
        .where('shop_id', shopId)
        .select(
          trx.raw('COALESCE(SUM(on_hand_quantity), 0) as on_hand_units'),
          trx.raw('COALESCE(SUM(available_quantity), 0) as available_units'),
          trx.raw('COALESCE(SUM(reserved_quantity), 0) as reserved_units'),
          trx.raw('COUNT(*) as truth_row_count')
        );

      // ── No valid pick location ────────────────────────────────────────────
      const [noValidPickRow] = await trx('inventory_truth as it')
        .where('it.shop_id', shopId)
        .where('it.on_hand_quantity', '>', 0)
        .whereNotExists(function () {
          this.select(trx.raw('1'))
            .from('inventory_truth as pit')
            .join('warehouse_locations as wl', function () {
              this.on('wl.shop_id', '=', 'pit.shop_id')
                  .andOn('wl.location_code', '=', 'pit.location_code');
            })
            .whereRaw('pit.shop_id = it.shop_id')
            .whereRaw('pit.lasyncro_variant_id = it.lasyncro_variant_id')
            .where('pit.on_hand_quantity', '>', 0)
            .where('wl.active', true)
            .where('wl.zone_type', 'pick')
            .where('wl.type', 'bin');
        })
        .countDistinct('it.lasyncro_variant_id as count');

      return {
        onHandUnits: Number(totalsRow.on_hand_units),
        availableUnits: Number(totalsRow.available_units),
        reservedUnits: Number(totalsRow.reserved_units),
        noValidPickLocationCount: Number(noValidPickRow.count),
        hasInventoryTruth: Number(totalsRow.truth_row_count) > 0,
      };
    });
  } catch {
    // Inventory state unavailable — products module degrades gracefully
    return null;
  }
}
