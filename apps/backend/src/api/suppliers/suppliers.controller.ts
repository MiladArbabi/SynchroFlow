import { pendingDeliveryQuantitySql } from '../../services/purchasing/purchasingEvidence.js';
// apps/backend/src/api/suppliers/suppliers.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { fireReceiveArrivedAlert } from '../../services/wms/wmsAlerts.service.js';
import { recomputeSupplierRating } from '../../services/suppliers/supplierRating.service.js';
import { enqueueShopSnapshotJob } from '../../services/shop-snapshot/enqueueShopSnapshotJob.js';
import {
  PurchaseOrderCreationError,
  createPurchaseOrderIdempotently,
  parsePurchaseOrderCreateInput,
  readIdempotencyKey,
} from '../../services/purchasing/purchaseOrderCreation.service.js';

/**
 * SUPPLIERS PORTAL CONTROLLERS
 * -----------------------------
 * All queries are tenant-scoped via req.user.shopId + RLS current_tenant.
 *
 * PO lifecycle:
 *   draft → ordered → confirmed → in_production → shipped →
 *   partially_received → received → cancelled
 *
 * in_production and shipped are skippable via force-advance.
 *
 * Supplier rating fields (on_time_rate, fill_rate, avg_delivery_days)
 * are computed automatically on every receive action — never set manually.
 * defect_rate updated separately by WMS pick exception flow (future sprint).
 */

// ─────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────

export async function httpGetSuppliers(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const suppliers = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('suppliers as s')
        .where('s.shop_id', shopId)
        .andWhere('s.active', true)
        .leftJoin('purchase_orders as po', function () {
          this.on('po.supplier_id', 's.id')
              .andOn('po.shop_id', trx.raw('?', [shopId]))
              .andOnNotIn('po.status', ['received', 'cancelled']);
        })
        .groupBy('s.id')
        .orderBy('s.name', 'asc')
        .select(
          's.id', 's.name', 's.contact_name', 's.contact_email', 's.contact_phone',
          's.on_time_rate', 's.fill_rate', 's.defect_rate', 's.avg_delivery_days',
          's.total_pos', 's.active', 's.notes', 's.moq', 's.lead_time_days', 's.created_at',
          trx.raw('COUNT(po.id) as open_po_count')
        );
    });

    return res.json({ suppliers });
  } catch (err) {
    console.error('[suppliers] httpGetSuppliers failed', err);
    return res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
}

export async function httpCreateSupplier(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

const { 
  name, 
  contact_name, 
  contact_email, 
  contact_phone, 
  notes, 
  moq, 
  lead_time_days 
} = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const [supplier] = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('suppliers')
        .insert({
          shop_id: shopId,
          name: name.trim(),
          contact_name: contact_name ?? null,
          contact_email: contact_email ?? null,
          contact_phone: contact_phone ?? null,
          moq: (moq === undefined || moq === null || moq === '') ? null : Number(moq),
          lead_time_days: (lead_time_days === undefined || lead_time_days === null || lead_time_days === '') ? null : Number(lead_time_days),
          notes: notes ?? null,
        })
        .returning('*');
    });

    return res.status(201).json({ supplier });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A supplier with this name already exists' });
    }
    console.error('[suppliers] httpCreateSupplier failed', err);
    return res.status(500).json({ error: 'Failed to create supplier' });
  }
}

