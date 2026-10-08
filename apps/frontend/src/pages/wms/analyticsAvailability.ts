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
