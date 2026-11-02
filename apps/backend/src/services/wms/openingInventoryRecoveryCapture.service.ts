// apps/backend/src/services/wms/openingInventoryRecoveryCapture.service.ts
//
// S4-5 I4 — per-credit recovery inclusion evidence for the opening cutover
// (CB1 at generation freeze, CB2 at every convergence authority capture).
//
// ONE canonical predicate: an I3 recovery credit (inbound_purchase,
// reference_type inventory_unit, triggered_by receive_recovery) at a location
// owned by the participating warehouse W — the same location → warehouse join
// the physical target sums (openingInventoryPhysicalTarget.service.ts). I3
// commits the credit and its inventory_truth +1 atomically, so inside one
// REPEATABLE READ snapshot a credit is in this set ⇔ its +1 is in the target.
//
// Read/insert only; no target, fingerprint, readiness or Shopify behaviour.

import type { Knex } from 'knex';

export const RECOVERY_CAPTURE_HEADERS = 'opening_inventory_recovery_capture_headers';
export const RECOVERY_CAPTURE_CREDITS = 'opening_inventory_recovery_capture_credits';

export interface RecoveryCreditRef {
  creditMovementId: string;
  locationCode: string;
}

export async function selectRecoveryCreditsForWarehouse(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<RecoveryCreditRef[]> {
  const rows = await trx('inventory_movements as m')
    .join('warehouse_locations as wl', function joinLocation() {
      this.on('wl.shop_id', '=', 'm.shop_id').andOn('wl.location_code', '=', 'm.location_code');
    })
    .where({
      'm.shop_id': shopId,
      'm.movement_type': 'inbound_purchase',
      'm.reference_type': 'inventory_unit',
      'm.triggered_by': 'receive_recovery',
      'wl.warehouse_id': warehouseId,
    })
    .orderBy('m.lasyncro_inventory_movement_id', 'asc')
    .select('m.lasyncro_inventory_movement_id', 'm.location_code');

  return rows.map((row: any) => ({
    creditMovementId: String(row.lasyncro_inventory_movement_id),
    locationCode: String(row.location_code),
  }));
}

/**
 * CB1. Must run inside the generation's own freeze transaction while the
 * generation is still 'assembling' (enforced by 0228). Any failure throws and
 * rolls the generation back with it.
 */
export async function captureRecoveryCreditsForGeneration(
  trx: Knex.Transaction,
  params: { shopId: number; generationId: string; warehouseId: string }
): Promise<number> {
  const { shopId, generationId, warehouseId } = params;
  const credits = await selectRecoveryCreditsForWarehouse(trx, shopId, warehouseId);

  await trx(RECOVERY_CAPTURE_HEADERS).insert({
    shop_id: shopId,
    generation_id: generationId,
    warehouse_id: warehouseId,
    credit_count: credits.length,
    source: 'freeze',
  });

  if (credits.length > 0) {
    await trx(RECOVERY_CAPTURE_CREDITS).insert(
      credits.map((credit) => ({
        shop_id: shopId,
        generation_id: generationId,
        credit_movement_id: credit.creditMovementId,
        location_code: credit.locationCode,
      }))
    );
  }

  const [{ count }] = await trx(RECOVERY_CAPTURE_CREDITS)
    .where({ shop_id: shopId, generation_id: generationId })
    .count({ count: '*' });
  if (Number(count) !== credits.length) {
    throw new Error('[OPENING_CUTOVER_RECOVERY_CAPTURE] inclusion count does not match the header');
  }

  return credits.length;
}

export type RecoveryCaptureComparison =
  | { kind: 'no_capture' }
  | { kind: 'match' }
  | { kind: 'changed' };

/**
 * CB2. Compares the credits visible in the caller's snapshot with the freeze
 * capture. A generation without a header has no evidence to compare (its
 * credits HOLD in I4); it is reported, never treated as a match.
 */
export async function compareRecoveryCreditsWithCapture(
  trx: Knex.Transaction,
  params: { shopId: number; generationId: string; warehouseId: string }
): Promise<RecoveryCaptureComparison> {
  const { shopId, generationId, warehouseId } = params;

  const header = await trx(RECOVERY_CAPTURE_HEADERS)
    .where({ shop_id: shopId, generation_id: generationId })
    .first('warehouse_id');
  if (!header) return { kind: 'no_capture' };
  if (String(header.warehouse_id) !== String(warehouseId)) return { kind: 'changed' };

  const captured = await trx(RECOVERY_CAPTURE_CREDITS)
    .where({ shop_id: shopId, generation_id: generationId })
    .orderBy('credit_movement_id', 'asc')
    .pluck('credit_movement_id');
  const current = await selectRecoveryCreditsForWarehouse(trx, shopId, warehouseId);

  const capturedIds = captured.map(String);
  const currentIds = current.map((credit) => credit.creditMovementId);

  return capturedIds.length === currentIds.length &&
    capturedIds.every((id, index) => id === currentIds[index])
    ? { kind: 'match' }
    : { kind: 'changed' };
}
