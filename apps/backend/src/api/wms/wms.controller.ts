// apps/backend/src/api/wms/wms.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { releaseBatch } from '../../services/wms/pickBatch.service.js';
import { resolveBarcode } from '../../services/wms/barcodeResolution.service.js';
import { confirmPickScan } from '../../services/wms/pickScan.service.js';
import { confirmPackScan } from '../../services/wms/packScan.service.js';
import { confirmShipment } from '../../services/wms/shipConfirmation.service.js';
import { createStowTask, claimStowTask, confirmStow } from '../../services/wms/stow.service.js';
import { writeAuditLog } from '../../services/audit/operatorAudit.service.js';
import {
  firePickExceptionAlert,
  fireStowTaskAlert,
  fireBatchReadyToPackAlert,
  fireBatchReadyToShipAlert,
} from '../../services/wms/wmsAlerts.service.js';
import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';
import { syncStowedQuantityToShopify } from '../../services/wms/shopifyInventorySync.service.js';

// ─────────────────────────────────────────
// GET /api/v1/wms/batches
// ─────────────────────────────────────────
export const httpGetBatches = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const batches = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('pick_batches')
        .where({ shop_id: shopId })
        .whereNotIn('status', ['pack_complete', 'cancelled'])
        .orderBy('released_at', 'desc')
        .select(
          'pick_batch_id',
          'status',
          'release_trigger',
          'total_line_items',
          'total_units',
          'units_picked',
          'units_packed',
          'picked_by',
          'packed_by',
          'pick_claimed_at',
          'pick_completed_at',
          'pack_claimed_at',
          'pack_completed_at',
          'released_at',
          'assigned_operator_id',
          'assigned_packer_id',
        );
    });

    return res.status(200).json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_BATCHES_FETCH_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch batches: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/batch/:batchId/line-items
// ─────────────────────────────────────────
export const httpGetBatchLineItems = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;
  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    const lineItems = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * LINE ITEMS FOR PICK SESSION
       * ----------------------------
       * Joins order_line_items → pick_batch_orders to scope to batch.
       * Pre-sorted by location_code ASC for optimal pick route
       * (operator walks A → B → C, not C → B → A).
       *
       * location_code sourced from inventory_truth if available,
       * falls back to WH-{shopId}-ROOT default.
       */
      return trx('order_line_items as oli')
        .join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'oli.lasyncro_order_id')
        .leftJoin(
          trx.raw(`
            (SELECT DISTINCT ON (lasyncro_variant_id)
              lasyncro_variant_id, location_code
             FROM inventory_truth
             WHERE shop_id = ?
               AND on_hand_quantity > 0
               AND location_code != ?
             ORDER BY lasyncro_variant_id, location_code ASC
            ) as it
          `, [shopId, `WH-${shopId}-ROOT`]),
          'it.lasyncro_variant_id',
          'oli.lasyncro_variant_id'
        )
        .leftJoin('pick_scan_log as psl', (join) => {
          join
            .on('psl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('psl.status', 'confirmed');
        })
        .where('pbo.pick_batch_id', batchId)
        .whereNull('psl.scan_id') // exclude already scanned line items
        .orderBy('it.location_code', 'asc') // optimal pick route
        .select(
          'oli.lasyncro_line_item_id',
          'oli.lasyncro_variant_id',
          'oli.lasyncro_order_id',
          'oli.sku',
          'oli.title',
          'oli.quantity',
          trx.raw(`COALESCE(it.location_code, ?) as location_code`, [`WH-${shopId}-ROOT`])
        );
    });

    return res.status(200).json({ line_items: lineItems });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_BATCH_LINE_ITEMS_FAILED]', { shopId, batchId, error: message });
    return res.status(500).json({ error: `Failed to fetch line items: ${message}` });
  }
};

