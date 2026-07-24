// apps/backend/src/api/wms/wms.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { getErrorMessage } from '@lasyncro/backend-core';
import { releaseBatch } from '../../services/wms/pickBatch.service.js';
import { resolveBarcode } from '../../services/wms/barcodeResolution.service.js';
import { generateUnitLabelsForLine } from '../../services/wms/unitLabelPdf.service.js';
import { computeCoverage } from '../../services/wms/inventoryUnit.service.js';
import { confirmPickScan } from '../../services/wms/pickScan.service.js';
import { confirmPackScan } from '../../services/wms/packScan.service.js';
import { confirmShipment } from '../../services/wms/shipConfirmation.service.js';
import { createStowTask, claimStowTask, confirmStow } from '../../services/wms/stow.service.js';
import { writeAuditLog } from '../../services/audit/operatorAudit.service.js';
import { reportShippedOrderOverage } from '../billing/stripe.meter.service.js';
import {
  firePickExceptionAlert,
  fireStowTaskAlert,
  fireStowExceptionAlert,
  fireBatchReadyToPackAlert,
  fireBatchReadyToShipAlert,
} from '../../services/wms/wmsAlerts.service.js';
import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';
import { generateInvoicePdf } from '../../services/wms/invoicePdf.service.js';
import { syncStowedQuantityToShopify } from '../../services/wms/shopifyInventorySync.service.js';
import {
  raisePackDecisionRequest,
  getPackDecisionRequest,
  resolvePackDecisionRequest,
} from '../../services/wms/packDecision.service.js';
import { encrypt } from '../../security/encryption.service.js';
import { generateAndPersistLabel } from '../../services/wms/carrierLabel.service.js';
import { resolveOrCreateReturnJobForScan } from '../../services/returns/returnJobs.service.js';
import { getOrRotateOpenUsagePeriod } from '../../api/billing/usagePeriod.service.js';
// ─────────────────────────────────────────
// GET /api/v1/wms/batches
// ─────────────────────────────────────────
export const httpGetBatches = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const batches = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('pick_batches as pb')
        .where({ 'pb.shop_id': shopId })
        .whereNotIn('pb.status', ['pack_complete', 'cancelled'])
        .leftJoin('users as upick', 'upick.id', 'pb.picked_by')
        .leftJoin('users as upack', 'upack.id', 'pb.packed_by')
        .orderBy('pb.released_at', 'desc')
        .select(
          'pb.pick_batch_id',
          'pb.status',
          'pb.release_trigger',
          'pb.total_line_items',
          'pb.total_units',
          'pb.units_picked',
          'pb.units_packed',
          'pb.picked_by',
          'pb.packed_by',
          'pb.pick_claimed_at',
          'pb.pick_completed_at',
          'pb.pack_claimed_at',
          'pb.pack_completed_at',
          'pb.released_at',
          'pb.assigned_operator_id',
          'pb.assigned_packer_id',
          trx.raw(`COALESCE(upick.first_name || ' ' || COALESCE(upick.last_name, ''), upick.email) as picker_name`),
          trx.raw(`COALESCE(upack.first_name || ' ' || COALESCE(upack.last_name, ''), upack.email) as packer_name`),
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
        .leftJoin('products as p', 'p.lasyncro_product_id', 'oli.lasyncro_product_id')
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
        .leftJoin(
          trx.raw(`
            (SELECT
              lasyncro_variant_id,
              array_agg(lasyncro_unit_id ORDER BY received_at) FILTER (WHERE status = 'stowed') AS unit_ids,
              MAX(current_location_code) FILTER (WHERE status = 'stowed') AS unit_location_code
             FROM inventory_units
             WHERE shop_id = ?
             GROUP BY lasyncro_variant_id
            ) as iu
          `, [shopId]),
          'iu.lasyncro_variant_id',
          'oli.lasyncro_variant_id'
        )
        .leftJoin('pick_scan_log as psl', (join) => {
          join
            .on('psl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('psl.status', 'confirmed');
        })
        /*
         * SPATIAL PICK ROUTE SORT (A4)
         * -----------------------------
         * Join warehouse_locations to get physical coordinates.
         * Sort by position_x/y ASC — operator walks shortest physical path.
         * COALESCE to 9999 pushes unpositioned items to end of route.
         * Fallback tiebreaker: location_code ASC.
         *
         * Replaces alphabetical location_code sort which caused zigzag routes.
         * At 100 picks/day saves ~15-20 min/operator — see OrderPool.md.
         */
        .leftJoin('warehouse_locations as wl', (join) => {
          join
            .on('wl.location_code', trx.raw(`COALESCE(it.location_code, ?)`,[`WH-${shopId}-ROOT`]))
            .andOnVal('wl.shop_id', shopId);
        })
        .where('pbo.pick_batch_id', batchId)
        .whereNull('psl.scan_id') // exclude already scanned line items
        .orderByRaw(`
          COALESCE(wl.position_x, 9999) ASC,
          COALESCE(wl.position_y, 9999) ASC,
          COALESCE(it.location_code, '') ASC
        `)
        .select(
          'oli.lasyncro_line_item_id',
          'oli.lasyncro_variant_id',
          'oli.lasyncro_order_id',
          'oli.sku',
          trx.raw(`COALESCE(p.title, 'Unknown product') as product_title`),
          'v.title as variant_title',
          'oli.quantity',
          'v.image_url',
          trx.raw(`
            COALESCE(
              iu.unit_location_code,
              it.location_code,
              ?
            ) as location_code
          `, [`WH-${shopId}-ROOT`]),
          'iu.unit_ids',
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
    const { assigned_operator_id, assigned_packer_id, priority_order_ids, exclusive } = req.body ?? {};
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return releaseBatch(
        trx,
        shopId,
        'manual',
        userId,
        assigned_operator_id ?? null,
        assigned_packer_id ?? null,
        Array.isArray(priority_order_ids) ? priority_order_ids : undefined,
        exclusive === true,
      );
    });

     if (!result) {
      return res.status(200).json({ message: 'No eligible orders available for batching' });
    }

    // T1 — onboarding activation audit: first wave released.
    //    — tenant context required for RLS on activation_audit_events.
    // Fire-and-forget — audit failure must never block the batch release.
    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('activation_audit_events').insert({
        event_id:    crypto.randomUUID(),
        event_type:  'wave_released',
        shop_id:     shopId,
        user_id:     userId,
        occurred_at: new Date(),
        payload:     JSON.stringify({ schema: 'activation_audit.v1', event: 'wave_released', occurredAt: new Date().toISOString() }),
      });
    }).catch((err: unknown) => console.error('[ACTIVATION_AUDIT] wave_released failed', err));

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
       * Count exceptions as a confirmed pick towards total picked items.
       */
      const confirmedScans = await trx('pick_scan_log')
        .where({ pick_batch_id: batchId, status: 'confirmed' })
        .count<{ count: string }>('scan_id as count')
        .first();
      const scannedCount = Number(confirmedScans?.count ?? 0);

      // Exceptions count as resolved line items — operator deliberately skipped them
      const exceptionCount = await trx('pick_exceptions')
        .where({ pick_batch_id: batchId })
        .countDistinct<{ count: string }>('lasyncro_line_item_id as count')
        .first();
      const resolvedCount = scannedCount + Number(exceptionCount?.count ?? 0);

      if (resolvedCount < batch.total_line_items) {
        throw new Error(
          `INCOMPLETE_PICK:${resolvedCount}/${batch.total_line_items}`
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

      // Advance order_warehouse_status → picked for all orders in this batch
      await trx('order_warehouse_status')
        .whereIn(
          'lasyncro_order_id',
          trx('pick_batch_orders')
            .where({ pick_batch_id: batchId })
            .select('lasyncro_order_id')
        )
        .where({ status: 'picking' })
        .update({
          status:             'picked',
          picked_at:          now,
          status_updated_at:  now,
          updated_at:         now,
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

      // Insert invoice print jobs per order (WM-34)
      // One pending job per order — updated to 'printed' when packer
      // calls GET /orders/:orderId/invoice. Idempotent via onConflict ignore.
      for (const order of batchOrders) {
        const orderRow = await trx('orders')
          .where({ lasyncro_order_id: order.lasyncro_order_id, shop_id: shopId })
          .select('wms_barcode')
          .first();

        if (orderRow?.wms_barcode) {
          await trx('barcode_print_jobs')
            .insert({
              shop_id: shopId,
              lasyncro_order_id: order.lasyncro_order_id,
              lasyncro_variant_id: null,
              quantity: 1,
              barcode_value: orderRow.wms_barcode,
              label_type: 'invoice',
              status: 'pending',
              created_by: userId,
            })
            .onConflict(
              db.raw('(shop_id, lasyncro_order_id) WHERE label_type = \'invoice\'')
            )
            .ignore();
        }
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
        .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin('order_warehouse_status as ows', 'ows.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('pbo.pick_batch_id', batchId)
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.wms_barcode',
          'o.total_price',
          'o.currency',
          'ows.status as warehouse_status',
        );

      // Get line items per order
      const orderIds = batchOrders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
      const lineItems = await trx('order_line_items as oli')
        .leftJoin('products as p', 'p.lasyncro_product_id', 'oli.lasyncro_product_id')
        .leftJoin('pack_scan_log as psl', (join) => {
          join
            .on('psl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('psl.status', 'confirmed');
        })
        .leftJoin('pick_scan_log as pskl', (join) => {
          join
            .on('pskl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('pskl.status', 'confirmed');
        })
        .whereIn('oli.lasyncro_order_id', orderIds)
        .select(
          'oli.lasyncro_line_item_id',
          'oli.lasyncro_order_id',
          'oli.lasyncro_variant_id',
          'oli.sku',
          trx.raw(`COALESCE(p.title, 'Unknown product') as product_title`),
          trx.raw(`oli.title as variant_title`),
          'oli.quantity',
          trx.raw('CASE WHEN psl.scan_id IS NOT NULL THEN true ELSE false END as pack_scanned'),
          trx.raw('CASE WHEN pskl.lasyncro_unit_id IS NOT NULL THEN true ELSE false END as has_tracked_unit')
        );

      // Group line items by order
      return batchOrders.map((order: { lasyncro_order_id: string }) => ({
        ...order,
        line_items: lineItems.filter((li: { lasyncro_order_id: string }) => li.lasyncro_order_id === order.lasyncro_order_id),
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
// GET /api/v1/wms/batches/ready-to-pack
// ─────────────────────────────────────────
// Aggregate version of httpGetBatchOrders above — every order sitting in a
// pick_complete batch (picked, no pack claim yet), with the LSU- unit
// barcode to scan per line item. Powers the "X orders ready to be packed"
// summary + expandable list in WMS Operations. Previously there was no
// way to see which barcodes belonged to a ready batch without already
// being mid pack-session — see wms_qa_findings_2026_07_24.md.
export const httpGetReadyToPack = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const orders = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const batchOrders = await trx('pick_batches as pb')
        .join('pick_batch_orders as pbo', 'pbo.pick_batch_id', 'pb.pick_batch_id')
        .join('orders as o', 'o.lasyncro_order_id', 'pbo.lasyncro_order_id')
        .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('pb.shop_id', shopId)
        .where('pb.status', 'pick_complete')
        .select(
          'pb.pick_batch_id',
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.wms_barcode',
        );

      const orderIds = batchOrders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
      if (orderIds.length === 0) return [];

      const lineItems = await trx('order_line_items as oli')
        .leftJoin('products as p', 'p.lasyncro_product_id', 'oli.lasyncro_product_id')
        .leftJoin('pick_scan_log as pskl', (join) => {
          join
            .on('pskl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
            .andOnVal('pskl.status', 'confirmed');
        })
        .whereIn('oli.lasyncro_order_id', orderIds)
        .select(
          'oli.lasyncro_line_item_id',
          'oli.lasyncro_order_id',
          'oli.sku',
          trx.raw(`COALESCE(p.title, 'Unknown product') as product_title`),
          trx.raw(`oli.title as variant_title`),
          'oli.quantity',
          'pskl.lasyncro_unit_id as unit_barcode'
        );

      return batchOrders.map((order: { lasyncro_order_id: string }) => ({
        ...order,
        line_items: lineItems.filter((li: { lasyncro_order_id: string }) => li.lasyncro_order_id === order.lasyncro_order_id),
      }));
    });

    return res.status(200).json({ orderCount: orders.length, orders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_READY_TO_PACK_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch ready-to-pack orders: ${message}` });
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

// POST /api/v1/wms/pack/free-scan
// ─────────────────────────────────────────
// WEB-PACK-02 — item-centric free-scan pack surface.
//
// Routes by barcode prefix:
//   LSU- → resolve unit → auto-claim batch → confirm pack scan → return order context
//   LSO- → verify all siblings confirmed → ship → auto-complete batch if last order
//
// Sad paths return { error, message } with appropriate HTTP status.
// Auto-claim fires inline on the first LSU- scan for a pick_complete batch.
export const httpPackFreeScan = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { scanned_value } = req.body;
  if (!scanned_value || typeof scanned_value !== 'string') {
    return res.status(400).json({ error: 'scanned_value required' });
  }

  // ── LSO- path — invoice barcode → ship confirmation ───────────────────────
  if (scanned_value.startsWith('LSO-')) {
    try {
      const result = await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

        const order = await trx('orders as o')
          .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
          .where({ 'o.shop_id': shopId, 'o.wms_barcode': scanned_value })
          .select('o.lasyncro_order_id', 'eim.external_order_id')
          .first();

        if (!order) return { error: 'invoice_not_found', message: 'Invoice barcode not recognised' };

        const batchOrder = await trx('pick_batch_orders as pbo')
          .join('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id')
          .where({ 'pbo.lasyncro_order_id': order.lasyncro_order_id, 'pb.shop_id': shopId, 'pb.status': 'packing' })
          .select('pb.pick_batch_id')
          .first();

        if (!batchOrder) {
          // No active packing batch — check if this order already shipped
          // entirely, which means the invoice scan is a return, not an error.
          const shipStatus = await trx('order_warehouse_status')
            .where({ lasyncro_order_id: order.lasyncro_order_id })
            .select('status')
            .first();
          if (shipStatus?.status === 'shipped' || shipStatus?.status === 'partially_shipped') {
            const jobResult = await resolveOrCreateReturnJobForScan(shopId, order.lasyncro_order_id, userId);
            return { type: 'return', lasyncro_order_id: order.lasyncro_order_id, ...jobResult };
          }
          return { error: 'batch_not_packing', message: 'No active packing batch found for this order' };
        }

        // All line items must be confirmed before shipping
        const [totalRow, confirmedRow] = await Promise.all([
          trx('order_line_items')
            .where({ lasyncro_order_id: order.lasyncro_order_id })
            .count<{ count: string }>('lasyncro_line_item_id as count')
            .first(),
          trx('pack_scan_log')
            .where({ pick_batch_id: batchOrder.pick_batch_id, lasyncro_order_id: order.lasyncro_order_id, status: 'confirmed' })
            .count<{ count: string }>('scan_id as count')
            .first(),
        ]);

        const total = Number(totalRow?.count ?? 0);
        const confirmed = Number(confirmedRow?.count ?? 0);

        if (confirmed < total) {
          return {
            error: 'siblings_incomplete',
            message: 'Not all items in this order have been scanned',
            confirmed,
            total,
          };
        }

        const packedAt = new Date();

        // The invoice scan closes the physical parcel; carrier handoff ships it later.
        await trx('order_warehouse_status')
          .where({ lasyncro_order_id: order.lasyncro_order_id })
          .update({
            status: 'packed',
            packed_at: packedAt,
            status_updated_at: packedAt,
            updated_at: packedAt,
          });

        // Complete the pack batch only after every order has had its invoice scanned.
        const unpackedCount = await trx('order_warehouse_status as ows')
          .join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'ows.lasyncro_order_id')
          .where({ 'pbo.pick_batch_id': batchOrder.pick_batch_id })
          .whereNotIn('ows.status', ['packed', 'shipped', 'partially_shipped'])
          .count<{ count: string }>('ows.lasyncro_order_id as count')
          .first();

        const batchComplete = Number(unpackedCount?.count ?? 0) === 0;

        if (batchComplete) {
          await trx('pick_batches')
            .where({ pick_batch_id: batchOrder.pick_batch_id })
            .update({
              status: 'pack_complete',
              pack_completed_at: packedAt,
              updated_at: packedAt,
            });

          console.info('[WMS_FREE_SCAN_BATCH_PACK_COMPLETE]', {
            pick_batch_id: batchOrder.pick_batch_id,
            shopId,
          });
        }

        console.info('[WMS_FREE_SCAN_PACKED]', {
          lasyncro_order_id: order.lasyncro_order_id,
          pick_batch_id: batchOrder.pick_batch_id,
          batch_complete: batchComplete,
          shopId,
          userId,
        });

        return {
          type: 'packed',
          lasyncro_order_id: order.lasyncro_order_id,
          external_order_id: order.external_order_id,
          pick_batch_id: batchOrder.pick_batch_id,
          batch_complete: batchComplete,
        };
      });

      if ('error' in result) {
        const statusMap: Record<string, number> = {
          invoice_not_found: 404,
          batch_not_packing: 409,
          siblings_incomplete: 409,
        };
        return res.status(statusMap[result.error as string] ?? 500).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WMS_FREE_SCAN_LSO_FAILED]', { shopId, userId, scanned_value, error: message });
      return res.status(500).json({ error: `Invoice scan failed: ${message}` });
    }
  }

  // ── LSU- path — unit barcode → resolve + auto-claim + confirm pack scan ────
  if (scanned_value.startsWith('LSU-')) {
    try {
      const result = await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

        // 1. Resolve unit
        const unit = await trx('inventory_units')
          .where({ shop_id: shopId, lasyncro_unit_id: scanned_value })
          .select('lasyncro_unit_id', 'lasyncro_variant_id', 'status')
          .first();

        if (!unit) return { error: 'unit_not_found', message: 'Unit barcode not recognised' };
        if (unit.status === 'shipped') {
          // Already left the building — this scan is a return, not a
          // duplicate pack. Fold into the same free-scan surface rather
          // than sending the operator to a separate screen.
          const pickLogForReturn = await trx('pick_scan_log')
            .where({ shop_id: shopId, lasyncro_unit_id: scanned_value, status: 'confirmed' })
            .select('lasyncro_line_item_id')
            .first();
          const lineItemForReturn = pickLogForReturn
            ? await trx('order_line_items')
                .where({ lasyncro_line_item_id: pickLogForReturn.lasyncro_line_item_id })
                .select('lasyncro_order_id')
                .first()
            : null;
          if (!lineItemForReturn) {
            return { error: 'return_order_unresolved', message: 'Item is shipped but its order could not be resolved for return intake' };
          }
          const jobResult = await resolveOrCreateReturnJobForScan(shopId, lineItemForReturn.lasyncro_order_id, userId);
          return { type: 'return', lasyncro_order_id: lineItemForReturn.lasyncro_order_id, ...jobResult };
        }
        if (unit.status === 'packed') {
          return { error: 'already_packed', message: 'Unit is already packed' };
        }
        if (unit.status !== 'picked') {
          return { error: 'not_picked', message: `Unit cannot be packed — current status: ${unit.status}` };
        }

        // 2. Find confirmed pick record → lasyncro_line_item_id + pick_batch_id
        const pickLog = await trx('pick_scan_log')
          .where({ shop_id: shopId, lasyncro_unit_id: scanned_value, status: 'confirmed' })
          .select('lasyncro_line_item_id', 'pick_batch_id')
          .first();

        if (!pickLog) {
          return { error: 'no_pick_record', message: 'No confirmed pick record found for this unit' };
        }

        // 3. Verify batch is packable
        const batch = await trx('pick_batches')
          .where({ pick_batch_id: pickLog.pick_batch_id, shop_id: shopId })
          .select('status', 'packed_by')
          .first();

        if (!batch) return { error: 'batch_not_found', message: 'Pick batch not found' };
        if (!['pick_complete', 'packing'].includes(batch.status)) {
          return { error: 'batch_not_ready', message: `Batch not ready for packing — status: ${batch.status}` };
        }

        // 4. Resolve lasyncro_order_id from line item
        const lineItemRow = await trx('order_line_items')
          .where({ lasyncro_line_item_id: pickLog.lasyncro_line_item_id })
          .select('lasyncro_order_id')
          .first();

        if (!lineItemRow) return { error: 'line_item_not_found', message: 'Line item not found' };
        const lasyncroOrderId: string = lineItemRow.lasyncro_order_id;

        // 5. Auto-claim batch on first LSU- scan (batch was pick_complete)
        const now = new Date();
        const autoClaimed = batch.status === 'pick_complete';

        if (autoClaimed) {
          await trx('pick_batches')
            .where({ pick_batch_id: pickLog.pick_batch_id })
            .update({
              status: 'packing',
              packed_by: userId,
              pack_claimed_at: now,
              pack_last_activity_at: now,
              updated_at: now,
            });

          const batchOrders = await trx('pick_batch_orders')
            .where({ pick_batch_id: pickLog.pick_batch_id })
            .select('lasyncro_order_id');

          for (const o of batchOrders) {
            await trx('order_warehouse_status')
              .where({ lasyncro_order_id: o.lasyncro_order_id })
              .update({ status: 'packing', status_updated_at: now, updated_at: now });

            const orderRow = await trx('orders')
              .where({ lasyncro_order_id: o.lasyncro_order_id, shop_id: shopId })
              .select('wms_barcode')
              .first();

            if (orderRow?.wms_barcode) {
              await trx('barcode_print_jobs')
                .insert({
                  shop_id: shopId,
                  lasyncro_order_id: o.lasyncro_order_id,
                  lasyncro_variant_id: null,
                  quantity: 1,
                  barcode_value: orderRow.wms_barcode,
                  label_type: 'invoice',
                  status: 'pending',
                  created_by: userId,
                })
                .onConflict(db.raw(`(shop_id, lasyncro_order_id) WHERE label_type = 'invoice'`))
                .ignore();
            }
          }

          console.info('[WMS_FREE_SCAN_BATCH_AUTOCLAIMED]', {
            pick_batch_id: pickLog.pick_batch_id,
            userId,
            shopId,
          });
        }

        // 6. Confirm pack scan for this unit
        const packScanResult = await confirmPackScan(trx, {
          pickBatchId: pickLog.pick_batch_id,
          lasyncroOrderId,
          lasyncroLineItemId: pickLog.lasyncro_line_item_id,
          lasyncroVariantId: unit.lasyncro_variant_id,
          lasyncroUnitId: unit.lasyncro_unit_id,
          quantityConfirmed: 1,
          scannedBy: userId,
          shopId,
        });

        // 7. Fetch variant + order + all line items with pack scan status
        const [variant, order, lineItems, trackingRow] = await Promise.all([
          trx('variants')
            .where({ lasyncro_variant_id: unit.lasyncro_variant_id, shop_id: shopId })
            .select('title as variant_title', 'sku', 'image_url')
            .first(),

          trx('orders as o')
            .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
            .where({ 'o.lasyncro_order_id': lasyncroOrderId, 'o.shop_id': shopId })
            .select(
              'o.lasyncro_order_id',
              'eim.external_order_id',
              'o.wms_barcode',
              'o.total_price',
              'o.currency',
              'o.shipping_name',
              'o.shipping_address1',
              'o.shipping_city',
              'o.shipping_zip',
              'o.shipping_country_code',
            )
            .first(),

          trx('order_line_items as oli')
            .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
            .leftJoin('pack_scan_log as psl', function () {
              this.on('psl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
                .andOn('psl.pick_batch_id', trx.raw('?', [pickLog.pick_batch_id]))
                .andOnVal('psl.status', 'confirmed');
            })
            .leftJoin('pick_scan_log as pskl', function () {
              this.on('pskl.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
                .andOn('pskl.pick_batch_id', trx.raw('?', [pickLog.pick_batch_id]))
                .andOnVal('pskl.status', 'confirmed');
            })
            .where({ 'oli.lasyncro_order_id': lasyncroOrderId })
            .select(
              'oli.lasyncro_line_item_id',
              'oli.lasyncro_variant_id',
              'oli.title as product_title',
              'oli.quantity',
              'v.image_url',
              'v.sku',
              trx.raw(`(psl.scan_id IS NOT NULL) as pack_scanned`),
              trx.raw(`(pskl.lasyncro_unit_id IS NOT NULL) as has_tracked_unit`),
            ),

          trx('order_shipment_tracking')
            .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
            .select('id')
            .first(),
        ]);

        console.info('[WMS_FREE_SCAN_UNIT_CONFIRMED]', {
          lasyncro_unit_id: unit.lasyncro_unit_id,
          lasyncro_order_id: lasyncroOrderId,
          pick_batch_id: pickLog.pick_batch_id,
          order_complete: packScanResult.order_complete,
          shopId,
          userId,
        });

        return {
          type: 'unit_resolved',
          pick_batch_id: pickLog.pick_batch_id,
          lasyncro_unit_id: unit.lasyncro_unit_id,
          lasyncro_order_id: lasyncroOrderId,
          order_complete: packScanResult.order_complete,
          auto_claimed: autoClaimed,
          has_carrier_label: !!trackingRow,
          variant,
          order,
          line_items: lineItems,
        };
      });

      if ('error' in result) {
        const statusMap: Record<string, number> = {
          unit_not_found: 404,
          not_picked: 409,
          already_packed: 409,
          no_pick_record: 409,
          batch_not_found: 404,
          batch_not_ready: 409,
          line_item_not_found: 500,
        };
        return res.status(statusMap[result.error as string] ?? 500).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WMS_FREE_SCAN_LSU_FAILED]', { shopId, userId, scanned_value, error: message });
      return res.status(500).json({ error: `Unit scan failed: ${message}` });
    }
  }

  // ── Unknown prefix ─────────────────────────────────────────────────────────
  return res.status(400).json({
    error: 'unrecognised_barcode',
    message: 'Barcode prefix not recognised. Expected LSU- or LSO-.',
  });
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

  let billableCount = 0;
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

      billableCount = parseInt(billableOrders?.count ?? '0', 10);

      if (billableCount > 0) {
        // Rotate stale Starter periods before metering this completed batch.
        // The helper returns the exact open row to increment, preventing a
        // concurrent month-boundary rotation from moving this usage.
        const usagePeriod = await getOrRotateOpenUsagePeriod(trx, shopId);
        const updated = await trx('shop_usage_metrics')
          .where({
            id: usagePeriod.id,
            shop_id: shopId,
          })
          .whereNull('period_ends_at')
          .increment('shipped_orders', billableCount);

        if (updated === 0) {
          console.warn('[WMS_PACK_COMPLETE][USAGE] open period changed before increment', {
            shopId,
            batchId,
            billableCount,
            usagePeriodId: usagePeriod.id,
          });
        } else {
          console.info('[WMS_PACK_COMPLETE][USAGE] shipped_orders incremented', {
            shopId,
            batchId,
            billableCount,
            usagePeriodId: usagePeriod.id,
          });
        }
      }

      // Alert supervisors — batch ready to ship
      await fireBatchReadyToShipAlert(trx, { shopId, batchId, isActive: true });
      console.info('[WMS_PACK_COMPLETED]', { pick_batch_id: batchId, packed_by: userId, shopId });
    });

    // Report overage to Stripe after transaction commits — non-fatal
    if (billableCount > 0) {
      await reportShippedOrderOverage(shopId, billableCount);
    }

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
        .leftJoin('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
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
          'v.image_url',
          'p.title as product_title',
          trx.raw(`
            (SELECT array_agg(iu.lasyncro_unit_id ORDER BY iu.received_at)
             FROM (
               SELECT lasyncro_unit_id, received_at
               FROM inventory_units
               WHERE lasyncro_variant_id = st.lasyncro_variant_id
               AND shop_id = st.shop_id
               AND status = 'received'
               LIMIT st.quantity
             ) iu
            ) as unit_ids
          `),
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
  } catch (err: unknown) {
    console.error('[STOW_LOCATION_ASSIGN_FAILED]', { shopId, taskId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to assign location: ${getErrorMessage(err)}` });
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
  const { quantity_placed, lasyncro_unit_id } = req.body ?? {};

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
        lasyncroUnitId: typeof lasyncro_unit_id === 'string' && lasyncro_unit_id.startsWith('LSU-')
          ? lasyncro_unit_id
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
              // THREAD A-2 (2026-06-29): shop_id now required by this
              // table's RLS policy. shopId already in scope from the
              // constrainedOrders query above — same tenant, no lookup.
              shop_id: shopId,
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
          error: getErrorMessage(err),
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
    scan_source, // optional: 'camera' | 'usb' | 'bt' | 'manual' — defaults to 'camera' in service
    lasyncro_unit_id,
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
        scanSource: scan_source,
        lasyncroUnitId:
          typeof lasyncro_unit_id === 'string' && lasyncro_unit_id.startsWith('LSU-')
            ? lasyncro_unit_id
            : undefined,
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
// GET /api/v1/wms/problem-center
// ─────────────────────────────────────────
export const httpGetProblemCenterExceptions = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  // Optional scope: ?order_id=<id> — used by EntityDetailModal to fetch only
  // this order's exceptions, instead of the whole shop's history. Omitted =
  // unchanged shop-wide behavior for the general Problem Center page.
  const orderId = typeof req.query.order_id === 'string' ? req.query.order_id : null;

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const exceptions = await trx('pick_exceptions as pe')
        .leftJoin('order_line_items as oli', 'oli.lasyncro_line_item_id','pe.lasyncro_line_item_id')
        .where('pe.shop_id', shopId)
        .modify((qb) => {
          if (orderId) qb.where('oli.lasyncro_order_id', orderId);
        })
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
          'oli.lasyncro_order_id',
          trx.raw(`upper(substring(pe.pick_batch_id::text, 1, 8)) as batch_short_id`)
        );

      const totalUnresolved = exceptions.filter((e: { resolved: boolean }) => !e.resolved).length;

      return { exceptions, total_unresolved: totalUnresolved };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_PROBLEM_CENTER_EXCEPTIONS_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch Problem Center: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/problem-center/:exceptionId/resolve
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
        .select('resolved', 'pick_batch_id')
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

      // ISS-065: this handler previously never cleared the alert fired by
      // firePickExceptionAlert (wmsAlerts.service.ts) on exception report,
      // which is keyed on entity_id = pick_batch_id. Unlike the
      // problem_center_tasks resolve path (ISS-030), this handler already
      // has pick_batch_id directly — no join needed.
      // NOTE: a batch can have multiple concurrent pick exceptions sharing
      // one alert_key (wms:exception:pick:{batchId}/wms:exception:pack:
      // {batchId}) — deactivating here on a single exception's resolve is
      // correct only when it's the last unresolved exception for that
      // batch+stage. Checked explicitly below rather than assumed.
      const remainingUnresolved = await trx('pick_exceptions')
        .where({ pick_batch_id: exception.pick_batch_id, shop_id: shopId, resolved: false })
        .count('* as count')
        .first();

      if (Number(remainingUnresolved?.count ?? 0) === 0) {
        await trx('alerts')
          .where({ shop_id: shopId, entity_id: exception.pick_batch_id, is_active: true })
          .andWhere('alert_type', 'in', ['wms_pick_exception', 'wms_pack_exception'])
          .update({ is_active: false, updated_at: new Date() });
      }

      console.info('[WMS_EXCEPTION_RESOLVED]', {
        pick_exception_id: exceptionId,
        resolved_by: userId,
        shopId,
        remaining_unresolved: Number(remainingUnresolved?.count ?? 0),
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
// POST /api/v1/wms/problem-center/:taskId/resolve
// ─────────────────────────────────────────
// Resolves an open problem_center_tasks row.
// resolution_action drives downstream inventory impact (not yet implemented — INV-03):
//   re_stow   → creates new stow task, item re-enters inventory
//   discard   → writes 'damage' inventory_movement, decrements inventory_truth
//   return    → future: return PO line
//   write_off → writes 'shrinkage' inventory_movement, decrements inventory_truth
export const httpResolveProblemTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { taskId } = req.params;
  const { resolution_action, resolution_notes } = req.body;

  const VALID_ACTIONS = ['re_stow', 'discard', 'write_off', 'quarantine', 'find_replacement'];
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });
  if (!resolution_action || !VALID_ACTIONS.includes(resolution_action)) {
    return res.status(400).json({ error: `resolution_action must be one of: ${VALID_ACTIONS.join(', ')}` });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const task = await trx('problem_center_tasks')
        .where({ problem_task_id: taskId, shop_id: shopId })
        .select('status', 'lasyncro_variant_id', 'quantity', 'source_exception_id', 'source')
        .first();

      if (!task) throw new Error('TASK_NOT_FOUND');
      if (task.status === 'resolved') throw new Error('TASK_ALREADY_RESOLVED');

      // ── Determine final status from resolution_action ──────
      const statusMap: Record<string, string> = {
        re_stow:          'resolved',
        discard:          'resolved',
        write_off:        'resolved',
        quarantine:       'resolved',
        find_replacement: 'investigating',
      };
      const finalStatus = statusMap[resolution_action] ?? 'resolved';

      await trx('problem_center_tasks')
        .where({ problem_task_id: taskId })
        .update({
          status: finalStatus,
          resolution_action,
          resolution_notes: resolution_notes?.trim() ?? null,
          resolved_by: userId,
          resolved_at: finalStatus === 'investigating' ? null : new Date(),
          updated_at: new Date(),
        });

      // ── CASCADE: inventory_movements for write-off actions ──
      // discard = physical damage (product destroyed)
      // write_off = shrinkage (missing, unaccounted)
      if (resolution_action === 'discard' || resolution_action === 'write_off') {
        const movementType = resolution_action === 'discard' ? 'damage' : 'shrinkage';
        const it = await trx('inventory_truth')
          .where({ lasyncro_variant_id: task.lasyncro_variant_id, shop_id: shopId })
          .select('available_quantity', 'on_hand_quantity', 'location_code')
          .first();

        // Only write movement if stock exists — never create negative inventory_movements
        const writeQty = Math.min(task.quantity, it?.available_quantity ?? 0);
        if (writeQty > 0) {
          await trx('inventory_movements').insert({
            lasyncro_inventory_movement_id: trx.raw('gen_random_uuid()'),
            lasyncro_variant_id: task.lasyncro_variant_id,
            movement_type: movementType,
            quantity_delta: -writeQty,
            reference_type: 'problem_center_task',
            reference_id: taskId,
            location_code: it?.location_code ?? 'WH-1-ROOT',
            shop_id: shopId,
            operator_id: userId,
            triggered_by: 'problem_center',
            occurred_at: new Date(),
          });
          // Decrement inventory_truth
          await trx('inventory_truth')
            .where({ lasyncro_variant_id: task.lasyncro_variant_id, shop_id: shopId })
            .decrement('available_quantity', writeQty)
            .decrement('on_hand_quantity', writeQty);
        }
        console.info('[PROBLEM_CENTER_WRITE_OFF]', {
          problem_task_id: taskId, movement_type: movementType,
          qty_written: writeQty, variant_id: task.lasyncro_variant_id, shopId,
        });
      }

      // ── CASCADE: quarantine — move item to PROBLEM bin, no stow task ─
      if (resolution_action === 'quarantine') {
        const problemBin = task.problem_bin_location ?? `WH-${shopId}-PROBLEM`;
        await trx('inventory_truth')
          .where({ lasyncro_variant_id: task.lasyncro_variant_id, shop_id: shopId })
          .update({ location_code: problemBin, updated_at: new Date() });
        console.info('[PROBLEM_CENTER_QUARANTINE]', {
          problem_task_id: taskId, variant_id: task.lasyncro_variant_id, shopId,
        });
      }

      // ── CASCADE: re_stow — create stow task so operator physically re-stows ─
      // Item currently sits in the problem bin. Operator claims this stow task,
      // walks to problem bin, picks the item, and stows it to the correct location.
      // Stow confirmation writes inventory_movements (inbound_purchase) + updates inventory_truth.
      if (resolution_action === 're_stow') {
        const problemBin = task.problem_bin_location ?? `WH-${shopId}-PROBLEM`;
        await trx('stow_tasks').insert({
          shop_id: shopId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          quantity: task.quantity,
          location_code: problemBin,
          status: 'pending',
          trigger: 'problem_center',
          source_task_id: taskId,
          created_at: new Date(),
          updated_at: new Date(),
        });
        console.info('[PROBLEM_CENTER_RE_STOW_TASK_CREATED]', {
          problem_task_id: taskId, variant_id: task.lasyncro_variant_id,
          quantity: task.quantity, problem_bin: problemBin, shopId,
        });
      }

      // ── Deactivate linked alerts ────────────────────────────
      // ISS-030: alerts.entity_id is keyed on the PARENT batch/job id
      // (pick_batch_id / receive_job_id — see wmsAlerts.service.ts
      // firePickExceptionAlert / fireReceiveExceptionAlert), not on the
      // exception record's own id. problem_center_tasks.source_exception_id
      // for pick/receive sources is the exception record's own id
      // (pick_exceptions.pick_exception_id / receive_exceptions.
      // receive_exception_id — confirmed via frontend call sites
      // PickBriefScreen.tsx, ReceiveJobScreen.tsx, WmsPage.tsx).
      // Resolve one level of indirection before matching, per source.
      // stow/returns are unaffected — those flows already store the
      // matching parent id directly in source_exception_id.
      if (task.source_exception_id) {
        let alertEntityId = task.source_exception_id;

        if (task.source === 'pick' || task.source === 'pack') {
          const pickException = await trx('pick_exceptions')
            .where({ pick_exception_id: task.source_exception_id, shop_id: shopId })
            .select('pick_batch_id')
            .first();
          if (pickException) alertEntityId = pickException.pick_batch_id;
        } else if (task.source === 'receive') {
          const receiveException = await trx('receive_exceptions')
            .where({ receive_exception_id: task.source_exception_id, shop_id: shopId })
            .select('receive_job_id')
            .first();
          if (receiveException) alertEntityId = receiveException.receive_job_id;
        }

        await trx('alerts')
          .where({ shop_id: shopId, entity_id: alertEntityId, is_active: true })
          .update({ is_active: false, updated_at: new Date() });
      }

      console.info('[PROBLEM_CENTER_RESOLVED]', {
        problem_task_id: taskId, resolution_action,
        final_status: finalStatus, resolved_by: userId, shopId,
      });
      return { problem_task_id: taskId, resolved: true, resolution_action, status: finalStatus };
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    if (message === 'TASK_NOT_FOUND') return res.status(404).json({ error: 'Problem task not found' });
    if (message === 'TASK_ALREADY_RESOLVED') return res.status(409).json({ error: 'Task already resolved' });
    console.error('[PROBLEM_CENTER_RESOLVE_FAILED]', { shopId, userId, taskId, error: message });
    return res.status(500).json({ error: `Failed to resolve problem task: ${message}` });
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
        .where('eoim.shop_id', shopId)
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
// GET /api/v1/wms/orders/:orderId/invoice
// ─────────────────────────────────────────
/**
 * Generates and streams an A4 invoice PDF for a pack order.
 *
 * - Fetches order + line items + shop details from DB
 * - Generates PDF via pdf-lib + bwip-js (Code128 barcode)
 * - Marks barcode_print_jobs row as printed
 * - Idempotent — safe to call multiple times (reprint)
 */
export const httpGetOrderInvoice = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId } = req.params;
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Fetch order
      const order = await trx('orders as o')
        .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.lasyncro_order_id': orderId, 'o.shop_id': shopId })
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.wms_barcode',
          'o.total_price',
          'o.currency',
          'o.order_created_at',
          'o.shipping_name',
          'o.shipping_address1',
          'o.shipping_address2',
          'o.shipping_city',
          'o.shipping_zip',
          'o.shipping_province',
          'o.shipping_country_code',
        )
        .first();

      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (!order.wms_barcode) throw new Error('ORDER_NO_WMS_BARCODE');

      // Fetch line items with product info and image
      const lineItems = await trx('order_line_items as oli')
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
        .leftJoin('products as p', 'p.lasyncro_product_id', 'oli.lasyncro_product_id')
        .where({ 'oli.lasyncro_order_id': orderId })
        .select(
          trx.raw(`COALESCE(p.title, oli.title) as product_title`),
          trx.raw(`oli.title as variant_title`),
          'oli.quantity',
          'oli.sku',
          'v.image_url',
          'oli.unit_price',
        );

      // Fetch shop info
      const shop = await trx('shops as s')
        .join('shopify_app_installations as sai', 'sai.shop_id', 's.id')
        .where({ 's.id': shopId })
        .select('s.name', 's.base_currency', 'sai.shop_domain')
        .first();

      if (!shop) throw new Error('SHOP_NOT_FOUND');

      // Mark invoice print job as printed
      await trx('barcode_print_jobs')
        .where({
          shop_id: shopId,
          lasyncro_order_id: orderId,
          label_type: 'invoice',
        })
        .update({ status: 'printed', printed_at: new Date() });

      return { order, lineItems, shop };
    });

    const pdfBuffer = await generateInvoicePdf(result.order, result.lineItems, result.shop);

    console.info('[WMS_INVOICE_GENERATED]', {
      shopId,
      orderId,
      wmsBarcode: result.order.wms_barcode,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${result.order.wms_barcode}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
    if (message === 'ORDER_NO_WMS_BARCODE') return res.status(409).json({ error: 'Order has no WMS barcode — batch not yet released' });
    console.error('[WMS_INVOICE_FAILED]', { shopId, orderId, error: message });
    return res.status(500).json({ error: `Failed to generate invoice: ${message}` });
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
      /*
       * ORDER POOL QUERY (A1)
       * ----------------------
       * Returns all constraint-free, unbatched, pending/processing orders.
       * Enriched with: external_order_id, customer name, priority flag,
       * line item count, unit count, zone distribution.
       * Priority-flagged orders surface first, then oldest-first.
       * Zone distribution: distinct zone_type values of bins holding
       * the order's variants — feeds pre-release preview UI.
       */
      const rows = await trx
        .with('latest_age_snapshot', (qb) => {
          // Same DISTINCT ON pattern as sla.metrics.ts / pickBatch.service.ts —
          // order_age_snapshot is append-only/versioned, must read latest only.
          qb.from('order_age_snapshot as oas')
            .distinctOn('oas.lasyncro_order_id')
            .select('oas.lasyncro_order_id', 'oas.is_shipping_sla_breached')
            .orderBy('oas.lasyncro_order_id')
            .orderBy('oas.aggregate_version', 'desc');
        })
        .from('orders as o')
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id','o.lasyncro_order_id')
        .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
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
        .orderByRaw('ofs.is_priority_flagged DESC, COALESCE(las.is_shipping_sla_breached, false) DESC, o.order_created_at ASC')
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.total_price',
          'o.currency',
          'o.order_created_at',
          'o.promised_ship_by',
          'ofs.is_priority_flagged',
          'las.is_shipping_sla_breached',
          trx.raw(`null::text as customer_name`),
          // Line item + unit counts via subquery
          trx.raw(`(
            SELECT COUNT(*)::integer
            FROM order_line_items oli
            WHERE oli.lasyncro_order_id = o.lasyncro_order_id
          ) as line_item_count`),
          trx.raw(`(
            SELECT COALESCE(SUM(oli.quantity), 0)::integer
            FROM order_line_items oli
            WHERE oli.lasyncro_order_id = o.lasyncro_order_id
          ) as unit_count`),
          // Zone distribution: which warehouse zones hold this order's variants
          trx.raw(`(
            SELECT COALESCE(
              array_agg(DISTINCT wl.zone_type ORDER BY wl.zone_type),
              ARRAY[]::warehouse_zone_type[]
            )
            FROM order_line_items oli
            JOIN inventory_truth it ON it.lasyncro_variant_id = oli.lasyncro_variant_id
              AND it.shop_id = o.shop_id
              AND it.on_hand_quantity > 0
            JOIN warehouse_locations wl ON wl.location_code = it.location_code
              AND wl.shop_id = o.shop_id
              AND wl.zone_type IS NOT NULL
            WHERE oli.lasyncro_order_id = o.lasyncro_order_id
          ) as zone_distribution`),
        );

        // Load max_batch_line_items for ceiling display in UI
        const settings = await trx('shop_wms_settings')
          .where({ shop_id: shopId })
          .select('max_batch_line_items')
          .first();

        const activeConstraints = trx('order_constraints')
          .where('is_active', true)
          .groupBy('lasyncro_order_id')
          .select('lasyncro_order_id')
          .as('active_constraints');

        const summaryRow = await trx('orders as o')
          .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
          .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
          .leftJoin('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id')
          .leftJoin(activeConstraints, 'active_constraints.lasyncro_order_id', 'o.lasyncro_order_id')
          .where('o.shop_id', shopId)
          .select(
            trx.raw(`
              COUNT(*) FILTER (
                WHERE pbo.lasyncro_order_id IS NULL
                AND ofs.status IN ('pending', 'processing')
                AND active_constraints.lasyncro_order_id IS NULL
              )::integer as ready_for_release_count
            `),
            trx.raw(`
              COUNT(DISTINCT o.lasyncro_order_id) FILTER (
                WHERE pbo.lasyncro_order_id IS NOT NULL
              )::integer as in_batch_order_count
            `),
            trx.raw(`
              COUNT(DISTINCT pb.pick_batch_id) FILTER (
                WHERE pbo.lasyncro_order_id IS NOT NULL
              )::integer as active_batch_count
            `),
            trx.raw(`
              COUNT(*) FILTER (
                WHERE pbo.lasyncro_order_id IS NULL
                AND active_constraints.lasyncro_order_id IS NOT NULL
              )::integer as blocked_count
            `),
            trx.raw(`
              COUNT(*) FILTER (
                WHERE pbo.lasyncro_order_id IS NULL
                AND ofs.status = 'fulfilled'
              )::integer as fulfilled_count
            `),
            trx.raw(`
              COUNT(*) FILTER (
                WHERE pbo.lasyncro_order_id IS NULL
                AND active_constraints.lasyncro_order_id IS NULL
                AND (
                  ofs.lasyncro_order_id IS NULL
                  OR ofs.status NOT IN ('pending', 'processing', 'fulfilled')
                )
              )::integer as not_ready_count
            `)
          )
          .first();

        const summary = {
          ready_for_release_count: Number(summaryRow?.ready_for_release_count ?? rows.length),
          in_batch_order_count: Number(summaryRow?.in_batch_order_count ?? 0),
          active_batch_count: Number(summaryRow?.active_batch_count ?? 0),
          blocked_count: Number(summaryRow?.blocked_count ?? 0),
          fulfilled_count: Number(summaryRow?.fulfilled_count ?? 0),
          not_ready_count: Number(summaryRow?.not_ready_count ?? 0),
        };

        const emptyReason =
          rows.length > 0
            ? null
            : summary.in_batch_order_count > 0
              ? 'ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED'
              : summary.blocked_count > 0
                ? 'ORDERS_BLOCKED'
                : summary.not_ready_count > 0
                  ? 'ORDERS_NOT_READY'
                  : summary.fulfilled_count > 0
                    ? 'NO_UNFULFILLED_ORDERS'
                    : 'NO_ORDERS';

        return {
          rows,
          maxBatchLineItems: settings?.max_batch_line_items ?? 108,
          summary,
          emptyReason,
        };
      });

      return res.json({
        eligible_order_count: result.rows.length,
        max_batch_line_items: result.maxBatchLineItems,
        orders: result.rows,
        summary: result.summary,
        empty_reason: result.emptyReason,
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ORDER_POOL_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch order pool: ${message}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/orders/:orderId/priority
// ─────────────────────────────────────────
export const httpSetOrderPriority = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });
  const { orderId } = req.params;
  const { flagged } = req.body;
  if (typeof flagged !== 'boolean') return res.status(400).json({ error: 'flagged (boolean) required' });
  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      // Verify order belongs to shop and is in the pool (not already batched)
      const order = await trx('orders as o')
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.lasyncro_order_id': orderId, 'o.shop_id': shopId })
        .whereNull('pbo.lasyncro_order_id')
        .select('o.lasyncro_order_id')
        .first();
      if (!order) return res.status(404).json({ error: 'Order not found in pool' });
      // Call Postgres function — handles idempotency and audit trail
      await trx.raw(
        `SELECT set_order_priority_flag(?, ?)`,
        [orderId, flagged]
      );
    });
    console.info('[ORDER_PRIORITY_SET]', { shopId, orderId, flagged, setBy: userId });
    return res.json({ success: true, lasyncro_order_id: orderId, is_priority_flagged: flagged });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ORDER_PRIORITY_FAILED]', { shopId, orderId, error: message });
    return res.status(500).json({ error: `Failed to set priority: ${message}` });
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
          total_units: inventory.reduce((s: number, i: { on_hand_quantity: number }) => s + i.on_hand_quantity, 0),
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
          total_on_hand: inventory.reduce((s: number, i: { on_hand_quantity: number }) => s + i.on_hand_quantity, 0),
          total_reserved: inventory.reduce((s: number, i: { reserved_quantity: number }) => s + i.reserved_quantity, 0),
          total_available: inventory.reduce((s: number, i: { available_quantity: number }) => s + i.available_quantity, 0),
          active_receive: activeReceive ?? null,
          active_stow: activeStow ?? null,
          active_batch: activePick ?? null,
          open_exceptions: Number(exceptions?.count ?? 0),
        };
      }

      // ── 3. Try WMS barcode (LSO-XXXXXXXX invoice scan) ────────────────────
      const wmsOrder = await trx('orders as o')
        .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.shop_id': shopId, 'o.wms_barcode': scanned_value })
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.wms_barcode',
          'o.total_price',
          'o.currency',
          'o.order_created_at',
        )
        .first();
      if (wmsOrder) {
        const lineItems = await trx('order_line_items as oli')
          .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
          .where({ 'oli.lasyncro_order_id': wmsOrder.lasyncro_order_id })
          .select('oli.title', 'oli.quantity', 'v.sku', 'oli.lasyncro_line_item_id');
        const batch = await trx('pick_batch_orders as pbo')
          .join('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id')
          .where({ 'pbo.lasyncro_order_id': wmsOrder.lasyncro_order_id })
          .whereNotIn('pb.status', ['pack_complete', 'cancelled'])
          .select('pb.pick_batch_id', 'pb.status')
          .first();
        return {
          type: 'invoice_scan',
          wms_barcode: scanned_value,
          lasyncro_order_id: wmsOrder.lasyncro_order_id,
          external_order_id: wmsOrder.external_order_id,
          total_price: wmsOrder.total_price,
          currency: wmsOrder.currency,
          order_created_at: wmsOrder.order_created_at,
          line_items: lineItems,
          active_batch: batch ?? null,
        };
      }

      // ── 4. Try order external ID (Shopify order ID scan) ──────────────────
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
// PATCH /api/v1/wms/settings
// ─────────────────────────────────────────
// Updates editable WMS settings fields for the shop.
// All fields optional — only provided fields are updated.
export const httpPatchWmsSettings = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    problem_bin_location,
    max_batch_line_items,
    auto_release_enabled,
    auto_release_interval_minutes,
    idle_alert_threshold_minutes,
    include_return_label,
    legacy_barcode_fallback_enabled,
  } = req.body;
  
  const updates: Record<string, unknown> = {};
  if (problem_bin_location !== undefined) updates.problem_bin_location = String(problem_bin_location).trim() || null;
  if (include_return_label !== undefined) updates.include_return_label = Boolean(include_return_label);
  // WM-46 manual toggle: lets a shop owner disable legacy barcode
  // fallback once they've decided coverage is high enough, without
  // waiting for auto-sunset (not yet implemented — see
  // wms_barcode_identity_resolution_playbook.md §7b).
  if (legacy_barcode_fallback_enabled !== undefined) updates.legacy_barcode_fallback_enabled = Boolean(legacy_barcode_fallback_enabled);
  if (max_batch_line_items !== undefined) {
    const val = Number(max_batch_line_items);
    if (!Number.isInteger(val) || val < 1 || val > 500) return res.status(400).json({ error: 'max_batch_line_items must be 1–500' });
    updates.max_batch_line_items = val;
  }
  if (auto_release_enabled !== undefined) updates.auto_release_enabled = Boolean(auto_release_enabled);
  if (auto_release_interval_minutes !== undefined) {
    const val = Number(auto_release_interval_minutes);
    if (!Number.isInteger(val) || val < 5 || val > 1440) return res.status(400).json({ error: 'auto_release_interval_minutes must be 5–1440' });
    updates.auto_release_interval_minutes = val;
  }
  if (idle_alert_threshold_minutes !== undefined) {
    const val = Number(idle_alert_threshold_minutes);
    if (!Number.isInteger(val) || val < 1 || val > 480) return res.status(400).json({ error: 'idle_alert_threshold_minutes must be 1–480' });
    updates.idle_alert_threshold_minutes = val;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' });
  updates.updated_at = new Date();

  try {
    const settings = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const [updated] = await trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .update(updates)
        .returning('*');
      if (!updated) throw new Error('SETTINGS_NOT_FOUND');
      return updated;
    });

    console.info('[WMS_SETTINGS_UPDATED]', { shopId, updates });
    return res.status(200).json({ settings });
  } catch (err: unknown) {
    if (getErrorMessage(err) === 'SETTINGS_NOT_FOUND') return res.status(404).json({ error: 'WMS settings not found' });
    console.error('[WMS_SETTINGS_PATCH_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to update WMS settings: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/settings
// ─────────────────────────────────────────
// Returns the shop's WMS configuration row (shop_wms_settings).
// Used by OwnerSettingsScreen > Warehouse tab.
// Read-only — PATCH endpoint pending (ISSUE-010).
export const httpGetWmsSettings = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const settings = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shop_wms_settings').where({ shop_id: shopId }).first();
    });

    if (!settings) return res.status(404).json({ error: 'WMS settings not found for this shop' });

    return res.status(200).json({ settings });
  } catch (err: unknown) {
    console.error('[WMS_SETTINGS_FETCH_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to fetch WMS settings: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/problem-center
// ─────────────────────────────────────────
// ISS-054: source_exception_id was previously trusted from the client with
// zero verification — the resolve-time alert-deactivation logic (ISS-030,
// ISS-065) depends entirely on this value being a real row in the correct
// source table. An unvalidated/stale/foreign-shop id here silently breaks
// alert clearing downstream with no error surfaced at creation time.
// Also confirmed (2026-07-08 audit) this endpoint is the PRIMARY creation
// path for 5+ call sites across web+mobile (WmsPage, PickBriefScreen,
// StowScreen ×3, ReceiveJobScreen ×2) — not a rare manual escape hatch.
const VALID_PROBLEM_SOURCES = ['pick', 'stow', 'receive', 'pack', 'returns'] as const;
type ProblemSource = typeof VALID_PROBLEM_SOURCES[number];

// Maps each source to the table + PK column that source_exception_id
// must reference, scoped to this shop. 'stow' and 'returns' already have
// dedicated server-side insert paths (stow.service.ts, returnJobs.service.ts)
// that don't go through this endpoint, but are included here for
// completeness in case a client ever calls this generic path for them too.
const SOURCE_EXCEPTION_TABLE: Partial<Record<ProblemSource, { table: string; pk: string }>> = {
  pick:    { table: 'pick_exceptions',    pk: 'pick_exception_id' },
  pack:    { table: 'pick_exceptions',    pk: 'pick_exception_id' },
  receive: { table: 'receive_exceptions', pk: 'receive_exception_id' },
};

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
  if (!VALID_PROBLEM_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${VALID_PROBLEM_SOURCES.join(', ')}` });
  }
  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Verify source_exception_id references a real, shop-scoped row
      // before it becomes the anchor for future alert-clearing logic.
      if (source_exception_id) {
        const lookup = SOURCE_EXCEPTION_TABLE[source as ProblemSource];
        if (lookup) {
          const exists = await trx(lookup.table)
            .where({ [lookup.pk]: source_exception_id, shop_id: shopId })
            .first(lookup.pk);
          if (!exists) {
            throw new Error('SOURCE_EXCEPTION_NOT_FOUND');
          }
        }
      }

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
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    if (message === 'SOURCE_EXCEPTION_NOT_FOUND') {
      return res.status(404).json({ error: 'source_exception_id does not reference a valid exception for this shop' });
    }
    console.error('[PROBLEM_CENTER_CREATE_FAILED]', { shopId, error: message, stack: err instanceof Error ? err.stack : undefined });
    return res.status(500).json({ error: `Failed to create problem task: ${message}` });
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
  } catch (err: unknown) {
    console.error('[PROBLEM_CENTER_FETCH_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to fetch problem tasks: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/problem-center/:taskId/replacement
// ─────────────────────────────────────────
export const httpFindReplacementForTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = String(req.params.taskId);

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const task = await trx('problem_center_tasks as pct')
        .where({ 'pct.problem_task_id': taskId, 'pct.shop_id': shopId })
        .select('pct.lasyncro_variant_id', 'pct.quantity')
        .first();

      if (!task) throw new Error('Problem task not found');

      // Find same variant at other locations with sufficient stock
      const candidates = await trx('inventory_truth as it')
        .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
        .where('it.shop_id', shopId)
        .where('it.lasyncro_variant_id', task.lasyncro_variant_id)
        .where('it.available_quantity', '>=', task.quantity)
        .orderBy('it.available_quantity', 'desc')
        .select(
          'it.location_code',
          'it.available_quantity',
          'it.on_hand_quantity',
          'v.title as variant_title',
          'v.sku',
        );

      return { task_id: taskId, variant_id: task.lasyncro_variant_id, replacement_locations: candidates };
    });

    return res.json(result);
  } catch (err: unknown) {
    console.error('[REPLACEMENT_FINDER_FAILED]', { shopId, taskId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Replacement finder failed: ${getErrorMessage(err)}` });
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

      /**
       * INV-PC-01 FIX — deferred inventory impact
       * ------------------------------------------
       * Previously wrote inventory_movements + decremented inventory_truth
       * immediately at exception report time. This was inconsistent with
       * pick exceptions which defer inventory impact to resolve time.
       *
       * Unified pattern: exception report → problem_center_tasks row only.
       * Inventory movement written by httpResolveProblemTask on owner
       * resolution (discard → damage movement, write_off → shrinkage,
       * re_stow → new stow task, quarantine → location transfer).
       *
       * This ensures:
       * - Supervisor reviews before inventory is affected
       * - Audit trail: resolution action drives movement, not report time
       * - Consistent with pick/pack exception lifecycle
       */

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

      // Fire alert to owner/admin inbox
      await fireStowExceptionAlert(trx, {
        shopId,
        stowTaskId: taskId,
        exceptionType: exception_type,
        quantity: affectedQty,
      });

      return { prob_label: probLabel, problem_bin: problemBin, movement_type: movementType };
    });
    console.info('[STOW_EXCEPTION_REPORTED]', { shopId, taskId, exception_type, quantity });
    return res.status(201).json(result);
  } catch (err: unknown) {
    console.error('[STOW_EXCEPTION_FAILED]', { shopId, taskId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Stow exception failed: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// PACK DECISION REQUESTS
// ─────────────────────────────────────────

/**
 * POST /api/v1/wms/pack/decision-request
 * ----------------------------------------
 * Operator raises a blocking decision request (item_missing, short_pick).
 * Pack job pauses on this order until owner resolves.
 */
export const httpRaisePackDecision = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    pick_batch_id, lasyncro_order_id, lasyncro_line_item_id,
    exception_type, question,
  } = req.body;

  if (!pick_batch_id)         return res.status(400).json({ error: 'pick_batch_id is required' });
  if (!lasyncro_order_id)     return res.status(400).json({ error: 'lasyncro_order_id is required' });
  if (!lasyncro_line_item_id) return res.status(400).json({ error: 'lasyncro_line_item_id is required' });
  if (!['item_missing', 'short_pick'].includes(exception_type)) {
    return res.status(400).json({ error: 'exception_type must be item_missing or short_pick' });
  }
  if (!['ship_partial', 'hold_and_requeue'].includes(question)) {
    return res.status(400).json({ error: 'question must be ship_partial or hold_and_requeue' });
  }

  try {
    const request = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return raisePackDecisionRequest(trx, {
        shopId,
        pickBatchId:         pick_batch_id,
        lasyncroOrderId:     lasyncro_order_id,
        lasyncroLineItemId:  lasyncro_line_item_id,
        exceptionType:       exception_type,
        question,
        raisedBy:            userId,
      });
    });

    return res.status(201).json({ request });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PACK_DECISION_RAISE_FAILED]', { shopId, userId, error: message });
    return res.status(500).json({ error: `Failed to raise pack decision: ${message}` });
  }
};

