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
import type { Knex } from 'knex';
import { format as csvFormat } from '@fast-csv/format';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { Tier, TIERS, tierHasFlag } from '@lasyncro/backend-core/config/tiers.js';
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

class InvalidFilterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class InvalidStatusFilterError extends InvalidFilterError {
  constructor(value: string) {
    super('INVALID_STATUS_FILTER', `Invalid status filter value: '${value}'`);
    this.name = 'InvalidStatusFilterError';
  }
}

class InvalidDateFilterError extends InvalidFilterError {
  constructor(field: string, value: unknown) {
    super('INVALID_DATE_FILTER', `Invalid ${field} filter value: '${value}'`);
    this.name = 'InvalidDateFilterError';
  }
}

class InvalidColumnFilterError extends InvalidFilterError {
  constructor(value: string) {
    super('INVALID_COLUMN_FILTER', `Invalid column filter value: '${value}'`);
    this.name = 'InvalidColumnFilterError';
  }
}

// Invalid Date serializes to a NaN-laden string ('0NaN-NaN-NaNT...') that
// Postgres rejects at cast time with a 500 — this must reject before the
// value ever reaches Knex/the query. Non-string input (e.g. a bare number)
// is rejected outright rather than coerced — `new Date(12345)` would
// otherwise "succeed" as a nonsense timestamp instead of failing loudly.
function parseDateFilter(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new InvalidDateFilterError(field, value);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new InvalidDateFilterError(field, value);
  }
  return d;
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

// Column registry: one source of truth per resource for both the SQL
// projection and the CSV header. `sql` is the raw expression WITHOUT the
// 'as <key>' suffix — the builder below appends it, so every column stays
// declared exactly once instead of duplicated between a header array and
// a .select() block that could silently drift apart.
interface ColumnDef {
  key: string;
  label: string;
  sql: string;
}

type ExportResource = 'orders' | 'returns' | 'finances' | 'products';

