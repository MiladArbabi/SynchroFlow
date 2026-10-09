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

// ═════════════════════════════════════════════════════════════════════════════
// GH-1231 — Analytics V1 per-block availability (RED until implemented)
//
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.5
// "Failure precedence". GH-1230 D1–D6 apply first (request failure, denial,
// selected window, request-level shape guards); only then may a SINGLE
// missing/malformed new V1 block degrade the regions that depend on it.
//
// Expected production interface (apps/frontend/src/pages/wms/analyticsAvailability.ts):
//   resolveV1HistoricalBlocks(q, selectedDays) → { pace, problems, team, costs }
//   resolveV1LiveBlocks(q)                     → { flow, summary }
// Every value is an AnalyticsAvailability<T> (loading | ready | unavailable | denied).
// Ready data: pace → { window, pace }, problems → { window, problems },
// team → { window, team_activity }, costs → { unlocked },
// flow → the live `flow` block, summary → { shipped_today, cpt_local,
// hours_to_cpt, active_operators }.
// ═════════════════════════════════════════════════════════════════════════════

import * as availabilityModule from '../../apps/frontend/src/pages/wms/analyticsAvailability';

type AnyAvailability = { status: string; data?: any; updatedAt?: number; denial?: unknown };

function v1Export(name: 'resolveV1HistoricalBlocks' | 'resolveV1LiveBlocks'): (...args: any[]) => Record<string, AnyAvailability> {
  const fn = (availabilityModule as Record<string, unknown>)[name];
  if (typeof fn !== 'function') {
    throw new Error(`GH-1231 V1 contract missing: analyticsAvailability.${name}() is not implemented`);
  }
  return fn as (...args: any[]) => Record<string, AnyAvailability>;
}
const resolveV1Historical = (q: AnalyticsQuerySnapshot, days: number) => v1Export('resolveV1HistoricalBlocks')(q, days);
const resolveV1Live = (q: AnalyticsQuerySnapshot) => v1Export('resolveV1LiveBlocks')(q);

const HIST_BLOCKS = ['pace', 'problems', 'team', 'costs'] as const;
const WINDOW_BLOCKS = ['pace', 'problems', 'team'] as const;
const LIVE_BLOCKS = ['flow', 'summary'] as const;

const DATES_7 = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];

function v1Window(days: number) {
  return {
    days,
    timezone: 'Europe/Stockholm',
    start_at: '2026-10-01T22:00:00.000Z',
    bucket: days === 90 ? 'week' : 'day',
    today_local: '2026-10-08',
  };
}

function paceFrom(values: number[]) {
  const points = DATES_7.map((d, i) => ({
    start_date: d, end_date: d, items_picked: values[i], is_current: i === DATES_7.length - 1, is_clipped: false,
  }));
  return { items_picked_total: values.reduce((a, b) => a + b, 0), points };
}

/** New-backend composite for 7d: legacy keys unchanged + additive V1 blocks, genuine zero. */
function v1HistoricalZero() {
  return {
    ...historicalKnownZero(7),
    window: v1Window(7),
    pace: paceFrom([0, 0, 0, 0, 0, 0, 0]),
    problems: { total: 0, open_total: 0, by_type: {}, products: [], products_total: 0 },
    team_activity: [] as unknown[],
  };
}

function v1HistoricalNonzero() {
  return {
    ...historicalKnownZero(7),
    cost: { unlocked: true, total_cost: 400, cost_per_order: 2.5, cost_per_unit: null, exception_cost: null, orders_shipped: 0, editorial: null },
    window: v1Window(7),
    pace: paceFrom([0, 0, 0, 0, 0, 60, 12]),
    problems: {
      total: 3,
      open_total: 1,
      by_type: { short_pick: 2, item_missing: 1 },
      products: [
        { lasyncro_variant_id: 'v-1', display_label: 'Mug - Blue', sku: 'MUG-BL', count: 2 },
        { lasyncro_variant_id: 'v-2', display_label: 'Poster', sku: null, count: 1 },
      ],
      products_total: 2,
    },
    team_activity: [
      { user_id: 7, display_name: 'Avery Lind', items_picked: 50, items_packed: 30, is_current_member: true },
      { user_id: 9, display_name: 'Blake Moss', items_picked: 22, items_packed: 0, is_current_member: false },
    ],
  };
}

type V1Hist = ReturnType<typeof v1HistoricalNonzero>;

const FLOW_STATUSES = ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'] as const;

function flowZero() {
  return { stages: Object.fromEntries(FLOW_STATUSES.map((s) => [s, { count: 0, oldest_age_s: null }])) as Record<string, { count: number; oldest_age_s: number | null }> };
}