/**
 * WMS CONTROLLER (WM-03)
 * -----------------------
 * Handles pick batch release, barcode resolution, and pick scan confirmation.
 *
 * All endpoints require:
 * - authenticateToken — valid JWT
 * - requireAction — action-level access control (WM-19)
 * - requireFt2 — shop must be in FT2 lifecycle
 *
 * Tenant isolation:
 * - All DB operations run inside a transaction with SET LOCAL "app.current_tenant"
 */

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/release
// ─────────────────────────────────────────
export const httpReleaseBatch = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { assigned_operator_id, assigned_packer_id } = req.body ?? {};
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return releaseBatch(
        trx,
        shopId,
        'manual',
        userId,
        assigned_operator_id ?? null,
        assigned_packer_id ?? null,
      );
    });

    if (!result) {
      return res.status(200).json({ message: 'No eligible orders available for batching' });
    }

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_BATCH_RELEASE_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Batch release failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/claim
// ─────────────────────────────────────────
export const httpClaimBatch = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;

  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const batch = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .select('status', 'picked_by')
        .first();

      if (!batch) {
        throw new Error('BATCH_NOT_FOUND');
      }

      if (batch.status === 'picking' && batch.picked_by === userId) {
        // Operator re-claiming their own batch — allow through
        return;
      }
      if (batch.status !== 'pending') {
        throw new Error(`BATCH_NOT_CLAIMABLE:${batch.status}`);
      }
      if (batch.picked_by !== null) {
        throw new Error('BATCH_ALREADY_CLAIMED');
      }

      const now = new Date();

      await trx('pick_batches')
        .where({ pick_batch_id: batchId })
        .update({
          status: 'picking',
          picked_by: userId,
          pick_claimed_at: now,
          pick_last_activity_at: now,
          updated_at: now,
        });

      // Transition all orders in batch → picking
      const batchOrders = await trx('pick_batch_orders')
        .where({ pick_batch_id: batchId })
        .select('lasyncro_order_id');

      for (const order of batchOrders) {
        await trx('order_warehouse_status')
          .insert({
            lasyncro_order_id: order.lasyncro_order_id,
            status: 'picking',
            pick_batch_id: batchId,
            status_updated_at: now,
            picked_at: null,
            packed_at: null,
            shipped_at: null,
          })
          .onConflict(['lasyncro_order_id'])
          .merge({
            status: 'picking',
            pick_batch_id: batchId,
            status_updated_at: now,
            updated_at: now,
          });

        // Transition all line items for this order → picking
        const lineItems = await trx('order_line_items')
          .where({ lasyncro_order_id: order.lasyncro_order_id })
          .select('lasyncro_line_item_id', 'lasyncro_order_id');

        for (const li of lineItems) {
          await trx('order_line_item_warehouse_status')
            .insert({
              lasyncro_line_item_id: li.lasyncro_line_item_id,
              lasyncro_order_id: li.lasyncro_order_id,
              shop_id: shopId,
              status: 'picking',
              status_updated_at: now,
            })
            .onConflict(['lasyncro_line_item_id'])
            .merge({
              status: 'picking',
              status_updated_at: now,
              updated_at: now,
            });
        }
      }

      console.info('[WMS_BATCH_CLAIMED]', {
        pick_batch_id: batchId,
        claimed_by: userId,
        shopId,
      });
      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'pick_claim',
        entityType: 'pick_batch',
        entityId: String(batchId),
        metadata: { claimed_at: now },
      });
    });

    return res.status(200).json({ pick_batch_id: batchId, status: 'picking' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'BATCH_NOT_FOUND') {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (message === 'BATCH_ALREADY_CLAIMED') {
      return res.status(409).json({ error: 'Batch already claimed by another operator' });
    }
    if (message.startsWith('BATCH_NOT_CLAIMABLE')) {
      return res.status(409).json({ error: `Batch is not in pending status: ${message.split(':')[1]}` });
    }

    console.error('[WMS_BATCH_CLAIM_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Batch claim failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/pick-complete
// ─────────────────────────────────────────
export const httpCompletePick = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  
  const batchId = String(req.params.batchId);
  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const batch = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .select('status', 'picked_by', 'total_line_items')
        .first();

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status !== 'picking') throw new Error(`BATCH_NOT_IN_PICKING:${batch.status}`);
      if (batch.picked_by !== userId) throw new Error('BATCH_NOT_OWNED_BY_OPERATOR');

      /**
       * COMPLETION GUARD
       * ----------------
       * All line items must have a confirmed scan before
       * pick_complete is allowed. Prevents partial pick acknowledgement.
       */
      const confirmedScans = await trx('pick_scan_log')
        .where({ pick_batch_id: batchId, status: 'confirmed' })
        .count<{ count: string }>('scan_id as count')
        .first();

      const scannedCount = Number(confirmedScans?.count ?? 0);

      if (scannedCount < batch.total_line_items) {
        throw new Error(
          `INCOMPLETE_PICK:${scannedCount}/${batch.total_line_items}`
        );
      }

      const now = new Date();

      await trx('pick_batches')
        .where({ pick_batch_id: batchId })
        .update({
          status: 'pick_complete',
          pick_completed_at: now,
          updated_at: now,
        });

      // Alert supervisors — batch ready for packer
      await fireBatchReadyToPackAlert(trx, { shopId, batchId, isActive: true });

      console.info('[WMS_PICK_COMPLETED]', {
        pick_batch_id: batchId,
        picked_by: userId,
        shopId,
        scannedCount,
      });
    });

    return res.status(200).json({ pick_batch_id: batchId, status: 'pick_complete' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'BATCH_NOT_FOUND') {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (message === 'BATCH_NOT_OWNED_BY_OPERATOR') {
      return res.status(403).json({ error: 'Batch not owned by this operator' });
    }
    if (message.startsWith('BATCH_NOT_IN_PICKING')) {
      return res.status(409).json({ error: `Batch is not in picking status: ${message.split(':')[1]}` });
    }
    if (message.startsWith('INCOMPLETE_PICK')) {
      const [scanned, total] = message.split(':')[1].split('/');
      return res.status(409).json({
        error: 'Not all line items have been scanned',
        scanned: Number(scanned),
        total: Number(total),
      });
    }

    console.error('[WMS_PICK_COMPLETE_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Pick complete failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/pack/claim
// ─────────────────────────────────────────
export const httpClaimPack = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;
  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const batch = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .select('status', 'packed_by')
        .first();

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status !== 'pick_complete') throw new Error(`BATCH_NOT_CLAIMABLE:${batch.status}`);
      if (batch.packed_by !== null) throw new Error('BATCH_ALREADY_CLAIMED');

      const now = new Date();

      await trx('pick_batches')
        .where({ pick_batch_id: batchId })
        .update({
          status: 'packing',
          packed_by: userId,
          pack_claimed_at: now,
          pack_last_activity_at: now,
          updated_at: now,
        });

      // Transition all orders in batch → packing
      const batchOrders = await trx('pick_batch_orders')
        .where({ pick_batch_id: batchId })
        .select('lasyncro_order_id');

      for (const order of batchOrders) {
        await trx('order_warehouse_status')
          .where({ lasyncro_order_id: order.lasyncro_order_id })
          .update({
            status: 'packing',
            status_updated_at: now,
            updated_at: now,
          });
      }

      console.info('[WMS_PACK_CLAIMED]', { pick_batch_id: batchId, packed_by: userId, shopId });
    });

    return res.status(200).json({ pick_batch_id: batchId, status: 'packing' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'BATCH_NOT_FOUND') return res.status(404).json({ error: 'Batch not found' });
    if (message === 'BATCH_ALREADY_CLAIMED') return res.status(409).json({ error: 'Batch already claimed by another packer' });
    if (message.startsWith('BATCH_NOT_CLAIMABLE')) return res.status(409).json({ error: `Batch is not in pick_complete status: ${message.split(':')[1]}` });
    console.error('[WMS_PACK_CLAIM_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Pack claim failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/batch/:batchId/orders
// ─────────────────────────────────────────
export const httpGetBatchOrders = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;
  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    const orders = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Get all orders in batch with their external order id for invoice
      const batchOrders = await trx('pick_batch_orders as pbo')
        .join('orders as o', 'o.lasyncro_order_id', 'pbo.lasyncro_order_id')
        .join('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin('order_warehouse_status as ows', 'ows.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('pbo.pick_batch_id', batchId)
        .select(
          'o.lasyncro_order_id',
          'eoim.external_order_id',
          'o.total_price',
          'o.currency',
          'ows.status as warehouse_status',
        );

      // Get line items per order
      const orderIds = batchOrders.map((o: any) => o.lasyncro_order_id);
      const lineItems = await trx('order_line_items as oli')
        .leftJoin('pack_scan_log as psl', (join) => {
          join
            .on('psl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('psl.status', 'confirmed');
        })
        .whereIn('oli.lasyncro_order_id', orderIds)
        .select(
          'oli.lasyncro_line_item_id',
          'oli.lasyncro_order_id',
          'oli.lasyncro_variant_id',
          'oli.sku',
          'oli.title',
          'oli.quantity',
          trx.raw('CASE WHEN psl.scan_id IS NOT NULL THEN true ELSE false END as pack_scanned')
        );

      // Group line items by order
      return batchOrders.map((order: any) => ({
        ...order,
        line_items: lineItems.filter((li: any) => li.lasyncro_order_id === order.lasyncro_order_id),
      }));
    });

    return res.status(200).json({ orders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_BATCH_ORDERS_FAILED]', { shopId, batchId, error: message });
    return res.status(500).json({ error: `Failed to fetch batch orders: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/pack/scan
// ─────────────────────────────────────────
export const httpConfirmPackScan = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    pick_batch_id,
    lasyncro_order_id,
    lasyncro_line_item_id,
    lasyncro_variant_id,
    quantity_confirmed,
  } = req.body;

  if (
    !pick_batch_id ||
    !lasyncro_order_id ||
    !lasyncro_line_item_id ||
    !lasyncro_variant_id ||
    typeof quantity_confirmed !== 'number' ||
    quantity_confirmed <= 0
  ) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return confirmPackScan(trx, {
        pickBatchId: pick_batch_id,
        lasyncroOrderId: lasyncro_order_id,
        lasyncroLineItemId: lasyncro_line_item_id,
        lasyncroVariantId: lasyncro_variant_id,
        quantityConfirmed: quantity_confirmed,
        scannedBy: userId,
        shopId,
      });
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_PACK_SCAN_FAILED]', { shopId, userId, error: message });
    return res.status(500).json({ error: `Pack scan failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/pack-complete
// ─────────────────────────────────────────
export const httpCompletePack = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const batchId = String(req.params.batchId);
  if (!batchId) return res.status(400).json({ error: 'batchId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const batch = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .select('status', 'packed_by', 'total_units')
        .first();

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status !== 'packing') throw new Error(`BATCH_NOT_IN_PACKING:${batch.status}`);
      if (batch.packed_by !== userId) throw new Error('BATCH_NOT_OWNED_BY_PACKER');

      const now = new Date();

      await trx('pick_batches')
        .where({ pick_batch_id: batchId })
        .update({
          status: 'pack_complete',
          pack_completed_at: now,
          updated_at: now,
        });

      // --- Usage metering (MON-11) ---
      // Count non-cancelled orders in this batch — billed at pack-complete.
      // Cancelled orders excluded: order_cancelled mid-pick generates a stow task,
      // those items never reach the customer.
      const billableOrders = await trx('pick_batch_orders as pbo')
        .join('order_fulfillment_status as ofs', 'pbo.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where({ 'pbo.pick_batch_id': batchId, 'pbo.shop_id': shopId })
        .whereNot('ofs.status', 'cancelled')
        .count<[{ count: string }]>('pbo.lasyncro_order_id as count')
        .first();

      const billableCount = parseInt(billableOrders?.count ?? '0', 10);

      if (billableCount > 0) {
        // Increment shipped_orders on the open billing period for this shop.
        // If no open period exists, log and continue — never block fulfillment for billing failures.
        const updated = await trx('shop_usage_metrics')
          .where({ shop_id: shopId })
          .whereNull('period_ends_at')
          .increment('shipped_orders', billableCount);

        if (updated === 0) {
          console.warn('[WMS_PACK_COMPLETE][USAGE] no open billing period found — shipped_orders not incremented', {
            shopId,
            batchId,
            billableCount,
          });
        } else {
          console.info('[WMS_PACK_COMPLETE][USAGE] shipped_orders incremented', {
            shopId,
            batchId,
            billableCount,
          });
        }
      }

      // Alert supervisors — batch ready to ship
      await fireBatchReadyToShipAlert(trx, { shopId, batchId, isActive: true });
      console.info('[WMS_PACK_COMPLETED]', { pick_batch_id: batchId, packed_by: userId, shopId });
    });

    return res.status(200).json({ pick_batch_id: batchId, status: 'pack_complete' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'BATCH_NOT_FOUND') return res.status(404).json({ error: 'Batch not found' });
    if (message === 'BATCH_NOT_OWNED_BY_PACKER') return res.status(403).json({ error: 'Batch not owned by this packer' });
    if (message.startsWith('BATCH_NOT_IN_PACKING')) return res.status(409).json({ error: `Batch is not in packing status: ${message.split(':')[1]}` });
    console.error('[WMS_PACK_COMPLETE_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Pack complete failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/ship
// ─────────────────────────────────────────
export const httpConfirmShipment = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;
  const { lasyncro_order_id, partial_shipment } = req.body;

  if (!batchId) return res.status(400).json({ error: 'batchId is required' });
  if (!lasyncro_order_id) return res.status(400).json({ error: 'lasyncro_order_id is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      // Verify order belongs to this batch
      const batchOrder = await trx('pick_batch_orders')
        .where({
          pick_batch_id: batchId,
          lasyncro_order_id,
        })
        .first();

      if (!batchOrder) {
        throw new Error('ORDER_NOT_IN_BATCH');
      }

      await confirmShipment(trx, {
        lasyncroOrderId: lasyncro_order_id,
        shopId,
        partialShipment: partial_shipment === true,
        shippedAt: new Date(),
      });

      console.info('[WMS_SHIPMENT_CONFIRMED]', {
        batchId,
        lasyncro_order_id,
        shopId,
        confirmedBy: userId,
        partial_shipment,
      });
    });

    return res.status(200).json({
      lasyncro_order_id,
      status: partial_shipment ? 'partially_shipped' : 'shipped',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'ORDER_NOT_IN_BATCH') {
      return res.status(404).json({ error: 'Order not found in this batch' });
    }
    console.error('[WMS_SHIPMENT_CONFIRM_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Shipment confirmation failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/stow-tasks
// ─────────────────────────────────────────
export const httpGetStowTasks = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tasks = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('stow_tasks as st')
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'st.lasyncro_variant_id')
        .where('st.shop_id', shopId)
        .whereIn('st.status', ['pending', 'in_progress'])
        .orderBy('st.created_at', 'asc')
        .select(
          'st.stow_task_id',
          'st.lasyncro_variant_id',
          'st.quantity',
          'st.location_code',
          'st.status',
          'st.trigger',
          'st.pick_batch_id',
          'st.claimed_by',
          'st.claimed_at',
          'st.created_at',
          'v.title as variant_title',
          'v.sku',
        );
    });

    return res.status(200).json({ stow_tasks: tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_STOW_TASKS_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch stow tasks: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/stow-tasks
// ─────────────────────────────────────────
export const httpCreateStowTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { lasyncro_variant_id, quantity, location_code } = req.body;

  if (!lasyncro_variant_id || typeof quantity !== 'number' || quantity <= 0 || !location_code) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  try {

    const stowTaskId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const newStowTaskId = await createStowTask(trx, {
        shopId,
        lasyncroVariantId: lasyncro_variant_id,
        quantity,
        locationCode: location_code,
        trigger: 'inbound_stock',
      });

      // Alert supervisors — stow task needs attention
      await fireStowTaskAlert(trx, {
        shopId,
        stowTaskId: newStowTaskId,
        isActive: true,
        trigger: 'inbound_stock',
      });

      return newStowTaskId;
    });

    return res.status(201).json({ stow_task_id: stowTaskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_STOW_TASK_CREATE_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to create stow task: ${message}` });
  }
};

// ISSUE-003/FEAT-004: Assigns a location to a pending stow task created without one.
// Required before an operator can claim an inbound_stock stow task (location unknown at creation).
export async function httpAssignStowLocation(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = req.params.taskId as string;
  const { location_code } = req.body;

  if (!location_code || typeof location_code !== 'string' || location_code.trim() === '') {
    return res.status(400).json({ error: 'location_code is required' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Verify location exists in this shop's warehouse
      const location = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: location_code.trim() })
        .first();
      if (!location) return res.status(404).json({ error: 'Location not found' });

      const updated = await trx('stow_tasks')
        .where({ stow_task_id: taskId, shop_id: shopId, status: 'pending' })
        .update({ location_code: location_code.trim(), updated_at: new Date() });

      if (updated === 0) throw new Error('Stow task not found or not in pending status');
    });

    console.info('[STOW_LOCATION_ASSIGNED]', { shopId, taskId, location_code });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[STOW_LOCATION_ASSIGN_FAILED]', { shopId, taskId, error: err.message });
    return res.status(500).json({ error: `Failed to assign location: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /api/v1/wms/stow-tasks/:taskId/claim
// ─────────────────────────────────────────
export const httpClaimStowTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = String(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await claimStowTask(trx, taskId, shopId, userId);
    });

    return res.status(200).json({ stow_task_id: taskId, status: 'in_progress' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('not found')) return res.status(404).json({ error: 'Stow task not found' });
    if (message.includes('already claimed')) return res.status(409).json({ error: 'Stow task already claimed' });
    if (message.includes('not claimable')) return res.status(409).json({ error: `Stow task not claimable: ${message}` });
    console.error('[WMS_STOW_CLAIM_FAILED]', { shopId, userId, taskId, error: message });
    return res.status(500).json({ error: `Stow claim failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/stow-tasks/:taskId/confirm
// ─────────────────────────────────────────
export const httpConfirmStow = async (req: Request, res: Response) => {
  const { quantity_placed } = req.body ?? {};

  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = String(req.params.taskId);
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await confirmStow(trx, {
        stowTaskId: taskId,
        shopId,
        claimedBy: userId,
        quantityPlaced: typeof quantity_placed === 'number' && quantity_placed > 0
          ? quantity_placed
          : undefined,
      });
      // Auto-resolve stow alert
      await fireStowTaskAlert(trx, {
        shopId,
        stowTaskId: taskId,
        isActive: false,
        trigger: 'inbound_stock',
      });

      // CASCADE: Rebuild inventory projection for stowed variant so
      // constraint evaluator sees updated available_quantity on next reconciliation.
      const task = await trx('stow_tasks')
        .where({ stow_task_id: taskId, shop_id: shopId })
        .select('lasyncro_variant_id')
        .first();

      if (task?.lasyncro_variant_id) {
        // NOTE: intentionally NOT rebuilding inventory projection after stow confirm.
        // Stow confirm is a location transfer only — inventory_truth is updated directly
        // by confirmStow. Rebuilding from movements would erase the location transfer
        // since no new movement is written on stow (per inventory contract INV-02).
      /*  await rebuildInventoryProjectionForVariants(
          shopId,
          [task.lasyncro_variant_id],
          trx,
          new Date()
        ); */

        // CASCADE: Enqueue reconciliation for orders constrained on this variant.
        // Constraint engine will re-evaluate inventory block and release if stock now sufficient.
        const constrainedOrders = await trx('order_constraints as oc')
          .join('orders as o', 'oc.lasyncro_order_id', 'o.lasyncro_order_id')
          .where({
            'oc.constraint_type': 'inventory',
            'oc.is_active': true,
            'oc.block_type': 'oversell',
          })
          .where('o.shop_id', shopId)
          .where('oc.target_id', task.lasyncro_variant_id)
          .select('o.lasyncro_order_id', 'o.aggregate_version');

        for (const order of constrainedOrders) {
          await trx('order_reconciliation_intents')
            .insert({
              lasyncro_order_id: order.lasyncro_order_id,
              aggregate_version: order.aggregate_version,
              created_at: new Date(),
            })
            .onConflict(['lasyncro_order_id', 'aggregate_version'])
            .ignore();
        }

        if (constrainedOrders.length > 0) {
          console.info('[STOW_CASCADE_ORDERS_QUEUED]', {
            shopId,
            taskId,
            variantId: task.lasyncro_variant_id,
            ordersQueued: constrainedOrders.length,
          });
          // CASCADE NOTE: inventory_truth updated directly by confirmStow — no rebuild needed.
        }
      }
    });

    // CASCADE: Sync stowed quantity to Shopify OUTSIDE transaction —
    // external HTTP call must not hold DB connection open.
    // Failure is logged but does not fail the stow confirmation.
    const stowedTask = await db('stow_tasks')
      .where({ stow_task_id: taskId, shop_id: shopId })
      .select('lasyncro_variant_id', 'quantity', 'location_code')
      .first();

    if (stowedTask?.lasyncro_variant_id && stowedTask?.location_code) {
      syncStowedQuantityToShopify(db as any, {
        shopId,
        lasyncroVariantId: stowedTask.lasyncro_variant_id,
        locationCode: stowedTask.location_code,
        quantityDelta: stowedTask.quantity,
      }).catch((err: Error) => {
        // Non-fatal — internal inventory_truth is source of truth.
        // Shopify sync failure is recoverable via manual reconciliation.
        console.error('[SHOPIFY_INV_SYNC_FAILED]', {
          shopId,
          taskId,
          error: err.message,
        });
      });
    }

    return res.status(200).json({ stow_task_id: taskId, status: 'completed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('not found')) return res.status(404).json({ error: 'Stow task not found' });
    if (message.includes('not in progress')) return res.status(409).json({ error: 'Stow task not in progress' });
    if (message.includes('different operator')) return res.status(403).json({ error: 'Stow task owned by different operator' });
    console.error('[WMS_STOW_CONFIRM_FAILED]', { shopId, userId, taskId, error: message });
    return res.status(500).json({ error: `Stow confirmation failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/batch/:batchId/exception
// ─────────────────────────────────────────
export const httpReportPickException = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

 const batchId = String(req.params.batchId);

  const {
    lasyncro_line_item_id,
    lasyncro_variant_id,
    exception_type,
    stage,
    quantity_required,
    quantity_found,
  } = req.body;

  const VALID_EXCEPTION_TYPES = [
    'item_missing',
    'short_pick',
    'product_defect',
    'packaging_defect',
    'order_cancelled',
    'wrong_item',
  ];

  const VALID_STAGES = ['pick', 'pack'];

  if (
    !batchId ||
    !lasyncro_line_item_id ||
    !lasyncro_variant_id ||
    !exception_type ||
    !stage ||
    typeof quantity_required !== 'number' ||
    typeof quantity_found !== 'number'
  ) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  if (!VALID_EXCEPTION_TYPES.includes(exception_type)) {
    return res.status(400).json({ error: `Invalid exception_type: ${exception_type}` });
  }

  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `Invalid stage: ${stage}` });
  }

  try {
    const exceptionId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Validate batch exists and is active
      const batch = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .select('status')
        .first();

      if (!batch) throw new Error('BATCH_NOT_FOUND');

      const ACTIVE_STATUSES = ['picking', 'pick_complete', 'packing'];
      if (!ACTIVE_STATUSES.includes(batch.status)) {
        throw new Error(`BATCH_NOT_ACTIVE:${batch.status}`);
      }

      const { randomUUID } = await import('crypto');
      const pickExceptionId = randomUUID();

      await trx('pick_exceptions').insert({
        pick_exception_id: pickExceptionId,
        shop_id: shopId,
        pick_batch_id: batchId,
        lasyncro_line_item_id,
        lasyncro_variant_id,
        exception_type,
        stage,
        quantity_required,
        quantity_found,
        raised_by: userId,
        raised_at: new Date(),
        resolved: false,
      });

      // Fire proactive alert to supervisor
      await firePickExceptionAlert(trx, {
        shopId,
        batchId,
        stage,
        exceptionType: exception_type,
      });

      console.info('[WMS_EXCEPTION_REPORTED]', {
        pick_exception_id: pickExceptionId,
        batchId,
        exception_type,
        stage,
        shopId,
        raised_by: userId,
      });

      return pickExceptionId;
    });

    return res.status(201).json({ pick_exception_id: exceptionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'BATCH_NOT_FOUND') {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (message.startsWith('BATCH_NOT_ACTIVE')) {
      return res.status(409).json({ error: `Batch is not active: ${message.split(':')[1]}` });
    }

    console.error('[WMS_EXCEPTION_REPORT_FAILED]', { shopId, userId, batchId, error: message });
    return res.status(500).json({ error: `Exception report failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/barcode/resolve
// ─────────────────────────────────────────
export const httpResolveBarcode = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { scanned_value } = req.body;

  if (!scanned_value || typeof scanned_value !== 'string') {
    return res.status(400).json({ error: 'scanned_value is required' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return resolveBarcode(trx, shopId, scanned_value);
    });

    if (!result) {
      return res.status(404).json({ error: 'No variant found for scanned value' });
    }

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_BARCODE_RESOLVE_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Barcode resolution failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/pick/scan
// ─────────────────────────────────────────
export const httpConfirmPickScan = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    pick_batch_id,
    lasyncro_line_item_id,
    lasyncro_variant_id,
    location_code,
    quantity_confirmed,
  } = req.body;

  if (
    !pick_batch_id ||
    !lasyncro_line_item_id ||
    !lasyncro_variant_id ||
    !location_code ||
    typeof quantity_confirmed !== 'number' ||
    quantity_confirmed <= 0
  ) {
    return res.status(400).json({ error: 'Missing or invalid required fields' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      return confirmPickScan(trx, {
        pickBatchId: pick_batch_id,
        lasyncroLineItemId: lasyncro_line_item_id,
        lasyncroVariantId: lasyncro_variant_id,
        locationCode: location_code,
        quantityConfirmed: quantity_confirmed,
        scannedBy: userId,
        shopId,
      });
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_PICK_SCAN_FAILED]', { shopId, userId, error: message });
    return res.status(500).json({ error: `Pick scan failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/sku-gaps
// ─────────────────────────────────────────
export const httpGetSkuGaps = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const exceptions = await trx('pick_exceptions as pe')
        .leftJoin('order_line_items as oli', 'oli.lasyncro_line_item_id', 'pe.lasyncro_line_item_id')
        .where('pe.shop_id', shopId)
        .orderBy('pe.raised_at', 'desc')
        .select(
          'pe.pick_exception_id',
          'pe.pick_batch_id',
          'pe.lasyncro_line_item_id',
          'pe.lasyncro_variant_id',
          'pe.exception_type',
          'pe.stage',
          'pe.quantity_required',
          'pe.quantity_found',
          'pe.raised_by',
          'pe.raised_at',
          'pe.resolved',
          'pe.resolved_by',
          'pe.resolved_at',
          'pe.resolution_note',
          'oli.title as variant_title',
          'oli.sku',
          trx.raw(`upper(substring(pe.pick_batch_id::text, 1, 8)) as batch_short_id`)
        );

      const totalUnresolved = exceptions.filter((e: any) => !e.resolved).length;

      return { exceptions, total_unresolved: totalUnresolved };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_SKU_GAPS_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch SKU gaps: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/sku-gaps/:exceptionId/resolve
// ─────────────────────────────────────────
export const httpResolveException = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { exceptionId } = req.params;
  const { resolution_note } = req.body;

  if (!exceptionId) return res.status(400).json({ error: 'exceptionId is required' });
  if (!resolution_note || typeof resolution_note !== 'string' || !resolution_note.trim()) {
    return res.status(400).json({ error: 'resolution_note is required' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const exception = await trx('pick_exceptions')
        .where({ pick_exception_id: exceptionId, shop_id: shopId })
        .select('resolved')
        .first();

      if (!exception) throw new Error('EXCEPTION_NOT_FOUND');
      if (exception.resolved) throw new Error('EXCEPTION_ALREADY_RESOLVED');

      await trx('pick_exceptions')
        .where({ pick_exception_id: exceptionId })
        .update({
          resolved: true,
          resolved_by: userId,
          resolved_at: new Date(),
          resolution_note: resolution_note.trim(),
          updated_at: new Date(),
        });

      console.info('[WMS_EXCEPTION_RESOLVED]', {
        pick_exception_id: exceptionId,
        resolved_by: userId,
        shopId,
      });
    });

    return res.status(200).json({ pick_exception_id: exceptionId, resolved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'EXCEPTION_NOT_FOUND') return res.status(404).json({ error: 'Exception not found' });
    if (message === 'EXCEPTION_ALREADY_RESOLVED') return res.status(409).json({ error: 'Exception already resolved' });
    console.error('[WMS_EXCEPTION_RESOLVE_FAILED]', { shopId, userId, exceptionId, error: message });
    return res.status(500).json({ error: `Failed to resolve exception: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/orders/:orderId/packing-slip
// ─────────────────────────────────────────
/**
 * PACKING SLIP URL (PP1-02)
 * -------------------------
 * Returns the Shopify packing slip URL for a fulfilled order.
 *
 * Requires:
 * - order_warehouse_status.shopify_fulfillment_id (set by writeShopifyFulfillment)
 * - external_order_identity_map.external_order_id
 * - shopify_app_installations.shop_domain
 *
 * URL format: https://{shop_domain}/admin/orders/{order_id}/fulfillments/{fulfillment_id}/packing_slips
 */
export const httpGetPackingSlipUrl = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId } = req.params;
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const row = await trx('order_warehouse_status as ows')
        .join('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'ows.lasyncro_order_id')
        .join('shopify_app_installations as sai', 'sai.shop_id', trx.raw('?', [shopId]))
        .where('ows.lasyncro_order_id', orderId)
        .where('ows.shop_id', shopId)
        .select(
          'ows.shopify_fulfillment_id',
          'eoim.external_order_id',
          'sai.shop_domain',
        )
        .first();

      return row;
    });

    if (!result) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!result.shopify_fulfillment_id) {
      return res.status(409).json({ error: 'Order not yet fulfilled — no packing slip available' });
    }

    const packingSlipUrl = `https://${result.shop_domain}/admin/orders/${result.external_order_id}/fulfillments/${result.shopify_fulfillment_id}/packing_slips`;

    return res.json({ packing_slip_url: packingSlipUrl });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_PACKING_SLIP_FAILED]', { shopId, orderId, error: message });
    return res.status(500).json({ error: `Failed to get packing slip URL: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/location/resolve
// ─────────────────────────────────────────
export const httpResolveLocation = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { scanned_value } = req.body;
  if (!scanned_value) return res.status(400).json({ error: 'scanned_value required' });

  try {
    const location = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('warehouse_locations')
        .where({ shop_id: shopId })
        .where(function () {
          this.where('barcode', scanned_value)
            .orWhere('location_code', scanned_value);
        })
        .select('location_code', 'barcode', 'type')
        .first();
    });

    if (!location) {
      return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
    }

    return res.json({ location_code: location.location_code, barcode: location.barcode, type: location.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LOCATION_RESOLVE_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to resolve location: ${message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/order-pool
// ─────────────────────────────────────────
export const httpGetOrderPool = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const rows = await trx('orders as o')
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
        .orderBy('o.order_created_at', 'asc')
        .select(
          'o.lasyncro_order_id',
          'o.total_price',
          'o.currency',
          'o.order_created_at',
        );
      return rows;
    });
    return res.json({
      eligible_order_count: result.length,
      orders: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ORDER_POOL_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch order pool: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/scan/resolve
// ─────────────────────────────────────────
// Universal scanner — resolves product, location, or order barcode
// and returns full warehouse context.
export const httpScanResolve = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { scanned_value } = req.body;
  if (!scanned_value) return res.status(400).json({ error: 'scanned_value required' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // ── 1. Try location barcode ──────────────────────────────────────────
      const location = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .where(function () {
          this.where('barcode', scanned_value).orWhere('location_code', scanned_value);
        })
        .first();

      if (location) {
        const inventory = await trx('inventory_truth as it')
          .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
          .where({ 'it.shop_id': shopId, 'it.location_code': location.location_code })
          .where('it.on_hand_quantity', '>', 0)
          .select(
            'it.lasyncro_variant_id',
            'v.title as variant_title',
            'v.sku',
            'it.on_hand_quantity',
            'it.reserved_quantity',
            'it.available_quantity',
          );

        const activeSowTasks = await trx('stow_tasks')
          .where({ shop_id: shopId, location_code: location.location_code })
          .whereIn('status', ['pending', 'in_progress'])
          .count('* as count')
          .first();

        return {
          type: 'location',
          location_code: location.location_code,
          inventory,
          total_variants: inventory.length,
          total_units: inventory.reduce((s: number, i: any) => s + i.on_hand_quantity, 0),
          pending_stow_tasks: Number(activeSowTasks?.count ?? 0),
        };
      }

      // ── 2. Try product barcode / SKU ─────────────────────────────────────
      const variantIdentity = await trx('external_product_identity_map')
        .where({ shop_id: shopId })
        .where(function () {
          this.where('barcode', scanned_value)
            .orWhere('external_sku', scanned_value);
        })
        .first();

      // Also try barcode_print_jobs (laSyncro-generated barcodes)
      const printJobMatch = !variantIdentity
        ? await trx('barcode_print_jobs')
            .where({ shop_id: shopId, barcode_value: scanned_value })
            .first()
        : null;

      const lasyncroVariantId = variantIdentity?.lasyncro_variant_id
        ?? printJobMatch?.lasyncro_variant_id;

      if (lasyncroVariantId) {
        const variant = await trx('variants')
          .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
          .select('title', 'sku', 'unit_cost')
          .first();

        // Inventory across all locations
        const inventory = await trx('inventory_truth')
          .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
          .where('on_hand_quantity', '>', 0)
          .select('location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity');

        // Active receive job
        const activeReceive = await trx('receive_job_lines as rjl')
          .join('receive_jobs as rj', 'rj.receive_job_id', 'rjl.receive_job_id')
          .where({ 'rjl.lasyncro_variant_id': lasyncroVariantId, 'rj.shop_id': shopId })
          .whereIn('rj.status', ['pending', 'in_progress', 'inspection'])
          .select('rj.receive_job_id', 'rj.status', 'rjl.quantity_expected', 'rjl.quantity_accepted', 'rjl.inspection_complete')
          .first();

        // Active pick batch
        const activePick = await trx('pick_batch_orders as pbo')
          .join('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id')
          .join('order_line_items as oli', 'oli.lasyncro_order_id', 'pbo.lasyncro_order_id')
          .where({ 'oli.lasyncro_variant_id': lasyncroVariantId, 'pb.shop_id': shopId })
          .whereIn('pb.status', ['pending', 'picking', 'pick_complete', 'packing'])
          .select('pb.pick_batch_id', 'pb.status')
          .first();

        // Active stow task
        const activeStow = await trx('stow_tasks')
          .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
          .whereIn('status', ['pending', 'in_progress'])
          .select('stow_task_id', 'status', 'location_code', 'quantity')
          .first();

        // Active exceptions
        const exceptions = await trx('pick_exceptions')
          .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
          .whereNull('resolved_at')
          .count('* as count')
          .first();

        // Derive warehouse stage
        let stage = 'unknown';
        if (activeReceive && !activeReceive.inspection_complete) stage = 'receiving';
        else if (activeReceive && activeReceive.inspection_complete) stage = 'received';
        else if (activeStow?.status === 'pending') stage = 'stow_pending';
        else if (activeStow?.status === 'in_progress') stage = 'stowing';
        else if (activePick?.status === 'pending' || activePick?.status === 'picking') stage = 'picking';
        else if (activePick?.status === 'pick_complete') stage = 'pick_complete';
        else if (activePick?.status === 'packing') stage = 'packing';
        else if (inventory.length > 0) stage = 'stowed';

        return {
          type: 'product',
          lasyncro_variant_id: lasyncroVariantId,
          variant_title: variant?.title ?? null,
          sku: variant?.sku ?? null,
          unit_cost: variant?.unit_cost ?? null,
          stage,
          inventory,
          total_on_hand: inventory.reduce((s: number, i: any) => s + i.on_hand_quantity, 0),
          total_reserved: inventory.reduce((s: number, i: any) => s + i.reserved_quantity, 0),
          total_available: inventory.reduce((s: number, i: any) => s + i.available_quantity, 0),
          active_receive: activeReceive ?? null,
          active_stow: activeStow ?? null,
          active_batch: activePick ?? null,
          open_exceptions: Number(exceptions?.count ?? 0),
        };
      }

      // ── 3. Try order external ID (invoice scan) ───────────────────────────
      const orderIdentity = await trx('external_order_identity_map')
        .where({ shop_id: shopId, external_order_id: scanned_value })
        .first();

      if (orderIdentity) {
        const order = await trx('orders as o')
          .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
          .where({ 'o.lasyncro_order_id': orderIdentity.lasyncro_order_id })
          .select('o.total_price', 'o.currency', 'o.order_created_at', 'ofs.status as fulfillment_status')
          .first();

        const lineItems = await trx('order_line_items as oli')
          .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
          .where({ 'oli.lasyncro_order_id': orderIdentity.lasyncro_order_id })
          .select('oli.title', 'oli.quantity', 'v.sku');

        const batch = await trx('pick_batch_orders as pbo')
          .join('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id')
          .where({ 'pbo.lasyncro_order_id': orderIdentity.lasyncro_order_id })
          .whereNotIn('pb.status', ['pack_complete', 'cancelled'])
          .select('pb.pick_batch_id', 'pb.status')
          .first();

        return {
          type: 'order',
          external_order_id: scanned_value,
          lasyncro_order_id: orderIdentity.lasyncro_order_id,
          fulfillment_status: order?.fulfillment_status ?? null,
          total_price: order?.total_price ?? null,
          currency: order?.currency ?? null,
          order_created_at: order?.order_created_at ?? null,
          line_items: lineItems,
          active_batch: batch ?? null,
        };
      }

      return null;
    });

    if (!result) {
      return res.status(404).json({ error: 'SCAN_NOT_RESOLVED', scanned_value });
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SCAN_RESOLVE_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Scan resolve failed: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/problem-center
// ─────────────────────────────────────────
export const httpCreateProblemTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    lasyncro_variant_id,
    quantity,
    exception_type,
    source,
    source_exception_id,
  } = req.body;

  if (!lasyncro_variant_id || !quantity || !exception_type || !source) {
    return res.status(400).json({ error: 'lasyncro_variant_id, quantity, exception_type, source required' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Atomically increment prob_label_sequence and return new value
      const seqResult = await trx.raw(`
        UPDATE shop_wms_settings
        SET prob_label_sequence = prob_label_sequence + 1,
            updated_at = NOW()
        WHERE shop_id = ?
        RETURNING prob_label_sequence, problem_bin_location
      `, [shopId]);

      const seqRow = seqResult.rows[0];
      const seqNum = seqRow.prob_label_sequence;
      const probLabel = `PROB-${shopId}-${String(seqNum).padStart(4, '0')}`;
      const problemBin = seqRow.problem_bin_location ?? `WH-${shopId}-PROBLEM`;

      // Create problem center task
      const [task] = await trx('problem_center_tasks')
        .insert({
          shop_id: shopId,
          status: 'open',
          source,
          source_exception_id: source_exception_id ?? null,
          lasyncro_variant_id,
          quantity,
          exception_type,
          problem_bin_location: problemBin,
          notes: probLabel,
        })
        .returning('*');

      // Generate PROB label print job
      await trx('barcode_print_jobs')
        .insert({
          shop_id: shopId,
          receive_job_id: null,
          lasyncro_variant_id,
          quantity,
          barcode_value: probLabel,
          status: 'pending',
          created_by: userId,
        });

      return { problem_task_id: task.problem_task_id, prob_label: probLabel, problem_bin: problemBin };
    });

    return res.status(201).json(result);
  } catch (err: any) {
    console.error('[PROBLEM_CENTER_CREATE_FAILED]', { shopId, error: err.message, stack: err.stack });
    return res.status(500).json({ error: `Failed to create problem task: ${err.message}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/problem-center
// ─────────────────────────────────────────
export const httpGetProblemTasks = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  const roles = req.user?.roles ?? [];
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tasks = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      let query = trx('problem_center_tasks as pct')
        .join('variants as v', 'v.lasyncro_variant_id', 'pct.lasyncro_variant_id')
        .where('pct.shop_id', shopId)
        .whereIn('pct.status', ['open', 'investigating'])
        .orderBy('pct.created_at', 'desc')
        .select(
          'pct.problem_task_id',
          'pct.status',
          'pct.source',
          'pct.exception_type',
          'pct.quantity',
          'pct.problem_bin_location',
          'pct.assigned_operator_id',
          'pct.claimed_by',
          'pct.notes as prob_label',
          'pct.created_at',
          'v.title as variant_title',
          'v.sku',
        );

      // Operators see pool + assigned to them only
      const isOperator = roles.includes('operator') && !roles.includes('owner') && !roles.includes('admin');
      if (isOperator) {
        query = query.where(function () {
          this.whereNull('pct.assigned_operator_id')
            .orWhere('pct.assigned_operator_id', userId);
        });
      }

      return query;
    });

    return res.json({ problem_tasks: tasks });
  } catch (err: any) {
    console.error('[PROBLEM_CENTER_FETCH_FAILED]', { shopId, error: err.message });
    return res.status(500).json({ error: `Failed to fetch problem tasks: ${err.message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/stow-tasks/:taskId/exception
// ─────────────────────────────────────────
export const httpReportStowException = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = String(req.params.taskId);
  const { exception_type, quantity, notes } = req.body;

  if (!exception_type || !quantity || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'exception_type and quantity required' });
  }

  const VALID_STOW_EXCEPTIONS = ['item_missing', 'product_defect', 'packaging_defect'];
  if (!VALID_STOW_EXCEPTIONS.includes(exception_type)) {
    return res.status(400).json({ error: `Invalid exception_type. Must be: ${VALID_STOW_EXCEPTIONS.join(', ')}` });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      const task = await trx('stow_tasks')
        .where({ stow_task_id: taskId, shop_id: shopId })
        .select('lasyncro_variant_id', 'quantity', 'location_code', 'status')
        .first();

      if (!task) throw new Error('Stow task not found');

      const affectedQty = Math.min(quantity, task.quantity);
      const movementType = exception_type === 'item_missing' ? 'shrinkage' : 'damage';
      const locationCode = task.location_code ?? `WH-${shopId}-ROOT`;

      // Write inventory movement (shrinkage or damage)
      const movementId = crypto.randomUUID();
      const deviceEventId = crypto.randomUUID();

      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: movementId,
        lasyncro_variant_id: task.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: movementType,
        quantity_delta: -affectedQty,
        location_code: locationCode,
        reference_type: 'stow_task',
        reference_id: taskId,
        platform: 'wms',
        occurred_at: new Date(),
        device_event_id: deviceEventId,
      }).onConflict(['device_event_id']).ignore();

      // Decrement inventory_truth
      await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: task.lasyncro_variant_id, location_code: locationCode })
        .update({
          on_hand_quantity: trx.raw('GREATEST(0, on_hand_quantity - ?)', [affectedQty]),
          available_quantity: trx.raw('GREATEST(0, available_quantity - ?)', [affectedQty]),
          sellable_quantity: trx.raw('GREATEST(0, sellable_quantity - ?)', [affectedQty]),
          updated_at: new Date(),
        });

      // Create problem center task
      const seqResult = await trx.raw(`
        UPDATE shop_wms_settings
        SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
        WHERE shop_id = ?
        RETURNING prob_label_sequence, problem_bin_location
      `, [shopId]);

      const seqRow = seqResult.rows[0];
      const probLabel = `PROB-${shopId}-${String(seqRow.prob_label_sequence).padStart(4, '0')}`;
      const problemBin = seqRow.problem_bin_location ?? `WH-${shopId}-PROBLEM`;

      await trx('problem_center_tasks').insert({
        shop_id: shopId,
        status: 'open',
        source: 'stow',
        source_exception_id: taskId,
        lasyncro_variant_id: task.lasyncro_variant_id,
        quantity: affectedQty,
        exception_type,
        problem_bin_location: problemBin,
        notes: probLabel,
      });

      // Write audit log
      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'stow_exception',
        entityType: 'stow_task',
        entityId: taskId,
        metadata: { exception_type, quantity: affectedQty, movement_type: movementType, prob_label: probLabel },
      });

      return { prob_label: probLabel, problem_bin: problemBin, movement_type: movementType };
    });

    console.info('[STOW_EXCEPTION_REPORTED]', { shopId, taskId, exception_type, quantity });
    return res.status(201).json(result);
  } catch (err: any) {
    console.error('[STOW_EXCEPTION_FAILED]', { shopId, taskId, error: err.message });
    return res.status(500).json({ error: `Stow exception failed: ${err.message}` });
  }
};