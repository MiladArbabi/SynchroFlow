// tests/unit/ui/wms/WmsAnalyticsPage.availability.test.tsx
//
// GH-1230 availability / freshness / window truth — modernized for the
// GH-1231 Analytics V1 screen (Concept A; blueprint §12B), NON-VACUOUS.
//
// Ratified contract (GH-1230 D1–D6, unchanged):
//   - Unavailable is never a confirmed zero; failure is never empty (D1).
//   - Historical (/api/v1/wms/analytics) and live (/api/v1/wms/analytics/live)
//     are independently available; one failing never falsifies the other.
//   - Rendered historical data must belong to the selected 7d/30d/90d window (D2).
//   - ACTION_FORBIDDEN reads "You don't have access to Analytics" and never an
//     upgrade prompt; COMMERCIAL_ACCESS_DENIED is distinct from it (D3).
//   - Freshness derives only from actual successful fetch time, per request (D4).
//   - A 200 payload missing required structure is not a healthy empty (D5).
//   - 401/403 are not retried; bounded transient retries remain (D6).
// GH-1231 §12B.5 adds: per-block degradation after D1–D6, and the
// old-backend → new-frontend deployment gap.
//
// NON-VACUITY (GH-1231 regression warning): every positive assertion names a
// ratified V1 region and label and FAILS when it is absent — no helper skips
// a missing label. Regions are found by accessible role + name (the region's
// area name or its question), never by DOM shape or data-* spelling.
// Historical regions: Pace, Problems, Team, Costs. Live: Flow, plus the live
// "Orders fulfilled today (all sales channels)" and "Assigned to active
// batches" values.
//
// Deliberately NOT protected: typography, layout, geometry (JSDOM cannot
// certify the scroll-free contract — that is the local Playwright gate),
// wording other than ratified copy.
//
// Commercial admission is out of scope here: CommercialGate is a passthrough
// so the page is reached exactly as when a stale snapshot admits it while the
// backend denies. Operator direct-URL redirect stays protected by
// tests/unit/ui/routing/ProtectedRoute.role-admission.test.tsx (GH-1222 C5).
//
// Only the HTTP boundary is mocked; the real hooks, resolvers and page run.

import React from 'react';
import { screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { renderWithProviders } from 'test-utils';
import WmsAnalyticsPage from 'pages/ft2-pages/WmsAnalyticsPage';
import { ConfigProvider } from 'contexts/ConfigContext';

jest.mock('components/CommercialGate', () => ({
  __esModule: true,
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Canonical commercial denial presentation is UpgradePrompt fed an AccessDecision
// (CommercialGate precedent, tests/unit/ui/commercial-access/commercial-gate.test.tsx).
// The probe exposes the forwarded decision without rendering any copy.
jest.mock('components/UpgradePrompt', () => ({
  __esModule: true,
  UpgradePrompt: ({ decision, mode }: { decision?: { reason?: string; requiredTier?: string }; mode: string }) => (
    <div
      data-testid="commercial-upgrade-prompt"
      data-mode={mode}
      data-reason={decision?.reason ?? ''}
      data-required-tier={decision?.requiredTier ?? ''}
    />
  ),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: 'core',
    snapshot: { modules: new Set<string>(), flags: new Set<string>() },
    hasResolved: true,
  }),
}));

jest.mock('hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ rates: { USD: 1 }, isLoading: false, isStale: false }),
}));

jest.mock('contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  ...jest.requireActual('@lasyncro/shared/ui'),
  formatCurrencyCompact: (n: number | null) => (n == null ? '—' : `$${n}`),
}));

// ─── FIXTURES ────────────────────────────────────────────────────────────────

type Days = 7 | 30 | 90;

/** Per-window Team sentinel — if it renders under another window, attribution is wrong. */
const SENTINEL: Record<Days, string> = { 7: 'Avery Seven', 30: 'Blake Thirty', 90: 'Casey Ninety' };
/** Per-window Pace total (Σ buckets = Σ Team picked). */
const PACE_TOTAL: Record<Days, number> = { 7: 72, 30: 318, 90: 905 };
const TODAY = '2026-10-08';
const START_AT: Record<Days, string> = { 7: '2026-10-01T22:00:00.000Z', 30: '2026-09-08T22:00:00.000Z', 90: '2026-07-10T22:00:00.000Z' };