/**
 * GET /api/v1/wms/pack/decision-request/:requestId
 * --------------------------------------------------
 * Mobile polls this until status !== 'pending'.
 * Returns current status + partial_shipment decision.
 */
export const httpGetPackDecision = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const requestId = String(req.params.requestId);

  try {
    const request = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return getPackDecisionRequest(trx, requestId, shopId);
    });

    if (!request) return res.status(404).json({ error: 'Decision request not found' });
    return res.status(200).json({ request });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PACK_DECISION_GET_FAILED]', { shopId, requestId, error: message });
    return res.status(500).json({ error: `Failed to get pack decision: ${message}` });
  }
};

/**
 * POST /api/v1/wms/pack/decision-request/:requestId/resolve
 * ----------------------------------------------------------
 * Owner/admin approves or rejects the decision.
 * approved + partial_shipment=true  → packer proceeds with partial ship
 * approved + partial_shipment=false → packer holds
 * rejected                          → order requeued
 * Role enforcement: controller checks owner/admin — backend guard.
 */
export const httpResolvePackDecision = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  const rolesRaw = req.user?.roles ?? [];
  const roles    = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const canResolve = roles.includes('owner') || roles.includes('admin');
  if (!canResolve) {
    return res.status(403).json({ error: 'Only owners and admins can resolve pack decisions' });
  }

  const requestId = String(req.params.requestId);
  const { status, partial_shipment, note } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }

  try {
    const request = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return resolvePackDecisionRequest(trx, {
        requestId,
        shopId,
        resolvedBy:      userId,
        status,
        partialShipment: partial_shipment,
        note,
      });
    });

    return res.status(200).json({ request });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'PACK_DECISION_NOT_FOUND') {
      return res.status(404).json({ error: 'Decision request not found' });
    }
    if (message === 'PACK_DECISION_ALREADY_RESOLVED') {
      return res.status(409).json({ error: 'Decision already resolved' });
    }
    console.error('[PACK_DECISION_RESOLVE_FAILED]', { shopId, userId, requestId, error: message });
    return res.status(500).json({ error: `Failed to resolve pack decision: ${message}` });
  }
};

