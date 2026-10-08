// tests/contract/wms-analytics-availability.contract.test.ts
//
// GH-1230 — Warehouse Analytics availability contract (CI-gated).
//
// The frontend render suite (tests/unit/ui/wms/WmsAnalyticsPage.availability
// .test.tsx) is not in the gating CI job; this contract protects the pure
// resolver every Analytics surface renders through:
//   - unknown/unavailable is never a confirmed zero; error is never empty (D1)
//   - historical data must match the selected, server-echoed window (D2)
//   - ACTION_FORBIDDEN is a role denial; COMMERCIAL_ACCESS_DENIED forwards the
//     server's decision and never fabricates a tier (D3)
//   - freshness is the successful-fetch time only (D4)
//   - malformed 200 payloads are unavailable; valid nulls are not (D5)
//   - 401/403 are never retried; transient errors retry a bounded 3 times (D6)

import {
  ANALYTICS_MAX_RETRIES,
  classifyAnalyticsDenial,
  isHistoricalPayload,
  isLiveCapacityPayload,
  resolveAnalyticsDenial,
  resolveHistoricalAvailability,
  resolveLiveAvailability,
  shouldRetryAnalyticsQuery,
  type AnalyticsQuerySnapshot,
} from '../../apps/frontend/src/pages/wms/analyticsAvailability';

