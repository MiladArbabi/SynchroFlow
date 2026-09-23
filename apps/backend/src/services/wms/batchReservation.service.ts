import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import {
  readReleaseCapacity,
  sumReleaseCapacityByVariant,
} from '../inventory/releaseCapacity.service.js';
import { assertPickAllocationsScanReady } from './pickExecutionReadiness.service.js';

const RESERVATION_NAMESPACE =
  'c2d3e4f5-a6b7-8901-bcde-f12345678901';

/**
 * SHOP-REVIEW-RELEASE-SYSTEM-08 (R14) — a genuine concurrent inventory race.
 *
 * The release-time pre-check in pickBatch.service.ts already routes orders that
 * are short *before* reservation to newly_blocked (that is the R9 path, and it
 * is unchanged). This typed error means the pre-check WAS satisfiable, but after
 * `SELECT ... FOR UPDATE` locked the pickable rows another release had already
 * committed and depleted the stock — CONFLICT_WITH_NEWER_INVENTORY_STATE.
 *
 * It is NOT an internal error, an intake exception, an operational Blocked
 * condition, nor an oversell constraint, and it never persists new business
 * state: it simply escapes the release so the outer db.transaction rolls back
 * whole, and the controller maps it to HTTP 409 so the operator can refresh and
 * retry. Typed (never message-matched) so the mapping needs no SQL/Knex
 * internals — same rationale as CanonicalContractError.
 */
export class InventoryChangedDuringReleaseError extends Error {
  public readonly code = 'INVENTORY_CHANGED_DURING_RELEASE' as const;
  public readonly variantId: string | null;
  public readonly requiredQuantity: number | null;
  public readonly availableQuantity: number | null;

  constructor(details: {
    variantId?: string | null;
    requiredQuantity?: number | null;
    availableQuantity?: number | null;
  }) {
    super('Inventory changed while the batch was being released.');
    this.name = 'InventoryChangedDuringReleaseError';
    this.variantId = details.variantId ?? null;
    this.requiredQuantity = details.requiredQuantity ?? null;
    this.availableQuantity = details.availableQuantity ?? null;
    // Required for instanceof to survive TS's ES5 downlevel of Error subclasses.
    Object.setPrototypeOf(this, InventoryChangedDuringReleaseError.prototype);
  }
}

export interface BatchReservationLineItem {
  lasyncro_variant_id: string;
  quantity: number | string;

  /**
   * Reservation ownership provenance.
   * Required by reserveBatchInventory(), optional here so the existing
   * pure allocation helper remains backward-compatible for unit callers.
   */
  lasyncro_order_id?: string;
  lasyncro_line_item_id?: string;
}

interface BatchReservationOwnershipAllocation {
  lasyncroOrderId: string;
  lasyncroLineItemId: string;
  lasyncroVariantId: string;
  locationCode: string;
  quantity: number;
}

interface PickableInventoryRow {
  lasyncro_variant_id: string;
  location_code: string;
  available_quantity: number | string;
  /**
   * SHOP-REV-02: allocation preference. 0 = bin, 1 = warehouse root.
   * Lower allocates first, so stowed stock is always consumed before
   * unlocated root stock. Optional for callers of the exported
   * buildBatchReservationAllocations, which get bin-priority by default.
   */
  location_rank?: number;
}

export interface BatchReservationAllocation {
  lasyncroVariantId: string;
  locationCode: string;
  quantity: number;
}

interface ReserveBatchInventoryInput {
  shopId: number;
  pickBatchId: string;
  releasedBy: number | null;
  lineItems: BatchReservationLineItem[];
}

function parsePositiveInteger(
  value: number | string,
  label: string
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `[PICK_BATCH_SERVICE] ${label} must be a positive integer. Received: ${value}`
    );
  }

  return parsed;
}