/**
 * GET /api/v1/wms/pack/decision-requests
 * ----------------------------------------
 * Lists pack decision requests for the shop.
 * ?status=pending|approved|rejected (default: pending)
 * Owner/admin surface — Problem Center pending decisions strip.
 */
export const httpListPackDecisions = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const status  = (req.query.status   as string) ?? 'pending';
  const orderId = (req.query.order_id as string) ?? null;

  try {
    let requests: Record<string, unknown>[] = [];
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const q = trx('pack_decision_requests as pdr')
        .where({ 'pdr.shop_id': shopId })
        .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'pdr.lasyncro_order_id')
        .leftJoin('order_line_items as oli', 'oli.lasyncro_line_item_id', 'pdr.lasyncro_line_item_id')
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
        .orderBy('pdr.raised_at', 'asc');

      // status=all returns every decision regardless of status (used by Order Detail page)
      if (status !== 'all') q.where({ 'pdr.status': status });
      // order_id scopes to a specific order (used by Order Detail page)
      if (orderId) q.where({ 'pdr.lasyncro_order_id': orderId });

      requests = await q.select(
          'pdr.id',
          'pdr.pick_batch_id',
          'pdr.lasyncro_order_id',
          'pdr.lasyncro_line_item_id',
          'pdr.exception_type',
          'pdr.question',
          'pdr.status',
          'pdr.partial_shipment',
          'pdr.raised_by',
          'pdr.raised_at',
          'pdr.resolved_by',
          'pdr.resolved_at',
          'pdr.note',
          'eim.external_order_id',
          'v.title as variant_title',
          'v.sku',
        );
    });

    return res.status(200).json({ requests, total: requests.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PACK_DECISIONS_LIST_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to list pack decisions: ${message}` });
  }
};
// ─────────────────────────────────────────
// PUT /api/v1/wms/carrier-settings
// ─────────────────────────────────────────
// Upserts carrier API credentials for the shop.
// public_key + private_key encrypted at rest before insert.
// Replaces existing credentials on re-submission.
export const httpUpsertCarrierSettings = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { carrier_code, public_key, private_key, api_token } = req.body;

  if (!carrier_code) {
    return res.status(400).json({ error: 'carrier_code required' });
  }

  const SUPPORTED = ['sendcloud', 'shippo'];
  if (!SUPPORTED.includes(carrier_code)) {
    return res.status(400).json({ error: `Unsupported carrier: ${carrier_code}. Supported: ${SUPPORTED.join(', ')}` });
  }

  const TWO_KEY_CARRIERS = ['sendcloud'];
  const SINGLE_TOKEN_CARRIERS = ['shippo'];

  if (TWO_KEY_CARRIERS.includes(carrier_code) && (!public_key || !private_key)) {
    return res.status(400).json({ error: 'public_key and private_key required for this carrier' });
  }
  if (SINGLE_TOKEN_CARRIERS.includes(carrier_code) && !api_token) {
    return res.status(400).json({ error: 'api_token required for this carrier' });
  }

  try {
    const updateFields: Record<string, any> = {
      shop_id: shopId,
      carrier_code,
      is_active: true,
      updated_at: new Date(),
    };

    if (public_key)  updateFields.public_key  = JSON.stringify(encrypt(String(public_key).trim()));
    if (private_key) updateFields.private_key = JSON.stringify(encrypt(String(private_key).trim()));
    if (api_token)    updateFields.api_token   = JSON.stringify(encrypt(String(api_token).trim()));

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('shop_carrier_settings')
        .insert(updateFields)
        .onConflict(['shop_id', 'carrier_code'])
        .merge(Object.keys(updateFields).filter(k => k !== 'shop_id' && k !== 'carrier_code'));
    });

    console.info('[CARRIER_SETTINGS_UPSERTED]', { shopId, carrier_code });
    return res.status(200).json({ carrier_code, is_active: true });
  } catch (err: unknown) {
    console.error('[CARRIER_SETTINGS_UPSERT_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to save carrier settings: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/carrier-settings
// ─────────────────────────────────────────
// Returns configured carriers for the shop.
// Raw keys are never returned — presence only.
export const httpGetCarrierSettings = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const carriers = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shop_carrier_settings')
        .where({ shop_id: shopId })
        .select('carrier_code', 'is_active', 'created_at', 'updated_at');
    });

    return res.status(200).json({ carriers });
  } catch (err: unknown) {
    console.error('[CARRIER_SETTINGS_FETCH_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to fetch carrier settings: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// DELETE /api/v1/wms/carrier-settings/:carrierCode
// ─────────────────────────────────────────
// Removes a carrier configuration for the shop.
export const httpDeleteCarrierSettings = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { carrierCode } = req.params;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const existing = await trx('shop_carrier_settings')
        .where({ shop_id: shopId, carrier_code: carrierCode })
        .first();
      if (!existing) throw new Error('CARRIER_NOT_FOUND');
      await trx('shop_carrier_settings')
        .where({ shop_id: shopId, carrier_code: carrierCode })
        .delete();
    });

    console.info('[CARRIER_SETTINGS_DELETED]', { shopId, carrierCode });
    return res.status(200).json({ deleted: true });
  } catch (err: unknown) {
    if (getErrorMessage(err) === 'CARRIER_NOT_FOUND') return res.status(404).json({ error: 'Carrier not found' });
    console.error('[CARRIER_SETTINGS_DELETE_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to delete carrier settings: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/orders/:orderId/generate-label
// ─────────────────────────────────────────
// Generates a shipping label for a packed order via the active carrier.
// Idempotent — returns existing tracking row if label already generated.
// Called by WEB-PACK-02 on first item scan per order, and available
// as a manual trigger in WEB-PACK-01.
export const httpGenerateShippingLabel = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId } = req.params;
  const { pick_batch_id } = req.body;

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Idempotency — return existing if already generated
      const existing = await trx('order_shipment_tracking')
        .where({ shop_id: shopId, lasyncro_order_id: orderId })
        .orderBy('created_at', 'desc')
        .first();

      if (existing) {
        return {
          shipmentTrackingId: existing.id,
          carrierCode:    existing.carrier_code,
          trackingNumber: existing.tracking_number,
          trackingUrl:    existing.tracking_url,
          labelUrl:       existing.label_url,
          alreadyExists:  true,
        };
      }

      // Resolve order shipping address
      const order = await trx('orders as o')
        .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.lasyncro_order_id': orderId, 'o.shop_id': shopId })
        .select(
          'eim.external_order_id',
          'o.shipping_name',
          'o.shipping_address1',
          'o.shipping_address2',
          'o.shipping_city',
          'o.shipping_province',
          'o.shipping_zip',
          'o.shipping_phone',
          'o.shipping_country_code',
        )
        .first();

      if (!order) return res.status(404).json({ error: 'Order not found' });

      if (!order.shipping_name || !order.shipping_address1 || !order.shipping_city ||
          !order.shipping_zip  || !order.shipping_country_code) {
        throw new Error('[GENERATE_LABEL] Incomplete shipping address on order');
      }

      const labelResult = await generateAndPersistLabel(trx, {
        shopId,
        lasyncroOrderId: String(orderId),
        pickBatchId:     pick_batch_id ?? null,
        orderNumber:     String(order.external_order_id),
        recipientName:   order.shipping_name,
        recipientPhone:  order.shipping_phone ?? null,
        address1:        order.shipping_address1,
        address2:        order.shipping_address2 ?? null,
        city:            order.shipping_city,
        recipientState:  order.shipping_province ?? null,
        postalCode:      order.shipping_zip,
        countryCode:     order.shipping_country_code,
      });

      return { ...labelResult, alreadyExists: false };
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('[GENERATE_LABEL_FAILED]', { shopId, orderId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to generate label: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/receive-job-lines/:lineId/unit-labels
// ─────────────────────────────────────────
// Returns a thermal-format PDF (50×25mm per page) for all LSU- units
// on a receive job line. Operator triggers after batch-confirm in receive session.
export const httpGetUnitLabels = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const lineId = Array.isArray(req.params.lineId) ? req.params.lineId[0] : req.params.lineId;
  if (!lineId) return res.status(400).json({ error: 'lineId required' });

  try {
    const pdfBytes = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return generateUnitLabelsForLine(trx, shopId, lineId);
    });

    if (!pdfBytes) {
      return res.status(404).json({ error: 'No units found for this line — inspect the line first' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="unit-labels-${lineId.slice(0, 8)}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err: unknown) {
    console.error('[UNIT_LABELS_FAILED]', { shopId, lineId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to generate unit labels: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/coverage
// ─────────────────────────────────────────
// Returns unit label coverage stats for this shop.
// Used by the WMS settings coverage metric strip.
export const httpGetUnitLabelCoverage = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const coverage = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return computeCoverage(trx, shopId);
    });
    return res.status(200).json(coverage);
  } catch (err: unknown) {
    console.error('[UNIT_COVERAGE_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to compute coverage: ${getErrorMessage(err)}` });
  }
};