function flowNonzero() {
  return {
    stages: {
      awaiting_pick: { count: 3, oldest_age_s: 5400 },
      picking: { count: 1, oldest_age_s: 600 },
      picked: { count: 2, oldest_age_s: 6_213_600 }, // ~72 days in recorded status — uncapped
      packing: { count: 0, oldest_age_s: null },
      packed: { count: 4, oldest_age_s: 0 },
    } as Record<string, { count: number; oldest_age_s: number | null }>,
  };
}

function v1Live(flow: unknown = flowNonzero()) {
  return { ...liveKnownZero(), shipped_today: 5, active_operators: 2, cpt_local: '16:00:00', hours_to_cpt: 1.5, flow };
}

const expectNoReadyOrData = (blocks: Record<string, AnyAvailability>, names: readonly string[]) => {
  for (const name of names) {
    expect(`${name}:${blocks[name]?.status}`).not.toBe(`${name}:ready`);
    expect(blocks[name]).not.toHaveProperty('data');
    expect(blocks[name]).not.toHaveProperty('updatedAt');
  }
};

describe('GH-1231 V1 — historical request-level precedence (GH-1230 D1–D6 first)', () => {
  it('pending and placeholder data leave every block loading, never zero', () => {
    const pending = resolveV1Historical(snapshot({}), 7);
    const placeholder = resolveV1Historical(snapshot({ data: v1HistoricalZero(), isPlaceholderData: true, dataUpdatedAt: 1 }), 7);
    for (const name of HIST_BLOCKS) {
      expect(pending[name]).toEqual({ status: 'loading' });
      expect(placeholder[name]).toEqual({ status: 'loading' });
    }
  });

  it('403 ACTION_FORBIDDEN denies every block as a role denial (D3)', () => {
    const r = resolveV1Historical(snapshot({ isError: true, error: ACTION_FORBIDDEN }), 7);
    for (const name of HIST_BLOCKS) expect(r[name]).toEqual({ status: 'denied', denial: { kind: 'role' } });
  });

  it('403 COMMERCIAL_ACCESS_DENIED denies every block with the server decision, and page denial is commercial', () => {
    const r = resolveV1Historical(snapshot({ isError: true, error: COMMERCIAL_DENIED }), 7);
    for (const name of HIST_BLOCKS) {
      expect(r[name]).toEqual({
        status: 'denied',
        denial: { kind: 'commercial', decision: { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' } },
      });
    }
    expect(resolveAnalyticsDenial(...(HIST_BLOCKS.map((n) => r[n]) as any))?.kind).toBe('commercial');
  });

  it('401 makes every block unavailable — not denied, not ready', () => {
    const r = resolveV1Historical(snapshot({ data: v1HistoricalNonzero(), isError: true, error: httpError(401), dataUpdatedAt: 5 }), 7);
    for (const name of HIST_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['500', httpError(500)],
    ['network error', new Error('Network Error')],
  ])('%s on refresh hides every block despite cached valid V1 data, exposing no stale value or freshness (D1/D4)', (_n, error) => {
    const r = resolveV1Historical(snapshot({ data: v1HistoricalNonzero(), isError: true, error, dataUpdatedAt: 5 }), 7);
    for (const name of HIST_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
    expectNoReadyOrData(r, HIST_BLOCKS);
  });

  it('wrong top-level days rejects every block for the selected period (D2)', () => {
    const r = resolveV1Historical(snapshot({ data: { ...v1HistoricalNonzero(), days: 30 }, dataUpdatedAt: 5 }), 7);
    for (const name of HIST_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
  });

  it('echoed window.days that differs from the selection rejects every selected-window block (D2)', () => {
    const data = { ...v1HistoricalNonzero(), window: { ...v1Window(7), days: 30 } };
    const r = resolveV1Historical(snapshot({ data, dataUpdatedAt: 5 }), 7);
    for (const name of WINDOW_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
    // Costs reads cost.unlocked only, which is not window-scoped (§12B.5 rule 2 scopes to selected-window regions).
    expect(r.costs).toEqual({ status: 'ready', data: { unlocked: true }, updatedAt: 5 });
  });

  it.each([
    ['non-object body', '<!doctype html>'],
    ['days missing', (() => { const { days: _d, ...rest } = v1HistoricalNonzero(); return rest; })()],
    ['cost.unlocked not boolean', { ...v1HistoricalNonzero(), cost: { unlocked: 'yes' } }],
    ['cost missing', { ...v1HistoricalNonzero(), cost: undefined }],
  ])('request-level legacy guard failure (%s) makes every block unavailable (D5)', (_n, data) => {
    const r = resolveV1Historical(snapshot({ data, dataUpdatedAt: 5 }), 7);
    for (const name of HIST_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
  });
});

describe('GH-1231 V1 — historical per-block degradation (only after D1–D6 pass)', () => {
  it('verified nonzero V1 response: every block ready with the successful-fetch time', () => {
    const data = v1HistoricalNonzero();
    const r = resolveV1Historical(snapshot({ data, dataUpdatedAt: 1234 }), 7);
    expect(r.pace).toEqual({ status: 'ready', data: { window: data.window, pace: data.pace }, updatedAt: 1234 });
    expect(r.problems).toEqual({ status: 'ready', data: { window: data.window, problems: data.problems }, updatedAt: 1234 });
    expect(r.team).toEqual({ status: 'ready', data: { window: data.window, team_activity: data.team_activity }, updatedAt: 1234 });
    expect(r.costs).toEqual({ status: 'ready', data: { unlocked: true }, updatedAt: 1234 });
  });

  it('genuine zero, empty arrays and an empty problem breakdown are valid and ready', () => {
    const data = v1HistoricalZero();
    const r = resolveV1Historical(snapshot({ data, dataUpdatedAt: 9 }), 7);
    for (const name of HIST_BLOCKS) expect(r[name].status).toBe('ready');
    expect(r.pace.data.pace.items_picked_total).toBe(0);
    expect(r.pace.data.pace.points).toHaveLength(7);
    expect(r.problems.data.problems.total).toBe(0);
    expect(r.team.data.team_activity).toEqual([]);
    expect(r.costs.data).toEqual({ unlocked: false });
  });

  it('DEPLOY GAP old backend → new frontend: legacy-only response keeps Costs ready; window-dependent V1 regions are unavailable, never zero', () => {
    const r = resolveV1Historical(snapshot({ data: historicalKnownZero(7), dataUpdatedAt: 3 }), 7);
    expect(r.costs).toEqual({ status: 'ready', data: { unlocked: false }, updatedAt: 3 });
    for (const name of WINDOW_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
  });

  const WINDOW_MALFORMED: [string, (p: V1Hist) => unknown][] = [
    ['window missing', (p) => ({ ...p, window: undefined })],
    ['window.timezone missing', (p) => ({ ...p, window: { ...p.window, timezone: undefined } })],
    ['window.bucket week for 7d', (p) => ({ ...p, window: { ...p.window, bucket: 'week' } })],
    ['window.today_local not a date', (p) => ({ ...p, window: { ...p.window, today_local: 'today' } })],
    ['window.start_at not a string', (p) => ({ ...p, window: { ...p.window, start_at: 0 } })],
  ];

  it.each(WINDOW_MALFORMED)('%s: Pace, Problems and Team unavailable; Costs stays ready', (_n, mutate) => {
    const r = resolveV1Historical(snapshot({ data: mutate(v1HistoricalNonzero()), dataUpdatedAt: 5 }), 7);
    for (const name of WINDOW_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
    expect(r.costs).toEqual({ status: 'ready', data: { unlocked: true }, updatedAt: 5 });
  });

  const BLOCK_MALFORMED: [string, 'pace' | 'problems' | 'team', (p: V1Hist) => unknown][] = [
    ['pace missing', 'pace', (p) => ({ ...p, pace: undefined })],
    ['pace.points: [null]', 'pace', (p) => ({ ...p, pace: { ...p.pace, points: [null] } })],
    ['pace point items_picked as string', 'pace', (p) => ({ ...p, pace: { ...p.pace, points: p.pace.points.map((pt, i) => (i === 5 ? { ...pt, items_picked: '60' } : pt)) } })],
    ['pace point items_picked negative', 'pace', (p) => ({ ...p, pace: { ...p.pace, points: p.pace.points.map((pt, i) => (i === 0 ? { ...pt, items_picked: -1 } : pt)) } })],
    ['pace total ≠ Σ points', 'pace', (p) => ({ ...p, pace: { ...p.pace, items_picked_total: 999 } })],
    ['pace with no current bucket', 'pace', (p) => ({ ...p, pace: { ...p.pace, points: p.pace.points.map((pt) => ({ ...pt, is_current: false })) } })],
    ['pace current bucket not last', 'pace', (p) => ({ ...p, pace: { ...p.pace, points: p.pace.points.map((pt, i) => ({ ...pt, is_current: i === 0 })) } })],
    ['pace points empty', 'pace', (p) => ({ ...p, pace: { items_picked_total: 0, points: [] } })],
    ['problems missing', 'problems', (p) => ({ ...p, problems: undefined })],
    ['problems.total as string', 'problems', (p) => ({ ...p, problems: { ...p.problems, total: '3' } })],
    ['problems open_total > total', 'problems', (p) => ({ ...p, problems: { ...p.problems, open_total: 4 } })],
    ['problems Σ by_type ≠ total', 'problems', (p) => ({ ...p, problems: { ...p.problems, by_type: { short_pick: 1 } } })],
    ['problems by_type includes order_cancelled', 'problems', (p) => ({ ...p, problems: { ...p.problems, total: 4, by_type: { ...p.problems.by_type, order_cancelled: 1 } } })],
    ['problems.products: [null]', 'problems', (p) => ({ ...p, problems: { ...p.problems, products: [null] } })],
    ['problem product display_label missing', 'problems', (p) => ({ ...p, problems: { ...p.problems, products: [{ ...p.problems.products[0], display_label: undefined }] } })],
    ['problem product count as string', 'problems', (p) => ({ ...p, problems: { ...p.problems, products: [{ ...p.problems.products[0], count: '2' }] } })],
    ['products_total < products.length', 'problems', (p) => ({ ...p, problems: { ...p.problems, products_total: 1 } })],
    ['team_activity missing', 'team', (p) => ({ ...p, team_activity: undefined })],
    ['team_activity not an array', 'team', (p) => ({ ...p, team_activity: {} })],
    ['team row items_picked null', 'team', (p) => ({ ...p, team_activity: [{ ...p.team_activity[0], items_picked: null }] })],
    ['team row display_name missing', 'team', (p) => ({ ...p, team_activity: [{ ...p.team_activity[0], display_name: undefined }] })],
    ['team row is_current_member missing', 'team', (p) => ({ ...p, team_activity: [{ ...p.team_activity[0], is_current_member: undefined }] })],
  ];

  it.each(BLOCK_MALFORMED)('%s → only %s unavailable; other verified blocks stay ready', (_n, broken, mutate) => {
    const r = resolveV1Historical(snapshot({ data: mutate(v1HistoricalNonzero()), dataUpdatedAt: 5 }), 7);
    expect(r[broken]).toEqual({ status: 'unavailable' });
    for (const name of HIST_BLOCKS.filter((n) => n !== broken)) {
      expect(`${name}:${r[name].status}`).toBe(`${name}:ready`);
      expect(r[name].updatedAt).toBe(5);
    }
  });
});

describe('GH-1231 V1 — live blocks (flow + summary)', () => {
  it('pending and placeholder leave flow and summary loading', () => {
    const pending = resolveV1Live(snapshot({}));
    const placeholder = resolveV1Live(snapshot({ data: v1Live(), isPlaceholderData: true, dataUpdatedAt: 1 }));
    for (const name of LIVE_BLOCKS) {
      expect(pending[name]).toEqual({ status: 'loading' });
      expect(placeholder[name]).toEqual({ status: 'loading' });
    }
  });

  it('verified response: flow and summary ready from the same fetch (counts and ages share freshness)', () => {
    const data = v1Live();
    const r = resolveV1Live(snapshot({ data, dataUpdatedAt: 77 }));
    expect(r.flow).toEqual({ status: 'ready', data: data.flow, updatedAt: 77 });
    expect(r.summary).toEqual({
      status: 'ready',
      data: { shipped_today: 5, cpt_local: '16:00:00', hours_to_cpt: 1.5, active_operators: 2 },
      updatedAt: 77,
    });
  });

  it('a very old recorded-status age is valid and preserved uncapped', () => {
    const r = resolveV1Live(snapshot({ data: v1Live(), dataUpdatedAt: 1 }));
    expect(r.flow.data.stages.picked.oldest_age_s).toBe(6_213_600);
  });

  it('genuine zero flow (all counts 0, null ages) is ready', () => {
    const r = resolveV1Live(snapshot({ data: v1Live(flowZero()), dataUpdatedAt: 1 }));
    expect(r.flow.status).toBe('ready');
    expect(r.flow.data.stages.picked).toEqual({ count: 0, oldest_age_s: null });
  });

  it('403 role denial denies both; 401 / 500 / network with cached data make both unavailable', () => {
    const denied = resolveV1Live(snapshot({ isError: true, error: ACTION_FORBIDDEN }));
    for (const name of LIVE_BLOCKS) expect(denied[name]).toEqual({ status: 'denied', denial: { kind: 'role' } });
    for (const error of [httpError(401), httpError(500), new Error('Network Error')]) {
      const r = resolveV1Live(snapshot({ data: v1Live(), isError: true, error, dataUpdatedAt: 77 }));
      for (const name of LIVE_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
      expectNoReadyOrData(r, LIVE_BLOCKS);
    }
  });

  it('DEPLOY GAP old backend → new frontend: live response without flow keeps summary ready; Flow unavailable, never zero', () => {
    const r = resolveV1Live(snapshot({ data: { ...liveKnownZero(), shipped_today: 5 }, dataUpdatedAt: 4 }));
    expect(r.flow).toEqual({ status: 'unavailable' });
    expect(r.summary).toEqual({
      status: 'ready',
      data: { shipped_today: 5, cpt_local: null, hours_to_cpt: null, active_operators: 0 },
      updatedAt: 4,
    });
  });

  it.each([
    ['shipped_today null', { shipped_today: null }],
    ['active_operators missing', { active_operators: undefined }],
    ['cpt_local not string|null', { cpt_local: 1600 }],
    ['hours_to_cpt not number|null', { hours_to_cpt: '1.5' }],
  ])('request-level live guard failure (%s) makes flow and summary unavailable (D5)', (_n, patch) => {
    const r = resolveV1Live(snapshot({ data: { ...v1Live(), ...patch }, dataUpdatedAt: 1 }));
    for (const name of LIVE_BLOCKS) expect(r[name]).toEqual({ status: 'unavailable' });
  });

  const stagesWith = (status: string, value: unknown) => ({ stages: { ...flowNonzero().stages, [status]: value } });
  const FLOW_MALFORMED: [string, unknown][] = [
    ['flow.stages missing', {}],
    ['picked stage missing (Waiting to be packed)', (() => { const { picked: _p, ...rest } = flowNonzero().stages; return { stages: rest }; })()],
    ['awaiting_pick stage missing', (() => { const { awaiting_pick: _a, ...rest } = flowNonzero().stages; return { stages: rest }; })()],
    ['count as string', stagesWith('picking', { count: '1', oldest_age_s: 600 })],
    ['count negative', stagesWith('picking', { count: -1, oldest_age_s: 600 })],
    ['age negative', stagesWith('picking', { count: 1, oldest_age_s: -5 })],
    ['orders present but age null', stagesWith('picking', { count: 1, oldest_age_s: null })],
    ['no orders but an age is reported', stagesWith('packing', { count: 0, oldest_age_s: 120 })],
  ];

  it.each(FLOW_MALFORMED)('malformed flow (%s) → Flow unavailable; summary stays ready', (_n, flow) => {
    const r = resolveV1Live(snapshot({ data: v1Live(flow), dataUpdatedAt: 8 }));
    expect(r.flow).toEqual({ status: 'unavailable' });
    expect(r.summary.status).toBe('ready');
  });
});

describe('GH-1231 V1 — DEPLOY GAP new backend → old frontend (GH-1230 resolvers tolerate additive fields)', () => {
  it('the legacy historical resolver still accepts a V1-extended composite', () => {
    const data = { ...v1HistoricalNonzero(), ...historicalNonzero(7), window: v1Window(7) };
    expect(isHistoricalPayload(data)).toBe(true);
    expect(resolveHistoricalAvailability(snapshot({ data, dataUpdatedAt: 2 }), 7).status).toBe('ready');
  });

  it('the legacy live resolver still accepts a live response carrying flow', () => {
    expect(isLiveCapacityPayload(v1Live())).toBe(true);
    expect(resolveLiveAvailability(snapshot({ data: v1Live(), dataUpdatedAt: 2 })).status).toBe('ready');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GH-1231 — displayed quantities and selected-window coverage (RED until implemented)
//
// Every displayed item / order / problem / team quantity is a finite,
// nonnegative integer. Pace buckets must cover exactly the selected window's
// shop-local dates (§12B.3): 7d/30d one ordered day per date ending today_local;
// 90d contiguous Monday-start weeks covering exactly 90 dates. A bucket set that
// sums correctly but is repeated, missing, misordered or shifted falsely claims
// the period and is unavailable — absent dates are never densified into zeros.
// Probes keep each block's own sum/current-bucket invariants consistent where the
// shape allows, so they isolate the integer/coverage rule; assertions isolate
// the region: only the broken block degrades (§12B.5 rule 4).
// ─────────────────────────────────────────────────────────────────────────────

function expectOnlyHistoricalUnavailable(r: Record<string, AnyAvailability>, broken: readonly string[], updatedAt: number) {
  for (const name of broken) expect(r[name]).toEqual({ status: 'unavailable' });
  for (const name of HIST_BLOCKS.filter((n) => !broken.includes(n))) {
    expect(`${name}:${r[name].status}`).toBe(`${name}:ready`);
    expect(r[name].updatedAt).toBe(updatedAt);
  }
}

describe('GH-1231 V1 — displayed quantities are finite nonnegative integers', () => {
  const withPace = (p: V1Hist, values: number[]) => ({ ...p, pace: paceFrom(values) });
  const withProblems = (p: V1Hist, patch: Partial<V1Hist['problems']>) => ({ ...p, problems: { ...p.problems, ...patch } });
  const withProduct = (p: V1Hist, i: number, count: number) =>
    withProblems(p, { products: p.problems.products.map((row, j) => (j === i ? { ...row, count } : row)) });
  const withTeamRow = (p: V1Hist, patch: Record<string, number>) =>
    ({ ...p, team_activity: p.team_activity.map((row, j) => (j === 0 ? { ...row, ...patch } : row)) });

  // v1HistoricalNonzero: pace [0,0,0,0,0,60,12] = 72; problems 3 / open 1 / {short_pick 2, item_missing 1}.
  const NUMERIC_MALFORMED: [string, 'pace' | 'problems' | 'team', (p: V1Hist) => unknown][] = [
    ['pace bucket fractional (Σ consistent)', 'pace', (p) => withPace(p, [0, 0, 0, 0, 0, 59.5, 12.5])],
    ['pace bucket negative (Σ consistent)', 'pace', (p) => withPace(p, [-1, 0, 0, 0, 0, 61, 12])],
    ['pace bucket NaN', 'pace', (p) => withPace(p, [0, 0, 0, 0, 0, NaN, 12])],
    ['pace bucket and total Infinity (Σ consistent)', 'pace', (p) => withPace(p, [0, 0, 0, 0, 0, Infinity, 12])],
    ['pace.items_picked_total fractional', 'pace', (p) => ({ ...p, pace: { ...p.pace, items_picked_total: 72.5 } })],
    ['problems.total and a type count fractional (Σ consistent)', 'problems', (p) => withProblems(p, { total: 3.5, by_type: { short_pick: 2.5, item_missing: 1 } })],
    ['problems.total negative (open and type counts match)', 'problems', (p) => withProblems(p, { total: -1, open_total: -1, by_type: { short_pick: -1 } })],
    ['problems.open_total fractional', 'problems', (p) => withProblems(p, { open_total: 0.5 })],
    ['problems.open_total negative', 'problems', (p) => withProblems(p, { open_total: -1 })],
    ['problems type count negative (Σ consistent)', 'problems', (p) => withProblems(p, { by_type: { short_pick: 4, item_missing: -1 } })],
    ['problems type counts fractional (Σ consistent)', 'problems', (p) => withProblems(p, { by_type: { short_pick: 1.5, item_missing: 1.5 } })],
    ['problem product count fractional', 'problems', (p) => withProduct(p, 0, 1.5)],
    ['problem product count negative', 'problems', (p) => withProduct(p, 1, -1)],
    ['problems.products_total fractional', 'problems', (p) => withProblems(p, { products_total: 2.5 })],
    ['team items_picked fractional', 'team', (p) => withTeamRow(p, { items_picked: 50.5 })],
    ['team items_picked negative', 'team', (p) => withTeamRow(p, { items_picked: -1 })],
    ['team items_picked NaN', 'team', (p) => withTeamRow(p, { items_picked: NaN })],
    ['team items_packed fractional', 'team', (p) => withTeamRow(p, { items_packed: 30.5 })],
    ['team items_packed negative', 'team', (p) => withTeamRow(p, { items_packed: -1 })],
  ];

  it.each(NUMERIC_MALFORMED)('%s → only %s unavailable; other verified blocks stay ready', (_n, broken, mutate) => {
    const r = resolveV1Historical(snapshot({ data: mutate(v1HistoricalNonzero()), dataUpdatedAt: 5 }), 7);
    expectOnlyHistoricalUnavailable(r, [broken], 5);
  });

  const stagesWith = (status: string, value: unknown) => ({ stages: { ...flowNonzero().stages, [status]: value } });
  const FLOW_NUMERIC_MALFORMED: [string, unknown][] = [
    ['picking count fractional', stagesWith('picking', { count: 1.5, oldest_age_s: 600 })],
    ['awaiting_pick count fractional', stagesWith('awaiting_pick', { count: 2.5, oldest_age_s: 5400 })],
    ['packed count NaN', stagesWith('packed', { count: NaN, oldest_age_s: 0 })],
    ['picked count Infinity', stagesWith('picked', { count: Infinity, oldest_age_s: 6_213_600 })],
  ];

  it.each(FLOW_NUMERIC_MALFORMED)('flow %s → Flow unavailable; summary stays ready', (_n, flow) => {
    const r = resolveV1Live(snapshot({ data: v1Live(flow), dataUpdatedAt: 8 }));
    expect(r.flow).toEqual({ status: 'unavailable' });
    expect(r.summary).toEqual(expect.objectContaining({ status: 'ready', updatedAt: 8 }));
  });

  it('a fractional populated Flow age is unavailable while the summary stays ready', () => {
    const r = resolveV1Live(snapshot({ data: v1Live(stagesWith('picking', { count: 1, oldest_age_s: 600.5 })), dataUpdatedAt: 8 }));
    expect(r.flow).toEqual({ status: 'unavailable' });
    expect(r.summary).toEqual(expect.objectContaining({ status: 'ready', updatedAt: 8 }));
  });

  it('an unsafe integer populated Flow age is unavailable while the summary stays ready', () => {
    const r = resolveV1Live(snapshot({ data: v1Live(stagesWith('picking', { count: 1, oldest_age_s: Number.MAX_SAFE_INTEGER + 1 })), dataUpdatedAt: 8 }));
    expect(r.flow).toEqual({ status: 'unavailable' });
    expect(r.summary).toEqual(expect.objectContaining({ status: 'ready', updatedAt: 8 }));
  });
});

describe('GH-1231 V1 — Pace buckets cover exactly the selected 7 / 30 / 90-day window', () => {
  type PacePoint = { start_date: string; end_date: string; items_picked: number; is_current: boolean; is_clipped: boolean };

  const TODAY = '2026-10-08'; // Thursday; 90d window starts Saturday 2026-07-11
  // Shop-local midnight (Europe/Stockholm, CEST) of each window's first date.
  const START_AT: Record<number, string> = { 7: '2026-10-01T22:00:00.000Z', 30: '2026-09-08T22:00:00.000Z', 90: '2026-07-10T22:00:00.000Z' };

  const shiftDate = (isoDate: string, n: number) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayCount = (p: PacePoint) => (Date.parse(p.end_date) - Date.parse(p.start_date)) / 86_400_000 + 1;

  function dailyPoints(days: number): PacePoint[] {
    return Array.from({ length: days }, (_, i) => {
      const date = shiftDate(TODAY, i - days + 1);
      return { start_date: date, end_date: date, items_picked: i % 3, is_current: i === days - 1, is_clipped: false };
    });
  }

  /** Clipped Sat–Sun first week, full Monday–Sunday weeks, current Monday–today week. */
  function weeklyPoints90(): PacePoint[] {
    const first = shiftDate(TODAY, -89);
    const points: PacePoint[] = [];
    for (let start = first; start <= TODAY;) {
      const toSunday = (7 - new Date(`${start}T00:00:00Z`).getUTCDay()) % 7;
      const sunday = shiftDate(start, toSunday);
      const end = sunday < TODAY ? sunday : TODAY;
      points.push({ start_date: start, end_date: end, items_picked: points.length % 4, is_current: end === TODAY, is_clipped: start === first && toSunday < 6 });
      start = shiftDate(end, 1);
    }
    return points;
  }

  const validPoints = (days: number) => (days === 90 ? weeklyPoints90() : dailyPoints(days));

  /** Current flag stays on the last bucket and the total stays Σ buckets, so only coverage can reject. */
  function historicalWith(days: number, points: PacePoint[]) {
    const pts = points.map((p, i) => ({ ...p, is_current: i === points.length - 1 }));
    return {
      ...v1HistoricalNonzero(),
      days,
      window: { days, timezone: 'Europe/Stockholm', start_at: START_AT[days], bucket: days === 90 ? 'week' : 'day', today_local: TODAY },
      pace: { items_picked_total: pts.reduce((a, p) => a + p.items_picked, 0), points: pts },
    };
  }

  it('fixture self-check: 90d weeks are 14 contiguous buckets covering exactly 90 dates', () => {
    const weeks = weeklyPoints90();
    expect(weeks).toHaveLength(14);
    expect(weeks.reduce((n, p) => n + dayCount(p), 0)).toBe(90);
    expect(weeks[0]).toMatchObject({ start_date: '2026-07-11', end_date: '2026-07-12' });
    expect(weeks[13]).toMatchObject({ start_date: '2026-10-05', end_date: TODAY });
  });

  it.each([[7, 7], [30, 30], [90, 14]])('valid %id coverage (%i buckets) is ready with the buckets as returned — nothing densified', (days, buckets) => {
    const data = historicalWith(days, validPoints(days));
    const r = resolveV1Historical(snapshot({ data, dataUpdatedAt: 6 }), days);
    for (const name of HIST_BLOCKS) expect(`${name}:${r[name].status}`).toBe(`${name}:ready`);
    expect(r.pace.data.pace.points).toHaveLength(buckets);
    expect(r.pace.data.pace).toEqual(data.pace);
  });

  const without = (pts: PacePoint[], i: number) => pts.filter((_, j) => j !== i);

  it('daily Pace buckets cannot claim clipping, including today', () => {
    for (const index of [0, 6]) {
      const points = dailyPoints(7).map((p, i) => ({ ...p, is_clipped: i === index }));
      const r = resolveV1Historical(snapshot({ data: historicalWith(7, points), dataUpdatedAt: 6 }), 7);
      expectOnlyHistoricalUnavailable(r, ['pace'], 6);
    }
  });

  it('a weekly first bucket starting after Monday must declare clipping', () => {
    const points = weeklyPoints90().map((p) => ({ ...p, is_clipped: false }));
    const r = resolveV1Historical(snapshot({ data: historicalWith(90, points), dataUpdatedAt: 6 }), 90);
    expectOnlyHistoricalUnavailable(r, ['pace'], 6);
  });

  it('later weekly buckets cannot claim clipping, including this week so far', () => {
    for (const index of [1, 13]) {
      const points = weeklyPoints90().map((p, i) => ({ ...p, is_clipped: p.is_clipped || i === index }));
      const r = resolveV1Historical(snapshot({ data: historicalWith(90, points), dataUpdatedAt: 6 }), 90);
      expectOnlyHistoricalUnavailable(r, ['pace'], 6);
    }
  });

  it('a Monday-start first week is ready only when it is not clipped', () => {
    // Shift the valid 90-day window two days forward: first Monday, today Saturday.
    const today = shiftDate(TODAY, 2);
    const points: PacePoint[] = [];
    for (let start = shiftDate(today, -89); start <= today;) {
      const sunday = shiftDate(start, 7 - (new Date(`${start}T00:00:00Z`).getUTCDay() || 7));
      const end = sunday < today ? sunday : today;
      points.push({ start_date: start, end_date: end, items_picked: 0, is_current: end === today, is_clipped: false });
      start = shiftDate(end, 1);
    }
    const data = historicalWith(90, points);
    data.window.today_local = today;
    data.window.start_at = '2026-07-12T22:00:00.000Z';
    const ready = resolveV1Historical(snapshot({ data, dataUpdatedAt: 6 }), 90);
    expect(ready.pace.status).toBe('ready');
    data.pace.points[0].is_clipped = true;
    expectOnlyHistoricalUnavailable(resolveV1Historical(snapshot({ data, dataUpdatedAt: 6 }), 90), ['pace'], 6);
  });
  const swap = (pts: PacePoint[], i: number) => pts.map((p, j) => (j === i ? pts[i + 1] : j === i + 1 ? pts[i] : p));
  const shiftAll = (pts: PacePoint[], n: number) =>
    pts.map((p) => ({ ...p, start_date: shiftDate(p.start_date, n), end_date: shiftDate(p.end_date, n) }));

  const COVERAGE_MALFORMED: [string, number, (pts: PacePoint[]) => PacePoint[]][] = [
    ['7d: a date missing (6 buckets)', 7, (pts) => without(pts, 3)],
    ['7d: a date repeated in place of another (7 buckets)', 7, (pts) => pts.map((p, j) => (j === 3 ? { ...pts[2] } : p))],
    ['7d: an extra repeated date (8 buckets)', 7, (pts) => [...pts.slice(0, 3), { ...pts[2] }, ...pts.slice(3)]],
    ['7d: two dates out of order', 7, (pts) => swap(pts, 1)],
    ['7d: series ends yesterday', 7, (pts) => shiftAll(pts, -1)],
    ['7d: series ends tomorrow', 7, (pts) => shiftAll(pts, 1)],
    ['7d: a two-day bucket in a daily window', 7, (pts) => [{ ...pts[0], end_date: pts[1].start_date }, ...pts.slice(2)]],
    ['30d: only the last 7 dates', 30, (pts) => pts.slice(-7)],
    ['30d: a date missing (29 buckets)', 30, (pts) => without(pts, 15)],
    ['30d: a date before the window (31 buckets)', 30, (pts) => [{ ...pts[0], start_date: shiftDate(pts[0].start_date, -1), end_date: shiftDate(pts[0].start_date, -1) }, ...pts]],
    ['90d: daily buckets instead of weekly', 90, () => dailyPoints(90)],
    ['90d: a full week missing', 90, (pts) => without(pts, 5)],
    ['90d: a week repeated', 90, (pts) => [...pts.slice(0, 5), { ...pts[4] }, ...pts.slice(5)]],
    ['90d: two weeks out of order', 90, (pts) => swap(pts, 3)],
    ['90d: first bucket starts before the window (91 dates)', 90, (pts) => [{ ...pts[0], start_date: shiftDate(pts[0].start_date, -1) }, ...pts.slice(1)]],
    ['90d: a contiguous week not starting on Monday', 90, (pts) => pts.map((p, j) => (
      j === 1 ? { ...p, end_date: shiftDate(p.end_date, 1) } : j === 2 ? { ...p, start_date: shiftDate(p.start_date, 1) } : p))],
    ['90d: series ends before today (current week missing)', 90, (pts) => pts.slice(0, -1)],
  ];

  it.each(COVERAGE_MALFORMED)('%s → only pace unavailable; Problems, Team and Costs stay ready', (_n, days, mutate) => {
    const r = resolveV1Historical(snapshot({ data: historicalWith(days, mutate(validPoints(days))), dataUpdatedAt: 6 }), days);
    expectOnlyHistoricalUnavailable(r, ['pace'], 6);
  });

  it.each([
    ['30d window echoing weekly buckets', 30, 'week'],
    ['90d window echoing daily buckets', 90, 'day'],
  ] as const)('%s: Pace, Problems and Team unavailable; Costs stays ready', (_n, days, bucket) => {
    const data = historicalWith(days, validPoints(days));
    const r = resolveV1Historical(snapshot({ data: { ...data, window: { ...data.window, bucket } }, dataUpdatedAt: 6 }), days);
    expectOnlyHistoricalUnavailable(r, WINDOW_BLOCKS, 6);
  });

  it('per-block fallback stays independent: broken Pace coverage and a broken Team row leave Problems and Costs ready', () => {
    const data = historicalWith(7, without(dailyPoints(7), 3));
    const r = resolveV1Historical(snapshot({ data: { ...data, team_activity: [{ ...data.team_activity[0], items_packed: 0.5 }] }, dataUpdatedAt: 6 }), 7);
    expectOnlyHistoricalUnavailable(r, ['pace', 'team'], 6);
  });
});