function aggregateRequiredQuantities(
  lineItems: BatchReservationLineItem[]
): Map<string, number> {
  const requiredByVariant = new Map<string, number>();

  for (const lineItem of lineItems) {
    const variantId = lineItem.lasyncro_variant_id;

    if (!variantId) {
      throw new Error(
        '[PICK_BATCH_SERVICE] Cannot reserve an order line without a variant ID.'
      );
    }

    const quantity = parsePositiveInteger(
      lineItem.quantity,
      `Order-line quantity for variant ${variantId}`
    );

    requiredByVariant.set(
      variantId,
      (requiredByVariant.get(variantId) ?? 0) + quantity
    );
  }

  return requiredByVariant;
}

function allocateRequiredQuantities(
  requiredByVariant: Map<string, number>,
  inventoryRows: PickableInventoryRow[]
): BatchReservationAllocation[] {
  const inventoryByVariant =
    new Map<string, PickableInventoryRow[]>();

  for (const inventoryRow of inventoryRows) {
    const availableQuantity = parsePositiveInteger(
      inventoryRow.available_quantity,
      `Available quantity for variant ${inventoryRow.lasyncro_variant_id} at ${inventoryRow.location_code}`
    );

    const rows =
      inventoryByVariant.get(inventoryRow.lasyncro_variant_id) ?? [];

    rows.push({
      ...inventoryRow,
      available_quantity: availableQuantity,
    });

    inventoryByVariant.set(
      inventoryRow.lasyncro_variant_id,
      rows
    );
  }

  const allocations: BatchReservationAllocation[] = [];

  const sortedRequiredVariants =
    [...requiredByVariant.entries()].sort(
      ([leftVariantId], [rightVariantId]) =>
        leftVariantId.localeCompare(rightVariantId)
    );

  for (const [variantId, requiredQuantity] of sortedRequiredVariants) {
    /**
     * SHOP-REV-02: rank first, then location_code. Sorting on
     * location_code alone would have ordered WH-{n}-ROOT among the bins
     * by alphabet — correct by luck for A-/B-/C- names, wrong for any
     * bin sorting after "WH". Rank makes bins-first explicit.
     */
    const rows = [
      ...(inventoryByVariant.get(variantId) ?? []),
    ].sort((left, right) => {
      const rankDelta = (left.location_rank ?? 0) - (right.location_rank ?? 0);
      if (rankDelta !== 0) return rankDelta;
      return left.location_code.localeCompare(right.location_code);
    });

    let remainingQuantity = requiredQuantity;
    let totalAvailable = 0;

    for (const row of rows) {
      const availableAtLocation = Number(
        row.available_quantity
      );

      totalAvailable += availableAtLocation;

      const allocatedQuantity = Math.min(
        remainingQuantity,
        availableAtLocation
      );

      if (allocatedQuantity > 0) {
        allocations.push({
          lasyncroVariantId: variantId,
          locationCode: row.location_code,
          quantity: allocatedQuantity,
        });

        remainingQuantity -= allocatedQuantity;
      }

      if (remainingQuantity === 0) break;
    }

    if (remainingQuantity > 0) {
      throw new Error(
        `[PICK_BATCH_SERVICE] Insufficient pickable inventory for variant ${variantId}. Required: ${requiredQuantity}, Available: ${totalAvailable}`
      );
    }
  }

  return allocations;
}

export function buildBatchReservationAllocations(
  lineItems: BatchReservationLineItem[],
  inventoryRows: PickableInventoryRow[]
): BatchReservationAllocation[] {
  return allocateRequiredQuantities(
    aggregateRequiredQuantities(lineItems),
    inventoryRows
  );
}

/**
 * Split the already-computed aggregate batch allocations back across
 * their owning order lines.
 *
 * Important: this does NOT choose different inventory. The aggregate
 * allocator remains authoritative for variant + location quantities.
 * This function only records who owns each piece of that allocation.
 */