// ─────────────────────────────────────────────
// PATCH /api/v1/suppliers/:id — update supplier fields
// ─────────────────────────────────────────────
export async function httpUpdateSupplier(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { name, contact_name, contact_email, contact_phone, notes, moq, lead_time_days } = req.body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    updates.name = name.trim();
  }
  if (contact_name !== undefined) updates.contact_name = contact_name?.trim() || null;
  if (contact_email !== undefined) updates.contact_email = contact_email?.trim() || null;
  if (contact_phone !== undefined) updates.contact_phone = contact_phone?.trim() || null;
  if (notes !== undefined) updates.notes = notes?.trim() || null;
  if (moq !== undefined) updates.moq = (moq === null || moq === '') ? null : Number(moq);
  if (lead_time_days !== undefined) updates.lead_time_days = (lead_time_days === null || lead_time_days === '') ? null : Number(lead_time_days);

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' });
  updates.updated_at = new Date();

  try {
    const [supplier] = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const existing = await trx('suppliers').where({ id, shop_id: shopId }).first();
      if (!existing) throw Object.assign(new Error('SUPPLIER_NOT_FOUND'), { statusCode: 404 });
      const result = await trx('suppliers').where({ id, shop_id: shopId }).update(updates).returning('*');
      await enqueueShopSnapshotJob(trx, shopId);
      return result;
    });
    return res.json({ supplier });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Supplier not found' });
    if (err?.code === '23505') return res.status(409).json({ error: 'A supplier with this name already exists' });
    console.error('[suppliers] httpUpdateSupplier failed', err);
    return res.status(500).json({ error: 'Failed to update supplier' });
  }
}

// ─────────────────────────────────────────────
// DELETE /api/v1/suppliers/:id — soft-delete (active=false)
// purchase_orders.supplier_id is ON DELETE RESTRICT; soft-delete preserves PO history.
// ─────────────────────────────────────────────
export async function httpDeleteSupplier(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const existing = await trx('suppliers').where({ id, shop_id: shopId }).first();
      if (!existing) throw Object.assign(new Error('SUPPLIER_NOT_FOUND'), { statusCode: 404 });
      await trx('suppliers').where({ id, shop_id: shopId }).update({ active: false, updated_at: new Date() });
      await enqueueShopSnapshotJob(trx, shopId);
      console.info('[SUPPLIERS] supplier soft-deleted', { shopId, id });
    });
    return res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Supplier not found' });
    console.error('[suppliers] httpDeleteSupplier failed', err);
    return res.status(500).json({ error: 'Failed to delete supplier' });
  }
}

// ─────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────

