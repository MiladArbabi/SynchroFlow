// apps/backend/src/api/exports/exports.controller.ts
//
// EXPORT ENGINE (GH #1014 — Sprint 1)
// -------------------------------------
// Sync-stream exports for Orders, Returns, and Finances.
// (Morning Brief PDF removed 2026-08-19 - see playbook section 12.)
//
// Tier gating (enforced in routes, not here):
//   Starter -> nothing | Core+ -> CSV (orders, returns, finances)
//
// Date window enforcement (see @lasyncro/backend-core/utils/tierDataWindow.js):
//   Starter -> no access | Core -> 6 months | Growth+ -> unlimited
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
//   order_constraints -> constraint_type, is_active (blocker truth)

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

// Mirrors the native `fulfillment_status_type` enum (see migration 0006 +
// backfill 0133). 'blocked' is deliberately NOT a member — it's a synthetic
// filter value resolved against order_constraints, not ofs.status.
const FULFILLMENT_STATUS_VALUES = [
  'pending',
  'processing',
  'fulfilled',
  'partially_fulfilled',
  'cancelled',
  'failed',
  'address_corrected',
] as const;

class InvalidStatusFilterError extends Error {
  constructor(value: string) {
    super(`Invalid status filter value: '${value}'`);
    this.name = 'InvalidStatusFilterError';
  }
}

function filename(resource: string, format: 'csv' | 'pdf'): string {
  const date = new Date().toISOString().split('T')[0];
  return `lasyncro-${resource}-${date}.${format}`;
}

// Postgres errors carry `code`/`detail` as plain properties, not on the
// Error prototype chain — narrow with a shape check rather than instanceof.
function pgErrorInfo(err: unknown): { code?: string; detail?: string } {
  if (typeof err === 'object' && err !== null) {
    const { code, detail } = err as { code?: unknown; detail?: unknown };
    return {
      code: typeof code === 'string' ? code : undefined,
      detail: typeof detail === 'string' ? detail : undefined,
    };
  }
  return {};
}

// ─── ORDERS CSV ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/orders
 *
 * Columns: order_id, created_at, total_price, currency,
  *          payment_state, fulfillment_status, blocker_type, channel,
 *          sku_count, shipping_country
 *
 * created_at is shop-local (converted via shops.timezone), formatted
 * 'YYYY-MM-DD HH24:MI:SS'.
 *
 * filters.status accepts the 7 fulfillment_status_type enum members plus
 * the synthetic value 'blocked', which resolves against order_constraints
 * (canonical blocker truth) rather than order_fulfillment_status.
 *
 * Joins: order_fulfillment_status (status), order_revenue_units (sku_count),
 *        shops (timezone for created_at conversion)
 */
