import type { Knex } from 'knex';
import { lockLocationHierarchy } from './locationHierarchy.service.js';

export class LocationLifecycleEligibilityError extends Error {
  readonly statusCode = 409;
  constructor(readonly dependency: string) {
    super(`LOCATION_LIFECYCLE_BLOCKED: ${dependency}`);
  }
}

/** Caller owns the tenant transaction and acquires hierarchy coordination before
 * workflow/inventory locks. Inspect each row, including legacy direct-parent
 * stock; opposite discrepancies must never cancel each other out. No writes.
 * History blocks deletion/code reuse, while an identity edit retains its code.
 */
export async function assertLocationLifecycleEligible(
  trx: Knex.Transaction,
  shopId: number,
  locationCodes: readonly string[],
  preserveCode = true,
): Promise<void> {
  await lockLocationHierarchy(trx, shopId);
  if (locationCodes.length === 0) return;
  const result = await trx.raw(`
    WITH RECURSIVE affected(code) AS (
      SELECT unnest(?::text[])
      UNION
      SELECT l.location_code::text FROM warehouse_locations l
      JOIN affected a ON l.parent_location_code = a.code WHERE l.shop_id = ?
    ), dependencies AS (
      SELECT 'inventory' AS dependency FROM inventory_truth i
      WHERE i.shop_id = ? AND i.location_code IN (SELECT code FROM affected)
        AND (i.on_hand_quantity <> 0 OR i.reserved_quantity <> 0 OR i.committed_quantity <> 0 OR i.available_quantity <> 0)
      UNION ALL
      SELECT 'reservation' FROM pick_reservation_allocations a
      JOIN pick_batches b ON b.shop_id = a.shop_id AND b.pick_batch_id = a.pick_batch_id
      WHERE a.shop_id = ? AND a.location_code IN (SELECT code FROM affected)
        AND a.quantity > 0 AND b.status::text IN ('pending', 'picking')
      UNION ALL
      SELECT 'physical_custody' FROM inventory_units u
      WHERE u.shop_id = ? AND (u.current_location_code IN (SELECT code FROM affected)
        OR u.quarantined_from_location IN (SELECT code FROM affected))
        AND (u.identity_unverified OR u.status::text NOT IN ('shipped', 'lost', 'written_off', 'discarded'))
      UNION ALL
      SELECT 'quantity_custody' FROM pick_scan_unit_settlement s
      JOIN inventory_units u ON u.shop_id = s.shop_id AND u.lasyncro_unit_id = s.lasyncro_unit_id
      WHERE s.shop_id = ? AND s.origin_location_code IN (SELECT code FROM affected)
        AND s.released_at IS NULL
        AND (u.identity_unverified OR u.status::text NOT IN ('shipped', 'lost', 'written_off', 'discarded'))
      UNION ALL
      SELECT 'active_pick' FROM pick_scan_log s
      JOIN pick_batches b ON b.shop_id = s.shop_id AND b.pick_batch_id = s.pick_batch_id
      WHERE s.shop_id = ? AND s.location_code IN (SELECT code FROM affected)
        AND b.status::text IN ('pending', 'picking')
      UNION ALL
      SELECT 'problem_custody' FROM problem_center_tasks t
      WHERE t.shop_id = ? AND t.problem_bin_location IN (SELECT code FROM affected)
        AND t.status::text IN ('open', 'investigating')
      UNION ALL
      SELECT 'stow' FROM stow_tasks t WHERE t.shop_id = ?
        AND t.location_code IN (SELECT code FROM affected)
        AND t.status::text NOT IN ('completed', 'cancelled', 'finished_with_exceptions')
      UNION ALL
      SELECT 'recount' FROM inventory_recount_tasks t WHERE t.shop_id = ?
        AND t.status::text NOT IN ('committed', 'cancelled')
        AND (t.scope_location_code IN (SELECT code FROM affected) OR EXISTS (
          SELECT 1 FROM inventory_recount_lines l WHERE l.shop_id = t.shop_id
          AND l.recount_task_id = t.recount_task_id AND l.location_code IN (SELECT code FROM affected)))
      UNION ALL
      SELECT 'opening_snapshot' FROM opening_inventory_shopify_snapshots s
      WHERE s.shop_id = ? AND s.status = 'collecting' AND EXISTS (
        SELECT 1 FROM warehouse_locations l WHERE l.shop_id = s.shop_id
        AND l.warehouse_id = s.warehouse_id AND l.location_code IN (SELECT code FROM affected))
      UNION ALL
      SELECT 'fulfillment_conflict' FROM inventory_reconciliation_conflicts c
      WHERE c.shop_id = ? AND c.status = 'open' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(c.candidate_locations) candidate
        WHERE candidate->>'location_code' IN (SELECT code FROM affected))
    ) SELECT dependency FROM dependencies LIMIT 1`,
  [[...new Set(locationCodes)], ...Array(11).fill(shopId)]);
  if (result.rows[0]) throw new LocationLifecycleEligibilityError(result.rows[0].dependency);

  if (!preserveCode) {
    // Retain the original address of append-only evidence and prevent a new
    // location inheriting the same code's earlier operations/custody.
    for (const [table, column] of [
      ['inventory_movements', 'location_code'],
      ['inventory_unit_status', 'location_code'],
      ['pick_scan_log', 'location_code'],
      ['inventory_recount_lines', 'location_code'],
      ['inventory_recount_tasks', 'scope_location_code'],
      ['stow_tasks', 'location_code'],
      ['inventory_units', 'current_location_code'],
      ['inventory_units', 'quarantined_from_location'],
      ['pick_scan_unit_settlement', 'origin_location_code'],
      ['pick_reservation_allocations', 'location_code'],
      ['problem_center_tasks', 'problem_bin_location'],
    ]) {
      if (await trx(table).where({ shop_id: shopId }).whereIn(column, [...locationCodes]).first()) {
        throw new LocationLifecycleEligibilityError('location_history');
      }
    }
  }
}

/** Adding a first child makes its parent structural for Stow. Protect the
 * parent's active destination work without forbidding legacy direct-parent
 * stock. The caller retains its transaction and takes coordination before rows.
 */
export async function assertProspectiveParentStowEligible(
  trx: Knex.Transaction,
  shopId: number,
  parentCode: string | null,
): Promise<void> {
  if (parentCode === null) return;
  await lockLocationHierarchy(trx, shopId);
  // Inactive children also make a parent structural; a further child does not
  // change that destination eligibility.
  if (await trx('warehouse_locations').where({ shop_id: shopId, parent_location_code: parentCode }).first('location_code')) return;
  const activeStow = await trx('stow_tasks').where({ shop_id: shopId, location_code: parentCode })
    .whereNotIn('status', ['completed', 'cancelled', 'finished_with_exceptions']).first('stow_task_id');
  if (activeStow) throw new LocationLifecycleEligibilityError('stow');
}

/** Re-read after coordination waits. Recount may use legacy direct-parent and
 * warehouse-root stock; it must still resolve to an active tenant location.
 */
export async function assertRecountLocationsEligible(
  trx: Knex.Transaction,
  shopId: number,
  locationCodes: readonly string[],
  warehouseId?: string,
): Promise<void> {
  const codes = [...new Set(locationCodes)];
  if (codes.length === 0) return;
  const query = trx('warehouse_locations').where({ shop_id: shopId, active: true })
    .whereIn('location_code', codes);
  if (warehouseId !== undefined) query.where({ warehouse_id: warehouseId });
  const locations = await query.select('location_code');
  if (locations.length !== codes.length) throw new Error('RECOUNT_LOCATION_INELIGIBLE');
}
