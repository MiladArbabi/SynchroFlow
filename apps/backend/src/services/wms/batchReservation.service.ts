import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

const RESERVATION_NAMESPACE =
  'c2d3e4f5-a6b7-8901-bcde-f12345678901';

export interface BatchReservationLineItem {
  lasyncro_variant_id: string;
  quantity: number | string;
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
   * SHOP-REV-02: pickable = active bin OR warehouse root. Must match
   * inventoryConstraintEvaluator's filter exactly — that one decides
   * which orders are eligible, this one decides which are reservable.
   * A bin-only filter here threw on every tenant whose stock had not
   * been stowed, which is every tenant at install (Shopify ref 102766).
   *
   * location_rank drives bins-first allocation in
   * allocateRequiredQuantities; root is the fallback, not the default.
   *
   * FOR UPDATE serializes competing releases against the same
   * inventory_truth rows inside the caller's transaction.
   */
  const inventoryRows: PickableInventoryRow[] =
    await trx('inventory_truth as it')
      .join('warehouse_locations as wl', function () {
        this.on('wl.location_code', '=', 'it.location_code')
            .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
            .andOnVal('wl.active', true)
            .andOn(trx.raw('wl.type IN (?, ?)', ['bin', 'warehouse']));
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
      .orderBy('it.lasyncro_variant_id', 'asc')
      .orderBy('location_rank', 'asc')
      .orderBy('it.location_code', 'asc')
      .forUpdate();

  const allocations = allocateRequiredQuantities(
    requiredByVariant,
    inventoryRows
  );

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
        // PostgreSQL evaluates both expressions from the old row.
        // This preserves sellable_quantity === available_quantity.
        sellable_quantity: trx.raw(
          'available_quantity - ?',
          [allocation.quantity]
        ),
        last_evaluated_at: reservedAt,
        updated_at: reservedAt,
      });

    if (updatedRows !== 1) {
      throw new Error(
        `[PICK_BATCH_SERVICE] Inventory changed while reserving variant ${allocation.lasyncroVariantId} at ${allocation.locationCode}.`
      );
    }
  }

  return allocations;
}