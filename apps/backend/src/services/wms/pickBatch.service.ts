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

export interface ReleaseBatchResult {
  pick_batch_id: string;
  order_count: number;
  total_line_items: number;
  total_units: number;
}

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
   */
  priorityOrderIds?: string[],
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
  //    Sort: priority-flagged first, then oldest-first within each group.
  const eligibleOrders = await trx('orders as o')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
    .whereNotExists(
      trx('order_constraints as oc')
        .where('oc.lasyncro_order_id', trx.raw('o.lasyncro_order_id'))
        .where('oc.is_active', true)
        .select(1)
    )
    .where('o.shop_id', shopId)
    .whereIn('ofs.status', ['pending', 'processing'])
    .whereNull('pbo.lasyncro_order_id')
    .select('o.lasyncro_order_id', 'ofs.is_priority_flagged')
    .orderByRaw('ofs.is_priority_flagged DESC, o.order_created_at ASC');

  if (eligibleOrders.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No eligible orders found', { shopId });
    return null;
  }

  // 3. Build ordered candidate list:
  //    a) Owner-selected priority orders (priorityOrderIds) — validated against pool
  //    b) Pool priority-flagged orders not already selected
  //    c) Remaining pool orders oldest-first
  const eligibleSet = new Set(eligibleOrders.map(o => o.lasyncro_order_id));
  const validPriorityIds = (priorityOrderIds ?? []).filter(id => eligibleSet.has(id));
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

  for (const orderId of candidateIds) {
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

  // 6. Initialize warehouse status for all selected orders
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

  // 7. Initialize line item warehouse status for all selected orders
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
  };
}