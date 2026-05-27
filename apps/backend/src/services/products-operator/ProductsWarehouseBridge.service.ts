// apps/backend/src/services/products-operator/ProductsWarehouseBridge.service.ts
//
// ProductsWarehouseBridge
// -----------------------
// Cross-domain bridge: pulls warehouse floor readiness signals into the
// products operator surface.
//
// DESIGN CONTRACT:
// - Read-only — never mutates warehouse state
// - Returns null on failure — caller degrades gracefully
// - "No bin location" = variant has available stock but inventory_truth.location_code
//   is not a pick-zone bin in warehouse_locations.
//   On clean seed all stock sits at 'WH-1-ROOT' (warehouse root) — none stowed to bins.
//
// SCHEMA FACTS (verified 2026-05-27):
// - warehouse_locations: (shop_id, location_code) PK, zone_type (enum), type (enum)
//   location_type enum: warehouse | lane | shelf | bin
//   zone_type enum: pick | pack | receive | ship | returns | problem | quarantine | kitting | storage
// - inventory_truth: location_code references warehouse root ('WH-1-ROOT') by default —
//   not actual pick bins until stow workflow runs
// - Pick bins = warehouse_locations WHERE zone_type='pick' AND type='bin'

import { withTenant } from '@lasyncro/backend-core/db.js';

export type ProductsWarehouseSignals = {
  /** Total active pick bins on the warehouse floor */
  total_pick_bins: number;
  /** Pick bins that have at least one variant stowed (location_code match in inventory_truth) */
  stocked_pick_bins: number;
  /** Occupancy % = stocked_pick_bins / total_pick_bins. Null if no pick bins configured. */
  pick_zone_occupancy_pct: number | null;
  /** Variants with available_quantity > 0 but not stowed to any pick bin */
  variants_with_stock_no_bin: number;
};

export async function getProductsWarehouseSignals(
  shopId: number
): Promise<ProductsWarehouseSignals | null> {
  try {
    return await withTenant(shopId, async (trx) => {

      // ── Total active pick bins ────────────────────────────────────────────
      const [pickBinRow] = await trx('warehouse_locations')
        .where({ shop_id: shopId, zone_type: 'pick', type: 'bin', active: true })
        .count('* as count');

      const total_pick_bins = Number(pickBinRow.count);

      // ── Pick bins with stowed variants ───────────────────────────────────
      // A bin is "stocked" when inventory_truth.location_code matches a pick bin code
      const [stockedBinRow] = await trx('warehouse_locations as wl')
        .join('inventory_truth as it', function () {
          this.on('it.shop_id', '=', 'wl.shop_id')
              .andOn('it.location_code', '=', 'wl.location_code');
        })
        .where({
          'wl.shop_id': shopId,
          'wl.zone_type': 'pick',
          'wl.type': 'bin',
          'wl.active': true,
        })
        .where('it.available_quantity', '>', 0)
        .countDistinct('wl.location_code as count');

      const stocked_pick_bins = Number(stockedBinRow.count);

      const pick_zone_occupancy_pct =
        total_pick_bins > 0
          ? Math.round((stocked_pick_bins / total_pick_bins) * 100)
          : null;

      // ── Variants with stock but no pick bin assignment ───────────────────
      // These are variants whose location_code in inventory_truth does NOT
      // correspond to an active pick bin — stock exists but can't be picked.
      const [noBinRow] = await trx('inventory_truth as it')
        .leftJoin('warehouse_locations as wl', function () {
          this.on('wl.shop_id', '=', 'it.shop_id')
              .andOn('wl.location_code', '=', 'it.location_code')
              .andOnVal('wl.zone_type', '=', 'pick')
              .andOnVal('wl.type', '=', 'bin')
              .andOnVal('wl.active', '=', true);
        })
        .where('it.shop_id', shopId)
        .where('it.available_quantity', '>', 0)
        .whereNull('wl.location_code')
        .countDistinct('it.lasyncro_variant_id as count');

      const variants_with_stock_no_bin = Number(noBinRow.count);

      return {
        total_pick_bins,
        stocked_pick_bins,
        pick_zone_occupancy_pct,
        variants_with_stock_no_bin,
      };
    });
  } catch {
    // Warehouse data unavailable — products module degrades gracefully
    return null;
  }
}