function shiftDate(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dense, ordered, selected-window pace buckets; the current bucket holds 12. */
function pace(days: Days) {
  if (days === 90) {
    const first = shiftDate(TODAY, -89);
    const points = [];
    for (let start = first; start <= TODAY;) {
      const toSunday = (7 - new Date(`${start}T00:00:00Z`).getUTCDay()) % 7;
      const sunday = shiftDate(start, toSunday);
      const end = sunday < TODAY ? sunday : TODAY;
      points.push({ start_date: start, end_date: end, items_picked: 0, is_current: end === TODAY, is_clipped: start === first && toSunday < 6 });
      start = shiftDate(end, 1);
    }
    points[3].items_picked = PACE_TOTAL[90] - 12;
    points[points.length - 1].items_picked = 12;
    return { items_picked_total: PACE_TOTAL[90], points };
  }
  const points = Array.from({ length: days }, (_, i) => {
    const d = shiftDate(TODAY, i - days + 1);
    return { start_date: d, end_date: d, items_picked: 0, is_current: i === days - 1, is_clipped: false };
  });
  points[days - 2].items_picked = PACE_TOTAL[days] - 12;
  points[days - 1].items_picked = 12;
  return { items_picked_total: PACE_TOTAL[days], points };
}

/** Legacy composite keys only — what an old backend returns. */
function legacyHistorical(days: Days) {
  return {
    live: live(),
    operators: [],
    pipeline: {
      stages: { released_to_picking_s: 600, picking_s: 900, packing_s: 300, packed_to_shipped_s: 1200 },
      latencies: { receive_to_pickable_hours: 20, receive_to_pickable_samples: 3, return_to_restock_hours: 8 },
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

/** Complete, valid V1 composite (legacy keys + additive V1 blocks) with nonzero activity. */
function historical(days: Days) {
  return {
    ...legacyHistorical(days),
    window: { days, timezone: 'Europe/Stockholm', start_at: START_AT[days], bucket: days === 90 ? 'week' : 'day', today_local: TODAY },
    pace: pace(days),
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
      { user_id: days, display_name: SENTINEL[days], items_picked: PACE_TOTAL[days] - 50, items_packed: 30, is_current_member: true },
      { user_id: 99, display_name: 'Zoë Park', items_picked: 50, items_packed: 0, is_current_member: true },
    ],
  };
}

/** Valid V1 composite with legitimately zero activity and unconfigured cost. */
function historicalKnownZero(days: Days) {
  const p = pace(days);
  return {
    ...legacyHistorical(days),
    window: { days, timezone: 'Europe/Stockholm', start_at: START_AT[days], bucket: days === 90 ? 'week' : 'day', today_local: TODAY },
    pace: { items_picked_total: 0, points: p.points.map((pt) => ({ ...pt, items_picked: 0 })) },
    problems: { total: 0, open_total: 0, by_type: {}, products: [], products_total: 0 },
    team_activity: [],
  };
}

/** Five recorded statuses; distinct counts so a value can be attributed to its stage. */
function flow() {
  return {
    stages: {
      awaiting_pick: { count: 41, oldest_age_s: 10_800 },
      picking: { count: 42, oldest_age_s: 2700 },
      picked: { count: 43, oldest_age_s: 6_213_600 },
      packing: { count: 44, oldest_age_s: 0 },
      packed: { count: 45, oldest_age_s: 2700 },
    },
  };
}

function flowKnownZero() {
  return {
    stages: Object.fromEntries(
      ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'].map((s) => [s, { count: 0, oldest_age_s: null }]),
    ),
  };
}

/** Legacy live keys only — what an old backend returns. */
function legacyLive() {
  return {
    pipeline: { awaiting_pick: 41, picking: 42, packing: 44, ship_ready: 45, shipped: 5 },
    operators_on_shift: 4,
    active_operators: 3,
    cpt_local: '16:00:00',
    hours_to_cpt: 2.5,
    live_uph: 55,
    required_uph: 50,
    standard_uph: 48,
    on_track: 'green',
    shipped_today: 47,
    shipped_via_wms: 40,
    shipped_via_legacy: 7,
    unfulfilled_orders: 170,
  };
}

/** Valid V1 live payload: legacy keys + flow, nonzero sentinels. */
function live() {
  return { ...legacyLive(), flow: flow() };
}

/** Valid V1 live payload: legitimately zero, CPT unconfigured (null). */
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
    flow: flowKnownZero(),
  };
}

// ─── REQUEST BOUNDARY ────────────────────────────────────────────────────────

const HISTORICAL = '/api/v1/wms/analytics';
const LIVE = '/api/v1/wms/analytics/live';

const pending = () => new Promise<never>(() => {});
const httpError = (status: number, data?: Record<string, unknown>) =>
  Promise.reject(
    Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } }),
  );
