// apps/backend/src/services/wms/wmsAnalyticsV1.service.ts
//
// GH-1231 — Analytics V1 additive blocks (blueprint §12B.3–§12B.5).
//
//   GET /api/v1/wms/analytics       + window, pace, problems, team_activity
//   GET /api/v1/wms/analytics/live  + flow
//
// Legacy services (wmsAnalytics.service.ts, incl. getLiveCapacity and the
// Floor Display payload) are untouched; these blocks are computed beside them.
//
// Every function runs on the caller's withTenant transaction (RLS) and also
// filters shop_id explicitly. order_warehouse_status has no shop_id, so Flow
// is scoped through orders.shop_id as well as FORCE RLS.
//
// Clock (RED-2A ruling): the historical window and the activity upper bound
// both come from ONE request `now` captured by the controller — never from
// Postgres now() or the server's local date. Activity is bucketed by the
// window's own DST-correct local-midnight instants, so Postgres never needs
// to interpret the shop timezone.

import { Knex } from 'knex';
import {
  buildAnalyticsWindow,
  densifyPacePoints,
  variantDisplayLabel,
  type AnalyticsWindow,
} from './wmsAnalyticsV1.helpers.js';

export const V1_WINDOW_DAYS = [7, 30, 90] as const;
export type V1WindowDays = (typeof V1_WINDOW_DAYS)[number];

export function isV1WindowDays(days: number): days is V1WindowDays {
  return (V1_WINDOW_DAYS as readonly number[]).includes(days);
}

const FLOW_STATUSES = ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'] as const;
type FlowStatus = (typeof FLOW_STATUSES)[number];

const EXCLUDED_PROBLEM_TYPE = 'order_cancelled';
const PROBLEM_PRODUCTS_SHOWN = 5;
const UNNAMED_MEMBER = 'Unnamed team member';
const CANONICAL_INTEGER = /^(0|[1-9]\d*)$/;