export async function httpGetPurchaseOrders(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const purchase_orders = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('purchase_orders as po')
        .join('suppliers as s', 'po.supplier_id', 's.id')
        .leftJoin('purchase_order_line_items as li', function () {
          this.on('li.po_id', 'po.id')
              .andOn('li.shop_id', trx.raw('?', [shopId]));
        })
        .where('po.shop_id', shopId)
        .groupBy('po.id', 's.name', 's.on_time_rate', 's.fill_rate', 's.avg_delivery_days', 's.contact_email', 's.contact_name', 's.moq')
        .orderBy('po.created_at', 'desc')
        .select(
          'po.id', 'po.po_number', 'po.status', 'po.expected_delivery_date', 'po.actual_delivery_date',
          'po.notes', 'po.receive_notes', 'po.document_url', 'po.created_at',
          's.name as supplier_name',
          's.contact_email as supplier_contact_email',
          's.contact_name as supplier_contact_name',
          's.moq as supplier_moq',
          's.on_time_rate as supplier_on_time_rate',
          's.fill_rate as supplier_fill_rate',
          's.avg_delivery_days as supplier_avg_delivery_days',
          // GH-1109: durable Receive dispatch projection for collapsed PO identity.
          // Correlated subqueries preserve one purchase-order row despite the
          // existing line-item aggregation. Closed/cancelled work is not active.
          trx.raw(`(
            SELECT rj.receive_job_id
            FROM receive_jobs rj
            WHERE rj.po_id = po.id
              AND rj.shop_id = po.shop_id
              AND rj.status NOT IN ('closed', 'cancelled')
            ORDER BY rj.created_at DESC, rj.receive_job_id DESC
            LIMIT 1
          ) as receive_job_id`),
          trx.raw(`(
            SELECT rj.status
            FROM receive_jobs rj
            WHERE rj.po_id = po.id
              AND rj.shop_id = po.shop_id
              AND rj.status NOT IN ('closed', 'cancelled')
            ORDER BY rj.created_at DESC, rj.receive_job_id DESC
            LIMIT 1
          ) as receive_status`),
          trx.raw(`(
            SELECT rj.assigned_operator_id
            FROM receive_jobs rj
            WHERE rj.po_id = po.id
              AND rj.shop_id = po.shop_id
              AND rj.status NOT IN ('closed', 'cancelled')
            ORDER BY rj.created_at DESC, rj.receive_job_id DESC
            LIMIT 1
          ) as receive_assigned_operator_id`),
          trx.raw(`(
            SELECT COALESCE(
              NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
              u.email
            )
            FROM receive_jobs rj
            LEFT JOIN users u
              ON u.id = rj.assigned_operator_id
             AND u.shop_id = rj.shop_id
            WHERE rj.po_id = po.id
              AND rj.shop_id = po.shop_id
              AND rj.status NOT IN ('closed', 'cancelled')
            ORDER BY rj.created_at DESC, rj.receive_job_id DESC
            LIMIT 1
          ) as receive_assigned_operator_name`),
          // First line item name for PO summary row — avoids expanding to identify PO
          trx.raw('(SELECT description FROM purchase_order_line_items WHERE po_id = po.id LIMIT 1) as first_line_description'),
          trx.raw('COUNT(li.id) as line_items_count'),
          trx.raw('COALESCE(SUM(li.quantity_ordered), 0) as total_units_ordered'),
          trx.raw('COALESCE(SUM(li.quantity_received), 0) as total_units_received'),
          trx.raw(`CASE WHEN po.status IN ('received', 'cancelled') THEN 0 ELSE COALESCE(SUM(${pendingDeliveryQuantitySql('li')}), 0) END as total_units_pending_delivery`),
          trx.raw('COALESCE(SUM(li.unit_cost_cents * li.quantity_ordered), 0) as total_cost_cents'),
          trx.raw('COUNT(*) FILTER (WHERE li.lasyncro_variant_id IS NULL) as unlinked_lines_count')
        );
    });

    return res.json({ purchase_orders });
  } catch (err) {
    console.error('[suppliers] httpGetPurchaseOrders failed', err);
    return res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
}

export async function httpCreatePurchaseOrder(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  // GH-1262 S1: validation, idempotency and the atomic write live in
  // purchaseOrderCreation.service.ts. A replay returns the original PO.
  try {
    const idempotencyKey = readIdempotencyKey(req.get('Idempotency-Key'));
    const input = parsePurchaseOrderCreateInput(req.body);
    const { purchaseOrder } = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const result = await createPurchaseOrderIdempotently(trx, shopId, idempotencyKey, input);
      // A replay writes nothing, so it does not re-schedule the snapshot.
      if (!result.replayed) await enqueueShopSnapshotJob(trx, shopId);
      return result;
    });
    return res.status(201).json({ purchase_order: purchaseOrder });
  } catch (err) {
    if (err instanceof PurchaseOrderCreationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[suppliers] httpCreatePurchaseOrder failed', err);
    return res.status(500).json({ error: 'Failed to create purchase order' });
  }
}

export async function httpGetPoLineItems(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const poId = req.params.poId as string;

  try {
    const line_items = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('purchase_order_line_items as li')
        .leftJoin('variants as v', 'li.lasyncro_variant_id', 'v.lasyncro_variant_id')
        .leftJoin('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where({ 'li.po_id': poId, 'li.shop_id': shopId })
        .orderBy('li.created_at', 'asc')
        .select(
          'li.id', 'li.lasyncro_variant_id', 'li.description',
          'li.quantity_ordered', 'li.quantity_received', 'li.quantity_pending_delivery', 'li.unit_cost_cents',
          'v.sku', 'v.image_url', 'p.title as product_title'
        );
    });

    const deliveries = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('receive_job_lines as l').join('receive_jobs as j', 'j.receive_job_id', 'l.receive_job_id')
        .where({ 'j.shop_id': shopId, 'l.shop_id': shopId, 'j.po_id': poId }).where('j.status', 'closed')
        .select('l.po_line_item_id', 'l.receive_job_line_id', 'j.receive_job_id', 'j.delivery_accounting_version', 'j.actual_delivery_date', 'l.inspected_by', 'j.closed_by', 'l.quantity_expected', 'l.quantity_accepted', 'l.quantity_rejected', 'l.quantity_delivered', 'l.quantity_missing', 'l.quantity_deferred', 'l.quantity_held_recoverable')
        .orderBy('j.closed_at').orderBy('l.receive_job_line_id');
    });
    return res.json({ line_items, deliveries });
  } catch (err) {
    console.error('[suppliers] httpGetPoLineItems failed', err);
    return res.status(500).json({ error: 'Failed to fetch line items' });
  }
}