const ACTION_FORBIDDEN = { error: 'ACTION_FORBIDDEN', action: 'wms:analytics:read', current: ['admin'] };
const COMMERCIAL_ACCESS_DENIED = {
  error: 'COMMERCIAL_ACCESS_DENIED',
  reason: 'TIER_TOO_LOW',
  capabilityId: 'warehouse.analytics',
  currentTier: 'starter',
  requiredTier: 'core',
};

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type Scenario = {
  historical: (days: number) => Promise<unknown>;
  live: () => Promise<unknown>;
};

let scenario: Scenario;
const defaultScenario = (): Scenario => ({
  historical: (days) => Promise.resolve(historical(days as Days)),
  live: () => Promise.resolve(live()),
});

const pathOf = (url: string) => url.split('?')[0];
const daysOf = (url: string) => Number(new URLSearchParams(url.split('?')[1] ?? '').get('days'));

const mockGet = jest.fn((url: string) => {
  const path = pathOf(url);
  if (path === HISTORICAL) return scenario.historical(daysOf(url)).then((data) => ({ data }));
  if (path === LIVE) return scenario.live().then((data) => ({ data }));
  return Promise.reject(new Error(`unexpected GET ${url}`));
});

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (url: string) => mockGet(url),
    post: jest.fn(),
  },
}));

let nowSpy: jest.SpyInstance<number, []> | null = null;