/** Aggregates arrive as int4 numbers or bigint text; anything else is a defect, never a zero. */
function toCount(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && CANONICAL_INTEGER.test(value) ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${field} is not a nonnegative safe integer: ${JSON.stringify(value)}`);
  return n;
}

function addCount(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError('analytics count exceeds the safe integer range');
  return sum;
}

// ─── Window ──────────────────────────────────────────────────────────────────

export type V1WindowEcho = Pick<AnalyticsWindow, 'days' | 'timezone' | 'start_at' | 'bucket' | 'today_local'>;

/** The V1 window for the shop's validated timezone (UTC fallback), anchored at the request `now`. */
export async function getAnalyticsV1Window(shopId: number, days: V1WindowDays, now: Date, trx: Knex.Transaction): Promise<AnalyticsWindow> {
  const shop = await trx('shops').where('id', shopId).first('timezone');
  return buildAnalyticsWindow({ days, timezone: shop?.timezone ?? null, now });
}

export function windowEcho(window: AnalyticsWindow): V1WindowEcho {
  return {
    days: window.days,
    timezone: window.timezone,
    start_at: window.start_at,
    bucket: window.bucket,
    today_local: window.today_local,
  };
}

// ─── Pace + Team (one confirmed-scan population) ─────────────────────────────

export type TeamActivityRow = {
  user_id: number;
  display_name: string;
  items_picked: number;
  items_packed: number;
  is_current_member: boolean;
};

/**
 * Confirmed pick scans in [window.start_at, now], credited to scanned_by and
 * bucketed by scanned_at into the window's periods; confirmed pack scans in
 * the same range credited to scanned_by. Pace and Team picked come from the
 * SAME aggregated rows, so Σ Pace = Σ Team items_picked by construction.
 * People are everyone with ≥1 confirmed scan, current member or not.
 */
export async function getPaceAndTeam(shopId: number, window: AnalyticsWindow, now: Date, trx: Knex.Transaction) {
  const startAt = window.start_at;
  // Period start instants as one Postgres array literal (ISO strings hold no commas or quotes);
  // a JS array binding would be expanded by knex into a value list.
  const thresholds = `{${window.periods.map((p) => p.start_at).join(',')}}`;

  const pickRows: { user_id: number; bucket: number; items: string }[] = await trx('pick_scan_log')
    .where('shop_id', shopId)
    .where('status', 'confirmed')
    .where('scanned_at', '>=', startAt)
    .where('scanned_at', '<=', now)
    .groupBy('scanned_by', 'bucket')
    .select(
      'scanned_by as user_id',
      trx.raw('width_bucket(scanned_at, ?::timestamptz[]) as bucket', [thresholds]),
      trx.raw('SUM(quantity_confirmed)::text as items'),
    );

  const packRows: { user_id: number; items: string }[] = await trx('pack_scan_log')
    .where('shop_id', shopId)
    .where('status', 'confirmed')
    .where('scanned_at', '>=', startAt)
    .where('scanned_at', '<=', now)
    .groupBy('scanned_by')
    .select('scanned_by as user_id', trx.raw('SUM(quantity_confirmed)::text as items'));

  const picked = new Map<number, number>();
  const paceRows = pickRows.map((row) => {
    const period = window.periods[Number(row.bucket) - 1];
    // start_at ≤ scanned_at ≤ now < last period end, so every row has a period.
    if (!period) throw new RangeError(`pick scan outside the analytics window (bucket ${row.bucket})`);
    const items = toCount(row.items, 'pick_scan_log.quantity_confirmed');
    picked.set(row.user_id, addCount(picked.get(row.user_id) ?? 0, items));
    return { local_date: period.start_date, items_picked: items };
  });

  const packed = new Map<number, number>();
  for (const row of packRows) packed.set(row.user_id, toCount(row.items, 'pack_scan_log.quantity_confirmed'));

  const userIds = [...new Set([...picked.keys(), ...packed.keys()])];
  const [users, memberships] = userIds.length
    ? await Promise.all([
      trx('users').where('shop_id', shopId).whereIn('id', userIds).select('id', 'first_name', 'last_name'),
      trx('shop_memberships').where('shop_id', shopId).whereIn('user_id', userIds).whereNull('revoked_at').select('user_id'),
    ])
    : [[], []];
  const names = new Map<number, string>(users.map((u: { id: number; first_name: string | null; last_name: string | null }) => [
    u.id,
    [u.first_name?.trim(), u.last_name?.trim()].filter(Boolean).join(' ') || UNNAMED_MEMBER,
  ]));
  const current = new Set<number>(memberships.map((m: { user_id: number }) => m.user_id));

  const team: TeamActivityRow[] = userIds
    .map((userId) => ({
      user_id: userId,
      display_name: names.get(userId) ?? UNNAMED_MEMBER,
      items_picked: picked.get(userId) ?? 0,
      items_packed: packed.get(userId) ?? 0,
      is_current_member: current.has(userId),
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'en', { sensitivity: 'base' }) || a.user_id - b.user_id);

  return { pace: densifyPacePoints(window, paceRows), team_activity: team };
}

// ─── Problems (one pick_exceptions population) ───────────────────────────────

export type ProblemProduct = { lasyncro_variant_id: string; display_label: string; sku: string | null; count: number };

/**
 * pick_exceptions raised in [window.start_at, now], both stages, excluding
 * order_cancelled. total / open_total / by_type / products all come from this
 * one population. Products: count desc, then label asc, top 5 + products_total.
 */
export async function getProblems(shopId: number, window: AnalyticsWindow, now: Date, trx: Knex.Transaction) {
  const population = () => trx('pick_exceptions as pe')
    .where('pe.shop_id', shopId)
    .where('pe.raised_at', '>=', window.start_at)
    .where('pe.raised_at', '<=', now)
    .whereNot('pe.exception_type', EXCLUDED_PROBLEM_TYPE);

  const typeRows: { exception_type: string; count: number; open_count: number }[] = await population()
    .groupBy('pe.exception_type')
    .select(
      'pe.exception_type',
      trx.raw('COUNT(*)::int as count'),
      trx.raw('(COUNT(*) FILTER (WHERE pe.resolved = false))::int as open_count'),
    );

  const productRows: { lasyncro_variant_id: string; product_title: string | null; variant_title: string | null; sku: string | null; count: number }[] =
    await population()
      .leftJoin('variants as v', function joinVariant() {
        this.on('v.lasyncro_variant_id', '=', 'pe.lasyncro_variant_id').andOn('v.shop_id', '=', 'pe.shop_id');
      })
      .leftJoin('products as p', function joinProduct() {
        this.on('p.lasyncro_product_id', '=', 'v.lasyncro_product_id').andOn('p.shop_id', '=', 'pe.shop_id');
      })
      .groupBy('pe.lasyncro_variant_id', 'p.title', 'v.title', 'v.sku')
      .select(
        'pe.lasyncro_variant_id',
        'p.title as product_title',
        'v.title as variant_title',
        'v.sku',
        trx.raw('COUNT(*)::int as count'),
      );

  let total = 0;
  let openTotal = 0;
  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    const count = toCount(row.count, 'pick_exceptions count');
    total = addCount(total, count);
    openTotal = addCount(openTotal, toCount(row.open_count, 'pick_exceptions open count'));
    byType[row.exception_type] = count;
  }

  const products: ProblemProduct[] = productRows
    .map((row) => ({
      lasyncro_variant_id: row.lasyncro_variant_id,
      display_label: variantDisplayLabel({ product_title: row.product_title, variant_title: row.variant_title }),
      sku: row.sku ?? null,
      count: toCount(row.count, 'pick_exceptions product count'),
    }))
    .sort((a, b) => b.count - a.count
      || a.display_label.localeCompare(b.display_label, 'en', { sensitivity: 'base' })
      || a.lasyncro_variant_id.localeCompare(b.lasyncro_variant_id));

  return {
    total,
    open_total: openTotal,
    by_type: byType,
    products: products.slice(0, PROBLEM_PRODUCTS_SHOWN),
    products_total: products.length,
  };
}

// ─── Live Flow ───────────────────────────────────────────────────────────────

export type FlowStage = { count: number; oldest_age_s: number | null };
export type LiveFlow = { stages: Record<FlowStatus, FlowStage> };

/**
 * Clock-skew allowance for recorded status timestamps (GH-1231 A3 ruling).
 *
 * status_updated_at is stamped by the app server's clock (`new Date()` in the
 * WMS writers) and read against the database clock, so a just-recorded status
 * can look slightly in the future. Within this allowance the status is treated
 * as just recorded (age 0). It is an engineering resilience constant — not a
 * merchant-facing target or a measured clock SLA — and it never shortens or
 * caps a real elapsed age.
 */
export const FLOW_CLOCK_SKEW_TOLERANCE_S = 120;

/** A stage's recorded status times cannot be trusted; Flow is omitted rather than shown as fresh. */
export class FlowClockAnomalyError extends Error {
  constructor() {
    super('order_warehouse_status timestamps are beyond the clock-skew tolerance');
    this.name = 'FlowClockAnomalyError';
  }
}

/**
 * Orders per recorded warehouse status and the oldest time in that status,
 * from ONE query (one snapshot, one clock). Age is elapsed time since
 * status_updated_at, measured at statement_timestamp() — not the transaction
 * start, so a status committed earlier in this request is never "negative".
 * It is not worker activity and is never capped. A stage with no orders has
 * oldest_age_s null.
 *
 * Clock anomalies (A3):
 *   - earliest status within FLOW_CLOCK_SKEW_TOLERANCE_S in the future → age 0;
 *   - earliest status beyond the tolerance → the age cannot be trusted, so the
 *     whole Flow block is omitted (never `count > 0, oldest_age_s: 0`);
 *   - a future row beside an older valid row leaves the age from the older row
 *     and is logged.
 * Logs carry shop, stage and row counts only — never row contents.
 */
export async function getLiveFlow(shopId: number, trx: Knex.Transaction): Promise<LiveFlow> {
  const tolerance = `${FLOW_CLOCK_SKEW_TOLERANCE_S} seconds`;
  const rows: {
    status: FlowStatus;
    count: number;
    oldest_age_s: string | null;
    future_rows: number;
    earliest_beyond_tolerance: boolean;
  }[] = await trx('order_warehouse_status as ows')
    .join('orders as o', 'o.lasyncro_order_id', 'ows.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .whereIn('ows.status', FLOW_STATUSES as unknown as string[])
    .groupBy('ows.status')
    .select(
      'ows.status',
      trx.raw('COUNT(*)::int as count'),
      // Negative only within the skew allowance (anomalies are rejected below), so this clamp never hides one.
      trx.raw('GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (statement_timestamp() - MIN(ows.status_updated_at)))))::bigint::text as oldest_age_s'),
      trx.raw('(COUNT(*) FILTER (WHERE ows.status_updated_at > statement_timestamp() + ?::interval))::int as future_rows', [tolerance]),
      trx.raw('(MIN(ows.status_updated_at) > statement_timestamp() + ?::interval) as earliest_beyond_tolerance', [tolerance]),
    );

  const stages = Object.fromEntries(FLOW_STATUSES.map((s) => [s, { count: 0, oldest_age_s: null }])) as Record<FlowStatus, FlowStage>;
  for (const row of rows) {
    const futureRows = toCount(row.future_rows, 'order_warehouse_status future rows');
    if (futureRows > 0) {
      console.warn('[WMS_ANALYTICS_V1_FLOW_CLOCK_ANOMALY]', {
        shop_id: shopId,
        stage: row.status,
        future_rows: futureRows,
        tolerance_s: FLOW_CLOCK_SKEW_TOLERANCE_S,
        flow_omitted: row.earliest_beyond_tolerance === true,
      });
    }
    if (row.earliest_beyond_tolerance === true) throw new FlowClockAnomalyError();

    const count = toCount(row.count, 'order_warehouse_status count');
    stages[row.status] = {
      count,
      oldest_age_s: count > 0 ? toCount(row.oldest_age_s, 'order_warehouse_status age') : null,
    };
  }
  return { stages };
}

// ─── Additive composition (mixed-version safe) ───────────────────────────────

type V1BlockContext = { endpoint: 'historical' | 'live'; shopId: number; days?: number };

/**
 * Failures that must fail the whole request closed instead of omitting a block:
 * SQLSTATE class 28 (invalid authorization), class 08 (connection), 42501
 * (insufficient privilege / row-level security), 25P02 (transaction already
 * aborted — the savepoint could not contain it), and the backend-core tenant
 * context guards.
 */
const FAIL_CLOSED_SQLSTATE = /^(28|08)|^(42501|25P02)$/;
const FAIL_CLOSED_MESSAGE = /TENANT_CONTEXT_MISSING|FAILED_TO_SET_APP_CURRENT_TENANT/;

function sqlstateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

function failsClosed(error: unknown): boolean {
  const sqlstate = sqlstateOf(error);
  if (sqlstate && FAIL_CLOSED_SQLSTATE.test(sqlstate)) return true;
  return error instanceof Error && FAIL_CLOSED_MESSAGE.test(error.message);
}

/**
 * Runs one V1 block in its own savepoint, so a failing statement rolls back
 * only that block and the request transaction stays usable. An ordinary
 * data/SQL failure is logged and the block is OMITTED: legacy keys are still
 * served to old consumers, and the V1 frontend reads a missing block as
 * "unavailable" for that region only — never as zero. Security, tenant and
 * connection failures are re-thrown so the request fails closed.
 *
 * Logs carry context, block, SQLSTATE and error class only — never the raw
 * message, which can echo row values.
 */
async function optionalBlock<T>(
  trx: Knex.Transaction,
  context: V1BlockContext,
  block: string,
  fn: (sp: Knex.Transaction) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await trx.transaction((sp) => fn(sp));
  } catch (error) {
    const closed = failsClosed(error);
    console.error(closed ? '[WMS_ANALYTICS_V1_BLOCK_FAIL_CLOSED]' : '[WMS_ANALYTICS_V1_BLOCK_FAILED]', {
      endpoint: context.endpoint,
      shop_id: context.shopId,
      days: context.days ?? null,
      block,
      sqlstate: sqlstateOf(error),
      error_class: error instanceof Error ? error.name : typeof error,
    });
    if (closed) throw error;
    return undefined;
  }
}

export type AnalyticsV1HistoricalBlocks = Partial<{
  window: V1WindowEcho;
  pace: Awaited<ReturnType<typeof getPaceAndTeam>>['pace'];
  team_activity: TeamActivityRow[];
  problems: Awaited<ReturnType<typeof getProblems>>;
}>;

/**
 * The four additive composite blocks for a supported V1 window (7/30/90).
 * Legacy-only windows (e.g. days=14) get no V1 blocks — never fabricated ones.
 */
export async function getAnalyticsV1HistoricalBlocks(
  shopId: number,
  days: number,
  now: Date,
  trx: Knex.Transaction,
): Promise<AnalyticsV1HistoricalBlocks> {
  if (!isV1WindowDays(days)) return {};
  const context: V1BlockContext = { endpoint: 'historical', shopId, days };
  const window = await optionalBlock(trx, context, 'window', (sp) => getAnalyticsV1Window(shopId, days, now, sp));
  if (!window) return {};

  const blocks: AnalyticsV1HistoricalBlocks = { window: windowEcho(window) };
  const paceAndTeam = await optionalBlock(trx, context, 'pace', (sp) => getPaceAndTeam(shopId, window, now, sp));
  if (paceAndTeam) {
    blocks.pace = paceAndTeam.pace;
    blocks.team_activity = paceAndTeam.team_activity;
  }
  const problems = await optionalBlock(trx, context, 'problems', (sp) => getProblems(shopId, window, now, sp));
  if (problems) blocks.problems = problems;
  return blocks;
}

/** The additive live `flow` block, or undefined (omitted) if it cannot be verified. */
export async function getAnalyticsV1LiveFlow(shopId: number, trx: Knex.Transaction): Promise<LiveFlow | undefined> {
  return optionalBlock(trx, { endpoint: 'live', shopId }, 'flow', (sp) => getLiveFlow(shopId, sp));
}
