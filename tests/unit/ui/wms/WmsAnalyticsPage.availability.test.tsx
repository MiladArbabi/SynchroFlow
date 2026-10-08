// tests/unit/ui/wms/WmsAnalyticsPage.availability.test.tsx
//
// GH-1230 RED — Warehouse Analytics availability / freshness / window truth.
//
// Ratified contract (GH-1230 D1–D6, 2026-10-08):
//   - Unavailable is never a confirmed zero; failure is never empty.
//   - Historical (/api/v1/wms/analytics) and live (/api/v1/wms/analytics/live)
//     are independently available; one failing never falsifies the other.
//   - Rendered historical data must belong to the selected 7d/30d/90d window.
//   - A failed same-window refresh hides the affected metrics (D1).
//   - ACTION_FORBIDDEN reads "You don't have access to Analytics" and never an
//     upgrade prompt; COMMERCIAL_ACCESS_DENIED is distinct from it (D3).
//   - Freshness derives only from actual successful fetch time (D4).
//   - A 200 payload missing required structure is not a healthy empty (D5).
//   - 401/403 are not retried; bounded transient retries remain (D6).
//
// Deliberately NOT protected: exact typography, DOM shape, layout, metric
// formulas, wording other than the ratified D3 role-denial sentence and the
// D4 "Updated at HH:MM" family. Assertions are semantic (regex families).
//
// Commercial admission is out of scope here: CommercialGate is a passthrough
// so the page is reached exactly as when a stale snapshot admits it while the
// backend denies. Operator direct-URL redirect stays protected by
// tests/unit/ui/routing/ProtectedRoute.role-admission.test.tsx (GH-1222 C5).
//
// Mocks mirror tests/unit/ui/orders/OrdersOutboundPage.truth-model.test.tsx.

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { renderWithProviders } from 'test-utils';
import WmsAnalyticsPage from 'pages/ft2-pages/WmsAnalyticsPage';

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
  formatCurrencyCompact: (n: number | null) => (n == null ? '—' : `$${n}`),
}));

// ─── FIXTURES ────────────────────────────────────────────────────────────────

type Days = 7 | 30 | 90;

/** Per-window sentinel operator — if it renders under another window, attribution is wrong. */
const SENTINEL: Record<Days, string> = { 7: 'Avery7d', 30: 'Blake30d', 90: 'Casey90d' };

/** Complete, valid composite payload with nonzero activity for one window. */
function historical(days: Days) {
  return {
    live: live(),
    operators: [
      {
        user_id: days,
        first_name: SENTINEL[days],
        last_name: null,
        role: 'operator',
        picks: 120,
        packs: 80,
        batches_picked: 6,
        uph: 31.5,
        accuracy_pct: 97.2,
        exception_count: 2,
        avg_batch_seconds: 540,
        scan_source_mix: { camera: 10 },
      },
    ],
    pipeline: {
      stages: { released_to_picking_s: 600, picking_s: 900, packing_s: 300, packed_to_shipped_s: 1200 },
      latencies: { receive_to_pickable_hours: 20, receive_to_pickable_samples: 3, return_to_restock_hours: 8 },
    },
    exceptions: {
      top_skus: [
        { lasyncro_variant_id: `v-${days}`, title: 'Canvas Tote', sku: 'TOTE-1', exception_count: 2, type_breakdown: { short_pick: 2 } },
      ],
      heat_grid: [{ user_id: days, name: SENTINEL[days], pick_exception_rate_pct: 1.6, pack_exception_rate_pct: 0 }],
    },
    cost: { unlocked: true, total_cost: 400, cost_per_order: 2.5, cost_per_unit: 1.25, exception_cost: 3, orders_shipped: 160, editorial: null },
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
    throughput_trend: {
      points: [
        { day: '2026-10-06', units: 60, uph: 30 },
        { day: '2026-10-07', units: 60, uph: 33 },
      ],
      avg_uph: 31.5,
      latest_uph: 33,
    },
    exception_trend: { total: 2, open_total: 1, by_type: { short_pick: 2 }, points: [{ day: '2026-10-07', count: 2 }] },
    days,
  };
}

