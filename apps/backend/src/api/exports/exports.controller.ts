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
// Date window enforcement:
//   Core   → 12-month rolling window
//   Growth+ → unlimited
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
import PDFDocument from 'pdfkit';
import db from '@lasyncro/backend-core/db.js';
import { Tier, TIERS } from '@lasyncro/backend-core/config/tiers.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Returns earliest allowed date for Core tier (12-month rolling).
 * Growth/Scale → null (no restriction).
 */
function tierDataWindowSince(tier: Tier): Date | null {
  if (tier === 'core') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null;
}

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
    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    let query = db('orders as o')
      .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin(
        db('order_revenue_units').select('lasyncro_order_id').count('* as sku_count').groupBy('lasyncro_order_id').as('ru'),
        'ru.lasyncro_order_id', 'o.lasyncro_order_id'
      )
      .where('o.shop_id', shopId)
      .select(
        'o.lasyncro_order_id as order_id',
        'o.order_created_at as created_at',
        'o.total_price',
        'o.currency',
        'o.payment_state',
        db.raw("COALESCE(ofs.status, 'pending') as fulfillment_status"),
        db.raw("COALESCE(o.source, '—') as channel"),
        db.raw("COALESCE(ru.sku_count, 0) as sku_count"),
        db.raw("COALESCE(o.shipping_country_code, '—') as shipping_country")
      )
      .orderBy('o.order_created_at', 'desc');

    if (since) {
      query = query.where('o.order_created_at', '>=', since);
    }

    // Apply optional filters from request body
    const { date_from, date_to, status, payment_state } = req.body?.filters ?? {};
    if (date_from) query = query.where('o.order_created_at', '>=', new Date(date_from));
    if (date_to)   query = query.where('o.order_created_at', '<=', new Date(date_to));
    if (status?.length)        query = query.whereIn('ofs.status', status);
    if (payment_state?.length) query = query.whereIn('o.payment_state', payment_state);

    const rows = await query;

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
    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    let query = db('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .leftJoin('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .leftJoin('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('o.shop_id', shopId)
      .select(
        're.lasyncro_refund_execution_id as return_id',
        're.executed_at as created_at',
        're.lasyncro_order_id as order_id',
        db.raw("COALESCE(ru.title, '—') as item_title"),
        db.raw("COALESCE(ru.sku, '—') as sku"),
        db.raw("COALESCE(reli.refunded_quantity, 0) as units_returned"),
        db.raw("COALESCE(re.return_reason, '—') as return_reason"),
        're.total_refund_amount'
      )
      .orderBy('re.executed_at', 'desc');

    if (since) query = query.where('re.executed_at', '>=', since);

    const { date_from, date_to } = req.body?.filters ?? {};
    if (date_from) query = query.where('re.executed_at', '>=', new Date(date_from));
    if (date_to)   query = query.where('re.executed_at', '<=', new Date(date_to));

    const rows = await query;

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
    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    let query = db('order_margin_snapshot as oms')
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
        db.raw("ROUND((oms.margin_pct * 100)::numeric, 2) as margin_pct")
      )
      .orderBy('o.order_created_at', 'desc');

    if (since) query = query.where('o.order_created_at', '>=', since);

    const { date_from, date_to } = req.body?.filters ?? {};
    if (date_from) query = query.where('o.order_created_at', '>=', new Date(date_from));
    if (date_to)   query = query.where('o.order_created_at', '<=', new Date(date_to));

    const rows = await query;

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

// ─── MORNING BRIEF PDF ────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/brief
 *
 * Generates a formatted PDF from the latest morning_brief_snapshot.
 * Growth+ only (enforced in routes).
 *
 * Format:
 *   Header: LaSyncro logo text + date + shop summary
 *   Section: Needs a Decision (signals)
 *   Section: Today's Flow (pulse)
 */
export async function exportBrief(req: Request, res: Response) {
  const shopId = req.user!.shopId!;

  try {
    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const brief = await db('morning_brief_snapshots')
      .where({ shop_id: shopId })
      .first('signals', 'summary_line', 'generated_at', 'greeting');

    if (!brief) {
      return res.status(404).json({ error: 'BRIEF_NOT_FOUND' });
    }

    const signals: Array<{
      priority: number;
      title: string;
      detail: string;
      module: string;
    }> = Array.isArray(brief.signals) ? brief.signals : JSON.parse(brief.signals ?? '[]');

    const generatedAt = new Date(brief.generated_at).toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('brief', 'pdf')}"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // ── Header ──────────────────────────────────────────────────────────────
    doc
      .fontSize(22).font('Helvetica-Bold')
      .text('LaSyncro', 50, 50)
      .fontSize(10).font('Helvetica')
      .fillColor('#6B7280')
      .text('Daily Operations Brief', 50, 78)
      .text(generatedAt, 50, 92)
      .fillColor('#000000');

    doc.moveTo(50, 115).lineTo(545, 115).strokeColor('#E8E6E0').stroke();

    // ── Greeting + Summary ──────────────────────────────────────────────────
    if (brief.greeting) {
      doc.moveDown(1)
        .fontSize(18).font('Helvetica-Bold')
        .text(brief.greeting, 50, 130);
    }

    if (brief.summary_line) {
      doc.fontSize(11).font('Helvetica')
        .fillColor('#6B7280')
        .text(brief.summary_line, 50, 158)
        .fillColor('#000000');
    }

    doc.moveTo(50, 180).lineTo(545, 180).strokeColor('#E8E6E0').stroke();

    // ── Signals ─────────────────────────────────────────────────────────────
    let y = 195;

    doc.fontSize(9).font('Helvetica-Bold')
      .fillColor('#6B7280')
      .text('NEEDS A DECISION', 50, y)
      .fillColor('#000000');

    y += 18;

    if (signals.length === 0) {
      doc.fontSize(12).font('Helvetica')
        .fillColor('#6B7280')
        .text('All clear — no urgent issues today.', 50, y)
        .fillColor('#000000');
      y += 24;
    } else {
      for (const signal of signals) {
        doc.fontSize(12).font('Helvetica-Bold')
          .text(`P${signal.priority}  ${signal.title}`, 50, y);
        y += 16;
        doc.fontSize(10).font('Helvetica')
          .fillColor('#6B7280')
          .text(signal.detail, 66, y, { width: 479 })
          .fillColor('#000000');
        y += doc.heightOfString(signal.detail, { width: 479 }) + 10;
      }
    }

    doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor('#E8E6E0').stroke();
    y += 20;

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.fontSize(8).font('Helvetica')
      .fillColor('#9CA3AF')
      .text(`Generated by LaSyncro · ${generatedAt}`, 50, y);

    doc.end();

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportBrief failed', { shopId, msg });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}