// apps/backend/src/services/wms/openingInventoryPhysicalTarget.service.ts
//
// GH-1179 SLICE C — CURRENT PHYSICAL TARGET + LOCAL READINESS
// ------------------------------------------------------------
// The Opening Inventory cutover target is CURRENT local physical truth owned
// by the participating warehouse W, read at cutover time:
//
//   TARGET(V) = SUM inventory_truth.on_hand_quantity
//               over rows whose (shop_id, location_code) is owned by
//               warehouse_locations.warehouse_id = W
//
// Every W-owned location counts, whatever its type, zone or active flag. The
// frozen Shopify snapshot is provenance and key universe only, never
// arithmetic; expectations and opening-count differences are never read.
//
// Read only: every function runs on the caller's tenant transaction and
// writes nothing. Not yet wired into cutover (Slice D/E).

import type { Knex } from 'knex';

const SNAPSHOTS = 'opening_inventory_shopify_snapshots';
const SNAPSHOT_LINES = 'opening_inventory_shopify_snapshot_lines';

const OPEN_STOW_STATUSES = ['pending', 'in_progress'];
const UNRESOLVED_PROBLEM_STATUSES = ['open', 'investigating'];
const TERMINAL_LINE_STATUSES = ['shipped', 'cancelled'];

// ─── errors ──────────────────────────────────────────────────────────────────

export type OpeningInventoryPhysicalScopeErrorCode =
  | 'OPENING_INVENTORY_SNAPSHOT_REQUIRED'
  | 'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH';

/**
 * Scope-resolution integrity failure. Carries a stable `code` and never
 * readiness `reasons`: the participating warehouse could not be proven.
 */
export class OpeningInventoryPhysicalScopeError extends Error {
  readonly code: OpeningInventoryPhysicalScopeErrorCode;

  constructor(code: OpeningInventoryPhysicalScopeErrorCode, detail: string) {
    super(`[OPENING_INVENTORY_PHYSICAL_TARGET] ${code}: ${detail}`);
    this.name = 'OpeningInventoryPhysicalScopeError';
    this.code = code;
  }
}

/** Emission order is fixed; reasons are deduplicated. */
export const OPENING_INVENTORY_PHYSICAL_READINESS_REASONS = [
  'ROOT_NONZERO',
  'ORPHAN_NONZERO',
  'NEGATIVE',
  'PICK_PACK_IN_FLIGHT',
  'RETURN_PHYSICAL_UNRESOLVED',
  'CANCELLED_PICK_UNRESOLVED',
] as const;

export type OpeningInventoryPhysicalReadinessReason =
  (typeof OPENING_INVENTORY_PHYSICAL_READINESS_REASONS)[number];

export class OpeningInventoryPhysicalReadinessError extends Error {
  readonly reasons: OpeningInventoryPhysicalReadinessReason[];

  constructor(reasons: OpeningInventoryPhysicalReadinessReason[]) {
    super(
      `[OPENING_INVENTORY_PHYSICAL_NOT_READY] ${reasons.join(', ')}`
    );
    this.name = 'OpeningInventoryPhysicalReadinessError';
    this.reasons = reasons;
  }
}

// ─── participating warehouse ─────────────────────────────────────────────────

export interface OpeningInventoryParticipatingWarehouse {
  warehouseId: string;
  snapshotId: string;
  shopifyLocationId: string;
}

async function readCompleteSnapshot(
  trx: Knex.Transaction,
  shopId: number
): Promise<{ snapshot_id: string; warehouse_id: string; shopify_location_id: string }> {
  const snapshots = await trx(SNAPSHOTS)
    .where({ shop_id: shopId, status: 'complete' })
    .select('snapshot_id', 'warehouse_id', 'shopify_location_id');

  if (snapshots.length !== 1) {
    throw new OpeningInventoryPhysicalScopeError(
      'OPENING_INVENTORY_SNAPSHOT_REQUIRED',
      `expected exactly one complete Shopify snapshot, found ${snapshots.length}`
    );
  }

  return snapshots[0];
}

/**
 * W is the complete Slice-B snapshot's warehouse, and only once the opening
 * recount cohort proves exactly that same warehouse. Never falls back to a
 * mapping, an active warehouse, the cohort alone or a union.
 */
export async function resolveOpeningInventoryParticipatingWarehouse(
  trx: Knex.Transaction,
  shopId: number
): Promise<OpeningInventoryParticipatingWarehouse> {
  const snapshot = await readCompleteSnapshot(trx, shopId);

  const cohortWarehouseIds: string[] = (
    await trx('inventory_recount_tasks')
      .where({ shop_id: shopId, purpose: 'opening_inventory' })
      .distinct('warehouse_id')
      .pluck('warehouse_id')
  ).map(String);

  if (
    cohortWarehouseIds.length !== 1 ||
    cohortWarehouseIds[0] !== String(snapshot.warehouse_id)
  ) {
    throw new OpeningInventoryPhysicalScopeError(
      'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH',
      `opening cohort spans ${cohortWarehouseIds.length} warehouse(s) and must equal the snapshot warehouse`
    );
  }

  return {
    warehouseId: String(snapshot.warehouse_id),
    snapshotId: String(snapshot.snapshot_id),
    shopifyLocationId: String(snapshot.shopify_location_id),
  };
}