/** Valid composite with legitimately zero activity and unconfigured cost. */
function historicalKnownZero(days: Days) {
  return {
    live: liveKnownZero(),
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

/** Valid live payload with nonzero sentinels and an on-track signal. */
function live() {
  return {
    pipeline: { awaiting_pick: 41, picking: 42, packing: 44, ship_ready: 43, shipped: 5 },
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

/** Valid live payload: legitimately zero, CPT unconfigured (null), no signal. */
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
 * Renders with a test-local client. Default: retry:false (repository test
 * convention, test-utils.tsx:21-22) plus retryDelay:0 — GH-1230 D6 moved the
 * retry decision into the hooks (hook-local `retry` overrides the client
 * default), so transient failures still retry up to 3 times; retryDelay:0
 * keeps that bounded retry instant instead of real backoff. D6 cases pass
 * retry:3/retryDelay:0 to mirror the production client's defaults.
 */
function renderPage(clientOptions: { retry?: number | false; retryDelay?: number } = { retry: false, retryDelay: 0 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: clientOptions } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WmsAnalyticsPage />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient };
}

const historicalCalls = () => mockGet.mock.calls.filter(([url]) => pathOf(url) === HISTORICAL);
const liveCalls = () => mockGet.mock.calls.filter(([url]) => pathOf(url) === LIVE);

/** Positive warehouse-health claims made by historical zones. */
const HISTORICAL_HEALTHY =
  /floor is clear|picks are clean|no exceptions this period|no pick activity in this period|no completed picks in this period/i;
/** Positive health claim made by the live zone. */
const LIVE_HEALTHY = /^on track$/i;
/** Unavailable marker family (D1/D4) — anything that says "we don't know". */
const UNAVAILABLE = /unavailable|couldn[’']t load|could not load|not available/i;
/** Ratified D3 role-denial sentence family. */
const ROLE_DENIED = /you don[’']t have access to (warehouse )?analytics/i;
/** Upgrade / commercial-promotion prompt family. */
const UPGRADE_PROMPT = /upgrade|unlock|see plans|view plans|choose a plan|change plan/i;
const ZERO = /= 0$/;

/** Live-zone row labels unique to the live capacity zone. */
const LIVE_ROWS = [/^awaiting pick$/i, /^ship-ready$/i, /^shipped today$/i];

/**
 * Value of a labelled metric: text of the smallest ancestor of the label that
 * contains more than the label, minus the label. Null when the label is absent.
 * (Same semantic helper as OrdersOutboundPage.truth-model.test.tsx.)
 */
function metricValue(label: RegExp): string | null {
  const labelEl = screen.queryAllByText(label)[0];
  if (!labelEl) return null;
  const labelText = (labelEl.textContent ?? '').trim();
  let node: HTMLElement = labelEl;
  while (node.parentElement && node.parentElement !== document.body) {
    const parentText = (node.parentElement.textContent ?? '').trim();
    if (parentText !== labelText) return parentText.replace(labelText, '').trim();
    node = node.parentElement;
  }
  return null;
}

const bodyText = () => document.body.textContent ?? '';
/** A window sentinel renders in more than one zone (operator board, heat grid). */
const shows = (sentinel: string) => screen.queryAllByText(sentinel).length > 0;
async function expectShown(sentinel: string) {
  await waitFor(() => expect(shows(sentinel)).toBe(true));
}
const hasText = (re: RegExp) => re.test(bodyText());

function expectNoLiveZeros() {
  for (const label of LIVE_ROWS) {
    const value = metricValue(label);
    // "<label> = <value>" so a failure names the row that fabricated a zero.
    if (value !== null) expect(`${label.source} = ${value}`).not.toMatch(ZERO);
  }
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
const updatedAt = (h: number, m: number) => new RegExp(`updated at\\s*0?${hhmm(h, m)}`, 'i');

// ─── R4 / R5 — VALID SUCCESS CONTROLS ────────────────────────────────────────

describe('GH-1230 R4/R5 — valid successful responses (controls)', () => {
  it('R5 GREEN CONTROL: nonzero historical + live values render', async () => {
    renderPage();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));
    expect(metricValue(/^shipped today$/i)).toBe('47');
    expect(screen.getByText(LIVE_HEALTHY)).toBeInTheDocument();
  });

  it('R4 GREEN CONTROL: legitimately zero responses may show known zeros and healthy empty copy', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    scenario.live = () => Promise.resolve(liveKnownZero());
    renderPage();
    expect(await screen.findByText(/floor is clear/i)).toBeInTheDocument();
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('0'));
    expect(metricValue(/^shipped today$/i)).toBe('0');
    // Unconfigured cost (unlocked:false) is a valid, distinct state — not unavailable.
    expect(screen.getByText(/add hourly costs/i)).toBeInTheDocument();
  });
});

// ─── R1 / R2 — INDEPENDENT FAILURE ───────────────────────────────────────────

describe('GH-1230 R1/R2 — historical and live fail independently', () => {
  it('R1 EXPECTED RED: historical 500 shows unavailable, no healthy historical claims; live stays visible', async () => {
    scenario.historical = () => httpError(500);
    renderPage();
    await settleInitial();
    // Live is independent and must keep rendering its own truth.
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
  });

  it('R2 EXPECTED RED: live 500 shows no numeric zeros and no On track; historical stays visible', async () => {
    scenario.live = () => httpError(500);
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    expectNoLiveZeros();
    expect(screen.queryByText(LIVE_HEALTHY)).toBeNull();
  });
});

// ─── R3 — PENDING IS NOT ZERO ────────────────────────────────────────────────

describe('GH-1230 R3 — unresolved requests imply nothing', () => {
  it('R3a EXPECTED RED: pending live request renders no confirmed zeros', async () => {
    scenario.live = () => pending();
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);
    expectNoLiveZeros();
    expect(screen.queryByText(LIVE_HEALTHY)).toBeNull();
  });

  it('R3b CONTROL: pending historical request makes no healthy historical claim', async () => {
    scenario.historical = () => pending();
    renderPage();
    await settleInitial();
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
  });
});

// ─── R6 — WINDOW ATTRIBUTION ─────────────────────────────────────────────────

describe('GH-1230 R6 — rendered historical data belongs to the selected window', () => {
  it('R6a EXPECTED RED: 30d → 7d with 7d deferred never shows 30d data under 7d', async () => {
    const d7 = deferred<unknown>();
    scenario.historical = (days) => (days === 7 ? d7.promise : Promise.resolve(historical(days as Days)));
    const { user } = renderPage();
    await expectShown(SENTINEL[30]);

    await user.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(historicalCalls().some(([url]) => daysOf(url) === 7)).toBe(true));
    expect(shows(SENTINEL[30])).toBe(false);
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);

    await act(async () => { d7.resolve(historical(7)); });
    await expectShown(SENTINEL[7]);
  });

  it('R6b EXPECTED RED: rapid 7d → 30d → 90d with out-of-order resolution shows only 90d data', async () => {
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
  });
});

