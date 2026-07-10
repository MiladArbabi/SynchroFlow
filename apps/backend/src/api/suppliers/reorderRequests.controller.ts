// File: apps/backend/src/api/suppliers/reorderRequests.controller.ts
//
// MOQ Accumulation System — sourcing-recommendation-playbook.md §8
// Four endpoints: GET (by_supplier grouped), POST (queue), DELETE (dismiss), convert (→ PO).
// RLS: all queries require SET LOCAL app.current_tenant.
// Supplier is locked at queue time — never re-resolved on convert (§8.1).

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

// ── GET /reorder-requests ─────────────────────────────────────────────────────
// Returns all pending requests grouped by supplier, with MOQ progress.
export async function httpListReorderRequests(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let result: any[] = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Fetch all pending requests with variant + supplier detail in one query
      result = await trx('reorder_requests as rr')
        .join('suppliers as s', 's.id', 'rr.supplier_id')
        .join('variants as v', 'v.lasyncro_variant_id', 'rr.lasyncro_variant_id')
        .where('rr.shop_id', shopId)
        .andWhere('rr.status', 'pending')
        .orderBy(['rr.supplier_id', 'rr.created_at'])
        .select(
          'rr.id', 'rr.lasyncro_variant_id', 'rr.supplier_id', 'rr.qty_requested',
          'rr.source', 'rr.created_at',
          's.name as supplier_name', 's.moq',
          'v.sku', 'v.title'
        );
    });

    // Group by supplier — keyed by supplier_id
    const bySupplierMap = new Map<number, any>();

    for (const row of result) {
      if (!bySupplierMap.has(row.supplier_id)) {
        bySupplierMap.set(row.supplier_id, {
          supplier_id:   row.supplier_id,
          supplier_name: row.supplier_name,
          moq:           row.moq ? Number(row.moq) : null,
          total_qty:     0,
          moq_met:       false,
          requests:      [],
        });
      }
      const group = bySupplierMap.get(row.supplier_id);
      group.total_qty += Number(row.qty_requested);
      group.requests.push({
        id:                  row.id,
        lasyncro_variant_id: row.lasyncro_variant_id,
        sku:                 row.sku,
        title:               row.title,
        qty_requested:       Number(row.qty_requested),
        source:              row.source,
        created_at:          row.created_at,
      });
    }

    // Resolve moq_met after total_qty is fully accumulated
    const bySupplier = Array.from(bySupplierMap.values()).map((group) => ({
      ...group,
      // moq_met is false when moq is null — no target to meet
      moq_met: group.moq !== null && group.total_qty >= group.moq,
    }));

    return res.json({ by_supplier: bySupplier });
  } catch (err) {
    console.error('[reorder-requests] httpListReorderRequests failed', err);
    return res.status(500).json({ error: 'Failed to fetch reorder requests' });
  }
}

// ── POST /reorder-requests ────────────────────────────────────────────────────
// Queues a new reorder request. Supplier locked at creation time.
export async function httpCreateReorderRequest(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { lasyncro_variant_id, supplier_id, qty_requested, source } = req.body ?? {};

  if (!lasyncro_variant_id || !supplier_id || !qty_requested || !source) {
    return res.status(400).json({ error: 'lasyncro_variant_id, supplier_id, qty_requested, and source are required' });
  }
  if (!['alert', 'manual'].includes(source)) {
    return res.status(400).json({ error: 'source must be "alert" or "manual"' });
  }
  if (typeof qty_requested !== 'number' || qty_requested < 1) {
    return res.status(400).json({ error: 'qty_requested must be a positive integer' });
  }

  try {
    let row: any = null;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Verify supplier belongs to shop and is active
      const supplier = await trx('suppliers')
        .where({ id: supplier_id, shop_id: shopId, active: true })
        .first();
      if (!supplier) return; // null row signals 404 below

      // Verify variant belongs to shop
      const variant = await trx('variants')
        .where({ lasyncro_variant_id, shop_id: shopId })
        .first();
      if (!variant) return; // null row signals 404 below

      const [inserted] = await trx('reorder_requests')
        .insert({
          shop_id:             shopId,
          lasyncro_variant_id,
          supplier_id,
          qty_requested,
          source,
          status:              'pending',
          created_by:          userId ?? null,
        })
        .returning('*');

      row = inserted;
    });

    if (!row) return res.status(404).json({ error: 'Supplier or variant not found' });
    return res.status(201).json({ request: row });
  } catch (err) {
    console.error('[reorder-requests] httpCreateReorderRequest failed', err);
    return res.status(500).json({ error: 'Failed to create reorder request' });
  }
}

