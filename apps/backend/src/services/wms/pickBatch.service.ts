// apps/backend/src/services/wms/pickBatch.service.ts
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';
import { fireBatchReleasedAlert } from './wmsAlerts.service.js';

/**
 * PICK BATCH SERVICE (WM-07)
 * --------------------------
 * Assembles and releases pick batches from the order pool.
 *
 * Rules:
 * - Full orders only — no split orders across batches
 * - Orders eligible: fulfillment_status IN ('pending', 'processing')
 * - Orders excluded: already assigned to an active pick_batch_orders row
 * - Batch size: up to max_batch_line_items (from shop_wms_settings)
 * - Batch may release below ceiling
 * - release_trigger: 'auto' | 'manual'
 * - released_by: null for auto, user id for manual
 *
 * Caller must operate within a transaction with tenant set:
 *   SET LOCAL "app.current_tenant" = '{shopId}'
 */

export type SkippedReleaseOrderReason =
  | 'blocked'
  | 'already_batched'
  | 'status_changed'
  | 'not_in_pool';

export interface SkippedReleaseOrder {
  order_id: string;
  external_order_id: string | null;
  reason: SkippedReleaseOrderReason;
  label: string;
}

export interface ReleaseBatchResult {
  pick_batch_id: string | null;
  order_count: number;
  total_line_items: number;
  total_units: number;
  skipped_orders: SkippedReleaseOrder[];
}

const RELEASE_CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Overdue',
  inventory: 'Out of Stock',
  customer: 'Address Issue',
};

const getSkippedReleaseLabel = (
  reason: SkippedReleaseOrderReason,
  constraintType?: string | null
): string => {
  if (reason === 'blocked') {
    return constraintType ? RELEASE_CONSTRAINT_LABELS[constraintType] ?? 'Blocked' : 'Blocked';
  }

  if (reason === 'already_batched') return 'Already in a pick batch';
  if (reason === 'status_changed') return 'Status changed';
  return 'Not in release pool';
};