// ─── R7 — FAILED SAME-WINDOW REFRESH (D1) ────────────────────────────────────

describe('GH-1230 R7 — a failed refresh never leaves cached metrics presented as current', () => {
  it('R7a EXPECTED RED: historical refetch rejects → historical metrics hidden + unavailable; live unaffected', async () => {
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));

    scenario.historical = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'full'] });
    });

    await waitFor(() => expect(shows(SENTINEL[30])).toBe(false));
    expect(hasText(UNAVAILABLE)).toBe(true);
    expect(metricValue(/^awaiting pick$/i)).toBe('41');
  });

  it('R7b EXPECTED RED: live refetch rejects → live values and On track hidden; historical unaffected', async () => {
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));

    scenario.live = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'live'] });
    });

    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).not.toBe('41'));
    expect(screen.queryByText(LIVE_HEALTHY)).toBeNull();
    expect(hasText(UNAVAILABLE)).toBe(true);
    expect(shows(SENTINEL[30])).toBe(true);
  });
});

// ─── R8 — ACCESS DENIAL (D3) ─────────────────────────────────────────────────

describe('GH-1230 R8 — denial is neither healthy nor a speculative upgrade', () => {
  it('R8a EXPECTED RED: ACTION_FORBIDDEN → role-denial message, no healthy state, no upgrade prompt', async () => {
    scenario.historical = () => httpError(403, ACTION_FORBIDDEN);
    scenario.live = () => httpError(403, ACTION_FORBIDDEN);
    renderPage();
    await settleInitial();

    await waitFor(() => expect(hasText(ROLE_DENIED)).toBe(true));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    expect(screen.queryByText(LIVE_HEALTHY)).toBeNull();
    expectNoLiveZeros();
    expect(bodyText()).not.toMatch(UPGRADE_PROMPT);
    expect(screen.queryByTestId('commercial-upgrade-prompt')).toBeNull();
  });

  it('R8b EXPECTED RED: COMMERCIAL_ACCESS_DENIED → canonical commercial denial with the server decision, not a role denial', async () => {
    scenario.historical = () => httpError(403, COMMERCIAL_ACCESS_DENIED);
    scenario.live = () => httpError(403, COMMERCIAL_ACCESS_DENIED);
    renderPage();
    await settleInitial();

    // Canonical commercial presentation, fed the server's decision verbatim.
    const prompt = await screen.findByTestId('commercial-upgrade-prompt');
    expect(prompt).toHaveAttribute('data-mode', 'locked');
    expect(prompt).toHaveAttribute('data-reason', 'TIER_TOO_LOW');
    expect(prompt).toHaveAttribute('data-required-tier', 'core');
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    expect(screen.queryByText(LIVE_HEALTHY)).toBeNull();
    expectNoLiveZeros();
    expect(bodyText()).not.toMatch(ROLE_DENIED);
  });
});

// ─── R10 — RESPONSE SHAPE (D5) ───────────────────────────────────────────────

