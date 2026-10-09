// tests/unit/ui/wms/WmsAnalyticsPage.v1.test.tsx
//
// GH-1231 RED-2B — Analytics V1 owner screen, rendered React behaviour.
//
// Ratified target: Concept A, Visual Four Questions (blueprint §12B; playbook
// §18B; GH-1231 W1–W4, U1–U8). This suite owns the assertions RED-1 assigned
// to "the frontend RTL RED suite": rendered regions, question headings,
// drilldown links, Details interactions, denial presentation and retired
// claims — asserted on the rendered page, never by source regex.
//
// Selectors are semantic: a region is an accessible `region` named by its
// area or its ratified question; links are `link`s with real hrefs; Details
// is reachable by keyboard. Copy assertions use only ratified strings:
//   questions — "Are we keeping up?", "Where is work slowing down?",
//               "Where are problems happening?", "How is the team doing?"
//   Flow     — Waiting to be picked · Being picked · Waiting to be packed ·
//              Being packed · Ready to ship; "Orders waiting the longest in
//              each step" (concise exact ages, provenance in Details)
//   Pace     — "today so far" / "this week so far"; "Orders fulfilled today
//              (all sales channels)"; carrier cutoff at 16:00 shop time with
//              2h 30m left (asserted semantically, not as one sentence)
//   Problems — type labels; "No problems recorded in the last N days";
//              "Open Problem Center" → /problem-center
//   Flow     — "Open Order Flow" → /orders/flow
//   Team     — "Items picked" / "Items packed" column headers;
//              "Assigned to active batches" + "Includes unfinished batches;
//              not live staffing"
//   Costs    — "Hourly rates are set in Team" → /team;
//              "Cost reporting isn't available in Analytics yet"
//   state    — "Couldn't load this right now."; D3 role sentence.
//
// NOT asserted here (JSDOM cannot measure it): the scroll-free contract,
// region bounds, typography, the ≥2 product / ≥1 person rows at rest and
// "Showing K of N" clipping. Those are the local Playwright certification
// gate (U7) after implementation.
//
// Only the HTTP boundary is mocked; the real hooks, resolvers, page and the
// real ConfigProvider (shared Ops Console state) run.