/**
 * BULK LABEL BACKFILL (WM-40 Outbound module)
 * --------------------------------------------
 * Generates labels for a list of orders missing tracking, one at a time.
 * Each order gets its own transaction — a single bad address or carrier
 * failure must not roll back labels already generated for other orders
 * in the same batch. Synchronous: expected batch size is single digits
 * to low tens (SMB missing-tracking backlog), well within a normal
 * request timeout.
 */
export const httpBulkGenerateShippingLabels = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { order_ids } = req.body;
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'order_ids must be a non-empty array' });
  }
  if (order_ids.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 orders per batch' });
  }

  const results: Array<{
    orderId: string;
    success: boolean;
    trackingNumber?: string;
    alreadyExists?: boolean;
    error?: string;
  }> = [];

  for (const orderId of order_ids) {
    try {
      const result = await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

        const existing = await trx('order_shipment_tracking')
          .where({ shop_id: shopId, lasyncro_order_id: orderId })
          .orderBy('created_at', 'desc')
          .first();

        if (existing) {
          return {
            trackingNumber: existing.tracking_number,
            alreadyExists: true,
          };
        }

        const order = await trx('orders as o')
          .join('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
          .where({ 'o.lasyncro_order_id': orderId, 'o.shop_id': shopId })
          .select(
            'eim.external_order_id',
            'o.shipping_name',
            'o.shipping_address1',
            'o.shipping_address2',
            'o.shipping_city',
            'o.shipping_zip',
            'o.shipping_country_code',
          )
          .first();

        if (!order) {
          throw new Error('Order not found');
        }

        if (!order.shipping_name || !order.shipping_address1 || !order.shipping_city ||
            !order.shipping_zip || !order.shipping_country_code) {
          throw new Error('Incomplete shipping address');
        }

        const labelResult = await generateAndPersistLabel(trx, {
          shopId,
          lasyncroOrderId: String(orderId),
          pickBatchId: null,
          orderNumber: String(order.external_order_id),
          recipientName: order.shipping_name,
          recipientPhone:  order.shipping_phone ?? null,
          address1: order.shipping_address1,
          address2: order.shipping_address2 ?? null,
          city: order.shipping_city,
          recipientState: order.shipping_province ?? null,
          postalCode: order.shipping_zip,
          countryCode: order.shipping_country_code,
        });

        return { trackingNumber: labelResult.trackingNumber, alreadyExists: false };
      });

      results.push({ orderId, success: true, ...result });
    } catch (err: unknown) {
      results.push({ orderId, success: false, error: getErrorMessage(err) });
      console.error('[BULK_GENERATE_LABEL_ORDER_FAILED]', { shopId, orderId, error: getErrorMessage(err) });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.length - succeeded;

  console.info('[BULK_GENERATE_LABEL_COMPLETE]', { shopId, total: results.length, succeeded, failed });
  return res.status(200).json({ results, summary: { total: results.length, succeeded, failed } });
};

