// apps/frontend/src/pages/wms/analyticsAvailability.ts
//
// GH-1230 — Warehouse Analytics availability contract (pure, layout-agnostic).
//
// Resolves one query's raw state into what a surface may truthfully render.
// No React, no transport: consumed by WmsAnalyticsPage today and intended for
// the future owner screen unchanged; protected by a CI-gated contract test.
//
// Ratified rules (GH-1230 D1–D6):
//   - Unknown/unavailable is never a confirmed zero; an error is never empty.
//   - A failed refresh makes the query unavailable even though React Query
//     still holds the previous data (D1).
//   - Historical data renders only when its server-echoed `days` matches the
//     selected window; placeholder data is unresolved (D2).
//   - ACTION_FORBIDDEN is a role denial; COMMERCIAL_ACCESS_DENIED carries the
//     server's canonical AccessDecision (D3).
//   - Freshness is the query's successful-fetch time only (D4).
//   - A 200 payload missing required structure is unavailable, not empty (D5).
//   - 401/403 are never retried at the query layer; transient errors keep a
//     bounded retry (D6).

import type { AccessDecision } from '@lasyncro/commercial-policy';
import type { LiveCapacity, WmsAnalyticsResponse } from './useWmsAnalytics';

export type AnalyticsDenial =
  | { kind: 'role' }
  | { kind: 'commercial'; decision: AccessDecision };

export type AnalyticsAvailability<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; updatedAt: number }
  | { status: 'unavailable' }
  | { status: 'denied'; denial: AnalyticsDenial };

/** The subset of a React Query result the contract depends on. */
export type AnalyticsQuerySnapshot = {
  data: unknown;
  error: unknown;
  isError: boolean;
  isPlaceholderData: boolean;
  dataUpdatedAt: number;
};

/** Bounded transient retry count — matches React Query's default of 3. */
export const ANALYTICS_MAX_RETRIES = 3;

const ROLE_DENIAL_CODES = new Set(['ACTION_FORBIDDEN', 'NO_ROLE_ASSIGNED', 'FORBIDDEN']);
const COMMERCIAL_DENIAL_REASONS = new Set(['TIER_TOO_LOW', 'MODULE_NOT_INCLUDED', 'FEATURE_NOT_INCLUDED']);

type HttpErrorLike = { response?: { status?: unknown; data?: { [key: string]: unknown } } };

