import type { Knex } from 'knex';
import { randomUUID } from 'crypto';

/**
 * GH-1145 R0-1 — BATCH CANCELLATION RELEASES CURRENT OWNERSHIP.
 * -------------------------------------------------------------------
 * The aggregate reservation_hold (reference_type = 'pick_batch') is immutable
 * history written once at release. Reservation ownership moves on afterwards:
 * order-cancellation unwind and Shopify fulfillment release and delete the
 * allocations they own. Cancellation therefore releases what the batch's
 * SURVIVING pick_reservation_allocations still own, per variant + location,
 * and uses the original hold only as lineage and upper bound.
 *
 * LOCK ORDER (shared with cancellationUnwind.service.ts and, for the
 * warehouse-status → inventory_truth leg, fulfillmentPhysicalRemoval.service.ts):
 *   orders → pick_batches → pick_batch_orders → order_line_item_warehouse_status
 *   → pick_reservation_allocations → inventory_truth (variant, location order)
 */

const TERMINAL_LINE_STATUSES = new Set(['shipped', 'cancelled']);

export type BatchReservationOwnershipErrorCode =
  | 'HOLD_INVALID'
  | 'ALLOCATION_WITHOUT_HOLD'
  | 'OWNED_EXCEEDS_HOLD'
  | 'CONSUMED_ALLOCATION_ON_PENDING_BATCH'
  | 'TRUTH_RESERVED_BELOW_OWNED'
  | 'RELEASE_ALREADY_RECORDED'
  | 'OWNERSHIP_UNKNOWN';

/**
 * The batch's reservation ownership cannot be proven consistent with its
 * immutable holds and inventory_truth. Thrown before any write so the
 * caller's transaction leaves ledger, truth and warehouse state untouched.
 */
export class BatchReservationOwnershipError extends Error {
  readonly code: BatchReservationOwnershipErrorCode;
  readonly pickBatchId: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: BatchReservationOwnershipErrorCode,
    pickBatchId: string,
    details: Record<string, unknown> = {}
  ) {
    super(`BATCH_RESERVATION_OWNERSHIP:${code}`);
    this.name = 'BatchReservationOwnershipError';
    this.code = code;
    this.pickBatchId = pickBatchId;
    this.details = details;
  }
}

type OwnershipKey = {
  lasyncroVariantId: string;
  locationCode: string;
};

function ownershipKey(variantId: string, locationCode: string): string {
  return `${variantId}\u0000${locationCode}`;
}

function compareKeys(a: OwnershipKey, b: OwnershipKey): number {
  if (a.lasyncroVariantId !== b.lasyncroVariantId) {
    return a.lasyncroVariantId < b.lasyncroVariantId ? -1 : 1;
  }
  if (a.locationCode !== b.locationCode) {
    return a.locationCode < b.locationCode ? -1 : 1;
  }
  return 0;
}

