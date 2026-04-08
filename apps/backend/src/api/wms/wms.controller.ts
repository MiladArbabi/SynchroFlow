// apps/backend/src/api/wms/wms.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { releaseBatch } from '../../services/wms/pickBatch.service.js';
import { resolveBarcode } from '../../services/wms/barcodeResolution.service.js';
import { confirmPickScan } from '../../services/wms/pickScan.service.js';

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

  const { batchId } = req.params;

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
// POST /api/v1/wms/batch/:batchId/exception
// ─────────────────────────────────────────
export const httpReportPickException = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { batchId } = req.params;

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