export async function releaseBatch(
  trx: Knex.Transaction,
  shopId: number,
  trigger: 'auto' | 'manual',
  releasedBy: number | null,
  assignedOperatorId?: number | null,
  assignedPackerId?: number | null,
  /**
   * PRIORITY ORDER SELECTION (A2)
   * --------------------------------
   * Owner-selected orders locked in first before greedy fill.
   * All must be in the pool (constraint-free, unbatched).
   * Invalid IDs are silently skipped — greedy fill compensates.
   * Priority-flagged orders (is_priority_flagged=true) always
   * precede non-flagged orders in greedy fill even without explicit selection.
   * SLA-breached orders (order_age_snapshot.is_shipping_sla_breached — the
   * same 24h fulfillment_sla_hours threshold AL-01's alerts use, see
   * orderAgeProjection.ts) precede non-breached orders within each
   * priority-flag group. Manual flag always outranks automatic breach
   * status — see eligibleOrders query below for the full 3-key sort.
   */
  priorityOrderIds?: string[],
  /**
   * EXCLUSIVE SELECTION MODE (MOB-SMOKE-06b)
   * -----------------------------------------
   * When true and priorityOrderIds provided, skip greedy fill entirely.
   * Only the explicitly selected orders are batched — no pool fill.
   * Invalid IDs (not in pool) are silently skipped.
   * If no valid IDs remain after validation, returns null.
   */
  exclusive?: boolean,
): Promise<ReleaseBatchResult | null> {
  // 1. Load WMS settings for this shop
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select('max_batch_line_items')
    .first();
  if (!settings) {
    console.error('[PICK_BATCH_SERVICE] shop_wms_settings missing', { shopId });
    throw new Error(`[PICK_BATCH_SERVICE] No WMS settings found for shop ${shopId}`);
  }
  const maxLineItems: number = settings.max_batch_line_items;

  // 2. Find eligible orders — constraint-free, unbatched, pending/processing.
  //    Sort: priority-flagged first, then SLA-breached, then oldest-first.
  //    latest_age_snapshot CTE matches sla.metrics.ts's established pattern —
  //    order_age_snapshot is append-only/versioned; DISTINCT ON +
  //    aggregate_version DESC guarantees one row per order. Without this,
  //    the join would multiply eligible rows and corrupt the greedy fill below.
  const eligibleOrders = await trx
    .with('latest_age_snapshot', (qb) => {
      qb.from('order_age_snapshot as oas')
        .distinctOn('oas.lasyncro_order_id')
        .select('oas.lasyncro_order_id', 'oas.is_shipping_sla_breached')
        .orderBy('oas.lasyncro_order_id')
        .orderBy('oas.aggregate_version', 'desc');
    })
    .from('orders as o')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('latest_age_snapshot as las', 'las.lasyncro_order_id', 'o.lasyncro_order_id')
    .whereNotExists(
      trx('order_constraints as oc')
        .where('oc.lasyncro_order_id', trx.raw('o.lasyncro_order_id'))
        .where('oc.is_active', true)
        .select(1)
    )
    .where('o.shop_id', shopId)
    .whereIn('ofs.status', ['pending', 'processing'])
    .whereNull('pbo.lasyncro_order_id')
    .select('o.lasyncro_order_id', 'ofs.is_priority_flagged', 'las.is_shipping_sla_breached')
    .orderByRaw('ofs.is_priority_flagged DESC, COALESCE(las.is_shipping_sla_breached, false) DESC, o.order_created_at ASC');
    

  // 3. Build ordered candidate list:
  //    a) Owner-selected priority orders (priorityOrderIds) — validated against pool
  //    b) Pool priority-flagged orders not already selected
  //    c) Remaining pool orders oldest-first
  const eligibleSet = new Set(eligibleOrders.map(o => o.lasyncro_order_id));
  const requestedPriorityIds = priorityOrderIds ?? [];
  const validPriorityIds = requestedPriorityIds.filter(id => eligibleSet.has(id));
  const invalidPriorityIds = requestedPriorityIds.filter(id => !eligibleSet.has(id));

  const skippedOrders: SkippedReleaseOrder[] = [];

  if (invalidPriorityIds.length > 0) {
    const latestActiveConstraint = trx('order_constraints')
      .distinctOn('lasyncro_order_id')
      .select('lasyncro_order_id', 'constraint_type', 'block_type')
      .where('is_active', true)
      .orderByRaw('lasyncro_order_id, started_at DESC NULLS LAST')
      .as('oc');

    const invalidRows = await trx('orders as o')
      .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin(latestActiveConstraint, 'oc.lasyncro_order_id', 'o.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .whereIn('o.lasyncro_order_id', invalidPriorityIds)
      .select(
        'o.lasyncro_order_id',
        'eim.external_order_id',
        'ofs.status',
        'pbo.pick_batch_id',
        'oc.constraint_type',
        'oc.block_type'
      );

    const invalidById = new Map(invalidRows.map(row => [row.lasyncro_order_id, row]));

    for (const orderId of invalidPriorityIds) {
      const row = invalidById.get(orderId);

      const reason: SkippedReleaseOrderReason = !row
        ? 'not_in_pool'
        : row.constraint_type
        ? 'blocked'
        : row.pick_batch_id
        ? 'already_batched'
        : !['pending', 'processing'].includes(row.status)
        ? 'status_changed'
        : 'not_in_pool';

      skippedOrders.push({
        order_id: orderId,
        external_order_id: row?.external_order_id ?? null,
        reason,
        label: getSkippedReleaseLabel(reason, row?.constraint_type ?? null),
      });
    }
  }

  if (exclusive && validPriorityIds.length === 0) {
    console.info('[PICK_BATCH_SERVICE] Exclusive release requested with no valid selected orders', {
      shopId,
      requestedOrderCount: requestedPriorityIds.length,
      skipped_order_count: skippedOrders.length,
    });

    return {
      pick_batch_id: null,
      order_count: 0,
      total_line_items: 0,
      total_units: 0,
      skipped_orders: skippedOrders,
    };
  }

  if (eligibleOrders.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No eligible orders found', { shopId });
    return null;
  }

  const priorityFlaggedIds = eligibleOrders
    .filter(o => o.is_priority_flagged && !validPriorityIds.includes(o.lasyncro_order_id))
    .map(o => o.lasyncro_order_id);
  const remainingIds = eligibleOrders
    .filter(o => !validPriorityIds.includes(o.lasyncro_order_id) && !priorityFlaggedIds.includes(o.lasyncro_order_id))
    .map(o => o.lasyncro_order_id);

  const candidateIds = [...validPriorityIds, ...priorityFlaggedIds, ...remainingIds];

  // 4. Greedy fill up to max_batch_line_items ceiling — full orders only
  const selectedOrderIds: string[] = [];
  let runningLineItems = 0;
  let runningUnits = 0;

  // Exclusive mode — only batch the explicitly selected orders, no greedy fill
  const idsToProcess = (exclusive && validPriorityIds.length > 0)
    ? validPriorityIds
    : candidateIds;

  for (const orderId of idsToProcess) {
    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: orderId })
      .select('lasyncro_line_item_id', 'quantity');
    const orderLineCount = lineItems.length;
    const orderUnitCount = lineItems.reduce((sum, li) => sum + Number(li.quantity), 0);
    if (runningLineItems + orderLineCount > maxLineItems) {
      // Starvation guard: if nothing selected yet, include oversized order anyway
      if (selectedOrderIds.length === 0) {
        selectedOrderIds.push(orderId);
        runningLineItems += orderLineCount;
        runningUnits += orderUnitCount;
      }
      break;
    }
    selectedOrderIds.push(orderId);
    runningLineItems += orderLineCount;
    runningUnits += orderUnitCount;
  }
  if (selectedOrderIds.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No orders fit within ceiling', { shopId, maxLineItems });
    return null;
  }

  // 4. Create pick batch
  const pickBatchId = randomUUID();

 await trx('pick_batches').insert({
    pick_batch_id: pickBatchId,
    shop_id: shopId,
    status: 'pending',
    release_trigger: trigger,
    max_line_items: maxLineItems,
    total_line_items: runningLineItems,
    total_units: runningUnits,
    released_by: releasedBy,
    released_at: new Date(),
    assigned_operator_id: assignedOperatorId ?? null,
    assigned_packer_id: assignedPackerId ?? null,
  });

  // 5. Assign orders to batch
  await trx('pick_batch_orders').insert(
    selectedOrderIds.map((orderId) => ({
      pick_batch_id: pickBatchId,
      lasyncro_order_id: orderId,
      shop_id: shopId,
    }))
  );

  /**
   * RESERVATION HOLD ON BATCH RELEASE (INV-03)
   * -------------------------------------------
   * Write reservation_hold movements for all line items in the batch.
   * Decrements available_quantity, increments reserved_quantity on inventory_truth.
   *
   * Invariant: available_quantity = on_hand_quantity - reserved_quantity
   * Movement is append-only and idempotent via device_event_id.
   *
   * Audit: reference_type='pick_batch', reference_id=pickBatchId
   */
  const RESERVATION_NAMESPACE = 'c2d3e4f5-a6b7-8901-bcde-f12345678901';

  const allLineItems = await trx('order_line_items')
    .whereIn('lasyncro_order_id', selectedOrderIds)
    .select('lasyncro_line_item_id', 'lasyncro_variant_id', 'quantity');

  for (const li of allLineItems) {
    const movementId = uuidv5(
      `${pickBatchId}:${li.lasyncro_line_item_id}:reservation_hold`,
      RESERVATION_NAMESPACE
    );
    const deviceEventId = uuidv5(
      `${pickBatchId}:${li.lasyncro_line_item_id}:device`,
      RESERVATION_NAMESPACE
    );

    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: movementId,
        lasyncro_variant_id: li.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'reservation_hold',
        quantity_delta: li.quantity, // positive per check constraint
        location_code: `WH-${shopId}-ROOT`, // reserved from available pool
        reference_type: 'pick_batch',
        reference_id: pickBatchId,
        platform: 'wms',
        occurred_at: new Date(),
        device_event_id: deviceEventId,
        operator_id: releasedBy,        // traceability: admin/owner who released batch
        triggered_by: 'pick_scan',      // traceability: part of pick workflow
      })

    // Decrement available, increment reserved on inventory_truth
    await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: li.lasyncro_variant_id })
      .update({
        available_quantity: trx.raw('GREATEST(0, available_quantity - ?)', [li.quantity]),
        reserved_quantity: trx.raw('reserved_quantity + ?', [li.quantity]),
        last_evaluated_at: new Date(),
        updated_at: new Date(),
      });
  }

  console.info('[PICK_BATCH_RELEASED]', {
    pick_batch_id: pickBatchId,
    shopId,
    trigger,
    releasedBy,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
  });

  // Fire alert to owner/admin inbox — visible in Overview + Alerts tab
  await fireBatchReleasedAlert(trx, {
    shopId,
    batchId: pickBatchId,
    orderCount: selectedOrderIds.length,
    lineItems: runningLineItems,
    assignedOperatorId: assignedOperatorId ?? null,
  });

  // Notify operators — targeted if assigned, broadcast to pool otherwise
  dispatchNotification({
    shopId,
    payload: {
      title: 'New batch ready to pick',
      body: `Batch ${pickBatchId.slice(0, 8).toUpperCase()} released — ${runningLineItems} line items. Claim it to start picking.`,
      data: { route: '/wms', batchId: pickBatchId },
    },

    ...(assignedOperatorId
        ? { targetUserId: assignedOperatorId }
        : { broadcastToRole: 'operator' as const }),
  }).catch((err) => console.error('[PICK_BATCH_RELEASED_PUSH_FAILED]', err.message));

  // 6. Generate WMS barcode per order (WM-34)
  //    LSO-{8 char uppercase alphanumeric} — physical order identity
  //    from warehouse entry to ship confirmation.
  //    Generated at batch release (not claim) — orders need a barcode
  //    before the packer touches them.
  //    onConflict: ignore — idempotent if batch is re-released.
  const generateWmsBarcode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LSO-';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  };

  for (const orderId of selectedOrderIds) {
    await trx('orders')
      .where({ lasyncro_order_id: orderId, shop_id: shopId })
      .whereNull('wms_barcode')
      .update({ wms_barcode: generateWmsBarcode() });
  }

  console.info('[WMS_BARCODES_GENERATED]', {
    pick_batch_id: pickBatchId,
    order_count: selectedOrderIds.length,
  });

  // 7. Initialize warehouse status for all selected orders
  await trx('order_warehouse_status').insert(
    selectedOrderIds.map((orderId) => ({
      lasyncro_order_id: orderId,
      status: 'awaiting_pick',
      pick_batch_id: pickBatchId,
      status_updated_at: new Date(),
    }))
  ).onConflict(['lasyncro_order_id']).merge({
    status: 'awaiting_pick',
    pick_batch_id: pickBatchId,
    status_updated_at: new Date(),
    updated_at: new Date(),
  });

  // 8. Initialize line item warehouse status for all selected orders
  for (const orderId of selectedOrderIds) {
    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: orderId })
      .select('lasyncro_line_item_id', 'lasyncro_order_id');

    if (lineItems.length === 0) continue;

    await trx('order_line_item_warehouse_status').insert(
      lineItems.map((li) => ({
        lasyncro_line_item_id: li.lasyncro_line_item_id,
        lasyncro_order_id: li.lasyncro_order_id,
        shop_id: shopId,
        status: 'awaiting_pick',
        status_updated_at: new Date(),
      }))
    ).onConflict(['lasyncro_line_item_id']).merge({
      status: 'awaiting_pick',
      status_updated_at: new Date(),
      updated_at: new Date(),
    });
  }

  return {
    pick_batch_id: pickBatchId,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
    skipped_orders: skippedOrders,
  };
}