beforeEach(() => {
  mockGet.mockClear();
  scenario = defaultScenario();
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Renders with a test-local client inside the real ConfigProvider (shared Ops
 * Console state). Default: retry:false plus retryDelay:0 — GH-1230 D6 moved
 * the retry decision into the hooks (hook-local `retry` overrides the client
 * default), so transient failures still retry up to 3 times; retryDelay:0
 * keeps that bounded retry instant. D6 cases pass retry:3/retryDelay:0.
 */
function renderPage(clientOptions: { retry?: number | false; retryDelay?: number } = { retry: false, retryDelay: 0 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: clientOptions } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <WmsAnalyticsPage />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient };
}

const historicalCalls = () => mockGet.mock.calls.filter(([url]) => pathOf(url) === HISTORICAL);
const liveCalls = () => mockGet.mock.calls.filter(([url]) => pathOf(url) === LIVE);

type RegionKey = 'pace' | 'flow' | 'problems' | 'team' | 'costs';
/** Accessible region name: the area name or its ratified question. */
const REGION: Record<RegionKey, RegExp> = {
  pace: /\bpace\b|are we keeping up/i,
  flow: /\bflow\b|where is work slowing down/i,
  problems: /\bproblems\b|where are problems happening/i,
  team: /\bteam\b|how is the team doing/i,
  costs: /\bcosts?\b/i,
};
const HISTORICAL_REGIONS: RegionKey[] = ['pace', 'problems', 'team', 'costs'];

/** Throws when the region is absent — never vacuous. */
const region = (key: RegionKey) => screen.getByRole('region', { name: REGION[key] });
const regionText = (key: RegionKey) => region(key).textContent ?? '';

/** Ratified unavailable copy (§12B.4 "Zero versus unavailable"). */
const UNAVAILABLE = /couldn[’']t load this right now/i;
/** Ratified D3 role-denial sentence family. */
const ROLE_DENIED = /you don[’']t have access to (warehouse )?analytics/i;
/** Upgrade / commercial-promotion prompt family. */
const UPGRADE_PROMPT = /upgrade|unlock|see plans|view plans|choose a plan|change plan/i;
/** Ratified healthy-empty claim of the historical Problems region. */
const HISTORICAL_HEALTHY = /no problems recorded/i;

const FLOW_LABELS = ['Waiting to be picked', 'Being picked', 'Waiting to be packed', 'Being packed', 'Ready to ship'];
const FULFILLED_TODAY = 'Orders fulfilled today (all sales channels)';
const ASSIGNED = 'Assigned to active batches';
const num = (n: number) => new RegExp(`(^|[^\\d.])${n}([^\\d.]|$)`);

/**
 * Text of the largest ancestor of `label` (inside `container`) that contains
 * no OTHER label from `group` — i.e. that label's own value group. Null when
 * the label is absent.
 */
function groupText(container: HTMLElement, label: string, group: string[] = [label]): string | null {
  const el = within(container).queryAllByText(label)[0];
  if (!el) return null;
  let node: HTMLElement = el;
  while (node.parentElement && node !== container) {
    const parentText = node.parentElement.textContent ?? '';
    if (group.some((other) => other !== label && parentText.includes(other))) break;
    if (node.parentElement === container) break;
    node = node.parentElement;
  }
  return node.textContent ?? '';
}

/**
 * The live label and its value/status share one row. Pending skeletons have
 * no value text: never climb beyond that row into historical Team content.
 * A missing or ambiguous metric label must fail rather than skip protection.
 */
function liveValue(label: string): string {
  const el = screen.getByText(label, { exact: true });
  const row = el.parentElement;
  expect(row).not.toBeNull();
  return (row!.textContent ?? '').trim();
}

const bodyText = () => document.body.textContent ?? '';
const shows = (text: string) => screen.queryAllByText(text).length > 0;
async function expectShown(text: string) {
  await waitFor(() => expect(shows(text)).toBe(true));
}

/** Flow shows the live sentinel counts (41…45), each with its own stage. */
async function expectLiveFlowReady() {
  await waitFor(() => expect(groupText(region('flow'), 'Waiting to be picked', FLOW_LABELS)).toMatch(num(41)));
  expect(groupText(region('flow'), 'Ready to ship', FLOW_LABELS)).toMatch(num(45));
}

/** No live-derived value is presented as a confirmed zero; Flow region must exist. */
function expectNoLiveZeros() {
  const flowRegion = region('flow');
  for (const label of FLOW_LABELS) {
    const g = groupText(flowRegion, label, FLOW_LABELS);
    if (g !== null) expect(`${label} = ${g.replace(label, '')}`).not.toMatch(num(0));
  }
  for (const label of [FULFILLED_TODAY, ASSIGNED]) {
    const g = liveValue(label);
    expect(`${label} = ${g.replace(label, '')}`).not.toMatch(num(0));
  }
}

/** Every historical region is present and states it couldn't load; no historical value shown. */
async function expectHistoricalUnavailable(days: Days = 30) {
  await waitFor(() => {
    for (const key of HISTORICAL_REGIONS) expect(`${key}: ${regionText(key)}`).toMatch(UNAVAILABLE);
  });
  expect(shows(SENTINEL[days])).toBe(false);
  expect(regionText('pace')).not.toMatch(num(PACE_TOTAL[days]));
  expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
}

async function settleInitial() {
  await waitFor(() => {
    expect(historicalCalls().length).toBeGreaterThan(0);
    expect(liveCalls().length).toBeGreaterThan(0);
  });
}

/** Wall clock at a fixed local time; React Query stamps dataUpdatedAt from Date.now(). */
function setClock(h: number, m: number) {
  const t = new Date(2026, 9, 8, h, m, 0).getTime();
  nowSpy?.mockRestore();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t);
}
const hhmm = (h: number, m: number) => `${h}:${String(m).padStart(2, '0')}`;
/** "Updated at HH:MM" (historical header) and "Now · updated HH:MM" (live Flow) family. */
const updatedAt = (h: number, m: number) => new RegExp(`updated(\\s+at)?\\s*0?${hhmm(h, m)}`, 'i');

// ─── R4 / R5 — VALID SUCCESS CONTROLS ────────────────────────────────────────

describe('GH-1230 R4/R5 — valid successful responses', () => {
  it('R5: nonzero historical + live values render in their V1 regions', async () => {
    renderPage();
    await expectShown(SENTINEL[30]);
    expect(within(region('team')).getByText(SENTINEL[30])).toBeInTheDocument();
    expect(regionText('pace')).toMatch(num(PACE_TOTAL[30]));
    await expectLiveFlowReady();
    expect(liveValue(FULFILLED_TODAY)).toMatch(num(47));
    expect(liveValue(ASSIGNED)).toMatch(num(3));
  });

  it('R4: genuine zero renders as known zero with the ratified empty copy — never as unavailable', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    scenario.live = () => Promise.resolve(liveKnownZero());
    renderPage();
    expect(await within(await screen.findByRole('region', { name: REGION.problems })).findByText(/no problems recorded in the last 30 days/i))
      .toBeInTheDocument();
    expect(regionText('pace')).toMatch(num(0));
    await waitFor(() => expect(groupText(region('flow'), 'Waiting to be packed', FLOW_LABELS)).toMatch(num(0)));
    expect(liveValue(FULFILLED_TODAY)).toMatch(num(0));
    // Unconfigured cost (unlocked:false) is a valid, distinct state — not unavailable.
    expect(within(region('costs')).getByText(/hourly rates are set in team/i)).toBeInTheDocument();
    for (const key of [...HISTORICAL_REGIONS, 'flow'] as RegionKey[]) expect(regionText(key)).not.toMatch(UNAVAILABLE);
  });
});

// ─── R1 / R2 — INDEPENDENT FAILURE ───────────────────────────────────────────

describe('GH-1230 R1/R2 — historical and live fail independently', () => {
  it('R1: historical 500 → Pace, Problems, Team and Costs unavailable; live Flow stays visible', async () => {
    scenario.historical = () => httpError(500);
    renderPage();
    await settleInitial();
    await expectLiveFlowReady();
    await expectHistoricalUnavailable();
  });

  it('R2: live 500 → Flow unavailable with no confirmed zeros; historical regions stay visible', async () => {
    scenario.live = () => httpError(500);
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(regionText('flow')).toMatch(UNAVAILABLE));
    expect(regionText('flow')).not.toMatch(num(41));
    expectNoLiveZeros();
  });
});