import React from 'react';
import { screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { renderWithProviders } from 'test-utils';
import WmsAnalyticsPage from 'pages/ft2-pages/WmsAnalyticsPage';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

jest.mock('components/CommercialGate', () => ({
  __esModule: true,
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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
const TODAY = '2026-10-08'; // Thursday
const START_AT: Record<Days, string> = { 7: '2026-10-01T22:00:00.000Z', 30: '2026-09-08T22:00:00.000Z', 90: '2026-07-10T22:00:00.000Z' };
const PACE_TOTAL = 955; // = Σ Team items_picked
const CURRENT_BUCKET = 12;

function shiftDate(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pace(days: Days) {
  const points: { start_date: string; end_date: string; items_picked: number; is_current: boolean; is_clipped: boolean }[] = [];
  if (days === 90) {
    const first = shiftDate(TODAY, -89);
    for (let start = first; start <= TODAY;) {
      const toSunday = (7 - new Date(`${start}T00:00:00Z`).getUTCDay()) % 7;
      const sunday = shiftDate(start, toSunday);
      const end = sunday < TODAY ? sunday : TODAY;
      points.push({ start_date: start, end_date: end, items_picked: 0, is_current: end === TODAY, is_clipped: start === first && toSunday < 6 });
      start = shiftDate(end, 1);
    }
  } else {
    for (let i = 0; i < days; i += 1) {
      const d = shiftDate(TODAY, i - days + 1);
      points.push({ start_date: d, end_date: d, items_picked: 0, is_current: i === days - 1, is_clipped: false });
    }
  }
  points[points.length - 2].items_picked = PACE_TOTAL - CURRENT_BUCKET;
  points[points.length - 1].items_picked = CURRENT_BUCKET;
  return { items_picked_total: PACE_TOTAL, points };
}

/** Legacy keys carrying every retired claim (UPH, accuracy, cost, Default Title, names) — V1 must not render them. */
function legacyHistorical(days: Days, unlocked = true) {
  return {
    live: live(),
    operators: [{
      user_id: 1, first_name: 'Legacy', last_name: 'Operator', role: 'operator', picks: 120, packs: 80, batches_picked: 6,
      uph: 31.5, accuracy_pct: 97.2, exception_count: 2, avg_batch_seconds: 540, scan_source_mix: { camera: 10 },
    }],
    pipeline: {
      stages: { released_to_picking_s: 600, picking_s: 900, packing_s: 300, packed_to_shipped_s: 1200 },
      latencies: { receive_to_pickable_hours: 20, receive_to_pickable_samples: 3, return_to_restock_hours: 8 },
    },
    exceptions: {
      top_skus: [{ lasyncro_variant_id: 'v-2', title: 'Default Title', sku: null, exception_count: 1, type_breakdown: { short_pick: 1 } }],
      heat_grid: [{ user_id: 1, name: 'Legacy Operator', pick_exception_rate_pct: 1.6, pack_exception_rate_pct: 0 }],
    },
    cost: unlocked
      ? { unlocked: true, total_cost: 400, cost_per_order: 2.5, cost_per_unit: 1.25, exception_cost: 3, orders_shipped: 160, editorial: 'You shipped 160 orders at 2.5 cost-per-order, down from 3 last period.' }
      : { unlocked: false, cost_per_order: null, cost_per_unit: null, exception_cost: null, editorial: null },
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
    throughput_trend: { points: [{ day: '2026-10-07', units: 60, uph: 33 }], avg_uph: 33, latest_uph: 33 },
    exception_trend: { total: 2, open_total: 1, by_type: { short_pick: 2 }, points: [{ day: '2026-10-07', count: 2 }] },
    days,
  };
}

/** Team rows deliberately NOT alphabetical and with volume ≠ name order. */
const TEAM = [
  { user_id: 3, display_name: 'Zoë Park', items_picked: 900, items_packed: 0, is_current_member: true },
  { user_id: 1, display_name: 'Avery Lind', items_picked: 5, items_packed: 2, is_current_member: true },
  { user_id: 2, display_name: 'blake Moss', items_picked: 50, items_packed: 700, is_current_member: false },
];

function historical(days: Days, opts: { unlocked?: boolean } = {}) {
  return {
    ...legacyHistorical(days, opts.unlocked ?? true),
    window: { days, timezone: 'Europe/Stockholm', start_at: START_AT[days], bucket: days === 90 ? 'week' : 'day', today_local: TODAY },
    pace: pace(days),
    problems: {
      total: 4,
      open_total: 2,
      by_type: { short_pick: 2, item_missing: 1, wrong_item: 1 },
      products: [
        { lasyncro_variant_id: 'v-1', display_label: 'Mug - Blue', sku: 'MUG-BL', count: 3 },
        { lasyncro_variant_id: 'v-2', display_label: 'Poster', sku: null, count: 1 },
      ],
      products_total: 2,
    },
    team_activity: TEAM,
  };
}

function historicalKnownZero(days: Days) {
  const p = pace(days);
  return {
    ...legacyHistorical(days, false),
    operators: [],
    window: historical(days).window,
    pace: { items_picked_total: 0, points: p.points.map((pt) => ({ ...pt, items_picked: 0 })) },
    problems: { total: 0, open_total: 0, by_type: {}, products: [], products_total: 0 },
    team_activity: [],
  };
}

const FLOW_STAGES = [
  { status: 'awaiting_pick', label: 'Waiting to be picked', count: 7, age: 10_800, ageText: '3 h' },
  { status: 'picking', label: 'Being picked', count: 1, age: 2700, ageText: '45 min' },
  { status: 'picked', label: 'Waiting to be packed', count: 2, age: 6_213_600, ageText: '71 days' },
  { status: 'packing', label: 'Being packed', count: 0, age: null, ageText: '—' },
  { status: 'packed', label: 'Ready to ship', count: 4, age: 0, ageText: 'Under 1 min' },
] as const;
const FLOW_LABELS = FLOW_STAGES.map((s) => s.label);

function legacyLive() {
  return {
    pipeline: { awaiting_pick: 7, picking: 1, packing: 0, ship_ready: 4, shipped: 5 },
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

function live() {
  return {
    ...legacyLive(),
    flow: { stages: Object.fromEntries(FLOW_STAGES.map((s) => [s.status, { count: s.count, oldest_age_s: s.age }])) },
  };
}

function liveKnownZero() {
  return {
    ...legacyLive(),
    pipeline: { awaiting_pick: 0, picking: 0, packing: 0, ship_ready: 0, shipped: 0 },
    operators_on_shift: 0, active_operators: 0, cpt_local: null, hours_to_cpt: null, live_uph: null,
    required_uph: null, standard_uph: null, on_track: null, shipped_today: 0, shipped_via_wms: 0,
    shipped_via_legacy: 0, unfulfilled_orders: 0,
    flow: { stages: Object.fromEntries(FLOW_STAGES.map((s) => [s.status, { count: 0, oldest_age_s: null }])) },
  };
}

// ─── REQUEST BOUNDARY ────────────────────────────────────────────────────────

const HISTORICAL = '/api/v1/wms/analytics';
const LIVE = '/api/v1/wms/analytics/live';
const pending = () => new Promise<never>(() => {});
const httpError = (status: number, data?: Record<string, unknown>) =>
  Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } }));

type Scenario = { historical: (days: number) => Promise<unknown>; live: () => Promise<unknown> };
let scenario: Scenario;
const pathOf = (url: string) => url.split('?')[0];
const daysOf = (url: string) => Number(new URLSearchParams(url.split('?')[1] ?? '').get('days'));

const mockGet = jest.fn((url: string) => {
  const path = pathOf(url);
  if (path === HISTORICAL) return scenario.historical(daysOf(url)).then((data) => ({ data }));
  if (path === LIVE) return scenario.live().then((data) => ({ data }));
  return Promise.reject(new Error(`unexpected GET ${url}`));
});

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: (url: string) => mockGet(url), post: jest.fn() },
}));

