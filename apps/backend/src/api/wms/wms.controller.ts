// apps/backend/src/api/wms/wms.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { releaseBatch } from '../../services/wms/pickBatch.service.js';
import { resolveBarcode } from '../../services/wms/barcodeResolution.service.js';
import { confirmPickScan } from '../../services/wms/pickScan.service.js';
import { confirmPackScan } from '../../services/wms/packScan.service.js';
import { confirmShipment } from '../../services/wms/shipConfirmation.service.js';
import { createStowTask, claimStowTask, confirmStow } from '../../services/wms/stow.service.js';
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
          'released_at'
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
        .leftJoin('inventory_truth as it', (join) => {
          join
            .on('it.lasyncro_variant_id', 'oli.lasyncro_variant_id')
            .andOn('it.shop_id', trx.raw('?', [shopId]));
        })
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
          trx.raw(`COALESCE(it.location_code, 'WH-${shopId}-ROOT') as location_code`)
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
 * - requireRole — role-based access (temporary until WM-19)
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
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return releaseBatch(trx, shopId, 'manual', userId);
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
        await rebuildInventoryProjectionForVariants(
          shopId,
          [task.lasyncro_variant_id],
          trx,
          new Date()
        );

        // CASCADE: Enqueue reconciliation for orders constrained on this variant.
        // Constraint engine will re-evaluate inventory block and release if stock now sufficient.
        const constrainedOrders = await trx('order_constraints as oc')
          .join('orders as o', 'oc.lasyncro_order_id', 'o.lasyncro_order_id')
          .where({
            'oc.shop_id': shopId,
            'oc.constraint_type': 'inventory',
            'oc.is_active': true,
            'oc.block_type': 'oversell',
          })
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
          // CASCADE NOTE: Cash flow projection (computeCashFlowProjection) is live-computed
          // from inventory_truth × variants.unit_cost. The inventory rebuild above is sufficient
          // to refresh the 60-day projection on next read — no explicit write required.
          // Pre-condition: variants.unit_cost must be populated for COGS to appear in projection.
          
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