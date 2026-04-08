// apps/backend/src/services/wms/pickBatch.service.ts
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

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
  releasedBy: number | null
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

  // 2. Find eligible orders — pending/processing, not already batched
  const eligibleOrders = await trx('orders as o')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .whereIn('ofs.status', ['pending', 'processing'])
    .whereNull('pbo.lasyncro_order_id') // not already in any batch
    .select(
      'o.lasyncro_order_id',
    )
    .orderBy('o.order_created_at', 'asc'); // oldest first

  if (eligibleOrders.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No eligible orders found', { shopId });
    return null;
  }

  // 3. Greedily select full orders up to max_batch_line_items ceiling
  const selectedOrderIds: string[] = [];
  let runningLineItems = 0;
  let runningUnits = 0;

  for (const order of eligibleOrders) {
    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: order.lasyncro_order_id })
      .select('lasyncro_line_item_id', 'quantity');

    const orderLineCount = lineItems.length;
    const orderUnitCount = lineItems.reduce((sum, li) => sum + Number(li.quantity), 0);

    // Full order must fit within remaining ceiling
    if (runningLineItems + orderLineCount > maxLineItems) {
      // If no orders selected yet and single order exceeds ceiling,
      // include it anyway to prevent starvation
      if (selectedOrderIds.length === 0) {
        selectedOrderIds.push(order.lasyncro_order_id);
        runningLineItems += orderLineCount;
        runningUnits += orderUnitCount;
      }
      break;
    }

    selectedOrderIds.push(order.lasyncro_order_id);
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
  });

  // 5. Assign orders to batch
  await trx('pick_batch_orders').insert(
    selectedOrderIds.map((orderId) => ({
      pick_batch_id: pickBatchId,
      lasyncro_order_id: orderId,
      shop_id: shopId,
    }))
  );

  console.info('[PICK_BATCH_RELEASED]', {
    pick_batch_id: pickBatchId,
    shopId,
    trigger,
    releasedBy,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
  });

  return {
    pick_batch_id: pickBatchId,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
  };
}