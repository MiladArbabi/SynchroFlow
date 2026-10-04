// tests/unit/ui/orders/OrdersOutboundPage.truth-model.test.tsx
//
// OUTBOUND SLICE D RED — truthful Shipping State rail + ledger presentation.
//
// Protected here:
//   - Shipping State metrics come only from GET /api/v1/orders/outbound
//     `summary` (period-scoped); the legacy /orders/fulfilled sample is gone.
//   - Unresolved / failed / null truth is never rendered as a numeric zero.
//   - Carrier setup reflects loading / unavailable / inactive / active truth.
//   - Ledger: Tracking (not "Proof"/"Confirmed"), physical carrier (never the
//     label provider), distinct live-status semantics, per-row currency.
//   - Error vs never-shipped vs filtered-empty states are distinct.
//   - "Review missing tracking" navigates the ledger to state=missing_tracking.
//
// Deliberately NOT protected: exact typography, badge implementation, DOM
// order, geometry. Assertions are semantic (regex families), scoped to the
// Shipping State rail or to one ledger row.
//
// Mocks mirror OrdersOutboundPage.filter-model.test.tsx (Slice C).

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { renderWithProviders } from 'test-utils';
import OrdersOutboundPage from 'pages/ft2-pages/OrdersOutboundPage';
import { ConfigProvider } from 'contexts/ConfigContext';

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');
  const { OperationalContextShell } = jest.requireActual(
    '../../../../modules/shared/src/ui/OperationalContextShell'
  );
  return {
    __esModule: true,
    OperationalContextShell,
    EntityDetailModal: ({ children }: any) => React.createElement(React.Fragment, {}, children),
    PulseCard: ({ title }: any) => React.createElement('section', {}, React.createElement('h2', {}, title)),
  };
});

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  __esModule: true,
  OrderDetailModalBody: () => null,
}));

jest.mock('components/ModuleTabBar', () => ({
  __esModule: true,
  ModuleTabBar: () => null,
}));

jest.mock('components/ExportDrawer', () => ({
  __esModule: true,
  ExportDrawer: () => null,
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: 'growth',
    snapshot: { modules: new Set<string>(), flags: new Set<string>() },
    hasResolved: true,
  }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

// ─── FIXTURES ────────────────────────────────────────────────────────────────

type Summary = {
  shipped_count: number;
  with_tracking_count: number;
  missing_tracking_count: number;
  tracking_coverage_pct: number | null;
  avg_time_to_ship_hours: number | null;
};

const SUMMARY_WEEK: Summary = {
  shipped_count: 120,
  with_tracking_count: 90,
  missing_tracking_count: 30,
  tracking_coverage_pct: 75,
  avg_time_to_ship_hours: 26,
};

const SUMMARY_MONTH: Summary = {
  shipped_count: 400,
  with_tracking_count: 380,
  missing_tracking_count: 20,
  tracking_coverage_pct: 95,
  avg_time_to_ship_hours: 10,
};

const SUMMARY_KNOWN_ZERO: Summary = {
  shipped_count: 0,
  with_tracking_count: 0,
  missing_tracking_count: 0,
  tracking_coverage_pct: null,
  avg_time_to_ship_hours: null,
};

type Row = {
  lasyncro_order_id: string;
  external_order_id: string;
  shipped_at: string;
  total_price: string;
  currency: string;
  tracking_number: string | null;
  carrier: string | null;
  carrier_provider: string | null;
  latest_status: string | null;
  latest_event_at: string | null;
  is_stalled: boolean | null;
};

let rowSeq = 0;
function row(externalId: string, overrides: Partial<Row> = {}): Row {
  rowSeq += 1;
  return {
    lasyncro_order_id: `00000000-0000-4000-8000-${String(rowSeq).padStart(12, '0')}`,
    external_order_id: externalId,
    shipped_at: '2026-10-01T10:00:00.000Z',
    total_price: '10.00',
    currency: 'USD',
    tracking_number: `TRK${externalId}`,
    carrier: null,
    carrier_provider: 'sendcloud',
    latest_status: 'in_transit',
    latest_event_at: '2026-10-01T12:00:00.000Z',
    is_stalled: false,
    ...overrides,
  };
}

function page(rows: Row[], summary: Summary, total = rows.length) {
  return { orders: rows, total, page: 1, limit: 10, summary };
}

// ─── REQUEST BOUNDARY ────────────────────────────────────────────────────────

const OUTBOUND = '/api/v1/orders/outbound';
const FULFILLED = '/api/v1/orders/fulfilled';
const CARRIERS = '/api/v1/wms/carrier-settings';

const pending = () => new Promise<never>(() => {});
const httpError = (status: number) =>
  Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } }));