// ─── R3 — PENDING IS NOT ZERO ────────────────────────────────────────────────

describe('GH-1230 R3 — unresolved requests imply nothing', () => {
  it('R3a: pending live request → Flow region present, no confirmed zeros', async () => {
    scenario.live = () => pending();
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);
    expect(region('flow')).toBeInTheDocument();
    expectNoLiveZeros();
  });

  it('R3b: pending historical request → historical regions present, no healthy or zero claim; Flow ready', async () => {
    scenario.historical = () => pending();
    renderPage();
    await settleInitial();
    await expectLiveFlowReady();
    for (const key of HISTORICAL_REGIONS) expect(region(key)).toBeInTheDocument();
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    expect(regionText('pace')).not.toMatch(num(0));
  });
});

// ─── R6 — WINDOW ATTRIBUTION ─────────────────────────────────────────────────

describe('GH-1230 R6 — rendered historical data belongs to the selected window', () => {
  it('R6a: 30d → 7d with 7d deferred never shows 30d data under 7d', async () => {
    const d7 = deferred<unknown>();
    scenario.historical = (days) => (days === 7 ? d7.promise : Promise.resolve(historical(days as Days)));
    const { user } = renderPage();
    await expectShown(SENTINEL[30]);
    expect(regionText('pace')).toMatch(num(PACE_TOTAL[30]));

    await user.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(historicalCalls().some(([url]) => daysOf(url) === 7)).toBe(true));
    expect(shows(SENTINEL[30])).toBe(false);
    expect(regionText('pace')).not.toMatch(num(PACE_TOTAL[30]));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);

    await act(async () => { d7.resolve(historical(7)); });
    await expectShown(SENTINEL[7]);
    expect(regionText('pace')).toMatch(num(PACE_TOTAL[7]));
  });

  it('R6b: rapid 7d → 30d → 90d with out-of-order resolution shows only 90d data', async () => {
    const d30 = deferred<unknown>();
    const d90 = deferred<unknown>();
    scenario.historical = (days) =>
      days === 30 ? d30.promise : days === 90 ? d90.promise : Promise.resolve(historical(days as Days));
    // Default window is 30d (pending); establish a resolved 7d first.
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: '7d' }));
    await expectShown(SENTINEL[7]);

    await user.click(screen.getByRole('button', { name: '30d' }));
    await user.click(screen.getByRole('button', { name: '90d' }));
    await waitFor(() => expect(historicalCalls().some(([url]) => daysOf(url) === 90)).toBe(true));
    expect(shows(SENTINEL[7])).toBe(false);

    // The superseded 30d response arrives late, while 90d is selected.
    await act(async () => { d30.resolve(historical(30)); });
    expect(shows(SENTINEL[30])).toBe(false);
    expect(shows(SENTINEL[7])).toBe(false);

    await act(async () => { d90.resolve(historical(90)); });
    await expectShown(SENTINEL[90]);
    expect(regionText('pace')).toMatch(num(PACE_TOTAL[90]));
  });

  it('R6c: a V1 window echo for another period is never attributed to the selection', async () => {
    scenario.historical = (days) => Promise.resolve({ ...historical(days as Days), window: { ...historical(days as Days).window, days: 7 } });
    renderPage();
    await settleInitial();
    await expectLiveFlowReady();
    await waitFor(() => {
      for (const key of ['pace', 'problems', 'team'] as RegionKey[]) expect(`${key}: ${regionText(key)}`).toMatch(UNAVAILABLE);
    });
    expect(shows(SENTINEL[30])).toBe(false);
  });
});