// GET /api/v1/wms/live-activity
// Derives real-time floor state from existing tables — no new writers.
// picker_positions: last scan per operator within 4h window.
// active_batches: pick_batches in picking/packing status + line progress.
// stow_pressure: pending stow_tasks count anchored to RECEIVE-1.
// Closes WG-11. See overview-live-map-playbook.md §6.
export const httpGetLiveActivity = async (req: Request, res: Response): Promise<void> => {
  const shopId = req.user?.shopId;
  if (!shopId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const [pickerRows, batchRows, stowRow, awaitingPackRow] = await Promise.all([
      // Last scan location per operator — within 4-hour recency window only.
      trx('pick_scan_log as psl')
        .join('pick_batches as pb', 'pb.pick_batch_id', 'psl.pick_batch_id')
        .select('psl.scanned_by as operator_id', 'psl.location_code', 'psl.scanned_at', 'psl.pick_batch_id')
        .where('psl.shop_id', shopId)
        .where('psl.scanned_at', '>=', trx.raw("NOW() - INTERVAL '4 hours'"))
        .whereNotNull('psl.location_code')
        .whereIn('pb.status', ['picking', 'packing'])
        .orderBy('psl.scanned_by')
        .orderBy('psl.scanned_at', 'desc')
        .distinctOn('psl.scanned_by'),

      // Active batches with line-level progress.
      trx('pick_batches as pb')
        .select(
          'pb.pick_batch_id',
          'pb.status',
          trx.raw('COALESCE(pb.units_picked, 0) AS picked_lines'),
          'pb.total_line_items',
          'pb.total_units',
          trx.raw('COALESCE(pb.units_packed, 0) AS units_packed')
        )
        .where('pb.shop_id', shopId)
        .whereIn('pb.status', ['picking', 'packing']),

      // Stow pressure — pending tasks only.
      trx('stow_tasks')
        .where('shop_id', shopId)
        .where('status', 'pending')
        .count('stow_task_id as pending_count')
        .first(),

      trx('pick_batches')
        .where('shop_id', shopId)
        .where('status', 'pick_complete')
        .sum('total_units as total')
        .first(),
    ]);

    return res.status(200).json({
      pickerPositions: pickerRows.map(r => ({
        operator_id: String(r.operator_id),
        location_code: r.location_code,
        last_scan_at: r.scanned_at,
        batch_id: r.pick_batch_id,
      })),
      activeBatches: batchRows.map(r => ({
        batch_id: r.pick_batch_id,
        status: r.status,
        picked_lines: Number(r.picked_lines),
        total_lines: Number(r.total_line_items),
        total_units: Number(r.total_units),
        units_packed: Number(r.units_packed),
      })),
      stowPressure: {
        pending_count: Number(stowRow?.pending_count ?? 0),
        anchor_location: 'RECEIVE-1',
      },
      awaitingPackUnits: Number(awaitingPackRow?.total ?? 0),
      });
  });
};