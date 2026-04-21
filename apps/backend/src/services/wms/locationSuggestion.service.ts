// apps/backend/src/services/wms/locationSuggestion.service.ts
//
// LOCATION SUGGESTION SERVICE (WM-36)
// -------------------------------------
// Suggests a warehouse location for a stow task based on where the variant
// was most recently stowed.
//
// Strategy: last-known-location
//   - Query inventory_unit_status for the variant — status = 'stowed'
//   - Pick the location_code with the most recent status_updated_at
//   - Validate the location is still active in warehouse_locations
//   - Return null if no prior stow history exists (operator assigns manually)
//
// Why last-known-location:
//   - Consistent slotting reduces operator walk time
//   - Merchants typically stock the same variant in the same bin
//   - Simple, deterministic, no ML required
//
// Called by: createReceiveJob in receiveJob.service.ts (WM-36)
// Future: extend with zone-affinity scoring when multi-location is supported

import { Knex } from 'knex';

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

  // Find most recently used active location for this variant
  const suggestion = await trx('inventory_unit_status as ius')
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

  return suggestion?.location_code ?? null;
}