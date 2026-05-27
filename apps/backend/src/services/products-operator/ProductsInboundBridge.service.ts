// apps/backend/src/services/products-operator/ProductsInboundBridge.service.ts
//
// ProductsInboundBridge
// ---------------------
// Cross-domain bridge: pulls open PO pipeline into the products operator surface.
//
// DESIGN CONTRACT:
// - Read-only — never mutates supplier/PO state
// - Uses withTenant for RLS — caller passes shopId, bridge owns its own transaction
// - Returns null if PO data unavailable or query fails — caller degrades gracefully
// - "Open" POs: status NOT IN ('received', 'cancelled', 'draft')
// - "Overdue" POs: open AND expected_delivery_date < TODAY
// - po_short_ref: first 8 chars of UUID — no po_reference column exists on purchase_orders
//
// SCHEMA FACTS (verified 2026-05-26):
// - purchase_orders: id (uuid), shop_id, supplier_id (int FK), status (enum),
//   expected_delivery_date (date), total_units does NOT exist — computed via line items
// - purchase_order_line_items: po_id, quantity_ordered, quantity_received, lasyncro_variant_id
// - suppliers: id (int), name
// - Status enum: draft | ordered | confirmed | in_production | shipped | partially_received | received | cancelled

import { withTenant } from '@lasyncro/backend-core/db.js';

// ── Open PO statuses ──────────────────────────────────────────────────────────
const OPEN_PO_STATUSES = [
  'ordered',
  'confirmed',
  'in_production',
  'shipped',
  'partially_received',
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type InboundPO = {
  /** First 8 chars of UUID — display reference (no po_reference column) */
  po_short_ref: string;
  supplier_name: string;
  status: string;
  expected_delivery_date: string | null;
  /** Days past expected_delivery_date. Null if date not set or not yet overdue. */
  overdue_days: number | null;
  total_units_ordered: number;
  total_units_received: number;
  /** Unit IDs on this PO that are currently at zero stock in inventory_truth */
  covers_stocked_out_skus: string[];
};

export type ProductsInboundSignals = {
  /** Count of open POs (ordered → partially_received) */
  open_po_count: number;
  /** Total units expected across all open POs */
  total_units_expected: number;
  /** Total committed cash outflow (unit_cost_cents × quantity_ordered). Null if no costs entered. */
  total_committed_value_cents: number | null;
  /** POs past expected_delivery_date — need supplier chase */
  overdue_pos: InboundPO[];
  /** POs not yet overdue */
  pending_pos: InboundPO[];
};

// ── Service ───────────────────────────────────────────────────────────────────

export async function getProductsInboundSignals(
  shopId: number
): Promise<ProductsInboundSignals | null> {
  try {
    return await withTenant(shopId, async (trx) => {
      // Compare date strings (YYYY-MM-DD) to avoid timezone boundary issues.
      // PostgreSQL date type returns as ISO timestamp — we extract date part only.
      const todayStr = new Date().toISOString().slice(0, 10);

      // ── Fetch open POs with supplier name + line item aggregates ─────────
      const poRows = await trx('purchase_orders as po')
        .join('suppliers as s', 's.id', 'po.supplier_id')
        .leftJoin('purchase_order_line_items as poli', 'poli.po_id', 'po.id')
        .where('po.shop_id', shopId)
        .whereIn('po.status', OPEN_PO_STATUSES)
        .groupBy('po.id', 'po.status', 'po.expected_delivery_date', 's.name')
        .select([
          'po.id',
          'po.status',
          'po.expected_delivery_date',
          's.name as supplier_name',
          trx.raw('COALESCE(SUM(poli.quantity_ordered), 0)::integer AS total_units_ordered'),
          trx.raw('COALESCE(SUM(poli.quantity_received), 0)::integer AS total_units_received'),
          trx.raw(`
            CASE
              WHEN COUNT(poli.unit_cost_cents) = COUNT(poli.id)
              THEN SUM(poli.unit_cost_cents * poli.quantity_ordered)
              ELSE NULL
            END AS committed_value_cents
          `),
        ])
        .orderBy('po.expected_delivery_date', 'asc');

      if (poRows.length === 0) {
        return {
          open_po_count: 0,
          total_units_expected: 0,
          total_committed_value_cents: null,
          overdue_pos: [],
          pending_pos: [],
        };
      }

      // ── Fetch stocked-out variant IDs for cross-reference ────────────────
      // Used to flag which open POs cover currently stocked-out SKUs
      const stockedOutRows = await trx('inventory_truth as it')
        .where('it.shop_id', shopId)
        .where('it.available_quantity', '<=', 0)
        .select('it.lasyncro_variant_id');

      const stockedOutIds = new Set(stockedOutRows.map((r: { lasyncro_variant_id: string }) => r.lasyncro_variant_id));

      // ── Fetch variant IDs per PO for stocked-out cross-reference ─────────
      const poIds = poRows.map((r: { id: string }) => r.id);
      const lineItemRows = await trx('purchase_order_line_items')
        .whereIn('po_id', poIds)
        .whereNotNull('lasyncro_variant_id')
        .select(['po_id', 'lasyncro_variant_id']);

      // Map: po_id → stocked-out SKUs covered by this PO
      const poStockedOutMap = new Map<string, string[]>();
      for (const row of lineItemRows) {
        if (!stockedOutIds.has(row.lasyncro_variant_id)) continue;
        const existing = poStockedOutMap.get(row.po_id) ?? [];
        existing.push(row.lasyncro_variant_id);
        poStockedOutMap.set(row.po_id, existing);
      }

      // ── Assemble InboundPO records ────────────────────────────────────────
      const overdue_pos: InboundPO[] = [];
      const pending_pos: InboundPO[] = [];
      let total_units_expected = 0;
      let total_committed_value_cents: number | null = 0;

      for (const row of poRows) {
        // Slice to YYYY-MM-DD for timezone-safe date comparison
        const expectedDateStr = row.expected_delivery_date
          ? String(row.expected_delivery_date).slice(0, 10)
          : null;

        const overdueDays =
          expectedDateStr && expectedDateStr < todayStr
            ? Math.floor(
                (new Date(todayStr).getTime() - new Date(expectedDateStr).getTime()) / 86_400_000
              )
            : null;

        const po: InboundPO = {
          po_short_ref: (row.id as string).slice(0, 8).toUpperCase(),
          supplier_name: row.supplier_name,
          status: row.status,
          expected_delivery_date: row.expected_delivery_date ?? null,
          overdue_days: overdueDays,
          total_units_ordered: Number(row.total_units_ordered),
          total_units_received: Number(row.total_units_received),
          covers_stocked_out_skus: poStockedOutMap.get(row.id) ?? [],
        };

        total_units_expected += po.total_units_ordered;

        // Committed value — null if any PO has missing costs
        if (total_committed_value_cents !== null) {
          if (row.committed_value_cents == null) {
            total_committed_value_cents = null;
          } else {
            total_committed_value_cents += Number(row.committed_value_cents);
          }
        }

        if (overdueDays !== null && overdueDays > 0) {
          overdue_pos.push(po);
        } else {
          pending_pos.push(po);
        }
      }

      return {
        open_po_count: poRows.length,
        total_units_expected,
        total_committed_value_cents,
        overdue_pos,
        pending_pos,
      };
    });
  } catch {
    // PO data unavailable — products module degrades gracefully
    return null;
  }
}