// ── DELETE /reorder-requests/:id ──────────────────────────────────────────────
// Dismisses a single pending request. 400 if already converted.
export async function httpDeleteReorderRequest(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    let found = false;
    let alreadyConverted = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const existing = await trx('reorder_requests')
        .where({ id, shop_id: shopId })
        .first();

      if (!existing) return;
      found = true;

      if (existing.status !== 'pending') {
        alreadyConverted = true;
        return;
      }

      await trx('reorder_requests')
        .where({ id, shop_id: shopId })
        .update({ status: 'dismissed', updated_at: trx.fn.now() });
    });

    if (!found) return res.status(404).json({ error: 'Request not found' });
    if (alreadyConverted) return res.status(400).json({ error: 'Only pending requests can be dismissed' });
    return res.status(204).send();
  } catch (err) {
    console.error('[reorder-requests] httpDeleteReorderRequest failed', err);
    return res.status(500).json({ error: 'Failed to dismiss reorder request' });
  }
}

// ── POST /reorder-requests/convert ───────────────────────────────────────────
// Converts all pending requests for a supplier into a single PO.
// Line items: one per unique variant, qty = sum of all pending requests for that variant.
// Marks all converted requests: status='converted', converted_po_id, converted_at.
export async function httpConvertReorderRequests(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { supplier_id, expected_delivery_date, notes } = req.body ?? {};

  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id is required' });
  }

  try {
    let poId: string | null = null;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Fetch all pending for this supplier
      const pending = await trx('reorder_requests as rr')
        .join('variants as v', 'v.lasyncro_variant_id', 'rr.lasyncro_variant_id')
        .where('rr.shop_id', shopId)
        .andWhere('rr.supplier_id', supplier_id)
        .andWhere('rr.status', 'pending')
        .select('rr.id', 'rr.lasyncro_variant_id', 'rr.qty_requested', 'v.sku', 'v.title');

      if (!pending.length) return; // null poId signals 400 below

      // Collapse to one line item per variant — sum qty across multiple requests
      const lineItemMap = new Map<string, { description: string; qty: number; lasyncro_variant_id: string }>();
      for (const r of pending) {
        const key = r.lasyncro_variant_id;
        if (!lineItemMap.has(key)) {
          lineItemMap.set(key, {
            lasyncro_variant_id: r.lasyncro_variant_id,
            description:         r.sku ?? r.title ?? r.lasyncro_variant_id,
            qty:                 0,
          });
        }
        lineItemMap.get(key)!.qty += Number(r.qty_requested);
      }

      //Create PO
      const [po] = await trx('purchase_orders')
        .insert({
          shop_id:                shopId,
          supplier_id,
          // Cast required — status is purchase_order_status enum, not text
          status:                 trx.raw("'draft'::purchase_order_status"),
          expected_delivery_date: expected_delivery_date ?? null,
          notes:                  notes ?? null,
          // purchase_orders has no created_by column — omitted
        })
        .returning('id');

      poId = po.id;

      // shop_id required on line items — tenant isolation policy enforces it
      await trx('purchase_order_line_items').insert(
        Array.from(lineItemMap.values()).map((item) => ({
          po_id:               poId,
          shop_id:             shopId,
          lasyncro_variant_id: item.lasyncro_variant_id,
          description:         item.description,
          quantity_ordered:    item.qty,
          quantity_received:   0,
        }))
      );

      // Mark all pending requests as converted
      const now = new Date();
      await trx('reorder_requests')
        .whereIn('id', pending.map((r: any) => r.id))
        .update({
          status:          'converted',
          converted_po_id: poId,
          converted_at:    now,
          updated_at:      now,
        });
    });

    if (!poId) return res.status(400).json({ error: 'No pending requests found for this supplier' });
    return res.status(201).json({ po_id: poId });
  } catch (err) {
    console.error('[reorder-requests] httpConvertReorderRequests failed', err);
    return res.status(500).json({ error: 'Failed to convert reorder requests' });
  }
}