const httpError = (status: number, data?: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

const ACTION_FORBIDDEN = httpError(403, { error: 'ACTION_FORBIDDEN', action: 'wms:analytics:read' });
const COMMERCIAL_DENIED = httpError(403, {
  error: 'COMMERCIAL_ACCESS_DENIED',
  reason: 'TIER_TOO_LOW',
  capabilityId: 'warehouse.analytics',
  currentTier: 'starter',
  requiredTier: 'core',
});

function liveKnownZero() {
  return {
    pipeline: { awaiting_pick: 0, picking: 0, packing: 0, ship_ready: 0, shipped: 0 },
    operators_on_shift: 0,
    active_operators: 0,
    cpt_local: null,
    hours_to_cpt: null,
    live_uph: null,
    required_uph: null,
    standard_uph: null,
    on_track: null,
    shipped_today: 0,
    shipped_via_wms: 0,
    shipped_via_legacy: 0,
    unfulfilled_orders: 0,
  };
}

function historicalKnownZero(days: number) {
  return {
    operators: [],
    pipeline: {
      stages: { released_to_picking_s: null, picking_s: null, packing_s: null, packed_to_shipped_s: null },
      latencies: { receive_to_pickable_hours: null, receive_to_pickable_samples: 0, return_to_restock_hours: null },
    },
    exceptions: { top_skus: [], heat_grid: [] },
    cost: { unlocked: false, cost_per_order: null, cost_per_unit: null, exception_cost: null, editorial: null },
    aging_wip: {
      total: 0,
      by_stage: {
        picking: { count: 0, oldest_age_s: 0 },
        picked: { count: 0, oldest_age_s: 0 },
        packing: { count: 0, oldest_age_s: 0 },
        packed: { count: 0, oldest_age_s: 0 },
      },
      oldest_overall_s: 0,
    },
    throughput_trend: { points: [], avg_uph: null, latest_uph: null },
    exception_trend: { total: 0, open_total: 0, by_type: {}, points: [] },
    days,
  };
}

/** Producer-shaped nonzero composite (getOperatorPerformance … getExceptionTrend), cost unlocked. */
function historicalNonzero(days: number) {
  return {
    ...historicalKnownZero(days),
    operators: [{
      user_id: 7, first_name: 'Avery', last_name: null, role: 'operator', picks: 120, packs: 80, batches_picked: 6,
      uph: 31.5, accuracy_pct: null, exception_count: 2, avg_batch_seconds: null, scan_source_mix: {},
    }],
    pipeline: {
      stages: { released_to_picking_s: 600, picking_s: null, packing_s: 300, packed_to_shipped_s: 1200 },
      latencies: { receive_to_pickable_hours: 20, receive_to_pickable_samples: 3, return_to_restock_hours: null },
    },
    exceptions: {
      top_skus: [{ lasyncro_variant_id: 'v-1', title: null, sku: null, exception_count: 2, type_breakdown: { short_pick: 2 } }],
      heat_grid: [{ user_id: 7, name: 'Avery', pick_exception_rate_pct: 1.6, pack_exception_rate_pct: 0 }],
    },
    cost: { unlocked: true, total_cost: 400, cost_per_order: 2.5, cost_per_unit: null, exception_cost: null, orders_shipped: 0, editorial: null },
    aging_wip: {
      total: 3,
      by_stage: {
        picking: { count: 1, oldest_age_s: 1800 },
        picked: { count: 0, oldest_age_s: 0 },
        packing: { count: 1, oldest_age_s: 900 },
        packed: { count: 1, oldest_age_s: 600 },
      },
      oldest_overall_s: 1800,
    },
    throughput_trend: { points: [{ day: '2026-10-07', units: 60, uph: 33 }, { day: '2026-10-08', units: 0, uph: null }], avg_uph: 33, latest_uph: 33 },
    exception_trend: { total: 2, open_total: 1, by_type: { short_pick: 2 }, points: [{ day: '2026-10-07', count: 2 }] },
  };
}

type Payload = ReturnType<typeof historicalNonzero>;

const snapshot = (over: Partial<AnalyticsQuerySnapshot>): AnalyticsQuerySnapshot => ({
  data: undefined,
  error: null,
  isError: false,
  isPlaceholderData: false,
  dataUpdatedAt: 0,
  ...over,
});

describe('GH-1230 D3 — denial classification', () => {
  it('ACTION_FORBIDDEN (and other role codes) are role denials', () => {
    expect(classifyAnalyticsDenial(ACTION_FORBIDDEN)).toEqual({ kind: 'role' });
    expect(classifyAnalyticsDenial(httpError(403, { error: 'NO_ROLE_ASSIGNED' }))).toEqual({ kind: 'role' });
  });

  it('COMMERCIAL_ACCESS_DENIED forwards the server decision verbatim', () => {
    expect(classifyAnalyticsDenial(COMMERCIAL_DENIED)).toEqual({
      kind: 'commercial',
      decision: { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' },
    });
    // Module denial carries no tier step — none may be fabricated.
    expect(
      classifyAnalyticsDenial(httpError(403, { error: 'COMMERCIAL_ACCESS_DENIED', reason: 'MODULE_NOT_INCLUDED', requiredModule: 'wms' })),
    ).toEqual({ kind: 'commercial', decision: { allowed: false, reason: 'MODULE_NOT_INCLUDED', requiredModule: 'wms' } });
  });

  it('a commercial denial without a valid decision, other 403s, 401, 500 and network errors are not denials', () => {
    expect(classifyAnalyticsDenial(httpError(403, { error: 'COMMERCIAL_ACCESS_DENIED' }))).toBeNull();
    expect(classifyAnalyticsDenial(httpError(403, { error: 'COMMERCIAL_ACCESS_DENIED', reason: 'ALLOWED' }))).toBeNull();
    expect(classifyAnalyticsDenial(httpError(403, { error: 'TIER_INSUFFICIENT' }))).toBeNull();
    expect(classifyAnalyticsDenial(httpError(401))).toBeNull();
    expect(classifyAnalyticsDenial(httpError(500))).toBeNull();
    expect(classifyAnalyticsDenial(new Error('Network Error'))).toBeNull();
  });

  it('page-level denial: commercial truth takes precedence over role; none when no query is denied', () => {
    const role = resolveLiveAvailability(snapshot({ isError: true, error: ACTION_FORBIDDEN }));
    const commercial = resolveLiveAvailability(snapshot({ isError: true, error: COMMERCIAL_DENIED }));
    expect(resolveAnalyticsDenial(role, commercial)?.kind).toBe('commercial');
    expect(resolveAnalyticsDenial(role, { status: 'loading' })?.kind).toBe('role');
    expect(resolveAnalyticsDenial({ status: 'loading' }, { status: 'unavailable' })).toBeNull();
  });
});

describe('GH-1230 D6 — retry policy', () => {
  it('401 and 403 are never retried', () => {
    for (const error of [httpError(401), ACTION_FORBIDDEN, COMMERCIAL_DENIED]) {
      expect(shouldRetryAnalyticsQuery(0, error)).toBe(false);
    }
  });

  it('transient errors retry a bounded 3 times', () => {
    expect(ANALYTICS_MAX_RETRIES).toBe(3);
    for (const error of [httpError(500), httpError(503), new Error('Network Error')]) {
      expect([0, 1, 2, 3].map((n) => shouldRetryAnalyticsQuery(n, error))).toEqual([true, true, true, false]);
    }
  });
});

describe('GH-1230 D5 — response shape', () => {
  it('valid known-zero / null / unconfigured payloads are accepted', () => {
    expect(isLiveCapacityPayload(liveKnownZero())).toBe(true);
    expect(isHistoricalPayload(historicalKnownZero(30))).toBe(true);
  });

  it('payloads missing required structure are rejected', () => {
    expect(isLiveCapacityPayload({})).toBe(false);
    expect(isLiveCapacityPayload({ ...liveKnownZero(), pipeline: undefined })).toBe(false);
    expect(isLiveCapacityPayload({ ...liveKnownZero(), shipped_today: null })).toBe(false);
    expect(isHistoricalPayload({ days: 30 })).toBe(false);
    expect(isHistoricalPayload({ ...historicalKnownZero(30), operators: undefined })).toBe(false);
    expect(isHistoricalPayload('<!doctype html>')).toBe(false);
  });

  it('producer-shaped nonzero payload with legitimate nulls / zero / unlocked cost is accepted', () => {
    expect(isHistoricalPayload(historicalNonzero(30))).toBe(true);
    expect(resolveHistoricalAvailability(snapshot({ data: historicalNonzero(30), dataUpdatedAt: 1 }), 30).status).toBe('ready');
  });

  // Nested entries current owner-page cards dereference or present as known metrics.
  const NESTED_MALFORMED: [string, (p: Payload) => unknown][] = [
    ['operators: [null]', (p) => ({ ...p, operators: [null] })],
    ['operator picks not a number', (p) => ({ ...p, operators: [{ ...p.operators[0], picks: '120' }] })],
    ['operator uph not number|null', (p) => ({ ...p, operators: [{ ...p.operators[0], uph: 'fast' }] })],
    ['operator exception_count missing', (p) => ({ ...p, operators: [{ ...p.operators[0], exception_count: undefined }] })],
    ['throughput_trend.points: [null]', (p) => ({ ...p, throughput_trend: { ...p.throughput_trend, points: [null] } })],
    ['trend point uph not number|null', (p) => ({ ...p, throughput_trend: { ...p.throughput_trend, points: [{ day: '2026-10-07', units: 1, uph: '33' }] } })],
    ['trend avg_uph not number|null', (p) => ({ ...p, throughput_trend: { ...p.throughput_trend, avg_uph: '33' } })],
    ['aging total > 0 with empty by_stage', (p) => ({ ...p, aging_wip: { total: 3, by_stage: {}, oldest_overall_s: 1800 } })],
    ['aging stage missing', (p) => ({ ...p, aging_wip: { ...p.aging_wip, by_stage: { ...p.aging_wip.by_stage, picked: undefined } } })],
    ['aging stage count null', (p) => ({ ...p, aging_wip: { ...p.aging_wip, by_stage: { ...p.aging_wip.by_stage, packing: { count: null, oldest_age_s: 0 } } } })],
    ['aging oldest_overall_s missing', (p) => ({ ...p, aging_wip: { ...p.aging_wip, oldest_overall_s: undefined } })],
    ['problem SKUs: [null]', (p) => ({ ...p, exceptions: { ...p.exceptions, top_skus: [null] } })],
    ['problem SKU count not a number', (p) => ({ ...p, exceptions: { ...p.exceptions, top_skus: [{ ...p.exceptions.top_skus[0], exception_count: '2' }] } })],
    ['heat grid: [null]', (p) => ({ ...p, exceptions: { ...p.exceptions, heat_grid: [null] } })],
    ['heat grid rate missing', (p) => ({ ...p, exceptions: { ...p.exceptions, heat_grid: [{ ...p.exceptions.heat_grid[0], pack_exception_rate_pct: undefined }] } })],
    ['stage duration not number|null', (p) => ({ ...p, pipeline: { ...p.pipeline, stages: { ...p.pipeline.stages, picking_s: '900' } } })],
    ['stage duration missing', (p) => ({ ...p, pipeline: { ...p.pipeline, stages: { ...p.pipeline.stages, packing_s: undefined } } })],
    ['latency sample count null', (p) => ({ ...p, pipeline: { ...p.pipeline, latencies: { ...p.pipeline.latencies, receive_to_pickable_samples: null } } })],
    ['unlocked cost value not number|null', (p) => ({ ...p, cost: { ...p.cost, cost_per_order: '2.5' } })],
    ['unlocked cost editorial not string|null', (p) => ({ ...p, cost: { ...p.cost, editorial: 42 } })],
    ['problem trend open_total missing', (p) => ({ ...p, exception_trend: { ...p.exception_trend, open_total: undefined } })],
    ['problem trend by_type count not a number', (p) => ({ ...p, exception_trend: { ...p.exception_trend, by_type: { short_pick: '2' } } })],
  ];

  it.each(NESTED_MALFORMED)('nested malformed (%s) is rejected and resolves unavailable, never ready', (_name, mutate) => {
    const data = mutate(historicalNonzero(30));
    expect(isHistoricalPayload(data)).toBe(false);
    expect(resolveHistoricalAvailability(snapshot({ data, dataUpdatedAt: 1 }), 30)).toEqual({ status: 'unavailable' });
  });
});

describe('GH-1230 D1/D2/D4 — historical availability', () => {
  const ready = historicalKnownZero(30);

  it('pending and placeholder data are loading, never zero', () => {
    expect(resolveHistoricalAvailability(snapshot({}), 30)).toEqual({ status: 'loading' });
    expect(resolveHistoricalAvailability(snapshot({ data: historicalKnownZero(7), isPlaceholderData: true }), 30))
      .toEqual({ status: 'loading' });
  });

  it('verified data for the selected window is ready with its successful-fetch time', () => {
    expect(resolveHistoricalAvailability(snapshot({ data: ready, dataUpdatedAt: 1234 }), 30))
      .toEqual({ status: 'ready', data: ready, updatedAt: 1234 });
  });

  it('data echoed for another window is never attributed to the selection', () => {
    expect(resolveHistoricalAvailability(snapshot({ data: historicalKnownZero(7), dataUpdatedAt: 1 }), 30).status)
      .not.toBe('ready');
  });

  it('a failed refresh with retained data is unavailable, not stale-but-current', () => {
    expect(resolveHistoricalAvailability(snapshot({ data: ready, isError: true, error: httpError(500), dataUpdatedAt: 1 }), 30))
      .toEqual({ status: 'unavailable' });
  });

  it('malformed 200 is unavailable; denials are denied', () => {
    expect(resolveHistoricalAvailability(snapshot({ data: { days: 30 } }), 30)).toEqual({ status: 'unavailable' });
    expect(resolveHistoricalAvailability(snapshot({ isError: true, error: ACTION_FORBIDDEN }), 30))
      .toEqual({ status: 'denied', denial: { kind: 'role' } });
  });
});

describe('GH-1230 D1/D4/D5 — live availability (independent of historical)', () => {
  it('ready / loading / unavailable follow the live query alone', () => {
    const data = liveKnownZero();
    expect(resolveLiveAvailability(snapshot({ data, dataUpdatedAt: 99 }))).toEqual({ status: 'ready', data, updatedAt: 99 });
    expect(resolveLiveAvailability(snapshot({}))).toEqual({ status: 'loading' });
    expect(resolveLiveAvailability(snapshot({ data: {} }))).toEqual({ status: 'unavailable' });
    expect(resolveLiveAvailability(snapshot({ data, isError: true, error: httpError(500), dataUpdatedAt: 99 })))
      .toEqual({ status: 'unavailable' });
  });
});