export const EXPORT_COLUMNS: Record<ExportResource, ColumnDef[]> = {
  orders: [
    { key: 'order_id', label: 'Order ID', sql: 'o.lasyncro_order_id' },
    // Space-separated, not ISO 8601: Excel auto-parses 'YYYY-MM-DD HH24:MI:SS'
    // as a date/time value, but treats a 'T'-separated ISO string as text.
    { key: 'created_at', label: 'Created', sql: "to_char(o.order_created_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS')" },
    { key: 'total_price', label: 'Total', sql: 'o.total_price' },
    { key: 'currency', label: 'Currency', sql: 'o.currency' },
    { key: 'payment_state', label: 'Payment status', sql: 'o.payment_state' },
    { key: 'fulfillment_status', label: 'Fulfillment status', sql: "COALESCE(ofs.status::text, 'pending')" },
    { key: 'blocker_type', label: 'Blocker', sql: `(
      SELECT COALESCE(string_agg(DISTINCT oc.constraint_type, ' + '), '—')
      FROM order_constraints oc
      WHERE oc.lasyncro_order_id = o.lasyncro_order_id AND oc.is_active = true
    )` },
    { key: 'channel', label: 'Channel', sql: "COALESCE(o.source, '—')" },
    { key: 'sku_count', label: 'SKUs', sql: 'COALESCE(ru.sku_count, 0)' },
    { key: 'shipping_country', label: 'Ship-to country', sql: "COALESCE(o.shipping_country_code, '—')" },
  ],
  returns: [
    { key: 'return_id', label: 'Return ID', sql: 're.lasyncro_refund_execution_id' },
    { key: 'created_at', label: 'Created', sql: "to_char(re.executed_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS')" },
    { key: 'order_id', label: 'Order ID', sql: 're.lasyncro_order_id' },
    { key: 'item_title', label: 'Item', sql: "COALESCE(ru.title, '—')" },
    { key: 'sku', label: 'SKU', sql: "COALESCE(ru.sku, '—')" },
    { key: 'units_returned', label: 'Units returned', sql: 'COALESCE(reli.refunded_quantity, 0)' },
    // ::text cast is required: COALESCE resolves its argument types at
    // parse time, before any row is read. Against the return_reason_type
    // enum, the '—' literal fails type resolution regardless of whether
    // the table has matching rows — it errored even at 0 rows.
    { key: 'return_reason', label: 'Return reason', sql: "COALESCE(re.return_reason::text, '—')" },
    { key: 'total_refund_amount', label: 'Refund amount', sql: 're.total_refund_amount' },
  ],
  finances: [
    { key: 'order_id', label: 'Order ID', sql: 'oms.lasyncro_order_id' },
    { key: 'created_at', label: 'Created', sql: "to_char(o.order_created_at AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI:SS')" },
    { key: 'total_price', label: 'Total', sql: 'o.total_price' },
    { key: 'currency', label: 'Currency', sql: 'o.currency' },
    { key: 'gross_revenue', label: 'Gross revenue', sql: 'oms.gross_revenue' },
    { key: 'estimated_cost', label: 'Estimated cost', sql: 'oms.estimated_cost' },
    { key: 'gross_margin', label: 'Gross margin', sql: 'oms.gross_margin' },
    { key: 'margin_pct', label: 'Margin %', sql: 'ROUND((oms.margin_pct * 100)::numeric, 2)' },
  ],
  products: [
    { key: 'sku', label: 'SKU', sql: 'v.sku' },
    { key: 'title', label: 'Product', sql: 'v.title' },
    { key: 'status', label: 'Status', sql: 'v.status' },
    { key: 'unit_cost', label: 'Unit cost', sql: 'v.unit_cost' },
    { key: 'on_hand', label: 'On hand', sql: 'COALESCE(SUM(it.on_hand_quantity), 0)' },
    { key: 'available', label: 'Available', sql: 'COALESCE(SUM(it.available_quantity), 0)' },
    { key: 'reserved', label: 'Reserved', sql: 'COALESCE(SUM(it.reserved_quantity), 0)' },
    { key: 'extended_value', label: 'Extended value', sql: 'ROUND(v.unit_cost * COALESCE(SUM(it.on_hand_quantity), 0), 2)' },
    { key: 'locations', label: 'Locations', sql: "string_agg(it.location_code || '=' || it.on_hand_quantity, '; ' ORDER BY it.location_code) FILTER (WHERE it.on_hand_quantity > 0)" },
  ],
};

// Resolves filters.columns against the registry, in REGISTRY order — not
// the order the client sent them in. A client-controlled column order
// would make output non-deterministic (two requests with the same keys
// in different order would need to produce different CSVs). Absent or
// empty selects every column, unchanged from pre-registry behaviour.
function resolveColumns(resource: ExportResource, requested: unknown): ColumnDef[] {
  const all = EXPORT_COLUMNS[resource];
  if (!Array.isArray(requested) || requested.length === 0) {
    return all;
  }
  const requestedKeys = new Set(requested);
  for (const key of requestedKeys) {
    if (!all.some((c) => c.key === key)) {
      throw new InvalidColumnFilterError(String(key));
    }
  }
  return all.filter((c) => requestedKeys.has(c.key));
}

function buildSelect(trx: Knex.Transaction, defs: ColumnDef[]): Knex.Raw[] {
  return defs.map((c) => trx.raw(`${c.sql} as ${c.key}`));
}

// ─── COLUMN METADATA ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/exports/columns
 *
 * Feeds the frontend column picker. Maps EXPORT_COLUMNS down to {key,label}
 * ONLY — `sql` is a raw SQL fragment (subqueries, joins) and must NEVER
 * leave the backend. If you're adding a field to this response, it must
 * come from this explicit key/label destructure, never a spread of the
 * ColumnDef itself.
 */