export async function cancelUnclaimedBatch(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string
) {
  const observedMembers = await trx('pick_batch_orders')
    .where({ shop_id: shopId, pick_batch_id: batchId })
    .pluck('lasyncro_order_id');
  const observedAllocationOrders = await trx('pick_reservation_allocations')
    .where({ shop_id: shopId, pick_batch_id: batchId })
    .pluck('lasyncro_order_id');
  const scopeOrderIds = [...new Set<string>([
    ...observedMembers.map(String), ...observedAllocationOrders.map(String),
  ])].sort();
  await trx('orders')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_order_id', scopeOrderIds)
    .orderBy('lasyncro_order_id', 'asc')
    .forUpdate()
    .select('lasyncro_order_id');

  // Batch follows all order anchors.
  const batch = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
    })
    .select('status')
    .forUpdate()
    .first();

  if (!batch) {
    throw new Error('BATCH_NOT_FOUND');
  }

  if (batch.status !== 'pending') {
    throw new Error(`BATCH_NOT_CANCELLABLE:${batch.status}`);
  }

  // 2. Current membership (under the batch lock).
  const batchOrders = await trx('pick_batch_orders')
    .where({ shop_id: shopId, pick_batch_id: batchId })
    .orderBy('lasyncro_order_id', 'asc')
    .select('lasyncro_order_id')
    .forUpdate();

  const memberOrderIds: string[] = batchOrders.map(
    (order: { lasyncro_order_id: string }) => String(order.lasyncro_order_id)
  );

  const observedMemberSet = new Set(observedMembers.map(String));
  if (memberOrderIds.some(id => !observedMemberSet.has(id))) {
    throw new BatchReservationOwnershipError('OWNERSHIP_UNKNOWN', batchId, {
      reason: 'membership_outside_locked_scope',
    });
  }
  const removedMembers = [...observedMemberSet].filter(id => !memberOrderIds.includes(id));
  if (removedMembers.length > 0) {
    const states = await trx('order_line_item_warehouse_status')
      .where({ shop_id: shopId }).whereIn('lasyncro_order_id', removedMembers)
      .select('lasyncro_order_id', 'status');
    if (removedMembers.some(id => !states.some(row => String(row.lasyncro_order_id) === id)) ||
        states.some(row => !TERMINAL_LINE_STATUSES.has(row.status))) {
      throw new BatchReservationOwnershipError('OWNERSHIP_UNKNOWN', batchId, {
        reason: 'nonterminal_member_removed',
      });
    }
  }

  // 3. Warehouse-status locks BEFORE allocations / inventory truth. Shopify
  //    fulfillment takes the same line lock before releasing an allocation.
  await trx('order_warehouse_status')
    .whereIn('lasyncro_order_id', scopeOrderIds)
    .orderBy('lasyncro_order_id', 'asc')
    .forUpdate()
    .select('lasyncro_order_id');
  const lineStates = scopeOrderIds.length === 0
    ? []
    : await trx('order_line_item_warehouse_status')
      .where({ shop_id: shopId })
      .whereIn('lasyncro_order_id', scopeOrderIds)
      .orderBy('lasyncro_line_item_id', 'asc')
      .select('lasyncro_line_item_id', 'status')
      .forUpdate();

  const lineStatusById = new Map<string, string>(
    lineStates.map((row: { lasyncro_line_item_id: string; status: string }) => [
      String(row.lasyncro_line_item_id),
      String(row.status),
    ])
  );

  // 4. Current ownership, locked.
  const allocations = await trx('pick_reservation_allocations')
    .where({ shop_id: shopId, pick_batch_id: batchId })
    .orderBy('allocation_id', 'asc')
    .select(
      'allocation_id',
      'lasyncro_order_id',
      'lasyncro_line_item_id',
      'lasyncro_variant_id',
      'location_code',
      'quantity'
    )
    .forUpdate();

  const scopeOrderSet = new Set(scopeOrderIds);
  const unscopedAllocation = allocations.find(
    (allocation: any) => !scopeOrderSet.has(String(allocation.lasyncro_order_id))
  );

  if (unscopedAllocation) {
    throw new BatchReservationOwnershipError('OWNERSHIP_UNKNOWN', batchId, {
      reason: 'allocation_outside_locked_scope',
      allocationId: unscopedAllocation.allocation_id,
    });
  }

  // 5. Validate current ownership against immutable holds — before any write.
  if (allocations.length > 0) {
    const consumed = await trx('pick_scan_log')
      .where({ shop_id: shopId, status: 'confirmed' })
      .whereIn(
        'reservation_allocation_id',
        allocations.map((allocation: any) => allocation.allocation_id)
      )
      .first('reservation_allocation_id');

    if (consumed) {
      throw new BatchReservationOwnershipError(
        'CONSUMED_ALLOCATION_ON_PENDING_BATCH',
        batchId,
        { allocationId: consumed.reservation_allocation_id }
      );
    }
  }

  const holds = await trx('inventory_movements')
    .where({
      shop_id: shopId,
      reference_type: 'pick_batch',
      reference_id: batchId,
      movement_type: 'reservation_hold',
    })
    .select(
      'lasyncro_variant_id',
      'location_code',
      'quantity_delta'
    );

  const heldByKey = new Map<string, OwnershipKey & { held: number }>();

  for (const hold of holds) {
    const heldQuantity = Number(hold.quantity_delta);

    if (!Number.isInteger(heldQuantity) || heldQuantity <= 0) {
      throw new BatchReservationOwnershipError('HOLD_INVALID', batchId, {
        lasyncroVariantId: hold.lasyncro_variant_id,
        locationCode: hold.location_code,
      });
    }

    const key = ownershipKey(hold.lasyncro_variant_id, hold.location_code);
    const existing = heldByKey.get(key);

    heldByKey.set(key, {
      lasyncroVariantId: String(hold.lasyncro_variant_id),
      locationCode: String(hold.location_code),
      held: (existing?.held ?? 0) + heldQuantity,
    });
  }

  const ownedByKey = new Map<string, OwnershipKey & { owned: number }>();
  const allocatedLineIds = new Set<string>();

  for (const allocation of allocations) {
    const key = ownershipKey(allocation.lasyncro_variant_id, allocation.location_code);
    const existing = ownedByKey.get(key);

    allocatedLineIds.add(String(allocation.lasyncro_line_item_id));
    ownedByKey.set(key, {
      lasyncroVariantId: String(allocation.lasyncro_variant_id),
      locationCode: String(allocation.location_code),
      owned: (existing?.owned ?? 0) + Number(allocation.quantity),
    });
  }

  for (const [key, owned] of ownedByKey) {
    const hold = heldByKey.get(key);

    if (!hold) {
      throw new BatchReservationOwnershipError('ALLOCATION_WITHOUT_HOLD', batchId, {
        lasyncroVariantId: owned.lasyncroVariantId,
        locationCode: owned.locationCode,
      });
    }

    if (owned.owned > hold.held) {
      throw new BatchReservationOwnershipError('OWNED_EXCEEDS_HOLD', batchId, {
        lasyncroVariantId: owned.lasyncroVariantId,
        locationCode: owned.locationCode,
        owned: owned.owned,
        held: hold.held,
      });
    }
  }

  /*
   * A hold with no surviving ownership is legitimate only when nothing in
   * the batch still needs it: every member line of that variant is terminal
   * (externally shipped / cancelled) or owns its reservation elsewhere. A
   * live line with no allocation means ownership is unknown — fail closed.
   */
  const unownedHeldVariantIds = [
    ...new Set(
      [...heldByKey.entries()]
        .filter(([key]) => !ownedByKey.has(key))
        .map(([, hold]) => hold.lasyncroVariantId)
    ),
  ];

  if (unownedHeldVariantIds.length > 0 && memberOrderIds.length > 0) {
    const memberLines = await trx('order_line_items')
      .whereIn('lasyncro_order_id', memberOrderIds)
      .whereIn('lasyncro_variant_id', unownedHeldVariantIds)
      .select('lasyncro_line_item_id', 'lasyncro_variant_id');

    const liveUnallocatedLine = memberLines.find((line: any) => {
      const lineId = String(line.lasyncro_line_item_id);
      const status = lineStatusById.get(lineId);
      return !allocatedLineIds.has(lineId) &&
        !(status !== undefined && TERMINAL_LINE_STATUSES.has(status));
    });

    if (liveUnallocatedLine) {
      throw new BatchReservationOwnershipError('OWNERSHIP_UNKNOWN', batchId, {
        reason: 'held_variant_with_live_unallocated_line',
        lasyncroVariantId: liveUnallocatedLine.lasyncro_variant_id,
        lasyncroLineItemId: liveUnallocatedLine.lasyncro_line_item_id,
      });
    }
  }

  const memberLines = await trx('order_line_items')
    .whereIn('lasyncro_order_id', memberOrderIds)
    .select('lasyncro_line_item_id', 'quantity');
  const ownedByLine = new Map<string, number>();
  for (const allocation of allocations) {
    const lineId = String(allocation.lasyncro_line_item_id);
    ownedByLine.set(lineId, (ownedByLine.get(lineId) ?? 0) + Number(allocation.quantity));
  }
  for (const line of memberLines) {
    const lineId = String(line.lasyncro_line_item_id);
    const status = lineStatusById.get(lineId);
    const owned = ownedByLine.get(lineId) ?? 0;
    const expected = status && TERMINAL_LINE_STATUSES.has(status) ? 0 : Number(line.quantity);
    if (!status || owned !== expected) {
      throw new BatchReservationOwnershipError('OWNERSHIP_UNKNOWN', batchId, {
        reason: 'line_ownership_mismatch', lasyncroLineItemId: lineId,
        status: status ?? null, owned, expected,
      });
    }
  }

  const releases = [...ownedByKey.values()]
    .filter((owned) => owned.owned > 0)
    .sort(compareKeys);

  if (releases.length > 0) {
    const priorRelease = await trx('inventory_movements')
      .where({
        shop_id: shopId,
        reference_type: 'pick_batch',
        reference_id: batchId,
        movement_type: 'reservation_release',
      })
      .first('lasyncro_variant_id', 'location_code');

    if (priorRelease) {
      throw new BatchReservationOwnershipError('RELEASE_ALREADY_RECORDED', batchId, {
        lasyncroVariantId: priorRelease.lasyncro_variant_id,
        locationCode: priorRelease.location_code,
      });
    }
  }

  // Inventory truth locks, deterministic variant + location order.
  for (const release of releases) {
    const truth = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: release.lasyncroVariantId,
        location_code: release.locationCode,
      })
      .forUpdate()
      .first('reserved_quantity');

    if (!truth || Number(truth.reserved_quantity) < release.owned) {
      throw new BatchReservationOwnershipError('TRUTH_RESERVED_BELOW_OWNED', batchId, {
        lasyncroVariantId: release.lasyncroVariantId,
        locationCode: release.locationCode,
        owned: release.owned,
        reserved: truth ? Number(truth.reserved_quantity) : null,
      });
    }
  }

  // 6. Ledger + truth: release exactly the current owned quantity.
  let releasedUnits = 0;

  for (const release of releases) {
    const releasedAt = new Date();

    const insertedRelease = await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: randomUUID(),
        lasyncro_variant_id: release.lasyncroVariantId,
        shop_id: shopId,
        movement_type: 'reservation_release',
        quantity_delta: -release.owned,
        location_code: release.locationCode,
        reference_type: 'pick_batch',
        reference_id: batchId,
        platform: 'wms',
        occurred_at: releasedAt,
        operator_id: null,
        triggered_by: 'batch_cancelled',
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

    if (insertedRelease.length !== 1) {
      throw new BatchReservationOwnershipError('RELEASE_ALREADY_RECORDED', batchId, {
        lasyncroVariantId: release.lasyncroVariantId,
        locationCode: release.locationCode,
      });
    }

    const updatedTruthRows = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: release.lasyncroVariantId,
        location_code: release.locationCode,
      })
      .where('reserved_quantity', '>=', release.owned)
      .update({
        reserved_quantity: trx.raw(
          'reserved_quantity - ?',
          [release.owned]
        ),
        available_quantity: trx.raw(
          'available_quantity + ?',
          [release.owned]
        ),
        last_evaluated_at: releasedAt,
        updated_at: releasedAt,
      });

    if (updatedTruthRows !== 1) {
      throw new BatchReservationOwnershipError('TRUTH_RESERVED_BELOW_OWNED', batchId, {
        lasyncroVariantId: release.lasyncroVariantId,
        locationCode: release.locationCode,
        owned: release.owned,
      });
    }

    releasedUnits += release.owned;
  }

  // 7. Remove ownership, warehouse state and membership.
  await trx('pick_reservation_allocations')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
    })
    .delete();

  if (memberOrderIds.length > 0) {
    await trx('order_line_item_warehouse_status')
      .whereIn('lasyncro_order_id', memberOrderIds)
      .delete();

    await trx('order_warehouse_status')
      .whereIn('lasyncro_order_id', memberOrderIds)
      .delete();
  }

  await trx('pick_batch_orders')
    .where({ pick_batch_id: batchId })
    .delete();

  // 8. Batch state.
  const updatedBatchRows = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
      status: 'pending',
    })
    .update({
      status: 'cancelled',
      updated_at: new Date(),
    });

  if (updatedBatchRows !== 1) {
    throw new Error('BATCH_CANCEL_STATE_UPDATE_FAILED');
  }

  return {
    pick_batch_id: batchId,
    status: 'cancelled' as const,
    returned_order_count: memberOrderIds.length,
    released_reservation_count: releases.length,
    released_units: releasedUnits,
  };
}