describe('GH-1230 R10 — a malformed 200 is not a healthy empty', () => {
  it('R10a EXPECTED RED: historical 200 missing required structure → unavailable, no healthy claims', async () => {
    scenario.historical = (days) => Promise.resolve({ days });
    renderPage();
    await settleInitial();
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
  });

  it('R10b EXPECTED RED: live 200 missing required structure → no numeric zeros; historical unaffected', async () => {
    scenario.live = () => Promise.resolve({});
    renderPage();
    await settleInitial();
    await expectShown(SENTINEL[30]);

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    expectNoLiveZeros();
  });

  it('R10c GREEN CONTROL: valid null / unconfigured fields are not treated as malformed', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    scenario.live = () => Promise.resolve(liveKnownZero());
    renderPage();
    expect(await screen.findByText(/add hourly costs/i)).toBeInTheDocument();
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('0'));
    expect(bodyText()).not.toMatch(UNAVAILABLE);
  });
});

// ─── R10d — NESTED MALFORMED HISTORICAL (D5 review correction) ──────────────

describe('GH-1230 R10d — malformed nested historical entries never crash the page or hide healthy live data', () => {
  const NESTED: [string, (d: Days) => unknown][] = [
    ['operators: [null]', (d) => ({ ...historical(d), operators: [null] })],
    ['throughput_trend.points: [null]', (d) => ({ ...historical(d), throughput_trend: { ...historical(d).throughput_trend, points: [null] } })],
    ['aging total 3 with empty by_stage', (d) => ({ ...historical(d), aging_wip: { total: 3, by_stage: {}, oldest_overall_s: 1800 } })],
  ];

  it.each(NESTED)('R10d %s → historical unavailable, Live Capacity still rendered', async (_name, payload) => {
    scenario.historical = (days) => Promise.resolve(payload(days as Days));
    renderPage();
    await settleInitial();

    // The page stays mounted and the independent live truth stays visible.
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));
    expect(screen.getByText(LIVE_HEALTHY)).toBeInTheDocument();

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    // No part of the malformed composite is presented as known data.
    expect(shows(SENTINEL[30])).toBe(false);
    expect(bodyText()).not.toMatch(HISTORICAL_HEALTHY);
    // Ratified plain language in the newly added unavailable labels.
    expect(screen.queryByText(/^exceptions$/i)).toBeNull();
  });
});

// ─── R11 — FRESHNESS (D4) ────────────────────────────────────────────────────

describe('GH-1230 R11 — freshness comes only from actual successful fetches, independently', () => {
  it('R11a EXPECTED RED: historical and live each show their own successful-fetch time', async () => {
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
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));

    expect(bodyText()).toMatch(updatedAt(10, 15));
    expect(bodyText()).toMatch(updatedAt(10, 42));
  });

  it('R11b EXPECTED RED: a failed refresh never advances freshness; it is marked unavailable', async () => {
    setClock(9, 5);
    const { queryClient } = renderPage();
    await expectShown(SENTINEL[30]);
    await waitFor(() => expect(metricValue(/^awaiting pick$/i)).toBe('41'));
    await waitFor(() => expect(bodyText()).toMatch(updatedAt(9, 5)));

    setClock(9, 55);
    scenario.historical = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'full'] });
    });

    await waitFor(() => expect(hasText(UNAVAILABLE)).toBe(true));
    // Values from the 9:05 fetch are no longer presented as current…
    expect(shows(SENTINEL[30])).toBe(false);
    // …and the failed 9:55 attempt never becomes a freshness timestamp.
    expect(bodyText()).not.toMatch(updatedAt(9, 55));
  });
});

// ─── D6 — RETRY POLICY ───────────────────────────────────────────────────────

describe('GH-1230 D6 — authorization denials are not retried; transient errors keep bounded retry', () => {
  const RETRYING = { retry: 3, retryDelay: 0 } as const;

  it.each([
    ['ACTION_FORBIDDEN', ACTION_FORBIDDEN],
    ['COMMERCIAL_ACCESS_DENIED', COMMERCIAL_ACCESS_DENIED],
  ])('D6a EXPECTED RED: historical 403 %s is requested exactly once', async (_code, body) => {
    scenario.historical = () => httpError(403, body);
    renderPage(RETRYING);
    await settleInitial();
    // Allow any retries to happen (retryDelay 0), then count.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(historicalCalls()).toHaveLength(1);
  });

  it('D6b EXPECTED RED: live 403 ACTION_FORBIDDEN is requested exactly once', async () => {
    scenario.live = () => httpError(403, ACTION_FORBIDDEN);
    renderPage(RETRYING);
    await settleInitial();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(liveCalls()).toHaveLength(1);
  });

  it('D6c GREEN CONTROL: historical 500 keeps bounded transient retry (1 + 3 attempts)', async () => {
    scenario.historical = () => httpError(500);
    renderPage(RETRYING);
    await waitFor(() => expect(historicalCalls()).toHaveLength(4));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(historicalCalls()).toHaveLength(4);
  });
});