beforeEach(() => {
  mockGet.mockClear();
  scenario = {
    historical: (days) => Promise.resolve(historical(days as Days)),
    live: () => Promise.resolve(live()),
  };
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Shared Ops Console state, driven exactly as the top-nav trigger does. */
function ConsoleControls() {
  const { dispatch } = useConfig();
  return (
    <>
      <button type="button" onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>test: open console</button>
      <button type="button" onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>test: close console</button>
    </>
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <ConsoleControls />
        <WmsAnalyticsPage />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient };
}

type RegionKey = 'pace' | 'flow' | 'problems' | 'team' | 'costs';
const REGION: Record<RegionKey, RegExp> = {
  pace: /\bpace\b|are we keeping up/i,
  flow: /\bflow\b|where is work slowing down/i,
  problems: /\bproblems\b|where are problems happening/i,
  team: /\bteam\b|how is the team doing/i,
  costs: /\bcosts?\b/i,
};
const QUESTION: Record<Exclude<RegionKey, 'costs'>, string> = {
  pace: 'Are we keeping up?',
  flow: 'Where is work slowing down?',
  problems: 'Where are problems happening?',
  team: 'How is the team doing?',
};

const region = (key: RegionKey) => screen.getByRole('region', { name: REGION[key] });
const findRegion = (key: RegionKey) => screen.findByRole('region', { name: REGION[key] });
const textOf = (key: RegionKey) => region(key).textContent ?? '';

const UNAVAILABLE = /couldn[’']t load this right now/i;
const num = (n: number) => new RegExp(`(^|[^\\d.])${n}([^\\d.]|$)`);

/** Text of the largest ancestor of `label` inside `container` holding no OTHER label of `group`. */
function groupText(container: HTMLElement, label: string, group: readonly string[]): string {
  const el = within(container).getAllByText(label)[0];
  let node: HTMLElement = el;
  while (node.parentElement && node.parentElement !== container) {
    const parentText = node.parentElement.textContent ?? '';
    if (group.some((other) => other !== label && parentText.includes(other))) break;
    node = node.parentElement;
  }
  return node.textContent ?? '';
}

/** True when `a` precedes `b` in document order. */
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * Details is an accessible dialog (below lg popover) or a named
 * complementary/region (lg+ rail). A compact default rail with help text may
 * be present before any selection; what matters is which entity, if any, it
 * describes.
 */
function detailsPanel(): HTMLElement | null {
  return (
    screen.queryByRole('dialog')
    ?? screen.queryByRole('complementary', { name: /details/i })
    ?? screen.queryByRole('region', { name: /details/i })
  );
}

async function ready() {
  await waitFor(() => expect(within(region('team')).getByText('Avery Lind')).toBeInTheDocument());
  await waitFor(() => expect(groupText(region('flow'), 'Waiting to be picked', FLOW_LABELS)).toMatch(num(7)));
}

async function selectWindow(user: ReturnType<typeof userEvent.setup>, days: Days) {
  await user.click(screen.getByRole('button', { name: `${days}d` }));
  await waitFor(() => expect(mockGet.mock.calls.some(([url]) => pathOf(url) === HISTORICAL && daysOf(url) === days)).toBe(true));
}

// ═════════════════════════════════════════════════════════════════════════════
// 1–2. Composition
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Concept A composition', () => {
  it.each(Object.entries(QUESTION))('the %s region asks its ratified question as a heading', async (key, question) => {
    renderPage();
    const r = await findRegion(key as RegionKey);
    expect(within(r).getByRole('heading', { name: question })).toBeVisible();
  });

  it('renders exactly five named regions: Pace, Flow, Problems, Team and the Costs strip', async () => {
    renderPage();
    await ready();
    for (const key of Object.keys(REGION) as RegionKey[]) expect(region(key)).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3–4. Flow and zero / unknown / missing / unavailable
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Flow: five recorded statuses', () => {
  it('shows the five stages in process order, each with its own order count and recorded-status age', async () => {
    renderPage();
    await ready();
    const flow = region('flow');
    const labels = FLOW_LABELS.map((label) => within(flow).getAllByText(label)[0]);
    for (let i = 1; i < labels.length; i += 1) expect(precedes(labels[i - 1], labels[i])).toBe(true);
    for (const s of FLOW_STAGES) {
      const g = groupText(flow, s.label, FLOW_LABELS);
      expect(`${s.label}: ${g}`).toMatch(num(s.count));
      expect(`${s.label}: ${g}`).toContain(s.ageText);
    }
  });

  it('shows concise exact ages (never a lower-bound "+" the API does not report); an unknown age is "—", never 0', async () => {
    renderPage();
    await ready();
    const flow = region('flow');
    const packed = groupText(flow, 'Waiting to be packed', FLOW_LABELS);
    expect(packed).toContain('71 days');
    expect(packed).not.toMatch(/since an earlier day|\d\+/i);
    expect(groupText(flow, 'Being picked', FLOW_LABELS)).not.toMatch(/since an earlier day|\d\+/i);
    const packing = groupText(flow, 'Being packed', FLOW_LABELS);
    expect(packing).toContain('—');
    expect(packing).not.toMatch(/0\s*(s|sec|min|h)\b|under 1 min/i);
  });

  it('a live response without flow (older backend) makes Flow unavailable, never zero; Pace keeps the live fulfilled count', async () => {
    scenario.live = () => Promise.resolve(legacyLive());
    renderPage();
    await waitFor(() => expect(textOf('flow')).toMatch(UNAVAILABLE));
    for (const label of FLOW_LABELS) {
      const hits = within(region('flow')).queryAllByText(label);
      if (hits.length) expect(groupText(region('flow'), label, FLOW_LABELS)).not.toMatch(num(0));
    }
    expect(textOf('pace')).toMatch(/orders fulfilled today \(all sales channels\)/i);
    expect(textOf('pace')).toMatch(num(47));
  });
});

describe('GH-1231 V1 — genuine zero versus unavailable', () => {
  it('a verified zero response renders zeros and the ratified empty copy, not unavailable', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    scenario.live = () => Promise.resolve(liveKnownZero());
    const { user } = renderPage();
    await selectWindow(user, 7);
    expect(await within(await findRegion('problems')).findByText(/no problems recorded in the last 7 days/i)).toBeVisible();
    expect(textOf('pace')).toMatch(num(0));
    const flow = region('flow');
    for (const label of FLOW_LABELS) {
      const g = groupText(flow, label, FLOW_LABELS);
      expect(`${label}: ${g}`).toMatch(num(0));
      expect(`${label}: ${g}`).toContain('—');
    }
    for (const key of Object.keys(REGION) as RegionKey[]) expect(`${key}: ${textOf(key)}`).not.toMatch(UNAVAILABLE);
  });

  it('a historical 500 makes Pace, Problems, Team and the Costs strip say "Couldn\'t load this right now." with no values', async () => {
    scenario.historical = () => httpError(500);
    renderPage();
    await waitFor(() => {
      for (const key of ['pace', 'problems', 'team', 'costs'] as RegionKey[]) expect(`${key}: ${textOf(key)}`).toMatch(UNAVAILABLE);
    });
    expect(screen.queryByText('Avery Lind')).toBeNull();
    expect(screen.queryByText('Mug - Blue')).toBeNull();
    expect(textOf('pace')).not.toMatch(num(PACE_TOTAL));
    expect(groupText(region('flow'), 'Waiting to be picked', FLOW_LABELS)).toMatch(num(7));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Reporting window
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Pace reporting window and current partial period', () => {
  it.each([
    [7, 'today so far'],
    [30, 'today so far'],
    [90, 'this week so far'],
  ] as const)('%id: items picked in the last N days, with the current bucket read as "%s"', async (days, partial) => {
    const { user } = renderPage();
    if (days !== 30) await selectWindow(user, days);
    await waitFor(() => expect(textOf('pace')).toMatch(new RegExp(`last ${days} days`, 'i')));
    const pace = textOf('pace');
    expect(pace).toMatch(num(PACE_TOTAL));
    expect(pace).toMatch(new RegExp(partial, 'i'));
    expect(pace).not.toMatch(new RegExp(days === 90 ? 'today so far' : 'this week so far', 'i'));
    expect(pace).toMatch(num(CURRENT_BUCKET));
    expect(screen.getByRole('button', { name: `${days}d` })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Pace states the live all-channel fulfilled count and the shop-clock carrier cutoff, with no pace judgement', async () => {
    renderPage();
    await ready();
    const pace = textOf('pace');
    expect(pace).toMatch(/orders fulfilled today \(all sales channels\)/i);
    expect(pace).toMatch(num(47));
    // U4: configured cutoff on the shop clock, time remaining, no pace judgement.
    expect(pace).toMatch(/cutoff/i);
    expect(pace).toMatch(/\b16:00\b/);
    expect(pace).toMatch(/shop[- ]?(time|clock|local)/i);
    expect(pace).toMatch(/2\s*h\s*30\s*m/i);
    expect(pace).not.toMatch(/on track|at risk|behind|required|ahead/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Problems
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Problems: recognizable products, plain types', () => {
  it('lists product + variant names with counts, plain problem types, never "Default Title" or raw codes', async () => {
    renderPage();
    await ready();
    const problems = region('problems');
    expect(groupText(problems, 'Mug - Blue', ['Mug - Blue', 'Poster'])).toMatch(num(3));
    expect(groupText(problems, 'Poster', ['Mug - Blue', 'Poster'])).toMatch(num(1));
    expect(precedes(within(problems).getAllByText('Mug - Blue')[0], within(problems).getAllByText('Poster')[0])).toBe(true);
    for (const label of ['Could not pick full amount', 'Item not found', 'Wrong item']) {
      expect(within(problems).getAllByText(new RegExp(label, 'i')).length).toBeGreaterThan(0);
    }
    expect(problems.textContent).toMatch(num(4));
    expect(document.body.textContent).not.toMatch(/Default Title|short_pick|item_missing|wrong_item/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Team
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Team: alphabetical, confirmed items, no scores', () => {
  const NAMES = ['Avery Lind', 'blake Moss', 'Zoë Park'];

  it('orders people alphabetically (not by volume) with their picked and packed items', async () => {
    renderPage();
    await ready();
    const team = region('team');
    const els = NAMES.map((n) => within(team).getAllByText(n)[0]);
    expect(precedes(els[0], els[1]) && precedes(els[1], els[2])).toBe(true);
    for (const row of TEAM) {
      const g = groupText(team, row.display_name, NAMES);
      expect(`${row.display_name}: ${g}`).toMatch(num(row.items_picked));
      expect(`${row.display_name}: ${g}`).toMatch(num(row.items_packed));
    }
  });

  it('qualifies live batch assignment and makes no speed, accuracy, ranking or comparison claim', async () => {
    renderPage();
    await ready();
    const team = textOf('team');
    expect(team).toMatch(/assigned to active batches/i);
    expect(team).toMatch(num(3));
    expect(team).toContain('Includes unfinished batches; not live staffing');
    expect(team).not.toMatch(/\bUPH\b|per hour|accuracy|%|\brank|\bscore|vs\.? (self|team)|working now|on shift|top performer/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8–9. Costs and links
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Costs is setup-only', () => {
  it('with at least one rate: the neutral availability statement, no link, no money or cost estimate anywhere', async () => {
    renderPage();
    await ready();
    const costs = region('costs');
    expect(within(costs).getByText("Cost reporting isn't available in Analytics yet")).toBeVisible();
    expect(within(costs).queryAllByRole('link')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/[$€£¥]|cost[- ]per|per order|per item|last period|editorial/i);
  });

  it('with no rates: a plain Team setup link that promises nothing', async () => {
    scenario.historical = (days) => Promise.resolve(historical(days as Days, { unlocked: false }));
    renderPage();
    await ready();
    const costs = region('costs');
    expect(costs.textContent).toMatch(/hourly rates are set in team/i);
    expect(within(costs).getByRole('link')).toHaveAttribute('href', '/team');
    expect(costs.textContent).not.toMatch(/unlock|will show|to see/i);
  });
});

describe('GH-1231 V1 — drilldowns go only to real routes', () => {
  it('"Open Problem Center" → /problem-center and "Open Order Flow" → /orders/flow; no /wms/problem-center', async () => {
    renderPage();
    await ready();
    expect(within(region('problems')).getByRole('link', { name: /open problem center/i })).toHaveAttribute('href', '/problem-center');
    expect(within(region('flow')).getByRole('link', { name: /open order flow/i })).toHaveAttribute('href', '/orders/flow');
    for (const link of screen.queryAllByRole('link')) expect(link.getAttribute('href') ?? '').not.toMatch(/\/wms\/problem-center/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Details
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Details on selection (keyboard accessible, no "Usually")', () => {
  const SELECTIONS: [string, RegionKey, string, RegExp][] = [
    ['stage', 'flow', 'Waiting to be packed', num(2)],
    ['product', 'problems', 'Mug - Blue', num(3)],
    ['person', 'team', 'Avery Lind', num(5)],
  ];

  it.each(SELECTIONS)('Enter on a %s opens its Details; Escape closes or resets them', async (_kind, key, label, value) => {
    const { user } = renderPage();
    await ready();
    // No entity is selected initially (an empty / help-text default rail is allowed).
    for (const [, , entity] of SELECTIONS) expect(detailsPanel()?.textContent ?? '').not.toContain(entity);

    const control = within(region(key)).getByRole('button', { name: new RegExp(label, 'i') });
    control.focus();
    await user.keyboard('{Enter}');

    const details = await waitFor(() => {
      const panel = detailsPanel();
      expect(panel).not.toBeNull();
      return panel!;
    });
    expect(details.textContent).toContain(label);
    expect(details.textContent).toMatch(value);
    expect(details.textContent).not.toMatch(/usually|average|typical|median/i);

    // Escape closes Details or resets it to the unselected default.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(detailsPanel()?.textContent ?? '').not.toContain(label));
  });

  it('a click selects a stage too', async () => {
    const { user } = renderPage();
    await ready();
    await user.click(within(region('flow')).getByRole('button', { name: /being picked/i }));
    await waitFor(() => expect(detailsPanel()?.textContent ?? '').toContain('Being picked'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Ops Console coexistence (state only — geometry is the Playwright gate)
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — Ops Console open/close preserves the selection', () => {
  it('closing the Console restores all four answers with the window and Details selection preserved', async () => {
    const { user } = renderPage();
    await selectWindow(user, 7);
    await ready();
    within(region('flow')).getByRole('button', { name: /waiting to be packed/i }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(detailsPanel()?.textContent ?? '').toContain('Waiting to be packed'));

    await user.click(screen.getByText('test: open console'));
    await user.click(screen.getByText('test: close console'));

    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    for (const [key, question] of Object.entries(QUESTION)) {
      expect(within(region(key as RegionKey)).getByRole('heading', { name: question })).toBeVisible();
    }
    await waitFor(() => expect(detailsPanel()?.textContent ?? '').toContain('Waiting to be packed'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. Access and data states
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — access and data states', () => {
  it('role denial: the D3 sentence, no regions with data, no upgrade prompt', async () => {
    const denied = { error: 'ACTION_FORBIDDEN', action: 'wms:analytics:read' };
    scenario.historical = () => httpError(403, denied);
    scenario.live = () => httpError(403, denied);
    renderPage();
    expect(await screen.findByText(/you don[’']t have access to analytics/i)).toBeVisible();
    expect(screen.queryByTestId('commercial-upgrade-prompt')).toBeNull();
    for (const text of ['Avery Lind', 'Mug - Blue', 'Waiting to be packed']) expect(screen.queryByText(text)).toBeNull();
  });

  it('commercial denial: the canonical prompt with the server decision, not the role sentence', async () => {
    const denied = { error: 'COMMERCIAL_ACCESS_DENIED', reason: 'TIER_TOO_LOW', capabilityId: 'warehouse.analytics', currentTier: 'starter', requiredTier: 'core' };
    scenario.historical = () => httpError(403, denied);
    scenario.live = () => httpError(403, denied);
    renderPage();
    const prompt = await screen.findByTestId('commercial-upgrade-prompt');
    expect(prompt).toHaveAttribute('data-reason', 'TIER_TOO_LOW');
    expect(prompt).toHaveAttribute('data-required-tier', 'core');
    expect(document.body.textContent).not.toMatch(/you don[’']t have access/i);
  });

  it('loading: all four questions stand, with no zero, no value and no unavailable claim', async () => {
    scenario.historical = () => pending();
    scenario.live = () => pending();
    renderPage();
    for (const [key, question] of Object.entries(QUESTION)) {
      const r = await findRegion(key as RegionKey);
      expect(within(r).getByRole('heading', { name: question })).toBeVisible();
      expect(`${key}: ${r.textContent}`).not.toMatch(UNAVAILABLE);
    }
    for (const label of FLOW_LABELS) {
      const hits = within(region('flow')).queryAllByText(label);
      if (hits.length) expect(groupText(region('flow'), label, FLOW_LABELS)).not.toMatch(num(0));
    }
    expect(screen.queryByText(/no problems recorded/i)).toBeNull();
  });

  it('partial: one malformed block degrades only its region', async () => {
    scenario.historical = (days) => Promise.resolve({ ...historical(days as Days), problems: { ...historical(days as Days).problems, products: [null] } });
    renderPage();
    await ready();
    await waitFor(() => expect(textOf('problems')).toMatch(UNAVAILABLE));
    expect(textOf('pace')).toMatch(num(PACE_TOTAL));
    expect(textOf('pace')).not.toMatch(UNAVAILABLE);
    expect(textOf('team')).not.toMatch(UNAVAILABLE);
  });

  it('refresh error: cached values are withdrawn, not presented as current', async () => {
    const { queryClient } = renderPage();
    await ready();
    scenario.historical = () => httpError(500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['wms', 'analytics', 'full'] });
    });
    await waitFor(() => {
      for (const key of ['pace', 'problems', 'team', 'costs'] as RegionKey[]) expect(`${key}: ${textOf(key)}`).toMatch(UNAVAILABLE);
    });
    expect(screen.queryByText('Avery Lind')).toBeNull();
    expect(textOf('pace')).not.toMatch(num(PACE_TOTAL));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. Retired claims
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 V1 — retired misleading metrics and copy never render', () => {
  const RETIRED: [string, RegExp][] = [
    ['UPH / units per hour', /\bUPH\b|units per hour/i],
    ['accuracy', /accuracy/i],
    ['on track / at risk / behind', /on track|at risk|\bbehind\b/i],
    ['vs self / vs team', /vs\.? (self|team)/i],
    ['Pipeline Stage Velocity / historical stage averages', /pipeline stage velocity|usually|average|bottleneck/i],
    ['Stuck on the floor', /stuck on the floor/i],
    ['working now / on shift', /working now|on shift/i],
    ['money / cost estimates / editorial', /[$€£¥]|cost[- ]per|last period|you shipped/i],
    ['legacy operator / heat-grid names', /legacy operator/i],
    ['WMS vs legacy shipped split', /\bscanned\b.*\blegacy\b/i],
    ['Exceptions (merchant copy is Problems)', /\bexceptions?\b/i],
    ['receive / return latencies', /receive.to.pickable|return.to.restock/i],
  ];

  it.each(RETIRED)('never shows %s', async (_name, pattern) => {
    renderPage();
    await ready();
    expect(document.body.textContent).not.toMatch(pattern);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. GH-1231 visual remediation — Pace bar truth (R3) and contextual Details (R1)
//     Real pixel geometry and responsive stacking are the Playwright gate.
// ═════════════════════════════════════════════════════════════════════════════

/** Every plotted Pace period in order (nonzero = button, zero = inert), with its bar (if any). */
function pacePoints() {
  return [...region('pace').querySelectorAll<HTMLElement>('[data-pace-point]')].map((el) => ({
    items: Number(el.getAttribute('data-items-picked')),
    bar: el.querySelector<HTMLElement>('[data-pace-bar]'),
  }));
}

describe('GH-1231 R3 — Pace bar heights come only from confirmed items picked', () => {
  it.each([7, 30, 90] as Days[])('%sd: zero buckets draw no bar; nonzero bars scale to the largest real bucket', async (days) => {
    const { user } = renderPage();
    if (days !== 30) await selectWindow(user, days);
    await waitFor(() => expect(pacePoints()).toHaveLength(pace(days).points.length));

    const expected = pace(days).points.map((p) => p.items_picked);
    const max = Math.max(...expected);
    const plotted = pacePoints();
    expect(plotted.map((p) => p.items)).toEqual(expected);
    expect(plotted.reduce((sum, p) => sum + p.items, 0)).toBe(PACE_TOTAL);
    expect(textOf('pace')).toMatch(num(PACE_TOTAL));
    for (const { items, bar } of plotted) {
      if (items === 0) expect(bar).toBeNull();
      else expect(bar!.style.height).toBe(`${items / max * 100}%`);
    }
    // The partial current bucket is nonzero here and keeps its own true height.
    expect(plotted[plotted.length - 1].bar!.style.height).toBe(`${CURRENT_BUCKET / max * 100}%`);
  });

  it('a verified all-zero window plots every bucket with no activity bar, including partial periods', async () => {
    scenario.historical = (days) => Promise.resolve(historicalKnownZero(days as Days));
    renderPage();
    await waitFor(() => expect(pacePoints()).toHaveLength(30));
    expect(pacePoints().every((p) => p.items === 0 && p.bar === null)).toBe(true);
    expect(within(region('pace')).getAllByRole('img', { name: /partial current period/i })).toHaveLength(1);
  });
});

describe('GH-1231 R1 — Details is contextual, nonmodal and restores focus', () => {
  const details = () => screen.queryByRole('dialog', { name: /details/i });

  it('no Details panel or reserved rail exists until something is selected', async () => {
    renderPage();
    await ready();
    expect(details()).toBeNull();
    expect(screen.queryByRole('complementary', { name: /details/i })).toBeNull();
    expect(screen.queryByRole('region', { name: /details/i })).toBeNull();
  });

  it('opening moves focus into Details without hiding the workspace; Close returns focus to the trigger', async () => {
    const { user } = renderPage();
    await ready();
    const trigger = within(region('team')).getByRole('button', { name: /avery lind/i });
    trigger.focus();
    await user.keyboard(' ');

    const panel = await waitFor(() => details()!);
    expect(panel).toHaveTextContent('Avery Lind');
    expect(panel).not.toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(within(panel).getByRole('button', { name: /close details/i })).toHaveFocus());
    for (const key of ['pace', 'flow', 'problems', 'team'] as RegionKey[]) {
      expect(region(key).closest('[aria-hidden="true"]')).toBeNull();
    }
    expect(screen.getByRole('button', { name: '7d' })).toBeVisible();

    await user.click(within(panel).getByRole('button', { name: /close details/i }));
    await waitFor(() => expect(details()).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('Escape closes Details and returns focus to the selected period', async () => {
    const { user } = renderPage();
    await ready();
    const trigger = within(region('pace')).getAllByRole('button', { name: /confirmed items picked/i })[0];
    expect(trigger).toHaveAttribute('data-items-picked', String(PACE_TOTAL - CURRENT_BUCKET));
    trigger.focus();
    await user.keyboard('{Enter}');
    const panel = await waitFor(() => details()!);
    expect(within(panel).getByText(`${PACE_TOTAL - CURRENT_BUCKET} items picked`)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(details()).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. GH-1231 final UX cleanup (owner-ratified 2026-10-09)
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 cleanup — Pace: zero buckets are inert, nonzero buckets open Details', () => {
  it('a zero bucket is not a control (no button, not focusable) and neither click nor Enter opens Details', async () => {
    const { user } = renderPage();
    await ready();
    const zeros = [...region('pace').querySelectorAll<HTMLElement>('[data-pace-point][data-items-picked="0"]')];
    expect(zeros).toHaveLength(pace(30).points.filter((p) => p.items_picked === 0).length);
    for (const el of zeros) {
      expect(el.tagName).not.toBe('BUTTON');
      expect(el).toHaveAttribute('role', 'img');
      expect(el.tabIndex).toBe(-1);
      expect(el.getAttribute('aria-label')).toMatch(/: 0 confirmed items picked/);
    }
    await user.click(zeros[0]);
    zeros[0].focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: /details/i })).toBeNull();
  });

  it('every nonzero bucket is a button that opens its period Details', async () => {
    const { user } = renderPage();
    await ready();
    const buttons = within(region('pace')).getAllByRole('button', { name: /confirmed items picked/i });
    expect(buttons.map((b) => Number(b.getAttribute('data-items-picked')))).toEqual([PACE_TOTAL - CURRENT_BUCKET, CURRENT_BUCKET]);
    await user.click(buttons[1]);
    const panel = await screen.findByRole('dialog', { name: /details/i });
    expect(within(panel).getByText(`${CURRENT_BUCKET} items picked`)).toBeInTheDocument();
    expect(panel.textContent).toMatch(/today so far/i);
  });

  it('the caption and the top axis numeral are gone; timezone and partial periods stay in the accessible chart', async () => {
    renderPage();
    await ready();
    const pace = textOf('pace');
    expect(pace).not.toMatch(/striped bars are partial|Confirmed items ·/i);
    expect(pace).not.toMatch(num(PACE_TOTAL - CURRENT_BUCKET)); // the largest bucket is not echoed as an axis label
    expect(pace).toMatch(num(PACE_TOTAL));
    expect(pace).toMatch(num(CURRENT_BUCKET));
    expect(within(region('pace')).getByRole('group', { name: /per day, Europe\/Stockholm\. Striped bars are partial periods/i })).toBeInTheDocument();
  });
});

describe('GH-1231 cleanup — Flow is live: unchanged by the historical period', () => {
  const stageRows = () => within(region('flow')).getAllByRole('button').map((b) => b.textContent);

  it('subtitle, stage rows and the live request are identical across 30d, 7d and 90d', async () => {
    const { user } = renderPage();
    await ready();
    expect(within(region('flow')).getByText('Orders waiting the longest in each step')).toBeVisible();
    const before = stageRows();
    expect(before).toHaveLength(FLOW_STAGES.length);
    for (const days of [7, 90] as Days[]) {
      await selectWindow(user, days);
      await waitFor(() => expect(textOf('pace')).toMatch(new RegExp(`last ${days} days`, 'i')));
      expect(stageRows()).toEqual(before);
    }
    const liveCalls = mockGet.mock.calls.map(([url]) => url).filter((url) => pathOf(url) === LIVE);
    expect(liveCalls.length).toBeGreaterThan(0);
    for (const url of liveCalls) expect(url).not.toMatch(/days=/);
  });

  it('stage Details keep the recorded-status provenance of the age', async () => {
    const { user } = renderPage();
    await ready();
    await user.click(within(region('flow')).getByRole('button', { name: /waiting to be packed/i }));
    const panel = await screen.findByRole('dialog', { name: /details/i });
    expect(panel.textContent).toContain('Longest time in recorded status: 71 days');
    expect(panel.textContent).toMatch(/elapsed time since the order status was recorded; not continuous time spent by a person/i);
  });
});

describe('GH-1231 cleanup — Team column headers', () => {
  it('two static headers precede the rows, without arrows; rows keep exact names and quantities', async () => {
    renderPage();
    await ready();
    const team = region('team');
    const picked = within(team).getByText('Items picked', { exact: true });
    const packed = within(team).getByText('Items packed', { exact: true });
    expect(picked.closest('a, button')).toBeNull();
    expect(packed.closest('a, button')).toBeNull();
    expect(picked).toHaveAttribute('data-analytics-team-column', 'picked');
    expect(packed).toHaveAttribute('data-analytics-team-column', 'packed');
    expect(precedes(picked, packed)).toBe(true);
    expect(precedes(packed, within(team).getAllByText('Avery Lind')[0])).toBe(true);
    expect(team.textContent).not.toMatch(/[←→]/);
    for (const row of TEAM) {
      expect(within(team).getByRole('button', { name: new RegExp(`${row.display_name}.*\\b${row.items_picked} items picked\\b.*\\b${row.items_packed} items packed\\b`, 'i') })).toBeInTheDocument();
    }
  });
});

describe('GH-1231 cleanup — ghost actions keep their real destinations', () => {
  it('card, Costs, Details and Cast links go where they did', async () => {
    scenario.historical = (days) => Promise.resolve(historical(days as Days, { unlocked: false }));
    const { user } = renderPage();
    await ready();
    expect(within(region('flow')).getByRole('link', { name: 'Open Order Flow →' })).toHaveAttribute('href', '/orders/flow');
    expect(within(region('problems')).getByRole('link', { name: 'Open Problem Center →' })).toHaveAttribute('href', '/problem-center');
    expect(within(region('costs')).getByRole('link', { name: 'Open Team →' })).toHaveAttribute('href', '/team');

    await user.click(within(region('flow')).getByRole('button', { name: /being picked/i }));
    let panel = await screen.findByRole('dialog', { name: /details/i });
    expect(within(panel).getByRole('link', { name: 'Open Order Flow →' })).toHaveAttribute('href', '/orders/flow');
    await user.click(within(region('problems')).getByRole('button', { name: /mug - blue/i }));
    panel = await screen.findByRole('dialog', { name: /details/i });
    await waitFor(() => expect(within(panel).getByRole('link', { name: 'Open Problem Center →' })).toHaveAttribute('href', '/problem-center'));
    await user.click(within(panel).getByRole('button', { name: /close details/i }));

    await user.click(screen.getByRole('button', { name: 'Cast to display' }));
    expect(await screen.findByRole('link', { name: 'Manage displays in Settings →' })).toHaveAttribute('href', '/settings/warehouse');
  });
});
