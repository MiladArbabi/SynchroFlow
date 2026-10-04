// tests/unit/ui/orders/OrdersOutboundPage.filter-model.test.tsx
//
// OUTBOUND SLICE C RED — frontend filter / query model.
//
// The Shipped Orders ledger is a server-owned working set read from
// GET /api/v1/orders/outbound (Slice B). State and period are independent
// dimensions, search (q) intersects both, and the server owns filtering,
// pagination and sorting. Defaults: state=all, period=week, q=''.
//
// Protected here: the request model (endpoint, params, query-key prefix) and
// filter interaction semantics. Deliberately NOT protected: chip counts,
// Shipping State rail metrics (Slice D), row status wording (Slice D),
// styling, DOM order or geometry.
//
// Request capture is transport-agnostic: params are read from the URL query
// string AND from an axios `params` config, so either request style passes.
//
// Mocks mirror OrdersOutboundPage.ops-console-wiring.test.tsx.

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

// ─── REQUEST BOUNDARY ────────────────────────────────────────────────────────

const OUTBOUND = '/api/v1/orders/outbound';
const FULFILLED = '/api/v1/orders/fulfilled';

/** Large enough that a page 2 and 3 exist for any plausible page size. */
const SERVER_TOTAL = 500;

/** Present only in the legacy /fulfilled sample. Untracked, so the legacy
 *  client-side Needs-action rule would select it. */
const LEGACY_SAMPLE_ROW_ID = 'LEGACYSAMPLEUNTRACKED';