function buildReservationOwnershipAllocations(
  lineItems: BatchReservationLineItem[],
  allocations: BatchReservationAllocation[]
): BatchReservationOwnershipAllocation[] {
  const allocationPools = new Map<
    string,
    Array<{ locationCode: string; remaining: number }>
  >();

  for (const allocation of allocations) {
    const pool = allocationPools.get(allocation.lasyncroVariantId) ?? [];
    pool.push({
      locationCode: allocation.locationCode,
      remaining: allocation.quantity,
    });
    allocationPools.set(allocation.lasyncroVariantId, pool);
  }

  const ownedLines = [...lineItems].sort((left, right) => {
    const variantCompare = left.lasyncro_variant_id.localeCompare(
      right.lasyncro_variant_id
    );
    if (variantCompare !== 0) return variantCompare;

    const orderCompare = String(left.lasyncro_order_id ?? '').localeCompare(
      String(right.lasyncro_order_id ?? '')
    );
    if (orderCompare !== 0) return orderCompare;

    return String(left.lasyncro_line_item_id ?? '').localeCompare(
      String(right.lasyncro_line_item_id ?? '')
    );
  });

  const ownership: BatchReservationOwnershipAllocation[] = [];

  for (const lineItem of ownedLines) {
    if (!lineItem.lasyncro_order_id || !lineItem.lasyncro_line_item_id) {
      throw new Error(
        '[PICK_BATCH_SERVICE] Reservation ownership requires order and line-item IDs.'
      );
    }

    let remaining = parsePositiveInteger(
      lineItem.quantity,
      `Reservation ownership quantity for line ${lineItem.lasyncro_line_item_id}`
    );

    const pool = allocationPools.get(lineItem.lasyncro_variant_id) ?? [];

    for (const allocation of pool) {
      if (remaining === 0) break;
      if (allocation.remaining <= 0) continue;

      const ownedQuantity = Math.min(remaining, allocation.remaining);

      ownership.push({
        lasyncroOrderId: lineItem.lasyncro_order_id,
        lasyncroLineItemId: lineItem.lasyncro_line_item_id,
        lasyncroVariantId: lineItem.lasyncro_variant_id,
        locationCode: allocation.locationCode,
        quantity: ownedQuantity,
      });

      allocation.remaining -= ownedQuantity;
      remaining -= ownedQuantity;
    }

    if (remaining !== 0) {
      throw new Error(
        `[PICK_BATCH_SERVICE] Reservation ownership allocation mismatch for line ${lineItem.lasyncro_line_item_id}. Remaining: ${remaining}`
      );
    }
  }

  for (const [variantId, pool] of allocationPools.entries()) {
    const remaining = pool.reduce(
      (sum, allocation) => sum + allocation.remaining,
      0
    );

    if (remaining !== 0) {
      throw new Error(
        `[PICK_BATCH_SERVICE] Reservation ownership left ${remaining} unowned units for variant ${variantId}.`
      );
    }
  }

  return ownership;
}