function httpStatus(error: unknown): number | undefined {
  const status = (error as HttpErrorLike | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function errorBody(error: unknown): { [key: string]: unknown } | undefined {
  const data = (error as HttpErrorLike | null)?.response?.data;
  return data && typeof data === 'object' ? data : undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableNumber = (v: unknown) => v === null || isNumber(v);
const isNullableString = (v: unknown) => v === null || typeof v === 'string';

/** Denial carried by an error, or null when the error is not a denial. */
export function classifyAnalyticsDenial(error: unknown): AnalyticsDenial | null {
  if (httpStatus(error) !== 403) return null;
  const body = errorBody(error);
  const code = body?.error;
  if (typeof code === 'string' && ROLE_DENIAL_CODES.has(code)) return { kind: 'role' };
  if (code === 'COMMERCIAL_ACCESS_DENIED' && typeof body?.reason === 'string' && COMMERCIAL_DENIAL_REASONS.has(body.reason)) {
    // Forward the server's decision as-is — never fabricate a tier step.
    const decision: AccessDecision = { allowed: false, reason: body.reason as AccessDecision['reason'] };
    if (typeof body.requiredTier === 'string') decision.requiredTier = body.requiredTier as AccessDecision['requiredTier'];
    if (typeof body.requiredModule === 'string') decision.requiredModule = body.requiredModule as AccessDecision['requiredModule'];
    if (typeof body.requiredFeature === 'string') decision.requiredFeature = body.requiredFeature as AccessDecision['requiredFeature'];
    return { kind: 'commercial', decision };
  }
  return null;
}

/** D6 — React Query `retry` predicate: no retry on 401/403, bounded otherwise. */
export function shouldRetryAnalyticsQuery(failureCount: number, error: unknown): boolean {
  const status = httpStatus(error);
  if (status === 401 || status === 403) return false;
  return failureCount < ANALYTICS_MAX_RETRIES;
}

/** D5 — structure the live zone reads. Nullable fields may be null. */
export function isLiveCapacityPayload(value: unknown): value is LiveCapacity {
  if (!isObject(value) || !isObject(value.pipeline)) return false;
  const p = value.pipeline;
  return (
    ['awaiting_pick', 'picking', 'packing', 'ship_ready', 'shipped'].every((k) => isNumber(p[k])) &&
    isNumber(value.operators_on_shift) &&
    isNumber(value.shipped_today) &&
    isNumber(value.shipped_via_wms) &&
    isNumber(value.shipped_via_legacy) &&
    isNullableString(value.cpt_local) &&
    isNullableNumber(value.hours_to_cpt) &&
    isNullableNumber(value.live_uph) &&
    isNullableNumber(value.required_uph) &&
    (value.on_track === null || value.on_track === 'green' || value.on_track === 'amber' || value.on_track === 'red')
  );
}

const isNullableNumberField = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => isNullableNumber(o[k]));
const isNumberField = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => isNumber(o[k]));
const isArrayOf = (v: unknown, entry: (e: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.every((e) => isObject(e) && entry(e));

/** Aging stages getAgingWip always emits; a missing stage would render as a fabricated 0. */
const AGING_STAGES = ['picking', 'picked', 'packing', 'packed'];

const isOperatorRow = (o: Record<string, unknown>) =>
  isNumber(o.user_id) && isNullableString(o.first_name) && isNullableString(o.last_name) &&
  typeof o.role === 'string' &&
  isNumberField(o, ['picks', 'packs', 'exception_count']) &&
  isNullableNumberField(o, ['uph', 'accuracy_pct', 'avg_batch_seconds']);

const isProblemSkuRow = (o: Record<string, unknown>) =>
  typeof o.lasyncro_variant_id === 'string' && isNullableString(o.title) && isNullableString(o.sku) &&
  isNumber(o.exception_count);

const isHeatGridRow = (o: Record<string, unknown>) =>
  isNumber(o.user_id) && typeof o.name === 'string' &&
  isNumberField(o, ['pick_exception_rate_pct', 'pack_exception_rate_pct']);

const isTrendPoint = (o: Record<string, unknown>) => typeof o.day === 'string' && isNullableNumber(o.uph);

const isAgingStage = (v: unknown) => isObject(v) && isNumberField(v, ['count', 'oldest_age_s']);

/**
 * D5 — structure the historical zones read, including every nested entry a
 * card dereferences or presents as a known metric. Empty arrays, null metrics,
 * zero counts and locked (unconfigured) cost are valid producer output.
 */
export function isHistoricalPayload(value: unknown): value is WmsAnalyticsResponse {
  if (!isObject(value) || !isNumber(value.days)) return false;
  const { operators, pipeline, exceptions, cost, aging_wip, throughput_trend, exception_trend } = value;
  return (
    isArrayOf(operators, isOperatorRow) &&
    isObject(pipeline) &&
    isObject(pipeline.stages) &&
    isNullableNumberField(pipeline.stages, ['released_to_picking_s', 'picking_s', 'packing_s', 'packed_to_shipped_s']) &&
    isObject(pipeline.latencies) &&
    isNullableNumberField(pipeline.latencies, ['receive_to_pickable_hours', 'return_to_restock_hours']) &&
    isNumber(pipeline.latencies.receive_to_pickable_samples) &&
    isObject(exceptions) &&
    isArrayOf(exceptions.top_skus, isProblemSkuRow) &&
    isArrayOf(exceptions.heat_grid, isHeatGridRow) &&
    isObject(cost) &&
    typeof cost.unlocked === 'boolean' &&
    // Locked cost is a valid unconfigured state; unlocked values are shown as known money.
    (!cost.unlocked ||
      (isNullableNumberField(cost, ['cost_per_order', 'cost_per_unit', 'exception_cost']) && isNullableString(cost.editorial))) &&
    isObject(aging_wip) &&
    isNumberField(aging_wip, ['total', 'oldest_overall_s']) &&
    isObject(aging_wip.by_stage) &&
    AGING_STAGES.every((k) => isAgingStage((aging_wip.by_stage as Record<string, unknown>)[k])) &&
    isObject(throughput_trend) &&
    isArrayOf(throughput_trend.points, isTrendPoint) &&
    isNullableNumberField(throughput_trend, ['avg_uph', 'latest_uph']) &&
    isObject(exception_trend) &&
    isNumberField(exception_trend, ['total', 'open_total']) &&
    isObject(exception_trend.by_type) &&
    Object.values(exception_trend.by_type).every(isNumber) &&
    Array.isArray(exception_trend.points)
  );
}

function resolve<T>(
  q: AnalyticsQuerySnapshot,
  isPayload: (v: unknown) => v is T,
  matchesSelection: (data: T) => boolean,
): AnalyticsAvailability<T> {
  // D1/D3: an error wins over any retained data — cached values are not current.
  if (q.isError) {
    const denial = classifyAnalyticsDenial(q.error);
    return denial ? { status: 'denied', denial } : { status: 'unavailable' };
  }
  // D2: nothing verified for this selection yet.
  if (q.data === undefined || q.isPlaceholderData) return { status: 'loading' };
  // D5: a malformed success is unavailable, never a healthy empty.
  if (!isPayload(q.data)) return { status: 'unavailable' };
  // D2: the server answered for a different window — not this selection's truth.
  if (!matchesSelection(q.data)) return { status: 'unavailable' };
  return { status: 'ready', data: q.data, updatedAt: q.dataUpdatedAt };
}

export function resolveHistoricalAvailability(
  q: AnalyticsQuerySnapshot,
  selectedDays: number,
): AnalyticsAvailability<WmsAnalyticsResponse> {
  return resolve(q, isHistoricalPayload, (data) => data.days === selectedDays);
}

export function resolveLiveAvailability(q: AnalyticsQuerySnapshot): AnalyticsAvailability<LiveCapacity> {
  return resolve(q, isLiveCapacityPayload, () => true);
}

/** Page-level denial, if either query was denied. Commercial truth takes precedence. */
export function resolveAnalyticsDenial(
  ...states: AnalyticsAvailability<unknown>[]
): AnalyticsDenial | null {
  const denials = states.flatMap((s) => (s.status === 'denied' ? [s.denial] : []));
  return denials.find((d) => d.kind === 'commercial') ?? denials[0] ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// GH-1231 — Analytics V1 per-block availability (blueprint §12B.5).
//
// Failure precedence: GH-1230 D1–D6 first, per-block validation last.
//   1. A request error is unavailable or denied for every block of that
//      request, even with cached data (D1/D3). Pending/placeholder is loading.
//   2. Request-level guards (D5): historical `days` and `cost.unlocked`; live
//      `shipped_today`, `active_operators`, `cpt_local`, `hours_to_cpt`.
//   3. Selected window (D2): a top-level `days` mismatch rejects every
//      historical block; a `window.days` mismatch rejects the window blocks.
//   4. Only then may ONE missing/malformed new block (window, pace, problems,
//      team_activity, flow) degrade the regions that depend on it.
// Counts are finite nonnegative safe integers; Pace buckets must cover exactly
// the selected shop-local dates. Nothing invalid is ever turned into a zero.
// ═════════════════════════════════════════════════════════════════════════════

export type V1Window = {
  days: number;
  timezone: string;
  start_at: string;
  bucket: 'day' | 'week';
  today_local: string;
};

export type V1PacePoint = { start_date: string; end_date: string; items_picked: number; is_current: boolean; is_clipped: boolean };
export type V1Pace = { items_picked_total: number; points: V1PacePoint[] };

export type V1ProblemProduct = { lasyncro_variant_id: string; display_label: string; sku: string | null; count: number };
export type V1Problems = {
  total: number;
  open_total: number;
  by_type: Record<string, number>;
  products: V1ProblemProduct[];
  products_total: number;
};

export type V1TeamRow = { user_id: number; display_name: string; items_picked: number; items_packed: number; is_current_member: boolean };

export const V1_FLOW_STATUSES = ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'] as const;
export type V1FlowStatus = (typeof V1_FLOW_STATUSES)[number];
export type V1FlowStage = { count: number; oldest_age_s: number | null };
export type V1Flow = { stages: Record<V1FlowStatus, V1FlowStage> };

export type V1LiveSummary = { shipped_today: number; cpt_local: string | null; hours_to_cpt: number | null; active_operators: number };

export type V1HistoricalBlocks = {
  pace: AnalyticsAvailability<{ window: V1Window; pace: V1Pace }>;
  problems: AnalyticsAvailability<{ window: V1Window; problems: V1Problems }>;
  team: AnalyticsAvailability<{ window: V1Window; team_activity: V1TeamRow[] }>;
  costs: AnalyticsAvailability<{ unlocked: boolean }>;
};

export type V1LiveBlocks = {
  flow: AnalyticsAvailability<V1Flow>;
  summary: AnalyticsAvailability<V1LiveSummary>;
};

const V1_WINDOW_DAYS = new Set([7, 30, 90]);
const EXCLUDED_PROBLEM_TYPE = 'order_cancelled';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** A real calendar date (exact round-trip — 2026-02-30 is not normalized into March). */
function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

function isV1Window(v: unknown, selectedDays: number): v is V1Window {
  return (
    isObject(v) &&
    v.days === selectedDays &&
    V1_WINDOW_DAYS.has(selectedDays) &&
    isNonEmptyString(v.timezone) &&
    typeof v.start_at === 'string' && !Number.isNaN(Date.parse(v.start_at)) &&
    v.bucket === (selectedDays === 90 ? 'week' : 'day') &&
    isCalendarDate(v.today_local)
  );
}

const isPacePoint = (p: unknown): p is V1PacePoint =>
  isObject(p) && isCalendarDate(p.start_date) && isCalendarDate(p.end_date) && isCount(p.items_picked) &&
  typeof p.is_current === 'boolean' && typeof p.is_clipped === 'boolean';

/** Buckets cover exactly the window's shop-local dates, in order, no gaps or repeats. */
function coversWindow(points: V1PacePoint[], window: V1Window): boolean {
  const first = shiftDate(window.today_local, -(window.days - 1));
  if (window.bucket === 'day') {
    return points.length === window.days &&
      points.every((p, i) => p.start_date === p.end_date && p.start_date === shiftDate(first, i));
  }
  // Monday-start weeks: first starts at the window's first date, last ends today,
  // contiguous; only the first may start off-Monday, only the last may end off-Sunday.
  return points.every((p, i) => {
    const start = i === 0 ? first : shiftDate(points[i - 1].end_date, 1);
    if (p.start_date !== start || p.end_date < p.start_date || shiftDate(p.start_date, 6) < p.end_date) return false;
    if (i > 0 && isoWeekday(p.start_date) !== 1) return false;
    return i === points.length - 1 ? p.end_date === window.today_local : isoWeekday(p.end_date) === 7;
  });
}

function isV1Pace(v: unknown, window: V1Window): v is V1Pace {
  if (!isObject(v) || !isCount(v.items_picked_total) || !Array.isArray(v.points) || v.points.length === 0) return false;
  const points = v.points as unknown[];
  if (!points.every(isPacePoint)) return false;
  const sum = points.reduce((n, p) => n + p.items_picked, 0);
  if (!Number.isSafeInteger(sum) || sum !== v.items_picked_total) return false;
  // Exactly one current bucket, and it is the last (today / this week so far).
  if (points.some((p, i) => p.is_current !== (i === points.length - 1))) return false;
  // Clipping describes the window's partial first week, never today's partial period.
  if (points.some((p, i) => p.is_clipped !== (window.bucket === 'week' && i === 0 && isoWeekday(p.start_date) !== 1))) return false;
  return coversWindow(points, window);
}

const isProblemProduct = (p: unknown): p is V1ProblemProduct =>
  isObject(p) && isNonEmptyString(p.lasyncro_variant_id) && isNonEmptyString(p.display_label) &&
  isNullableString(p.sku) && isCount(p.count);

function isV1Problems(v: unknown): v is V1Problems {
  if (!isObject(v) || !isCount(v.total) || !isCount(v.open_total) || v.open_total > v.total) return false;
  if (!isObject(v.by_type) || EXCLUDED_PROBLEM_TYPE in v.by_type) return false;
  const typeCounts = Object.values(v.by_type);
  if (!typeCounts.every(isCount)) return false;
  const typeSum = typeCounts.reduce((n, c) => n + c, 0);
  if (!Number.isSafeInteger(typeSum) || typeSum !== v.total) return false;
  return Array.isArray(v.products) && v.products.every(isProblemProduct) &&
    isCount(v.products_total) && v.products_total >= v.products.length;
}

const isTeamRow = (r: unknown): r is V1TeamRow =>
  isObject(r) && isCount(r.user_id) && isNonEmptyString(r.display_name) &&
  isCount(r.items_picked) && isCount(r.items_packed) && typeof r.is_current_member === 'boolean';

const isV1Team = (v: unknown): v is V1TeamRow[] => Array.isArray(v) && v.every(isTeamRow);

function isV1FlowStage(v: unknown): v is V1FlowStage {
  if (!isObject(v) || !isCount(v.count)) return false;
  // A stage with orders has a recorded-status age; an empty stage has none.
  if (v.count === 0) return v.oldest_age_s === null;
  return isCount(v.oldest_age_s);
}

function isV1Flow(v: unknown): v is V1Flow {
  return isObject(v) && isObject(v.stages) &&
    V1_FLOW_STATUSES.every((s) => isV1FlowStage((v.stages as Record<string, unknown>)[s]));
}

/** Request error / pending outcome shared by every block of one request, or null to continue. */
function requestOutcome(q: AnalyticsQuerySnapshot): AnalyticsAvailability<never> | null {
  if (q.isError) {
    const denial = classifyAnalyticsDenial(q.error);
    return denial ? { status: 'denied', denial } : { status: 'unavailable' };
  }
  if (q.data === undefined || q.isPlaceholderData) return { status: 'loading' };
  return null;
}

const UNAVAILABLE = { status: 'unavailable' } as const;

export function resolveV1HistoricalBlocks(q: AnalyticsQuerySnapshot, selectedDays: number): V1HistoricalBlocks {
  const all = (state: AnalyticsAvailability<never>): V1HistoricalBlocks => ({ pace: state, problems: state, team: state, costs: state });

  const outcome = requestOutcome(q);
  if (outcome) return all(outcome);

  // Request-level guards the V1 screen still reads, then the selected window (D5, D2).
  const data = q.data;
  if (!isObject(data) || !isNumber(data.days) || !isObject(data.cost) || typeof data.cost.unlocked !== 'boolean') return all(UNAVAILABLE);
  if (data.days !== selectedDays) return all(UNAVAILABLE);

  const updatedAt = q.dataUpdatedAt;
  const ready = <T>(value: T) => ({ status: 'ready' as const, data: value, updatedAt });
  const costs = ready({ unlocked: data.cost.unlocked });

  // A missing or malformed window degrades every region that depends on it; Costs does not.
  if (!isV1Window(data.window, selectedDays)) return { pace: UNAVAILABLE, problems: UNAVAILABLE, team: UNAVAILABLE, costs };
  const window = data.window;

  return {
    pace: isV1Pace(data.pace, window) ? ready({ window, pace: data.pace }) : UNAVAILABLE,
    problems: isV1Problems(data.problems) ? ready({ window, problems: data.problems }) : UNAVAILABLE,
    team: isV1Team(data.team_activity) ? ready({ window, team_activity: data.team_activity }) : UNAVAILABLE,
    costs,
  };
}

export function resolveV1LiveBlocks(q: AnalyticsQuerySnapshot): V1LiveBlocks {
  const outcome = requestOutcome(q);
  if (outcome) return { flow: outcome, summary: outcome };

  const data = q.data;
  if (
    !isObject(data) || !isCount(data.shipped_today) || !isCount(data.active_operators) ||
    !isNullableString(data.cpt_local) || !isNullableNumber(data.hours_to_cpt)
  ) {
    return { flow: UNAVAILABLE, summary: UNAVAILABLE };
  }

  const updatedAt = q.dataUpdatedAt;
  const summary: V1LiveSummary = {
    shipped_today: data.shipped_today,
    cpt_local: data.cpt_local as string | null,
    hours_to_cpt: data.hours_to_cpt as number | null,
    active_operators: data.active_operators,
  };
  return {
    // Counts and ages come from this one response, so they share its freshness.
    flow: isV1Flow(data.flow) ? { status: 'ready', data: data.flow, updatedAt } : UNAVAILABLE,
    summary: { status: 'ready', data: summary, updatedAt },
  };
}