export async function exportOrders(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
      let query = trx('orders as o')
        .join('shops as s', 's.id', 'o.shop_id')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin(
          trx('order_revenue_units').select('lasyncro_order_id').count('* as sku_count').groupBy('lasyncro_order_id').as('ru'),
          'ru.lasyncro_order_id', 'o.lasyncro_order_id'
        )
        .where('o.shop_id', shopId)
        .select(
          'o.lasyncro_order_id as order_id',
          // Space-separated, not ISO 8601: Excel auto-parses 'YYYY-MM-DD HH24:MI:SS'
          // as a date/time value, but treats a 'T'-separated ISO string as text.
          trx.raw("to_char(o.order_created_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS') as created_at"),
          'o.total_price',
          'o.currency',
          'o.payment_state',
          trx.raw("COALESCE(ofs.status::text, 'pending') as fulfillment_status"),
          trx.raw(`(
            SELECT COALESCE(string_agg(DISTINCT oc.constraint_type, ' + '), '—')
            FROM order_constraints oc
            WHERE oc.lasyncro_order_id = o.lasyncro_order_id AND oc.is_active = true
          ) as blocker_type`),
          trx.raw("COALESCE(o.source, '—') as channel"),
          trx.raw("COALESCE(ru.sku_count, 0) as sku_count"),
          trx.raw("COALESCE(o.shipping_country_code, '—') as shipping_country")
        )
        .orderBy('o.order_created_at', 'desc');

      if (since) query = query.where('o.order_created_at', '>=', since);

      const { date_from, date_to, status, payment_state } = req.body?.filters ?? {};
      if (date_from) query = query.where('o.order_created_at', '>=', new Date(date_from));
      if (date_to) query = query.where('o.order_created_at', '<=', new Date(date_to));
      if (status?.length) {
        const isBlocked = status.includes('blocked');
        const remaining = status.filter((s: string) => s !== 'blocked');

        for (const value of remaining) {
          if (!(FULFILLMENT_STATUS_VALUES as readonly string[]).includes(value)) {
            throw new InvalidStatusFilterError(value);
          }
        }

        // EXISTS, not JOIN: an order can carry more than one active
        // constraint row (order_constraints allows multiple per order across
        // target_id/constraint_type). A JOIN would fan the order out into
        // one row per constraint, duplicating it in the CSV and inflating
        // the summed revenue. EXISTS only tests presence, so each order
        // appears at most once regardless of how many constraints it has.
        const blockedExists = () =>
          trx('order_constraints as oc')
            .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
            .andWhere('oc.is_active', true);

        if (isBlocked && remaining.length) {
          query = query.where((qb) => {
            qb.whereExists(blockedExists()).orWhereIn('ofs.status', remaining);
          });
        } else if (isBlocked) {
          query = query.whereExists(blockedExists());
        } else if (remaining.length) {
          query = query.whereIn('ofs.status', remaining);
        }
      }
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
    if (err instanceof InvalidStatusFilterError) {
      return res.status(400).json({ error: 'INVALID_STATUS_FILTER', message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportOrders failed', { shopId, msg, ...pgErrorInfo(err) });
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
 * created_at is shop-local (converted via shops.timezone), formatted
 * 'YYYY-MM-DD HH24:MI:SS'.
 *
 * Joins: refund_execution_line_items, order_revenue_units,
 *        shops (timezone for created_at conversion)
 */
export async function exportReturns(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
    let query = trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .join('shops as s', 's.id', 'o.shop_id')
      .leftJoin('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .leftJoin('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('o.shop_id', shopId)
      .select(
        're.lasyncro_refund_execution_id as return_id',
        trx.raw("to_char(re.executed_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS') as created_at"),
        're.lasyncro_order_id as order_id',
        trx.raw("COALESCE(ru.title, '—') as item_title"),
        trx.raw("COALESCE(ru.sku, '—') as sku"),
        trx.raw("COALESCE(reli.refunded_quantity, 0) as units_returned"),
        // ::text cast is required: COALESCE resolves its argument types at
        // parse time, before any row is read. Against the return_reason_type
        // enum, the '—' literal fails type resolution regardless of whether
        // the table has matching rows — it errored even at 0 rows.
        trx.raw("COALESCE(re.return_reason::text, '—') as return_reason"),
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
    console.error('[exports] exportReturns failed', { shopId, msg, ...pgErrorInfo(err) });
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
 * created_at is shop-local (converted via shops.timezone), formatted
 * 'YYYY-MM-DD HH24:MI:SS'.
 *
 * Source: order_margin_snapshot joined with orders, shops (timezone for
 * created_at conversion)
 */
export async function exportFinances(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);
  const since = tierDataWindowSince(tier);

  try {
    const rows = await withTenant(shopId, async (trx) => {
    let query = trx('order_margin_snapshot as oms')
      .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
      .join('shops as s', 's.id', 'o.shop_id')
      .where('oms.shop_id', shopId)
      .select(
        'oms.lasyncro_order_id as order_id',
        trx.raw("to_char(o.order_created_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS') as created_at"),
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
    console.error('[exports] exportFinances failed', { shopId, msg, ...pgErrorInfo(err) });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}
