// apps/backend/src/api/exports/exports.controller.ts
//
// EXPORT ENGINE (GH #1014 — Sprint 1)
// -------------------------------------
// Sync-stream exports for Orders, Returns, Finances, and Morning Brief.
//
// Tier gating (enforced in routes, not here):
//   Core+  → CSV (orders, returns, finances)
//   Growth+ → PDF (morning brief)
//
// Date window enforcement (see @lasyncro/backend-core/utils/tierDataWindow.js):
//   Starter → 60 days · Core → 180 days · Growth+ → unlimited
//
// All exports stream directly — no buffering, no temp files.
// Content-Disposition is always 'attachment' — never 'inline'.
//
// DB column sources (verified from migrations):
//   orders                  → lasyncro_order_id, order_created_at, total_price,
//                             currency, payment_state, source, shipping_country_code
//   order_fulfillment_status → status
//   order_revenue_units     → sku, title, quantity
//   refund_executions       → lasyncro_refund_execution_id, executed_at,
//                             total_refund_amount, return_reason
//   refund_execution_line_items → refunded_quantity, lasyncro_revenue_unit_id
//   order_revenue_units     → title, sku (joined for return line label)
//   order_margin_snapshot   → gross_revenue, estimated_cost, gross_margin, margin_pct
//   morning_brief_snapshots → signals, summary_line, generated_at

import { Request, Response } from 'express';
import { format as csvFormat } from '@fast-csv/format';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { Tier, TIERS } from '@lasyncro/backend-core/config/tiers.js';
import { tierDataWindowSince } from '@lasyncro/backend-core/utils/tierDataWindow.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function resolvedTier(req: Request): Tier {
  const raw = req.user?.tier ?? 'starter';
  return TIERS.includes(raw as Tier) ? (raw as Tier) : 'starter';
}

function filename(resource: string, format: 'csv' | 'pdf'): string {
  const date = new Date().toISOString().split('T')[0];
  return `lasyncro-${resource}-${date}.${format}`;
}

// ─── ORDERS CSV ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/orders
 *
 * Columns: order_id, created_at, total_price, currency,
 *          payment_state, fulfillment_status, channel, sku_count, shipping_country
 *
 * Joins: order_fulfillment_status (status), order_revenue_units (sku_count)
 */
export async function exportOrders(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
      let query = trx('orders as o')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin(
          trx('order_revenue_units').select('lasyncro_order_id').count('* as sku_count').groupBy('lasyncro_order_id').as('ru'),
          'ru.lasyncro_order_id', 'o.lasyncro_order_id'
        )
        .where('o.shop_id', shopId)
        .select(
          'o.lasyncro_order_id as order_id',
          'o.order_created_at as created_at',
          'o.total_price',
          'o.currency',
          'o.payment_state',
          trx.raw("COALESCE(ofs.status, 'pending') as fulfillment_status"),
          trx.raw("COALESCE(o.source, '—') as channel"),
          trx.raw("COALESCE(ru.sku_count, 0) as sku_count"),
          trx.raw("COALESCE(o.shipping_country_code, '—') as shipping_country")
        )
        .orderBy('o.order_created_at', 'desc');

      if (since) query = query.where('o.order_created_at', '>=', since);

      const { date_from, date_to, status, payment_state } = req.body?.filters ?? {};
      if (date_from) query = query.where('o.order_created_at', '>=', new Date(date_from));
      if (date_to) query = query.where('o.order_created_at', '<=', new Date(date_to));
      if (status?.length) query = query.whereIn('ofs.status', status);
      if (payment_state?.length) query = query.whereIn('o.payment_state', payment_state);

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('orders', 'csv')}"`);

    const csvStream = csvFormat({ headers: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportOrders failed', { shopId, msg });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}

// ─── RETURNS CSV ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/returns
 *
 * Columns: return_id, created_at, order_id, item_title, sku,
 *          units_returned, return_reason, total_refund_amount
 *
 * Joins: refund_execution_line_items, order_revenue_units
 */
export async function exportReturns(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
    let query = trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .leftJoin('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .leftJoin('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('o.shop_id', shopId)
      .select(
        're.lasyncro_refund_execution_id as return_id',
        're.executed_at as created_at',
        're.lasyncro_order_id as order_id',
        trx.raw("COALESCE(ru.title, '—') as item_title"),
        trx.raw("COALESCE(ru.sku, '—') as sku"),
        trx.raw("COALESCE(reli.refunded_quantity, 0) as units_returned"),
        trx.raw("COALESCE(re.return_reason, '—') as return_reason"),
        're.total_refund_amount'
      )
      .orderBy('re.executed_at', 'desc');

    if (since) query = query.where('re.executed_at', '>=', since);

    const { date_from, date_to } = req.body?.filters ?? {};
    if (date_from) query = query.where('re.executed_at', '>=', new Date(date_from));
    if (date_to)   query = query.where('re.executed_at', '<=', new Date(date_to));

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('returns', 'csv')}"`);

    const csvStream = csvFormat({ headers: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportReturns failed', { shopId, msg });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}

// ─── FINANCES CSV ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/finances
 *
 * Columns: order_id, created_at, total_price, currency,
 *          gross_revenue, estimated_cost, gross_margin, margin_pct
 *
 * Source: order_margin_snapshot joined with orders
 */
export async function exportFinances(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
    let query = trx('order_margin_snapshot as oms')
      .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
      .where('oms.shop_id', shopId)
      .select(
        'oms.lasyncro_order_id as order_id',
        'o.order_created_at as created_at',
        'o.total_price',
        'o.currency',
        'oms.gross_revenue',
        'oms.estimated_cost',
        'oms.gross_margin',
        trx.raw("ROUND((oms.margin_pct * 100)::numeric, 2) as margin_pct")
      )
      .orderBy('o.order_created_at', 'desc');

    if (since) query = query.where('o.order_created_at', '>=', since);

    const { date_from, date_to } = req.body?.filters ?? {};
    if (date_from) query = query.where('o.order_created_at', '>=', new Date(date_from));
    if (date_to)   query = query.where('o.order_created_at', '<=', new Date(date_to));

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('finances', 'csv')}"`);

    const csvStream = csvFormat({ headers: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportFinances failed', { shopId, msg });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}