// ─── R7 — FAILED SAME-WINDOW REFRESH (D1) ────────────────────────────────────

describe('GH-1230 R7 — a failed refresh never leaves cached metrics presented as current', () => {
  it('R7a: historical refetch rejects → historical regions unavailable, cached values hidden; Flow unaffected', async () => {
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await expectLiveFlowReady();

    scenario.historical = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'full'] });
    });

    await expectHistoricalUnavailable();
    expect(groupText(region('flow'), 'Waiting to be picked', FLOW_LABELS)).toMatch(num(41));
  });

  it('R7b: live refetch rejects → Flow unavailable, cached counts hidden; historical unaffected', async () => {
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await expectLiveFlowReady();

    scenario.live = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'live'] });
    });

    await waitFor(() => expect(regionText('flow')).toMatch(UNAVAILABLE));
    expect(regionText('flow')).not.toMatch(num(41));
    expect(liveValue(FULFILLED_TODAY) ?? '').not.toMatch(num(47));
    expect(shows(SENTINEL[30])).toBe(true);
  });
});

// ─── R8 — ACCESS DENIAL (D3) ─────────────────────────────────────────────────

describe('GH-1230 R8 — denial is neither healthy nor a speculative upgrade', () => {
  it('R8a: ACTION_FORBIDDEN → role-denial message, no data, no upgrade prompt', async () => {
    scenario.historical = () => httpError(403, ACTION_FORBIDDEN);
    scenario.live = () => httpError(403, ACTION_FORBIDDEN);
    renderPage();
    await settleInitial();

    await waitFor(() => expect(bodyText()).toMatch(ROLE_DENIED));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    for (const n of [41, 47]) expect(bodyText()).not.toMatch(num(n));
    expect(bodyText()).not.toMatch(UPGRADE_PROMPT);
    expect(screen.queryByTestId('commercial-upgrade-prompt')).toBeNull();
  });

  it('R8b: COMMERCIAL_ACCESS_DENIED → canonical commercial denial with the server decision, not a role denial', async () => {
    scenario.historical = () => httpError(403, COMMERCIAL_ACCESS_DENIED);
    scenario.live = () => httpError(403, COMMERCIAL_ACCESS_DENIED);
    renderPage();
    await settleInitial();

    const prompt = await screen.findByTestId('commercial-upgrade-prompt');
    expect(prompt).toHaveAttribute('data-mode', 'locked');
    expect(prompt).toHaveAttribute('data-reason', 'TIER_TOO_LOW');
    expect(prompt).toHaveAttribute('data-required-tier', 'core');
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    for (const n of [41, 47]) expect(bodyText()).not.toMatch(num(n));
    expect(bodyText()).not.toMatch(ROLE_DENIED);
  });
});