// ─── current physical target ─────────────────────────────────────────────────

export interface OpeningInventoryPhysicalTargetRow {
  lasyncroVariantId: string;
  targetQuantity: number;
}

/**
 * Keys = non-null snapshot variants ∪ variants with W-owned truth rows (zero
 * rows included). Orphan rows and other warehouses never contribute.
 */
export async function buildOpeningInventoryPhysicalTarget(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<OpeningInventoryPhysicalTargetRow[]> {
  const snapshot = await readCompleteSnapshot(trx, shopId);

  if (String(snapshot.warehouse_id) !== String(warehouseId)) {
    throw new OpeningInventoryPhysicalScopeError(
      'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH',
      'requested warehouse is not the complete snapshot warehouse'
    );
  }

  const result = await trx.raw(
    `WITH owned AS (
       SELECT it.lasyncro_variant_id, it.on_hand_quantity
       FROM inventory_truth it
       JOIN warehouse_locations wl
         ON wl.shop_id = it.shop_id
        AND wl.location_code = it.location_code
       WHERE it.shop_id = ?
         AND wl.warehouse_id = ?
     ),
     universe AS (
       SELECT lasyncro_variant_id FROM owned
       UNION
       SELECT l.lasyncro_variant_id
       FROM ${SNAPSHOT_LINES} l
       WHERE l.shop_id = ?
         AND l.snapshot_id = ?
         AND l.lasyncro_variant_id IS NOT NULL
     )
     SELECT u.lasyncro_variant_id,
            COALESCE(SUM(o.on_hand_quantity), 0)::bigint AS target_quantity
     FROM universe u
     LEFT JOIN owned o
       ON o.lasyncro_variant_id = u.lasyncro_variant_id
     GROUP BY u.lasyncro_variant_id`,
    [shopId, warehouseId, shopId, snapshot.snapshot_id]
  );

  return result.rows
    .map((row: { lasyncro_variant_id: string; target_quantity: string | number }) => {
      const targetQuantity = Number(row.target_quantity);

      if (!Number.isSafeInteger(targetQuantity)) {
        throw new Error(
          `[OPENING_INVENTORY_PHYSICAL_TARGET] Non-integer target for variant ${row.lasyncro_variant_id}`
        );
      }

      return {
        lasyncroVariantId: String(row.lasyncro_variant_id),
        targetQuantity,
      };
    })
    .sort((a: OpeningInventoryPhysicalTargetRow, b: OpeningInventoryPhysicalTargetRow) =>
      a.lasyncroVariantId < b.lasyncroVariantId ? -1 : a.lasyncroVariantId > b.lasyncroVariantId ? 1 : 0
    );
}

// ─── local physical readiness ────────────────────────────────────────────────

/** Configured ROOT plus the WH-{shopId}-ROOT literal current writers hardcode. */
async function hasNonzeroRoot(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<boolean> {
  const warehouse = await trx('warehouses')
    .where({ shop_id: shopId, warehouse_id: warehouseId })
    .first('root_location_code');

  const rootCodes = [`WH-${shopId}-ROOT`];
  if (warehouse?.root_location_code) {
    rootCodes.push(String(warehouse.root_location_code));
  }

  const row = await trx('inventory_truth')
    .where({ shop_id: shopId })
    .whereIn('location_code', rootCodes)
    .whereNot('on_hand_quantity', 0)
    .first('location_code');

  return Boolean(row);
}

/** Shop-wide: an orphan row's warehouse is unknowable. */
async function hasNonzeroOrphan(
  trx: Knex.Transaction,
  shopId: number
): Promise<boolean> {
  const row = await trx('inventory_truth as it')
    .where('it.shop_id', shopId)
    .whereNot('it.on_hand_quantity', 0)
    .whereNotExists(function () {
      this.select(trx.raw('1'))
        .from('warehouse_locations as wl')
        .whereRaw('wl.shop_id = it.shop_id')
        .whereRaw('wl.location_code = it.location_code');
    })
    .first('it.location_code');

  return Boolean(row);
}

/** W-owned only: another warehouse's negative never blocks W. */
async function hasNegativeOwnedTruth(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<boolean> {
  const row = await trx('inventory_truth as it')
    .join('warehouse_locations as wl', function () {
      this.on('wl.shop_id', '=', 'it.shop_id')
        .andOn('wl.location_code', '=', 'it.location_code');
    })
    .where('it.shop_id', shopId)
    .where('wl.warehouse_id', warehouseId)
    .where('it.on_hand_quantity', '<', 0)
    .first('it.location_code');

  return Boolean(row);
}

/**
 * A confirmed pick has left truth; it is settled only when its warehouse line
 * is shipped or cancelled. A missing line status fails closed.
 */
async function hasPickPackInFlight(
  trx: Knex.Transaction,
  shopId: number
): Promise<boolean> {
  const row = await trx('pick_scan_log as psl')
    .leftJoin('order_line_item_warehouse_status as ols', function () {
      this.on('ols.shop_id', '=', 'psl.shop_id')
        .andOn('ols.lasyncro_line_item_id', '=', 'psl.lasyncro_line_item_id');
    })
    .where('psl.shop_id', shopId)
    .where('psl.status', 'confirmed')
    .where('psl.quantity_confirmed', '>', 0)
    .where((query) => {
      query
        .whereNull('ols.lasyncro_line_item_id')
        .orWhereNotIn('ols.status', TERMINAL_LINE_STATUSES);
    })
    .first('psl.scan_id');

  return Boolean(row);
}

/**
 * Received returned units held outside truth. Job status alone is never a
 * signal: only quantity-bearing stow, Problem Center or line state counts.
 */
async function hasUnresolvedReturnPhysicalInventory(
  trx: Knex.Transaction,
  shopId: number
): Promise<boolean> {
  // R1 — resellable restock not fully placed.
  const restock = await trx('stow_tasks')
    .where({ shop_id: shopId, trigger: 'return_restock' })
    .whereIn('status', OPEN_STOW_STATUSES)
    .whereRaw('quantity > quantity_placed')
    .first('stow_task_id');
  if (restock) return true;

  // R2 — repackaging unit held; quarantine is not physical settlement.
  const repackaging = await trx('problem_center_tasks')
    .where({
      shop_id: shopId,
      source: 'returns',
      exception_type: 'repackaging_required',
    })
    .where((query) => {
      query
        .whereIn('status', UNRESOLVED_PROBLEM_STATUSES)
        .orWhere((resolved) => {
          resolved
            .where('status', 'resolved')
            .where('resolution_action', 'quarantine');
        });
    })
    .first('problem_task_id');
  if (repackaging) return true;

  // R3 — repackaging re_stow not fully placed.
  const repackagingRestow = await trx('stow_tasks as st')
    .join('problem_center_tasks as p', function () {
      this.on('p.shop_id', '=', 'st.shop_id')
        .andOn('p.problem_task_id', '=', 'st.source_task_id');
    })
    .where('st.shop_id', shopId)
    .where('st.trigger', 'problem_center')
    .whereIn('st.status', OPEN_STOW_STATUSES)
    .whereRaw('st.quantity > st.quantity_placed')
    .where('p.source', 'returns')
    .where('p.exception_type', 'repackaging_required')
    .first('st.stow_task_id');
  if (repackagingRestow) return true;

  // R4 — damaged/unsellable received and not written off (strict).
  const undisposed = await trx('refund_execution_line_items as reli')
    .join(
      'order_revenue_units as oru',
      'oru.lasyncro_revenue_unit_id',
      'reli.lasyncro_revenue_unit_id'
    )
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .whereIn('reli.item_condition', ['damaged', 'unsellable'])
    .whereRaw('COALESCE(reli.quantity_received, 0) > 0')
    .whereRaw(`reli.owner_decision IS DISTINCT FROM 'write_off'`)
    .first('reli.lasyncro_refund_line_item_id');

  return Boolean(undisposed);
}

/** Picked units of a cancelled order awaiting Problem Center or restow. */
async function hasUnresolvedCancelledPickInventory(
  trx: Knex.Transaction,
  shopId: number
): Promise<boolean> {
  const problem = await trx('problem_center_tasks')
    .where({
      shop_id: shopId,
      source: 'pick',
      exception_type: 'order_cancelled',
    })
    .whereIn('status', UNRESOLVED_PROBLEM_STATUSES)
    .first('problem_task_id');
  if (problem) return true;

  const restow = await trx('stow_tasks')
    .where({ shop_id: shopId, trigger: 'order_cancelled_mid_pick' })
    .whereIn('status', OPEN_STOW_STATUSES)
    .whereRaw('quantity > quantity_placed')
    .first('stow_task_id');

  return Boolean(restow);
}

/**
 * Fails closed with every applicable reason, deduplicated and in
 * OPENING_INVENTORY_PHYSICAL_READINESS_REASONS order.
 */
export async function assertOpeningInventoryPhysicalReadiness(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<void> {
  const failed = new Set<OpeningInventoryPhysicalReadinessReason>();

  if (await hasNonzeroRoot(trx, shopId, warehouseId)) failed.add('ROOT_NONZERO');
  if (await hasNonzeroOrphan(trx, shopId)) failed.add('ORPHAN_NONZERO');
  if (await hasNegativeOwnedTruth(trx, shopId, warehouseId)) failed.add('NEGATIVE');
  if (await hasPickPackInFlight(trx, shopId)) failed.add('PICK_PACK_IN_FLIGHT');
  if (await hasUnresolvedReturnPhysicalInventory(trx, shopId)) {
    failed.add('RETURN_PHYSICAL_UNRESOLVED');
  }
  if (await hasUnresolvedCancelledPickInventory(trx, shopId)) {
    failed.add('CANCELLED_PICK_UNRESOLVED');
  }

  if (failed.size > 0) {
    throw new OpeningInventoryPhysicalReadinessError(
      OPENING_INVENTORY_PHYSICAL_READINESS_REASONS.filter((reason) =>
        failed.has(reason)
      )
    );
  }
}