export async function httpUpdatePoStatus(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const poId = req.params.poId as string;
  const { status, actual_delivery_date } = req.body;

  const VALID_STATUSES = [
    'draft', 'ordered', 'confirmed', 'in_production',
    'shipped', 'partially_received', 'received', 'cancelled'
  ];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const po = await trx('purchase_orders as po')
        .join('suppliers as s', 'po.supplier_id', 's.id')
        .where({ 'po.id': poId, 'po.shop_id': shopId })
        .select('po.*', 's.name as supplier_name')
        .forUpdate('po').first();

      if (!po) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 });
      const active = await trx('receive_jobs').where({ shop_id: shopId, po_id: poId }).whereNotIn('status', ['closed', 'cancelled']).first('receive_job_id');
      const allowedNext: Record<string, string[]> = {
        draft: ['ordered', 'cancelled'], ordered: ['confirmed', 'in_production', 'shipped', 'cancelled'],
        confirmed: ['in_production', 'shipped', 'cancelled'], in_production: ['shipped', 'cancelled'],
        shipped: ['cancelled'], partially_received: ['cancelled'], received: [], cancelled: [],
      };
      if (active || (status !== po.status && !(allowedNext[po.status] ?? []).includes(status)) || ['received', 'partially_received'].includes(status)) {
        throw Object.assign(new Error('PO status is protected by the Receive lifecycle'), { statusCode: 409 });
      }
      if (status === po.status) return; // no repeated alerts or supplier count

      await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .update({
          status,
          actual_delivery_date: actual_delivery_date ?? po.actual_delivery_date,
          updated_at: new Date(),
        });

      // FEAT-004: Emit receive alert so operators are notified to open a receive session.
      if (status === 'shipped') {
        await fireReceiveArrivedAlert(trx, {
          shopId,
          poId,
          supplierName: po.supplier_name,
        });
      }

      // Write actual_delivery_date on shipped if provided, then recompute rating
      // so on_time_rate reflects late/early delivery at receive time, not just on close.
      if (status === 'shipped' && actual_delivery_date) {
        await recomputeSupplierRating(trx, shopId, po.supplier_id);
      }

      await enqueueShopSnapshotJob(trx, shopId);
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[suppliers] httpUpdatePoStatus failed', err);
    return res.status(500).json({ error: 'Failed to update PO status' });
  }
}

/**
 * POST /api/v1/suppliers/purchase-orders/:poId/receive
 * Retired quantity writer: preserves route authorization/tenant lookup,
 * then refuses receipt outside the canonical Receive transaction.
 */
export async function httpReceiveShipment(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    let poExists = false;
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const po = await trx('purchase_orders')
        .where({ id: req.params.poId, shop_id: shopId })
        .first('id');
      poExists = Boolean(po);
    });
    if (!poExists) return res.status(404).json({ error: 'Purchase order not found' });
    return res.status(409).json({ code: 'RECEIVE_SESSION_REQUIRED', error: 'Receive this delivery through a Receive job' });
  } catch (err) {
    console.error('[suppliers] httpReceiveShipment failed', err);
    return res.status(500).json({ error: 'Failed to check purchase order' });
  }
}

