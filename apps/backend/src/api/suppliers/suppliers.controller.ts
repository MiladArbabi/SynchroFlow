// apps/backend/src/api/suppliers/suppliers.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { fireReceiveArrivedAlert } from '../../services/wms/wmsAlerts.service.js';
import { recomputeSupplierRating } from '../../services/suppliers/supplierRating.service.js';

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
      return trx('suppliers').where({ id, shop_id: shopId }).update(updates).returning('*');
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
        .groupBy('po.id', 's.name', 's.on_time_rate', 's.fill_rate', 's.avg_delivery_days')
        .orderBy('po.created_at', 'desc')
        .select(
          'po.id', 'po.status', 'po.expected_delivery_date', 'po.actual_delivery_date',
          'po.notes', 'po.receive_notes', 'po.document_url', 'po.created_at',
          's.name as supplier_name',
          's.on_time_rate as supplier_on_time_rate',
          's.fill_rate as supplier_fill_rate',
          's.avg_delivery_days as supplier_avg_delivery_days',
          // First line item name for PO summary row — avoids expanding to identify PO
          trx.raw('(SELECT description FROM purchase_order_line_items WHERE po_id = po.id LIMIT 1) as first_line_description'),
          trx.raw('COUNT(li.id) as line_items_count'),
          trx.raw('COALESCE(SUM(li.quantity_ordered), 0) as total_units_ordered'),
          trx.raw('COALESCE(SUM(li.quantity_received), 0) as total_units_received'),
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

  const { supplier_id, expected_delivery_date, notes, document_url, line_items } = req.body;

  if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' });
  if (!Array.isArray(line_items) || line_items.length === 0) {
    return res.status(400).json({ error: 'line_items must be a non-empty array' });
  }
  for (const item of line_items) {
    if (!item.description || !item.quantity_ordered || item.quantity_ordered < 1) {
      return res.status(400).json({ error: 'Each line item requires description and quantity_ordered >= 1' });
    }
  }

  try {
    const po = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const supplier = await trx('suppliers')
        .where({ id: supplier_id, shop_id: shopId })
        .first();

      if (!supplier) {
        res.status(404).json({ error: 'Supplier not found' });
        return null;
      }

      const [newPo] = await trx('purchase_orders')
        .insert({
          shop_id: shopId,
          supplier_id,
          status: 'draft',
          expected_delivery_date: expected_delivery_date ?? null,
          notes: notes ?? null,
          document_url: document_url ?? null,
        })
        .returning('*');

      await trx('purchase_order_line_items').insert(
        line_items.map((item: any) => ({
          po_id: newPo.id,
          shop_id: shopId,
          lasyncro_variant_id: item.lasyncro_variant_id ?? null,
          description: item.description,
          quantity_ordered: item.quantity_ordered,
          quantity_received: 0,
          unit_cost_cents: item.unit_cost_cents ?? null,
        }))
      );

      return newPo;
    });

    if (!po) return;
    return res.status(201).json({ purchase_order: po });
  } catch (err) {
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
          'li.quantity_ordered', 'li.quantity_received', 'li.unit_cost_cents',
          'v.sku', 'v.image_url', 'p.title as product_title'
        );
    });

    return res.json({ line_items });
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
        .first();

      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .update({
          status,
          actual_delivery_date: actual_delivery_date ?? po.actual_delivery_date,
          updated_at: new Date(),
        });

      if (status === 'received') {
        await trx('suppliers')
          .where({ id: po.supplier_id, shop_id: shopId })
          .increment('total_pos', 1);
        await recomputeSupplierRating(trx, shopId, po.supplier_id);
        // Resolve the receive alert — PO fully received, no further operator action needed.
        await fireReceiveArrivedAlert(trx, { shopId, poId, supplierName: po.supplier_name, isActive: false });
      }

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

      if (status === 'partially_received') {
        await recomputeSupplierRating(trx, shopId, po.supplier_id);
      }
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[suppliers] httpUpdatePoStatus failed', err);
    return res.status(500).json({ error: 'Failed to update PO status' });
  }
}

/**
 * POST /api/v1/suppliers/purchase-orders/:poId/receive
 * Records quantities received per line item.
 * Auto-transitions PO to received if all items fully received.
 * Triggers supplier rating recompute on every receive action.
 */
export async function httpReceiveShipment(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const poId = req.params.poId as string;
  const { receive_notes, line_items } = req.body;

  if (!Array.isArray(line_items) || line_items.length === 0) {
    return res.status(400).json({ error: 'line_items required' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const po = await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .first();

      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      // Increment quantity_received per line item
      for (const item of line_items) {
        if (!item.line_item_id || item.quantity_received == null || item.quantity_received < 0) continue;

        const existing = await trx('purchase_order_line_items')
          .where({ id: item.line_item_id, po_id: poId, shop_id: shopId })
          .first();

        if (!existing) continue;

        const newQty = Math.min(
          existing.quantity_received + item.quantity_received,
          existing.quantity_ordered // never exceed ordered qty
        );

        await trx('purchase_order_line_items')
          .where({ id: item.line_item_id })
          .update({ quantity_received: newQty, updated_at: new Date() });
      }

      // Check if fully received
      const allItems = await trx('purchase_order_line_items')
        .where({ po_id: poId, shop_id: shopId });

      const fullyReceived = allItems.every(
        (i: any) => i.quantity_received >= i.quantity_ordered
      );

      const today = new Date().toISOString().split('T')[0];
      const newStatus = fullyReceived ? 'received' : 'partially_received';

      await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .update({
          status: newStatus,
          actual_delivery_date: po.actual_delivery_date ?? today,
          receive_notes: receive_notes ?? po.receive_notes,
          updated_at: new Date(),
        });

      if (fullyReceived) {
        await trx('suppliers')
          .where({ id: po.supplier_id, shop_id: shopId })
          .increment('total_pos', 1);
      }

      await recomputeSupplierRating(trx, shopId, po.supplier_id);
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[suppliers] httpReceiveShipment failed', err);
    return res.status(500).json({ error: 'Failed to record shipment receipt' });
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
// Returns id, sku, title, unit_cost for all variants matching the query.
export async function httpSearchVariants(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const q = (req.query.q as string ?? '').trim();
  try {
    const variants = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      let query = trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where({ 'v.shop_id': shopId })
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