// ─── R10 — RESPONSE SHAPE (D5) ───────────────────────────────────────────────

describe('GH-1230 R10 — a malformed 200 is not a healthy empty', () => {
  it('R10a: historical 200 missing required structure → every historical region unavailable', async () => {
    scenario.historical = (days) => Promise.resolve({ days });
    renderPage();
    await settleInitial();
    await expectLiveFlowReady();
    await expectHistoricalUnavailable();
  });

  it('R10b: live 200 missing required structure → Flow unavailable, no confirmed zeros; historical unaffected', async () => {
    scenario.live = () => Promise.resolve({});
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(regionText('flow')).toMatch(UNAVAILABLE));
    expectNoLiveZeros();
  });

  it('R10c: valid null / unconfigured fields are not treated as malformed', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    scenario.live = () => Promise.resolve(liveKnownZero());
    renderPage();
    await waitFor(() => expect(within(region('costs')).getByText(/hourly rates are set in team/i)).toBeInTheDocument());
    await waitFor(() => expect(groupText(region('flow'), 'Waiting to be picked', FLOW_LABELS)).toMatch(num(0)));
    expect(bodyText()).not.toMatch(UNAVAILABLE);
  });
});

// ─── R10d — VALID PARTIAL RESPONSES (§12B.5 rule 4) ─────────────────────────

describe('GH-1230 R10d — one malformed V1 block degrades only its own region', () => {
  const BLOCK: [string, RegionKey, (d: Days) => unknown][] = [
    ['pace.points: [null]', 'pace', (d) => ({ ...historical(d), pace: { ...historical(d).pace, points: [null] } })],
    ['problems.products: [null]', 'problems', (d) => ({ ...historical(d), problems: { ...historical(d).problems, products: [null] } })],
    ['team_activity: [null]', 'team', (d) => ({ ...historical(d), team_activity: [null] })],
  ];

  it.each(BLOCK)('R10d %s → only %s unavailable; other regions and live Flow keep rendering', async (_name, broken, payload) => {
    scenario.historical = (days) => Promise.resolve(payload(days as Days));
    renderPage();
    await settleInitial();
    await expectLiveFlowReady();

    await waitFor(() => expect(regionText(broken)).toMatch(UNAVAILABLE));
    for (const key of HISTORICAL_REGIONS.filter((k) => k !== broken)) expect(`${key}: ${regionText(key)}`).not.toMatch(UNAVAILABLE);
    if (broken !== 'pace') expect(regionText('pace')).toMatch(num(PACE_TOTAL[30]));
    if (broken !== 'team') expect(within(region('team')).getByText(SENTINEL[30])).toBeInTheDocument();
    if (broken !== 'problems') expect(within(region('problems')).getByText('Mug - Blue')).toBeInTheDocument();
  });

  it('R10d flow stage missing → Flow unavailable; live summary values and historical regions keep rendering', async () => {
    const { picked: _p, ...stages } = flow().stages;
    scenario.live = () => Promise.resolve({ ...legacyLive(), flow: { stages } });
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(regionText('flow')).toMatch(UNAVAILABLE));
    expect(regionText('flow')).not.toMatch(num(41));
    expect(liveValue(FULFILLED_TODAY)).toMatch(num(47));
  });
});