type Scenario = {
  outbound: (params: URLSearchParams) => Promise<unknown>;
  carriers: () => Promise<unknown>;
};

const DEFAULT_ROWS = [row('DEFAULTA'), row('DEFAULTB', { tracking_number: null, latest_status: null, is_stalled: null })];

let scenario: Scenario;
const defaultScenario = (): Scenario => ({
  outbound: (params) =>
    Promise.resolve(page(DEFAULT_ROWS, params.get('period') === 'month' ? SUMMARY_MONTH : SUMMARY_WEEK, 500)),
  carriers: () => Promise.resolve({ carriers: [{ carrier_code: 'sendcloud', is_active: true }] }),
});

function toParams(url: string, config?: { params?: Record<string, unknown> }): URLSearchParams {
  const [, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(config?.params ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return params;
}

const pathOf = (url: string) => url.split('?')[0];

/** Legacy shape with a sentinel total: if it ever reaches the rail, 999 shows. */
const LEGACY_FULFILLED = { orders: [], total: 999, page: 1, limit: 100 };

const mockGet = jest.fn((url: string, config?: { params?: Record<string, unknown> }) => {
  const path = pathOf(url);
  if (path === OUTBOUND) return scenario.outbound(toParams(url, config)).then((data) => ({ data }));
  if (path === CARRIERS) return scenario.carriers().then((data) => ({ data }));
  if (path === FULFILLED) return Promise.resolve({ data: LEGACY_FULFILLED });
  return Promise.reject(new Error(`unexpected GET ${url}`));
});

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (url: string, config?: { params?: Record<string, unknown> }) => mockGet(url, config),
    post: jest.fn(),
  },
}));