export async function reserveBatchInventory(
  trx: Knex.Transaction,
  input: ReserveBatchInventoryInput
): Promise<BatchReservationAllocation[]> {
  const {
    shopId,
    pickBatchId,
    releasedBy,
    lineItems,
  } = input;

  if (lineItems.length === 0) {
    throw new Error(
      '[PICK_BATCH_SERVICE] Cannot reserve inventory for an empty batch.'
    );
  }

  const requiredByVariant =
    aggregateRequiredQuantities(lineItems);

  const variantIds = [...requiredByVariant.keys()];

  /**
   * GH-1145-A1: capacity comes from readReleaseCapacity — the single
   * quantity definition shared with inventoryConstraintEvaluator (what is
   * eligible) and the pickBatch release precheck. Pickable = active pick bin
   * OR warehouse root, unconditionally (FRESH-STOW-CLIFF-01); location_rank
   * drives bins-first allocation, root is the fallback.
   *
   * lock: 'for_update' locks exactly the inventory_truth rows whose quantity
   * is allocated and decremented below, serializing competing releases
   * inside the caller's transaction.
   */
  const capacityRows = await readReleaseCapacity(trx, {
    shopId,
    variantIds,
    lock: 'for_update',
  });

  const inventoryRows: PickableInventoryRow[] = capacityRows.map((row) => ({
    lasyncro_variant_id: row.lasyncroVariantId,
    location_code: row.locationCode,
    available_quantity: row.availableQuantity,
    location_rank: row.locationRank,
  }));

  /**
   * SHOP-REVIEW-RELEASE-SYSTEM-08 (R14) — authoritative post-lock re-check.
   * The capacity rows are now FOR UPDATE-locked truth. If they can no longer
   * cover demand, a competing release committed between pickBatch.service.ts's
   * non-locking pre-check and this lock. That is a concurrency conflict, not a
   * pre-existing shortfall (R9), so surface it typed: the whole release rolls
   * back and the caller gets a controlled 409 instead of a generic 500.
   */
  const lockedAvailableByVariant = sumReleaseCapacityByVariant(capacityRows);
  for (const [variantId, requiredQuantity] of requiredByVariant) {
    const availableQuantity = lockedAvailableByVariant.get(variantId) ?? 0;
    if (availableQuantity < requiredQuantity) {
      throw new InventoryChangedDuringReleaseError({
        variantId,
        requiredQuantity,
        availableQuantity,
      });
    }
  }

  const allocations = allocateRequiredQuantities(
    requiredByVariant,
    inventoryRows
  );

  await assertPickAllocationsScanReady(
    trx,
    shopId,
    allocations
  );

  const ownershipAllocations =
    buildReservationOwnershipAllocations(lineItems, allocations);

  const reservedAt = new Date();

  for (const allocation of allocations) {
    const movementKey =
      `${pickBatchId}:` +
      `${allocation.lasyncroVariantId}:` +
      `${allocation.locationCode}`;

    const insertedMovements = await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: uuidv5(
          `${movementKey}:reservation_hold`,
          RESERVATION_NAMESPACE
        ),
        lasyncro_variant_id:
          allocation.lasyncroVariantId,
        shop_id: shopId,
        movement_type: 'reservation_hold',
        quantity_delta: allocation.quantity,
        location_code: allocation.locationCode,
        reference_type: 'pick_batch',
        reference_id: pickBatchId,
        platform: 'wms',
        occurred_at: reservedAt,
        device_event_id: uuidv5(
          `${movementKey}:device`,
          RESERVATION_NAMESPACE
        ),
        operator_id: releasedBy,
        triggered_by: 'pick_scan',
      })
      .onConflict([
        'shop_id',
        'reference_type',
        'reference_id',
        'lasyncro_variant_id',
        'location_code',
        'movement_type',
      ])
      .ignore()
      .returning('lasyncro_inventory_movement_id');

    /**
     * A conflict means this logical reservation already exists.
     * Never apply the projection mutation again on a retry.
     */
    if (insertedMovements.length === 0) continue;

    const updatedRows = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id:
          allocation.lasyncroVariantId,
        location_code: allocation.locationCode,
      })
      .where(
        'available_quantity',
        '>=',
        allocation.quantity
      )
      .update({
        available_quantity: trx.raw(
          'available_quantity - ?',
          [allocation.quantity]
        ),
        reserved_quantity: trx.raw(
          'reserved_quantity + ?',
          [allocation.quantity]
        ),
        last_evaluated_at: reservedAt,
        updated_at: reservedAt,
      });

    if (updatedRows !== 1) {
      // The FOR UPDATE-locked row changed under us before this UPDATE could
      // apply the decrement — the same CONFLICT_WITH_NEWER_INVENTORY_STATE as
      // the post-lock re-check above, surfaced typed for a controlled 409.
      throw new InventoryChangedDuringReleaseError({
        variantId: allocation.lasyncroVariantId,
        requiredQuantity: allocation.quantity,
        availableQuantity: null,
      });
    }
  }

  if (ownershipAllocations.length > 0) {
    await trx('pick_reservation_allocations')
      .insert(
        ownershipAllocations.map((allocation) => ({
          shop_id: shopId,
          pick_batch_id: pickBatchId,
          lasyncro_order_id: allocation.lasyncroOrderId,
          lasyncro_line_item_id: allocation.lasyncroLineItemId,
          lasyncro_variant_id: allocation.lasyncroVariantId,
          location_code: allocation.locationCode,
          quantity: allocation.quantity,
          created_at: reservedAt,
          updated_at: reservedAt,
        }))
      )
      .onConflict([
        'shop_id',
        'pick_batch_id',
        'lasyncro_line_item_id',
        'location_code',
      ])
      .ignore();
  }

  return allocations;
}