// ─── R12 — DEPLOYMENT GAP: OLD BACKEND → NEW FRONTEND ───────────────────────

describe('GH-1230 R12 — old backend (no V1 blocks) never renders as zero', () => {
  it('R12: legacy-only responses → Pace, Problems, Team and Flow unavailable; Costs and live summary keep rendering', async () => {
    scenario.historical = (days) => Promise.resolve(legacyHistorical(days as Days));
    scenario.live = () => Promise.resolve(legacyLive());
    renderPage();
    await settleInitial();

    await waitFor(() => {
      for (const key of ['pace', 'problems', 'team', 'flow'] as RegionKey[]) expect(`${key}: ${regionText(key)}`).toMatch(UNAVAILABLE);
    });
    expect(within(region('costs')).getByText(/hourly rates are set in team/i)).toBeInTheDocument();
    expect(liveValue(FULFILLED_TODAY)).toMatch(num(47));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    expect(regionText('pace')).not.toMatch(num(0));
  });
});

// ─── R11 — FRESHNESS (D4) ────────────────────────────────────────────────────

describe('GH-1230 R11 — freshness comes only from actual successful fetches, independently', () => {
  it('R11a: historical header and live Flow each show their own successful-fetch time', async () => {
    const hist = deferred<unknown>();
    const lv = deferred<unknown>();
    scenario.historical = () => hist.promise;
    scenario.live = () => lv.promise;
    renderPage();
    await settleInitial();

    setClock(10, 15);
    await act(async () => { hist.resolve(historical(30)); });
    await expectShown(SENTINEL[30]);

    setClock(10, 42);
    await act(async () => { lv.resolve(live()); });
    await expectLiveFlowReady();

    expect(regionText('flow')).toMatch(updatedAt(10, 42));
    expect(regionText('flow')).not.toMatch(updatedAt(10, 15));
    expect(bodyText()).toMatch(updatedAt(10, 15));
  });

  it('R11b: a failed refresh never advances freshness; it is marked unavailable', async () => {
    setClock(9, 5);
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await expectLiveFlowReady();
    await waitFor(() => expect(bodyText()).toMatch(updatedAt(9, 5)));

    setClock(9, 55);
    scenario.historical = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'full'] });
    });

    await expectHistoricalUnavailable();
    expect(bodyText()).not.toMatch(updatedAt(9, 55));
  });
});

// ─── D6 — RETRY POLICY ───────────────────────────────────────────────────────

describe('GH-1230 D6 — authorization denials are not retried; transient errors keep bounded retry', () => {
  const RETRYING = { retry: 3, retryDelay: 0 } as const;

  it.each([
    ['ACTION_FORBIDDEN', ACTION_FORBIDDEN],
    ['COMMERCIAL_ACCESS_DENIED', COMMERCIAL_ACCESS_DENIED],
  ])('D6a: historical 403 %s is requested exactly once', async (_code, body) => {
    scenario.historical = () => httpError(403, body);
    renderPage(RETRYING);
    await settleInitial();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(historicalCalls()).toHaveLength(1);
  });

  it('D6b: live 403 ACTION_FORBIDDEN is requested exactly once', async () => {
    scenario.live = () => httpError(403, ACTION_FORBIDDEN);
    renderPage(RETRYING);
    await settleInitial();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(liveCalls()).toHaveLength(1);
  });

  it('D6c: historical 401 is requested exactly once', async () => {
    scenario.historical = () => httpError(401);
    renderPage(RETRYING);
    await settleInitial();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(historicalCalls()).toHaveLength(1);
  });

  it('D6d: historical 500 keeps bounded transient retry (1 + 3 attempts)', async () => {
    scenario.historical = () => httpError(500);
    renderPage(RETRYING);
    await waitFor(() => expect(historicalCalls()).toHaveLength(4));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(historicalCalls()).toHaveLength(4);
  });
});