beforeEach(() => {
  mockGet.mockClear();
  scenario = defaultScenario();
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <OrdersOutboundPage />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const requestedPaths = () => mockGet.mock.calls.map(([url]) => pathOf(url));
const outboundRequests = () =>
  mockGet.mock.calls.filter(([url]) => pathOf(url) === OUTBOUND).map(([url, config]) => toParams(url, config));

const findPrimary = () => screen.findByRole('region', { name: /shipped orders/i });
const findRail = () => screen.findByRole('region', { name: /shipping state/i });

/** Unavailable / unknown marker family — anything but a fabricated number. */
const UNKNOWN = /^(—|–|-|n\/?a|unavailable|unknown|not available|no data)$/i;
const ZERO = /^0(\.0+)?\s*%?$/;

/**
 * Value of a rail metric: text of the smallest ancestor of the label that
 * contains more than the label, minus the label. Null when the label is absent.
 */
function metricValue(rail: HTMLElement, label: RegExp): string | null {
  const labelEl = within(rail).queryAllByText(label)[0];
  if (!labelEl) return null;
  const labelText = (labelEl.textContent ?? '').trim();
  let node: HTMLElement = labelEl;
  while (node.parentElement && node !== rail) {
    const parentText = (node.parentElement.textContent ?? '').trim();
    if (parentText !== labelText) return parentText.replace(labelText, '').trim();
    node = node.parentElement;
  }
  return null;
}

const METRICS = {
  shipped: /^shipped orders$/i,
  withTracking: /^with tracking$/i,
  missingTracking: /^missing tracking$/i,
  coverage: /^tracking coverage$/i,
  avgTime: /^avg time to ship$/i,
  carrierSetup: /^carrier setup$/i,
};

async function expectRailSummary(expected: Summary) {
  const rail = await findRail();
  await waitFor(() => {
    expect(metricValue(rail, METRICS.shipped)).toMatch(new RegExp(`\\b${expected.shipped_count}\\b`));
    expect(metricValue(rail, METRICS.withTracking)).toMatch(new RegExp(`\\b${expected.with_tracking_count}\\b`));
    expect(metricValue(rail, METRICS.missingTracking)).toMatch(new RegExp(`\\b${expected.missing_tracking_count}\\b`));
    expect(metricValue(rail, METRICS.coverage)).toMatch(new RegExp(`\\b${expected.tracking_coverage_pct}(\\.0+)?\\s*%`));
  });
}

// No leading \b: textContent concatenates spans ("Carrier setupSet up →").
const SETUP_CTA = /set up\b|configure\b|connect\b/i;
const setupCtas = (rail: HTMLElement) =>
  [...within(rail).queryAllByRole('button'), ...within(rail).queryAllByRole('link')]
    .filter((el) => SETUP_CTA.test(el.textContent ?? '') || SETUP_CTA.test(el.getAttribute('aria-label') ?? ''));

/**
 * Text of one ledger row: the largest ancestor of the row's order id that
 * contains no other fixture id (so header, filters and other rows are excluded).
 */
async function rowText(id: string, allIds: string[]): Promise<string> {
  const primary = await findPrimary();
  const idEl = (await within(primary).findAllByText(new RegExp(id)))[0];
  const others = allIds.filter((other) => other !== id);
  let node: HTMLElement = idEl;
  while (node.parentElement && node.parentElement !== primary) {
    const text = node.parentElement.textContent ?? '';
    if (others.some((other) => text.includes(other))) break;
    node = node.parentElement;
  }
  return node.textContent ?? '';
}

async function clickControl(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const primary = await findPrimary();
  const byRole = [...new Set(['button', 'radio', 'tab'].flatMap((role) => within(primary).queryAllByRole(role, { name })))];
  // Pagination controls are not role-bearing; fall back to exact visible text.
  const matches = byRole.length > 0 ? byRole : within(primary).queryAllByText(name);
  if (matches.length !== 1) throw new Error(`Expected one control ${name}, found ${matches.length}`);
  await user.click(matches[0]);
}

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  const primary = await findPrimary();
  const input = within(primary).getByPlaceholderText(/search by order number, sku,? or customer/i);
  await user.clear(input);
  await user.type(input, term);
}

async function expectLastOutbound(expected: { state: string; period: string; q: string; page: number }) {
  await waitFor(() => {
    const params = outboundRequests().at(-1);
    expect(params).toBeDefined();
    expect({
      state: params!.get('state'),
      period: params!.get('period'),
      q: params!.get('q') ?? '',
      page: Number(params!.get('page')),
    }).toEqual(expected);
  }, { timeout: 2000 });
}

// ─── 1. LEGACY SIGNAL SAMPLE REMOVED ─────────────────────────────────────────

describe('OUTBOUND SLICE D — legacy signal sample', () => {
  it('issues no /api/v1/orders/fulfilled request', async () => {
    renderPage();
    await findRail();
    await waitFor(() => expect(requestedPaths()).toContain(OUTBOUND));
    await waitFor(() => expect(requestedPaths()).toContain(CARRIERS));

    expect(requestedPaths()).not.toContain(FULFILLED);
  });
});

// ─── 2. SHIPPING STATE FROM SUMMARY ──────────────────────────────────────────

describe('OUTBOUND SLICE D — Shipping State renders the outbound summary', () => {
  it('shows summary counts, coverage and avg time to ship; no Value shipped', async () => {
    renderPage();
    await expectRailSummary(SUMMARY_WEEK);

    const rail = await findRail();
    const avg = metricValue(rail, METRICS.avgTime);
    expect(avg).toMatch(/\d/);
    expect(avg).not.toMatch(UNKNOWN);
    expect(metricValue(rail, METRICS.carrierSetup)).not.toBeNull();
    // Multi-currency truth is unresolved: no single value-shipped aggregate.
    expect(within(rail).queryByText(/value shipped/i)).toBeNull();
  });
});

// ─── 3. SUMMARY SCOPE IS PERIOD-ONLY ─────────────────────────────────────────

describe('OUTBOUND SLICE D — summary scope', () => {
  it('state, search and page keep the period summary; period changes it; rows never recompute it', async () => {
    scenario.outbound = (params) => {
      const state = params.get('state') ?? 'all';
      const rows = [row(`SCOPE${state.replace(/_/g, '')}A`), row(`SCOPE${state.replace(/_/g, '')}B`)];
      return Promise.resolve(page(rows, params.get('period') === 'month' ? SUMMARY_MONTH : SUMMARY_WEEK, 500));
    };
    const user = renderPage();
    await expectRailSummary(SUMMARY_WEEK);

    await clickControl(user, /^needs action$/i);
    await expectLastOutbound({ state: 'needs_action', period: 'week', q: '', page: 1 });
    await expectRailSummary(SUMMARY_WEEK);

    await search(user, 'ADA');
    await expectLastOutbound({ state: 'needs_action', period: 'week', q: 'ADA', page: 1 });
    await expectRailSummary(SUMMARY_WEEK);

    await clickControl(user, /^next\b/i);
    await expectLastOutbound({ state: 'needs_action', period: 'week', q: 'ADA', page: 2 });
    await expectRailSummary(SUMMARY_WEEK);

    await clickControl(user, /^this month$/i);
    await expectLastOutbound({ state: 'needs_action', period: 'month', q: 'ADA', page: 1 });
    await expectRailSummary(SUMMARY_MONTH);
  });
});

// ─── SUMMARY NULL CONTRACT ───────────────────────────────────────────────────

describe('OUTBOUND SLICE D — summary null contract', () => {
  it('loading: unresolved summary is not rendered as numeric zero', async () => {
    scenario.outbound = () => pending();
    renderPage();
    const rail = await findRail();
    await waitFor(() => expect(requestedPaths()).toContain(OUTBOUND));

    for (const label of [METRICS.shipped, METRICS.withTracking, METRICS.missingTracking, METRICS.coverage, METRICS.avgTime]) {
      const value = metricValue(rail, label);
      if (value !== null) expect(value).not.toMatch(ZERO);
    }
  });

  it('error: summary shows unavailable, not zero', async () => {
    scenario.outbound = () => httpError(500);
    renderPage();
    const rail = await findRail();
    await waitFor(() => expect(requestedPaths()).toContain(OUTBOUND));

    await waitFor(() => {
      for (const label of [METRICS.shipped, METRICS.withTracking, METRICS.missingTracking, METRICS.coverage]) {
        expect(metricValue(rail, label) ?? '—').toMatch(UNKNOWN);
      }
    });
  });

  it('explicit zero summary: known 0 counts are distinct from unavailable coverage / time', async () => {
    scenario.outbound = () =>
      Promise.resolve(page([], SUMMARY_KNOWN_ZERO, 0));
    renderPage();
    const rail = await findRail();

    await waitFor(() => {
      expect(metricValue(rail, METRICS.shipped)).toMatch(ZERO);
      expect(metricValue(rail, METRICS.withTracking)).toMatch(ZERO);
      expect(metricValue(rail, METRICS.missingTracking)).toMatch(ZERO);
      expect(metricValue(rail, METRICS.coverage)).toMatch(UNKNOWN);
      expect(metricValue(rail, METRICS.avgTime)).toMatch(UNKNOWN);
    });
  });
});

// ─── 4. CARRIER SETUP TRUTH ──────────────────────────────────────────────────

describe('OUTBOUND SLICE D — carrier setup truth', () => {
  it('A loading: not "Not configured", no setup CTA', async () => {
    scenario.carriers = () => pending();
    renderPage();
    const rail = await findRail();
    await waitFor(() => expect(requestedPaths()).toContain(CARRIERS));

    expect(metricValue(rail, METRICS.carrierSetup) ?? '').not.toMatch(/not configured/i);
    expect(setupCtas(rail)).toHaveLength(0);
  });

  it('B error / 403: unavailable, no setup CTA', async () => {
    scenario.carriers = () => httpError(403);
    renderPage();
    const rail = await findRail();

    await waitFor(() => expect(metricValue(rail, METRICS.carrierSetup)).toMatch(UNKNOWN));
    expect(setupCtas(rail)).toHaveLength(0);
  });

  it('C only inactive settings: Not configured', async () => {
    scenario.carriers = () => Promise.resolve({ carriers: [{ carrier_code: 'sendcloud', is_active: false }] });
    renderPage();
    const rail = await findRail();

    await waitFor(() => expect(metricValue(rail, METRICS.carrierSetup)).toMatch(/not configured/i));
  });

  it('D at least one active setting: Ready, no setup CTA', async () => {
    scenario.carriers = () => Promise.resolve({
      carriers: [{ carrier_code: 'shippo', is_active: false }, { carrier_code: 'sendcloud', is_active: true }],
    });
    renderPage();
    const rail = await findRail();

    await waitFor(() => expect(metricValue(rail, METRICS.carrierSetup)).toMatch(/ready/i));
    expect(setupCtas(rail)).toHaveLength(0);
  });
});

// ─── 5–8. LEDGER ROW TRUTH ───────────────────────────────────────────────────

describe('OUTBOUND SLICE D — Tracking column', () => {
  it('Tracking replaces Proof; number present is available, null is missing; no "Confirmed" claim', async () => {
    const ids = ['TX01', 'TX02'];
    scenario.outbound = () => Promise.resolve(page([
      row('TX01', { tracking_number: 'TRK-REAL-1', latest_status: 'in_transit' }),
      row('TX02', { tracking_number: null, latest_status: null, is_stalled: null, carrier_provider: null }),
    ], SUMMARY_WEEK));
    renderPage();
    const primary = await findPrimary();

    expect(await within(primary).findByText(/^tracking$/i)).toBeInTheDocument();
    expect(within(primary).queryByText(/^proof$/i)).toBeNull();
    expect(within(primary).queryByText(/confirmed/i)).toBeNull();

    expect(await rowText('TX01', ids)).toMatch(/TRK-REAL-1|available/i);
    expect(await rowText('TX02', ids)).toMatch(/missing/i);
  });
});

describe('OUTBOUND SLICE D — Carrier column', () => {
  it('shows the physical carrier, never the label provider as carrier', async () => {
    const ids = ['CX01', 'CX02'];
    scenario.outbound = () => Promise.resolve(page([
      row('CX01', { carrier: 'usps', carrier_provider: 'shippo' }),
      row('CX02', { carrier: null, carrier_provider: 'sendcloud' }),
    ], SUMMARY_WEEK));
    renderPage();

    const usps = await rowText('CX01', ids);
    expect(usps).toMatch(/usps/i);
    expect(usps).not.toMatch(/shippo/i);

    const none = await rowText('CX02', ids);
    expect(none).not.toMatch(/sendcloud/i);
    expect(none).toMatch(/—|–|unknown/i);
  });
});

describe('OUTBOUND SLICE D — Live status', () => {
  it('keeps carrier states semantically distinct', async () => {
    const fixtures: Array<[string, Partial<Row>]> = [
      ['LS01', { latest_status: 'delivered' }],
      ['LS02', { latest_status: 'out_for_delivery' }],
      ['LS03', { latest_status: 'in_transit' }],
      ['LS04', { latest_status: 'announced' }],
      ['LS05', { latest_status: 'exception', is_stalled: true }],
      ['LS06', { latest_status: 'returned' }],
      ['LS07', { latest_status: 'unknown' }],
      ['LS08', { latest_status: null, latest_event_at: null }],
      ['LS09', { tracking_number: null, latest_status: null, latest_event_at: null, is_stalled: null, carrier_provider: null }],
    ];
    const ids = fixtures.map(([id]) => id);
    scenario.outbound = () => Promise.resolve(page(fixtures.map(([id, o]) => row(id, o)), SUMMARY_WEEK));
    renderPage();

    expect(await rowText('LS01', ids)).toMatch(/delivered/i);
    expect(await rowText('LS02', ids)).toMatch(/out for delivery/i);
    expect(await rowText('LS03', ids)).toMatch(/in transit/i);
    expect(await rowText('LS04', ids)).toMatch(/label created|announced|pre-transit|info received/i);

    const exception = await rowText('LS05', ids);
    expect(exception).toMatch(/exception/i);
    expect(exception).not.toMatch(/no update/i);

    expect(await rowText('LS06', ids)).toMatch(/return/i);
    expect(await rowText('LS07', ids)).toMatch(/unknown/i);

    const trackedNoStatus = await rowText('LS08', ids);
    expect(trackedNoStatus).not.toMatch(/delivered|in transit|out for delivery|exception|not sent/i);

    const untracked = await rowText('LS09', ids);
    expect(untracked).toMatch(/missing|no tracking/i);
    expect(untracked).not.toMatch(/not sent/i);
  });

  it('stalled in-flight states expose staleness without hiding or replacing the carrier state', async () => {
    const fixtures: Array<[string, string, RegExp]> = [
      ['SX01', 'in_transit', /in transit/i],
      ['SX02', 'out_for_delivery', /out for delivery/i],
      ['SX03', 'announced', /label created|announced|pre-transit|info received/i],
    ];
    const ids = fixtures.map(([id]) => id);
    scenario.outbound = () => Promise.resolve(page(
      fixtures.map(([id, status]) => row(id, { latest_status: status, is_stalled: true })),
      SUMMARY_WEEK
    ));
    renderPage();

    for (const [id, , state] of fixtures) {
      const text = await rowText(id, ids);
      expect(text).toMatch(state);
      expect(text).toMatch(/stale|stalled|no recent update|no update/i);
      expect(text).not.toMatch(/delivered|missing/i);
    }
  });
});

describe('OUTBOUND SLICE D — currency', () => {
  it('formats each row in its own currency', async () => {
    const ids = ['MX01', 'MX02'];
    scenario.outbound = () => Promise.resolve(page([
      row('MX01', { currency: 'EUR', total_price: '42.50' }),
      row('MX02', { currency: 'USD', total_price: '19.99' }),
    ], SUMMARY_WEEK));
    renderPage();

    const eur = await rowText('MX01', ids);
    expect(eur).toMatch(/€|EUR/);
    expect(eur).toMatch(/42[.,]50/);
    expect(eur).not.toMatch(/\$/);

    const usd = await rowText('MX02', ids);
    expect(usd).toMatch(/\$|USD/);
    expect(usd).toMatch(/19[.,]99/);
    expect(usd).not.toMatch(/€|EUR/);
  });
});

// ─── 9. ERROR / EMPTY ────────────────────────────────────────────────────────

describe('OUTBOUND SLICE D — error vs empty', () => {
  const NEVER_SHIPPED = /no shipped orders/i;
  const FILTERED_EMPTY = /no (shipped )?orders match|match(es)? (the |your |current )*filters|no matching/i;
  const LOAD_FAILURE = /fail|couldn.t load|could not load|unable to load|error/i;

  it('A request error: load failure, not an empty ledger', async () => {
    scenario.outbound = () => httpError(500);
    renderPage();
    const primary = await findPrimary();

    expect(await within(primary).findByText(LOAD_FAILURE)).toBeInTheDocument();
    expect(within(primary).queryByText(NEVER_SHIPPED)).toBeNull();
    expect(within(primary).queryByText(FILTERED_EMPTY)).toBeNull();
  });

  it('B unfiltered total=0: no shipped orders yet', async () => {
    scenario.outbound = () => Promise.resolve(page([], SUMMARY_KNOWN_ZERO, 0));
    const user = renderPage();
    await clickControl(user, /^all time$/i);
    await expectLastOutbound({ state: 'all', period: 'all', q: '', page: 1 });
    const primary = await findPrimary();

    expect(await within(primary).findByText(NEVER_SHIPPED)).toBeInTheDocument();
    expect(within(primary).queryByText(FILTERED_EMPTY)).toBeNull();
  });

  it('C filtered total=0: no rows match the current filters', async () => {
    scenario.outbound = (params) =>
      Promise.resolve(params.get('state') === 'needs_action'
        ? page([], SUMMARY_WEEK, 0)
        : page(DEFAULT_ROWS, SUMMARY_WEEK, 500));
    const user = renderPage();
    await clickControl(user, /^needs action$/i);
    await expectLastOutbound({ state: 'needs_action', period: 'week', q: '', page: 1 });
    const primary = await findPrimary();

    expect(await within(primary).findByText(FILTERED_EMPTY)).toBeInTheDocument();
    expect(within(primary).queryByText(NEVER_SHIPPED)).toBeNull();
  });
});

// ─── 10. REVIEW MISSING TRACKING ─────────────────────────────────────────────

describe('OUTBOUND SLICE D — Review missing tracking navigates the ledger', () => {
  it('sets state=missing_tracking, resets page, keeps period and search', async () => {
    const user = renderPage();
    await clickControl(user, /^this month$/i);
    await search(user, 'ADA');
    await clickControl(user, /^next\b/i);
    await expectLastOutbound({ state: 'all', period: 'month', q: 'ADA', page: 2 });

    const cta = await waitFor(() => {
      const found = [
        ...screen.queryAllByRole('button', { name: /review missing tracking/i }),
        ...screen.queryAllByRole('link', { name: /review missing tracking/i }),
      ];
      expect(found).toHaveLength(1);
      return found[0];
    });
    await user.click(cta);

    await expectLastOutbound({ state: 'missing_tracking', period: 'month', q: 'ADA', page: 1 });
  });
});
