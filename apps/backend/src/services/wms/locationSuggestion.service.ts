// apps/backend/src/services/wms/locationSuggestion.service.ts
//
// LOCATION SUGGESTION SERVICE (WM-36 v2)
// ----------------------------------------
// Suggests a warehouse location for a stow task.
//
// Strategy: affinity-first, last-known-location fallback
//
// AFFINITY SCORING (WM-36 v2):
//   1. Find orders containing the target variant (90-day window)
//   2. Find all co-occurring variants on those orders (weighted by frequency)
//   3. Find where co-occurring variants are currently stowed
//   4. Score locations by sum of co-occurrence weights
//   5. Return highest-scoring active location
//
// FALLBACK (WM-36 v1):
//   If no affinity data exists (new product, no order history),
//   fall back to last-known-location from inventory_unit_status.
//
// Why affinity-first:
//   Products ordered together should be stored together.
//   Reduces picker walk distance on batched orders — directly
//   improves pick UPH at scale.
//
// Called by: createReceiveJob in receiveJob.service.ts

import { Knex } from 'knex';

const AFFINITY_WINDOW_DAYS = 90;

/**
 * Returns the suggested location_code for a variant, or null if unknown.
 * Must be called within an active transaction with SET LOCAL app.current_tenant.
 */
export async function suggestStowLocation(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    lasyncroVariantId: string;
  }
): Promise<string | null> {
  const { shopId, lasyncroVariantId } = params;

  // ── STRATEGY 1: AFFINITY-BASED SLOTTING ──────────────────────────────────
  //
  // Find variants that co-occur most frequently with the target variant
  // on orders in the past 90 days, then score locations by affinity weight.

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - AFFINITY_WINDOW_DAYS);

  try {
    // Step 1: Find orders containing target variant in window
    // Step 2: Find co-occurring variants on those orders (excluding self)
    // Step 3: Find where co-occurring variants are stowed
    // Step 4: Score locations by co-occurrence weight
    const affinityRows = await trx('order_revenue_units as ru_target')
      // Orders containing the target variant
      .join('order_revenue_units as ru_peer', function () {
        this.on('ru_peer.lasyncro_order_id', 'ru_target.lasyncro_order_id');
      })
      .whereNot('ru_peer.lasyncro_variant_id', lasyncroVariantId)
      // Join orders to apply time window
      .join('orders as o', function () {
        this.on('o.lasyncro_order_id', 'ru_target.lasyncro_order_id')
            .andOn('o.shop_id', trx.raw('?', [shopId]));
      })
      // Find where peer variants are currently stowed
      .join('inventory_unit_status as ius', function () {
        this.on('ius.lasyncro_variant_id', 'ru_peer.lasyncro_variant_id')
            .andOn('ius.shop_id', trx.raw('?', [shopId]))
            .andOnVal('ius.status', 'stowed');
      })
      // Validate location is active
      .join('warehouse_locations as wl', function () {
        this.on('wl.location_code', 'ius.location_code')
            .andOn('wl.shop_id', trx.raw('?', [shopId]))
            .andOnVal('wl.active', true);
      })
      .where('ru_target.lasyncro_variant_id', lasyncroVariantId)
      .where('o.order_created_at', '>=', windowStart)
      .groupBy('ius.location_code')
      // Score = number of co-occurring order lines at this location
      .orderByRaw('COUNT(ru_peer.lasyncro_variant_id) DESC')
      .select('ius.location_code')
      .limit(1)
      .first();

    if (affinityRows?.location_code) {
      return affinityRows.location_code;
    }
  } catch (err) {
    // Affinity query failed — fall through to last-known-location
    console.warn('[locationSuggestion] Affinity query failed, falling back:', (err as Error).message);
  }

  // ── STRATEGY 2: LAST-KNOWN-LOCATION FALLBACK (WM-36 v1) ──────────────────
  //
  // No affinity data — use most recent stow location for this variant.

  const fallback = await trx('inventory_unit_status as ius')
    .join('warehouse_locations as wl', function () {
      this.on('wl.location_code', 'ius.location_code')
          .andOn('wl.shop_id', trx.raw('?', [shopId]));
    })
    .where({
      'ius.shop_id': shopId,
      'ius.lasyncro_variant_id': lasyncroVariantId,
      'ius.status': 'stowed',
      'wl.active': true,
    })
    .orderBy('ius.status_updated_at', 'desc')
    .select('ius.location_code')
    .first();

  return fallback?.location_code ?? null;
}