function toParams(url: string, config?: { params?: Record<string, unknown> }): URLSearchParams {
  const [, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(config?.params ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return params;
}

const pathOf = (url: string) => url.split('?')[0];

/** Row identities are derived from the request so every rendered row proves
 *  which server working set it came from. Row 0 is untracked; row 1 is tracked,
 *  not stalled, with no carrier status (the legacy rule would drop it). */
function outboundRowId(params: URLSearchParams, i: number): string {
  const q = (params.get('q') ?? '').replace(/[^A-Za-z0-9]/g, '') || 'none';
  return `OB${params.get('state')}${params.get('period')}${q}P${params.get('page')}R${i}`.replace(/_/g, '');
}

function outboundResponse(params: URLSearchParams) {
  const limit = Number(params.get('limit')) || 10;
  const page = Number(params.get('page')) || 1;
  const orders = [0, 1].map((i) => ({
    lasyncro_order_id: `00000000-0000-4000-8000-00000000000${i}`,
    external_order_id: outboundRowId(params, i),
    shipped_at: '2026-10-01T10:00:00.000Z',
    total_price: '42.00',
    currency: 'USD',
    tracking_number: i === 0 ? null : `TRK-${i}`,
    carrier: null,
    carrier_provider: i === 0 ? null : 'sendcloud',
    latest_status: null,
    latest_event_at: null,
    is_stalled: i === 0 ? null : false,
  }));
  return {
    orders,
    total: SERVER_TOTAL,
    page,
    limit,
    state: params.get('state'),
    period: params.get('period'),
    summary: {
      shipped_count: SERVER_TOTAL,
      with_tracking_count: SERVER_TOTAL - 1,
      missing_tracking_count: 1,
      tracking_coverage_pct: 99.8,
      avg_time_to_ship_hours: 12,
    },
  };
}

/** Legacy shape kept so the current page renders and the RED fails on the
 *  request model, not on a missing mock. */
function fulfilledResponse() {
  return {
    orders: [{
      lasyncro_order_id: '00000000-0000-4000-8000-0000000000ff',
      external_order_id: LEGACY_SAMPLE_ROW_ID,
      total_price: '42.00',
      order_created_at: '2026-09-01T10:00:00.000Z',
      fulfilled_at: '2026-09-02T10:00:00.000Z',
      hours_to_fulfil: '24.0',
      tracking_number: null,
      tracking_url: null,
      carrier_code: null,
      latest_status: null,
      latest_location: null,
      latest_event_at: null,
      is_stalled: false,
    }],
    total: SERVER_TOTAL,
    page: 1,
    limit: 10,
  };
}

const mockGet = jest.fn((url: string, config?: { params?: Record<string, unknown> }) => {
  const path = pathOf(url);
  if (path === OUTBOUND) return Promise.resolve({ data: outboundResponse(toParams(url, config)) });
  if (path === FULFILLED) return Promise.resolve({ data: fulfilledResponse() });
  if (path === '/api/v1/wms/carrier-settings') return Promise.resolve({ data: { carriers: [] } });
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
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <OrdersOutboundPage />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const outboundRequests = (): URLSearchParams[] =>
  mockGet.mock.calls
    .filter(([url]) => pathOf(url) === OUTBOUND)
    .map(([url, config]) => toParams(url, config));

const lastOutbound = (): URLSearchParams | undefined => outboundRequests().at(-1);

type Expected = { state: string; period: string; q: string; page: number };

/** Waits until the most recent ledger request carries exactly this filter model. */
async function expectLedgerRequest(expected: Expected) {
  await waitFor(
    () => {
      const params = lastOutbound();
      expect(params).toBeDefined();
      expect({
        state: params!.get('state'),
        period: params!.get('period'),
        q: params!.get('q') ?? '',
        page: Number(params!.get('page')),
      }).toEqual(expected);
    },
    // Tolerates a search debounce; not a hang mask.
    { timeout: 2000 }
  );
}

const SEARCH_LABEL = /search by order number, sku,? (or|and) customer/i;
const CONTROL_ROLES = ['button', 'radio', 'tab', 'option', 'checkbox', 'menuitemradio'] as const;

const findPrimary = () => screen.findByRole('region', { name: /shipped orders/i });

/** Clicks the single filter / pagination control with this exact visible name,
 *  scoped to the Shipped Orders primary (the rail also says "Missing tracking"). */
async function clickControl(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const primary = await findPrimary();
  const byRole = [...new Set(CONTROL_ROLES.flatMap((role) => within(primary).queryAllByRole(role, { name })))];
  const matches = byRole.length > 0 ? byRole : within(primary).queryAllByText(name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one control named ${name} in Shipped orders, found ${matches.length}`);
  }
  await user.click(matches[0]);
}

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  const primary = await findPrimary();
  const input =
    within(primary).queryByRole('searchbox', { name: SEARCH_LABEL }) ??
    within(primary).queryByRole('textbox', { name: SEARCH_LABEL }) ??
    within(primary).queryByPlaceholderText(SEARCH_LABEL);
  if (!input) throw new Error('Missing Outbound search input ("Search by order number, SKU, or customer")');
  await user.clear(input);
  await user.type(input, term);
}

const STATE = {
  all: /^all$/i,
  needs_action: /^needs action$/i,
  missing_tracking: /^missing tracking$/i,
  in_transit: /^in transit$/i,
  delivered: /^delivered$/i,
};
const PERIOD = {
  week: /^this week$/i,
  month: /^this month$/i,
  all: /^all time$/i,
};
const NEXT_PAGE = /^next\b/i;

// ─── R1 — DEFAULT ────────────────────────────────────────────────────────────

describe('OUTBOUND SLICE C R1 — default filter model', () => {
  it('requests state=all, period=week, empty q, page=1, canonical shipped_at sort', async () => {
    renderPage();

    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    const params = lastOutbound()!;
    expect(Number(params.get('limit'))).toBeGreaterThan(0);
    expect(params.get('sort')).toBe('shipped_at');
    expect(['asc', 'desc']).toContain(params.get('dir'));
  });
});

// ─── R2 — STATE PRESERVES PERIOD ─────────────────────────────────────────────

describe('OUTBOUND SLICE C R2 — state is independent of period', () => {
  it('selecting a state keeps the current period', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, STATE.needs_action);
    await expectLedgerRequest({ state: 'needs_action', period: 'week', q: '', page: 1 });

    await clickControl(user, PERIOD.month);
    await clickControl(user, STATE.in_transit);
    await expectLedgerRequest({ state: 'in_transit', period: 'month', q: '', page: 1 });

    await clickControl(user, STATE.missing_tracking);
    await expectLedgerRequest({ state: 'missing_tracking', period: 'month', q: '', page: 1 });
  });
});

// ─── R3 — PERIOD PRESERVES STATE ─────────────────────────────────────────────

describe('OUTBOUND SLICE C R3 — period is independent of state', () => {
  it('selecting a period keeps the current state', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, STATE.needs_action);
    await clickControl(user, PERIOD.month);
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: '', page: 1 });

    await clickControl(user, PERIOD.all);
    await expectLedgerRequest({ state: 'needs_action', period: 'all', q: '', page: 1 });
  });
});

// ─── R4 — SEARCH COMBINES WITH BOTH ──────────────────────────────────────────

describe('OUTBOUND SLICE C R4 — search intersects state and period', () => {
  it('q joins the current state and period, and later state/period changes keep q', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, STATE.needs_action);
    await clickControl(user, PERIOD.month);
    await search(user, 'ADA-1001');
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: 1 });

    // E — another state clears neither period nor search.
    await clickControl(user, STATE.delivered);
    await expectLedgerRequest({ state: 'delivered', period: 'month', q: 'ADA-1001', page: 1 });

    await clickControl(user, PERIOD.week);
    await expectLedgerRequest({ state: 'delivered', period: 'week', q: 'ADA-1001', page: 1 });
  });
});

// ─── R5 — FILTER / SEARCH CHANGES RESET PAGE ─────────────────────────────────

describe('OUTBOUND SLICE C R5 — state, period and search changes reset page to 1', () => {
  it('returns to page 1 from page 2 on each working-set change', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, NEXT_PAGE);
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 2 });
    await clickControl(user, STATE.needs_action);
    await expectLedgerRequest({ state: 'needs_action', period: 'week', q: '', page: 1 });

    await clickControl(user, NEXT_PAGE);
    await expectLedgerRequest({ state: 'needs_action', period: 'week', q: '', page: 2 });
    await clickControl(user, PERIOD.month);
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: '', page: 1 });

    await clickControl(user, NEXT_PAGE);
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: '', page: 2 });
    await search(user, 'ADA-1001');
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: 1 });
  });
});

// ─── R6 — PAGE CHANGE PRESERVES FILTERS ──────────────────────────────────────

describe('OUTBOUND SLICE C R6 — server pagination keeps state, period and q', () => {
  it('moving between pages requests the next server page with the same filter model', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, STATE.needs_action);
    await clickControl(user, PERIOD.month);
    await search(user, 'ADA-1001');
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: 1 });

    await clickControl(user, NEXT_PAGE);
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: 2 });

    await clickControl(user, NEXT_PAGE);
    await expectLedgerRequest({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: 3 });

    // Rows on screen are the server's page 3, not a client slice.
    const primary = await findPrimary();
    const p3 = new URLSearchParams({ state: 'needs_action', period: 'month', q: 'ADA-1001', page: '3' });
    expect(await within(primary).findByText(new RegExp(outboundRowId(p3, 0)))).toBeInTheDocument();
  });
});

// ─── R7 — LEDGER ENDPOINT ────────────────────────────────────────────────────

describe('OUTBOUND SLICE C R7 — the ledger reads GET /api/v1/orders/outbound', () => {
  it('renders server rows from /orders/outbound under an Outbound-specific query key', async () => {
    renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    const primary = await findPrimary();
    const first = new URLSearchParams({ state: 'all', period: 'week', q: '', page: '1' });
    expect(await within(primary).findByText(new RegExp(outboundRowId(first, 0)))).toBeInTheDocument();
    expect(await within(primary).findByText(new RegExp(outboundRowId(first, 1)))).toBeInTheDocument();

    expect(queryClient.getQueryCache().findAll({ queryKey: ['orders', 'outbound'] }).length).toBeGreaterThan(0);
  });
});

// ─── R8 — NO CLIENT-DERIVED NEEDS-ACTION SAMPLE ──────────────────────────────

describe('OUTBOUND SLICE C R8 — Needs action is the server working set, not a client sample', () => {
  it('renders exactly the server needs_action rows, including ones the legacy rule would drop', async () => {
    const user = renderPage();
    await expectLedgerRequest({ state: 'all', period: 'week', q: '', page: 1 });

    await clickControl(user, STATE.needs_action);
    await expectLedgerRequest({ state: 'needs_action', period: 'week', q: '', page: 1 });

    const primary = await findPrimary();
    const p1 = new URLSearchParams({ state: 'needs_action', period: 'week', q: '', page: '1' });
    // Row 1 is tracked and not stalled: the legacy rule
    // (!tracking_number || hours_to_fulfil > 72) would hide it.
    expect(await within(primary).findByText(new RegExp(outboundRowId(p1, 0)))).toBeInTheDocument();
    expect(await within(primary).findByText(new RegExp(outboundRowId(p1, 1)))).toBeInTheDocument();
    // The legacy 100-row sample row must never become a ledger row.
    expect(within(primary).queryByText(new RegExp(LEGACY_SAMPLE_ROW_ID))).toBeNull();
  });
});