export async function exportColumns(_req: Request, res: Response) {
  const payload = Object.fromEntries(
    (Object.keys(EXPORT_COLUMNS) as ExportResource[]).map((resource) => [
      resource,
      EXPORT_COLUMNS[resource].map(({ key, label }) => ({ key, label })),
    ])
  );
  res.json(payload);
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
    const filters = req.body?.filters ?? {};
    const { date_from, date_to, status, payment_state, columns } = filters;

    // 403, not 400: the request is well-formed, the caller just isn't
    // entitled to it — a different meaning from InvalidFilterError, so it
    // does not route through that hierarchy. Absent filters.columns must
    // behave exactly as before this feature existed, at every tier.
    if ('columns' in filters && !tierHasFlag(tier, 'exports.column_selection')) {
      return res.status(403).json({ error: 'COLUMN_SELECTION_REQUIRES_GROWTH' });
    }

    const columnDefs = resolveColumns('orders', columns);

    const rows = await withTenant(shopId, async (trx) => {
      // Joins are always-on by design (Option B): every join here is a LEFT
      // (or the base 'shops' join required by created_at), and SMB row
      // volumes are under 10K per playbook section 2. A conditional-join
      // builder — joining only what a selected column needs — is deferred
      // until a column requires a table that isn't already joined.
      let query = trx('orders as o')
        .join('shops as s', 's.id', 'o.shop_id')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .leftJoin(
          trx('order_revenue_units').select('lasyncro_order_id').count('* as sku_count').groupBy('lasyncro_order_id').as('ru'),
          'ru.lasyncro_order_id', 'o.lasyncro_order_id'
        )
        .where('o.shop_id', shopId)
        .select(...buildSelect(trx, columnDefs))
        .orderBy('o.order_created_at', 'desc');

      if (since) query = query.where('o.order_created_at', '>=', since);

      if (date_from) query = query.where('o.order_created_at', '>=', parseDateFilter(date_from, 'date_from'));
      if (date_to) query = query.where('o.order_created_at', '<=', parseDateFilter(date_to, 'date_to'));
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

    const csvStream = csvFormat({ headers: columnDefs.map((c) => c.key), alwaysWriteHeaders: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    if (err instanceof InvalidFilterError) {
      return res.status(400).json({ error: err.code, message: err.message });
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
    const filters = req.body?.filters ?? {};
    const { date_from, date_to, columns } = filters;

    if ('columns' in filters && !tierHasFlag(tier, 'exports.column_selection')) {
      return res.status(403).json({ error: 'COLUMN_SELECTION_REQUIRES_GROWTH' });
    }

    const columnDefs = resolveColumns('returns', columns);

    const rows = await withTenant(shopId, async (trx) => {
    // Joins are always-on by design (Option B): every join here is a LEFT
    // (or the base 'orders'/'shops' joins required by created_at), and SMB
    // row volumes are under 10K per playbook section 2. A conditional-join
    // builder is deferred until a column requires a table that isn't
    // already joined.
    let query = trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .join('shops as s', 's.id', 'o.shop_id')
      .leftJoin('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .leftJoin('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('o.shop_id', shopId)
      .select(...buildSelect(trx, columnDefs))
      .orderBy('re.executed_at', 'desc');

    if (since) query = query.where('re.executed_at', '>=', since);

    if (date_from) query = query.where('re.executed_at', '>=', parseDateFilter(date_from, 'date_from'));
    if (date_to)   query = query.where('re.executed_at', '<=', parseDateFilter(date_to, 'date_to'));

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('returns', 'csv')}"`);

    const csvStream = csvFormat({ headers: columnDefs.map((c) => c.key), alwaysWriteHeaders: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    if (err instanceof InvalidFilterError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
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
    const filters = req.body?.filters ?? {};
    const { date_from, date_to, columns } = filters;

    if ('columns' in filters && !tierHasFlag(tier, 'exports.column_selection')) {
      return res.status(403).json({ error: 'COLUMN_SELECTION_REQUIRES_GROWTH' });
    }

    const columnDefs = resolveColumns('finances', columns);

    const rows = await withTenant(shopId, async (trx) => {
    // Joins are always-on by design (Option B): every join here is a LEFT
    // (or the base 'orders'/'shops' joins), and SMB row volumes are under
    // 10K per playbook section 2. A conditional-join builder is deferred
    // until a column requires a table that isn't already joined.
    let query = trx('order_margin_snapshot as oms')
      .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
      .join('shops as s', 's.id', 'o.shop_id')
      .where('oms.shop_id', shopId)
      .select(...buildSelect(trx, columnDefs))
      .orderBy('o.order_created_at', 'desc');

    if (since) query = query.where('o.order_created_at', '>=', since);

    if (date_from) query = query.where('o.order_created_at', '>=', parseDateFilter(date_from, 'date_from'));
    if (date_to)   query = query.where('o.order_created_at', '<=', parseDateFilter(date_to, 'date_to'));

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('finances', 'csv')}"`);

    const csvStream = csvFormat({ headers: columnDefs.map((c) => c.key), alwaysWriteHeaders: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    if (err instanceof InvalidFilterError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportFinances failed', { shopId, msg, ...pgErrorInfo(err) });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}

// ─── PRODUCTS CSV ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/exports/products
 *
 * Columns: sku, title, status, unit_cost, on_hand, available, reserved,
 *          extended_value, locations
 *
 * Variant grain — not time-series, so no date_from/date_to filtering.
 *
 * Source: variants LEFT JOIN inventory_truth (on lasyncro_variant_id +
 * shop_id).
 */
export async function exportProducts(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const tier = resolvedTier(req);

  try {
    const filters = req.body?.filters ?? {};
    const { status, columns } = filters;

    if ('columns' in filters && !tierHasFlag(tier, 'exports.column_selection')) {
      return res.status(403).json({ error: 'COLUMN_SELECTION_REQUIRES_GROWTH' });
    }

    const columnDefs = resolveColumns('products', columns);

    const rows = await withTenant(shopId, async (trx) => {
      // Joins are always-on by design (Option B): the join here is a LEFT,
      // and SMB row volumes are under 10K per playbook section 2. A
      // conditional-join builder is deferred until a column requires a
      // table that isn't already joined.
      //
      // LEFT JOIN, not JOIN: a SKU with no inventory_truth row (never
      // stocked, or fully depleted with the row cleaned up) must still
      // appear — an accountant's valuation needs the complete SKU list,
      // and on_hand 0 is information, not an omission.
      let query = trx('variants as v')
        .leftJoin('inventory_truth as it', function () {
          this.on('it.lasyncro_variant_id', '=', 'v.lasyncro_variant_id').andOn(
            'it.shop_id', '=', 'v.shop_id'
          );
        })
        .where('v.shop_id', shopId)
        .groupBy('v.lasyncro_variant_id', 'v.sku', 'v.title', 'v.status', 'v.unit_cost')
        .select(...buildSelect(trx, columnDefs))
        .orderBy('v.sku');

      // status is varchar, not an enum — no hardcoded whitelist (that was
      // the EXP-BLOCKED-02 failure). Any string is passed through; a value
      // with no matching rows legitimately yields zero rows, not an error.
      if (status?.length) query = query.whereIn('v.status', status);

      return query;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename('products', 'csv')}"`);

    const csvStream = csvFormat({ headers: columnDefs.map((c) => c.key), alwaysWriteHeaders: true });
    csvStream.pipe(res);
    for (const row of rows) csvStream.write(row);
    csvStream.end();

  } catch (err: unknown) {
    if (err instanceof InvalidFilterError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[exports] exportProducts failed', { shopId, msg, ...pgErrorInfo(err) });
    if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' });
  }
}