/**
 * PATCH /api/v1/suppliers/purchase-orders/:poId
 * Updates editable PO header fields: expected_delivery_date, notes, document_url.
 * Cannot modify line items or status via this endpoint.
 * Only allowed when PO is not yet shipped/received/cancelled.
 */
export async function httpPatchPurchaseOrder(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { poId } = req.params;
  const { expected_delivery_date, notes, document_url } = req.body;

  const updates: Record<string, unknown> = {};
  if (expected_delivery_date !== undefined) updates.expected_delivery_date = expected_delivery_date || null;
  if (notes !== undefined) updates.notes = notes?.trim() || null;
  if (document_url !== undefined) updates.document_url = document_url?.trim() || null;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' });
  updates.updated_at = new Date();

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const po = await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .select('status')
        .first();

      if (!po) throw Object.assign(new Error('PO_NOT_FOUND'), { statusCode: 404 });
      if (['shipped', 'received', 'cancelled'].includes(po.status)) {
        throw Object.assign(new Error('PO_NOT_EDITABLE'), { statusCode: 409 });
      }

      await trx('purchase_orders').where({ id: poId, shop_id: shopId }).update(updates);
      await enqueueShopSnapshotJob(trx, shopId);
      console.info('[SUPPLIERS] PO updated', { shopId, poId, updates });
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'PO not found' });
    if (err.statusCode === 409) return res.status(409).json({ error: 'PO cannot be modified in its current status' });
    console.error('[suppliers] httpPatchPurchaseOrder failed', err);
    return res.status(500).json({ error: 'Failed to update purchase order' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/suppliers/variants/search?q=...
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight variant search for PO line item autocomplete.
// Returns id, sku, title, unit_cost for PO-eligible variants matching the query.
//
// GH-1262 S1 H1: offers only variants the canonical PO creation service
// accepts. This predicate mirrors loadEligibleVariantIds in
// services/purchasing/purchaseOrderCreation.service.ts and must stay identical
// to it. Eligibility is applied before LIMIT; EXISTS keeps one row per variant.
const PO_ELIGIBLE_PRODUCT_STATUSES = ['active', 'draft', 'unlisted'];
const PO_SHOPIFY_VARIANT_GID_PATTERN = '^gid://shopify/ProductVariant/[1-9][0-9]*$';
const PO_SHOPIFY_PRODUCT_GID_PATTERN = '^gid://shopify/Product/[1-9][0-9]*$';

export async function httpSearchVariants(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const q = (req.query.q as string ?? '').trim();
  try {
    const variants = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      let query = trx('variants as v')
        .join('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id').andOn('p.shop_id', 'v.shop_id');
        })
        .where({ 'v.shop_id': shopId })
        .whereIn('p.status', PO_ELIGIBLE_PRODUCT_STATUSES)
        .whereExists(function () {
          this.select(trx.raw('1'))
            .from('external_product_identity_map as m')
            .whereRaw('m.shop_id = v.shop_id')
            .andWhereRaw('m.lasyncro_variant_id = v.lasyncro_variant_id')
            .andWhere('m.platform', 'shopify')
            .andWhereRaw('m.external_variant_id ~ ?', [PO_SHOPIFY_VARIANT_GID_PATTERN])
            .andWhereRaw('m.external_product_id ~ ?', [PO_SHOPIFY_PRODUCT_GID_PATTERN]);
        })
        .whereNotNull('v.sku')
        .whereNot('v.sku', '')
        .select('v.lasyncro_variant_id', 'v.sku', 'v.title', 'v.unit_cost', 'v.image_url', 'p.title as product_title')
        .orderBy('v.sku', 'asc')
        .limit(30);
      if (q) {
        query = query.where(function () {
          this.whereILike('v.sku', `%${q}%`).orWhereILike('v.title', `%${q}%`).orWhereILike('p.title', `%${q}%`);
        });
      }
      return query;
    });
    return res.json({ variants });
  } catch (err: any) {
    console.error('[VARIANTS_SEARCH_FAILED]', { shopId, q, error: err.message });
    return res.status(500).json({ error: 'Failed to search variants' });
  }
}
