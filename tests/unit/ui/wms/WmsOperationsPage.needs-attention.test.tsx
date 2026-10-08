/** WMS-OPS-NEEDS-ATTENTION-01 — Operations "Needs attention" strip. RED ONLY.
 * Needs attention is a bounded Owner/Admin projection of canonical Ops Console
 * NOW: real page, real useAlerts / React Query cache, real buildNowRows +
 * alertDeepLink, real ConfigContext reducer. Only transport, auth and WMS data
 * hooks are stubbed. Expected rows are computed from the canonical model, never
 * restated here. The existing Operations mount/inert contract stays owned by
 * WmsModuleFT2.operations-lifecycle-ia.test.tsx.
 */
import React, { useContext } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { ConfigContext, ConfigProvider } from 'contexts/ConfigContext';
import { axiosInstance } from 'api/axiosConfig';
import { normalizeAlertFilters, useAlerts, type Alert } from 'pages/alerts/useAlerts';
import { alertDeepLink } from 'pages/alerts/alertDeepLink';
import { buildNowRows } from '../../../../apps/frontend/src/components/OpsConsole/opsConsoleModel';

jest.mock('api/axiosConfig', () => ({ axiosInstance: {
  get: jest.fn(), post: jest.fn().mockResolvedValue({ data: {} }), patch: jest.fn().mockResolvedValue({ data: {} }),
} }));
// Real hook, observed: proves which inbox entry is read and with which options.
jest.mock('pages/alerts/useAlerts', () => {
  const actual = jest.requireActual('pages/alerts/useAlerts');
  return { ...actual, useAlerts: jest.fn((...args: unknown[]) => actual.useAlerts(...args)) };
});
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, role: mockRole } }) }));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({ useWms: () => mockWms }));
jest.mock('pages/wms/useReadyToPack', () => ({ useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGrid: () => ({ data: { locations: [] } }) }));
jest.mock('hooks/useSpotlight', () => ({ useSpotlight: () => ({ isDismissed: true, dismiss: jest.fn() }) }));
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: jest.requireActual('../../../../modules/wms/src/ui/pages/WmsModuleFT2').default,
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(), WmsConnectionBadge: () => null,
}));

let mockRole = 'owner';
const mockWms = {
  data: { batches: [] }, isLoading: false, isError: false, refetch: jest.fn(),
  stowTasks: [], settings: null, openReceiveJobs: [], recountTasks: [],
  recountLocked: false, recountTasksSettled: true, openingInventory: null,
  refetchOpeningInventory: jest.fn(),
};

// ── Canonical inbox fixture, in backend rank order ──
function alert(id: string, alert_type: string, title: string, extra: Partial<Alert> = {}): Alert {
  return {
    id, alert_key: `${alert_type}:${id}`, source: 'test', alert_type, severity: 'warning', title,
    message: '', entity_id: null, entity_type: null, revenue_impact: null, category: null,
    audience: 'all', is_active: true, dismissed_at: null, resolved_at: null, acknowledged_at: null,
    acknowledged_by: null, snoozed_until: null, escalated_at: null, rule_id: null,
    created_at: '2026-10-07T08:00:00Z', updated_at: '2026-10-07T08:00:00Z',
    treatment: null, action: null, ...extra,
  };
}
// Titles carry no digits and no CTA label text, so count/label assertions are unambiguous.
const INBOX: Alert[] = [
  alert('sla', 'sla_breach', 'Dispatch promise breached', { severity: 'critical' }),
  alert('stow-pending', 'wms_stow_pending', 'Stow work waiting'),
  alert('protect', 'stock_protection', 'Hero variant below floor', {
    treatment: 'protect',
    action: { key: 'protect', label: 'Protect stock', route: '/inventory/stock-protection?variantId=v-protect', module: 'inventory' },
  }),
  alert('released', 'wms_batch_released', 'Batch released to floor', { severity: 'info' }),
  alert('pick', 'wms_pick_exception', 'Pick short at bin', { severity: 'critical' }),
  alert('protect-null', 'stock_protection', 'Stock protection needs setup'),
  alert('stockout', 'stockout_risk', 'Stockout risk on bestseller', { entity_id: 'v-nine', entity_type: 'variant' }),
  alert('operational', 'operational', 'Operational summary'),
  alert('pack', 'wms_pack_exception', 'Pack mismatch at station'),
];
const META_TOTAL = 42; // deliberately != canonical NOW row count
const NOW_ROWS = buildNowRows(INBOX, alertDeepLink);
const NOW_TITLES = NOW_ROWS.map((row) => row.label);
const NON_NOW_TITLES = INBOX.map((a) => a.title).filter((t) => !NOW_TITLES.includes(t));
const VISIBLE_LIMIT = 3;

type InboxMode = { kind: 'ok'; alerts: Alert[]; total: number } | { kind: 'pending' } | { kind: 'error' };
const ALERTS_URL = /^\/api\/v1\/alerts\?/;
const HISTORY_URL = '/api/v1/operations/history';
// Canonical HISTORY V1 feed served to the page (GET /api/v1/operations/history).
let mockHistory: { items: unknown[] } = { items: [] };
function serveInbox(mode: InboxMode) {
  (axiosInstance.get as jest.Mock).mockImplementation((url: string) => {
    if (url === HISTORY_URL) return Promise.resolve({ data: mockHistory });
    if (!ALERTS_URL.test(url)) return Promise.resolve({ data: {} });
    if (mode.kind === 'pending') return new Promise(() => {});
    if (mode.kind === 'error') return Promise.reject(new Error('alerts unavailable'));
    return Promise.resolve({ data: { data: mode.alerts, meta: { total: mode.total, status: 'inbox' } } });
  });
}
function inboxGets() {
  return (axiosInstance.get as jest.Mock).mock.calls.filter(([url]) => ALERTS_URL.test(url));
}

let lastLocation = '';
function LocationProbe() { const l = useLocation(); lastLocation = `${l.pathname}${l.search}`; return null; }
function ConsoleProbe() {
  const { state } = useContext(ConfigContext);
  return <output aria-label="console state">{state.isOpsConsoleOpen ? 'open' : 'closed'}</output>;
}
function consoleState() { return screen.getByRole('status', { name: 'console state', hidden: true }).textContent; }

function renderOperations(role: 'owner' | 'admin' | 'operator', mode: InboxMode) {
  mockRole = role;
  serveInbox(mode);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/wms']}>
        <ConfigProvider>
          <ConsoleProbe />
          <LocationProbe />
          <WmsOperationsPage />
        </ConfigProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const LIVE: InboxMode = { kind: 'ok', alerts: INBOX, total: META_TOTAL };

function queryStrip() { return screen.queryByRole('region', { name: /needs attention/i }); }
async function findStrip() { return screen.findByRole('region', { name: /needs attention/i }); }
async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
function titlesInDomOrder(root: HTMLElement, titles: string[]) {
  return titles
    .map((t) => ({ t, node: within(root).queryByText(t) }))
    .filter((x): x is { t: string; node: HTMLElement } => x.node !== null)
    .sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((x) => x.t);
}
function actionNamed(root: HTMLElement, label: string) {
  const name = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const [match] = [...within(root).queryAllByRole('link', { name }), ...within(root).queryAllByRole('button', { name })];
  if (!match) throw new Error(`No row action named "${label}" in Needs attention`);
  return match;
}
// Alert-scoped claims only: the pre-existing WMS work-count header copy
// ("All clear — nothing waiting.", isAllClear(workCounts)) is not an alert claim.
function assertNoFalseAllClear() {
  expect(queryStrip()).toBeNull();
  expect(screen.queryByText(/nothing needs (your )?attention|no (open )?alerts|needs attention/i)).toBeNull();
}

beforeEach(() => {
  jest.clearAllMocks();
  focusManager.setFocused(true);
  lastLocation = '';
});
afterEach(() => { jest.useRealTimers(); });

describe('fixture sanity — canonical NOW projection of the inbox fixture', () => {
  it('real buildNowRows yields more than the visible limit, excludes WMS progression and null-action rows, and differs from meta.total', () => {
    expect(NOW_TITLES).toEqual([
      'Dispatch promise breached', 'Hero variant below floor', 'Pick short at bin',
      'Stockout risk on bestseller', 'Pack mismatch at station',
    ]);
    expect(NOW_ROWS.length).toBeGreaterThan(VISIBLE_LIMIT);
    expect(NOW_ROWS.length).not.toBe(META_TOTAL);
  });
});

describe('1 — passive canonical inbox reader', () => {
  it('reads the canonical inbox entry without owning poll:true and schedules no recurring refetch', async () => {
    jest.useFakeTimers();
    renderOperations('owner', LIVE);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });

    const calls = (useAlerts as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [filters, options] of calls) {
      expect(normalizeAlertFilters(filters)).toEqual({ status: 'inbox' });
      expect(options?.poll ?? false).toBe(false);
    }
    const initial = inboxGets().length;
    expect(initial).toBe(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(95_000); });
    expect(inboxGets().length).toBe(initial);
  });
});

describe('2–4 — NOW eligibility, canonical order, bounded rows', () => {
  it('shows exactly the first three canonical NOW rows in backend order; excluded and overflow alerts are absent', async () => {
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    const visible = NOW_TITLES.slice(0, VISIBLE_LIMIT);
    expect(titlesInDomOrder(strip, [...NOW_TITLES, ...NON_NOW_TITLES])).toEqual(visible);
  });
});

describe('5 — header count is the full canonical actionable NOW count', () => {
  it('counts every canonical NOW row, not the visible rows and not alerts meta.total', async () => {
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    const text = strip.textContent ?? '';
    expect(text).toMatch(new RegExp(`(^|\\D)${NOW_ROWS.length}(\\D|$)`));
    expect(text).not.toMatch(new RegExp(`(^|\\D)${META_TOTAL}(\\D|$)`));
  });
});

describe('6–8 — strip absence never asserts a false all-clear', () => {
  it('successful inbox with zero actionable NOW rows => strip absent', async () => {
    const nonActionable = INBOX.filter((a) => NON_NOW_TITLES.includes(a.title));
    expect(buildNowRows(nonActionable, alertDeepLink)).toHaveLength(0);
    renderOperations('owner', { kind: 'ok', alerts: nonActionable, total: nonActionable.length });
    await waitFor(() => expect(inboxGets().length).toBeGreaterThan(0));
    await settle();
    expect(queryStrip()).toBeNull();
  });

  it('loading inbox => strip absent and no all-clear/zero claim', async () => {
    renderOperations('owner', { kind: 'pending' });
    await settle();
    assertNoFalseAllClear();
  });

  it('failed inbox => strip absent and no all-clear/zero claim', async () => {
    renderOperations('owner', { kind: 'error' });
    await settle();
    await settle();
    assertNoFalseAllClear();
  });

  it('operator has no Needs attention strip even with actionable NOW rows', async () => {
    renderOperations('operator', LIVE);
    await settle();
    await settle();
    expect(queryStrip()).toBeNull();
    for (const title of NOW_TITLES) expect(screen.queryByText(title)).toBeNull();
  });
});

describe('9 — row action uses the canonical NOW route', () => {
  it.each(NOW_ROWS.slice(0, 2).map((row) => [row.label, row.action]))(
    '%s navigates to its canonical action route',
    async (_title, action) => {
      if (!action || action.kind !== 'navigate') throw new Error('fixture row lacks a navigate action');
      renderOperations('owner', LIVE);
      const strip = await findStrip();
      fireEvent.click(actionNamed(strip, action.label));
      expect(lastLocation).toBe(action.route);
    },
  );
});

describe('10 — no local alert lifecycle state or controls', () => {
  // PARITY-03: History is explicitly allowed as the single read-only historical
  // action; only lifecycle/mutation controls are forbidden here.
  it('strip offers no acknowledge/snooze/resolve/dismiss lifecycle controls and writes no alert mutation', async () => {
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    const lifecycle = /acknowledge|\back\b|snooze|resolve|dismiss/i;
    expect(within(strip).queryAllByRole('button', { name: lifecycle })).toHaveLength(0);
    expect(within(strip).queryAllByRole('link', { name: lifecycle })).toHaveLength(0);
    for (const button of within(strip).queryAllByRole('button')) fireEvent.click(button);
    const alertWrites = (axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => /\/api\/v1\/alerts\//.test(url));
    expect(alertWrites).toHaveLength(0);
  });
});

describe('8/12 — Owner/Admin strip coexists with the existing Operations surface', () => {
  it.each(['owner', 'admin'] as const)('%s sees Needs attention while Quick Scan remains mounted', async (role) => {
    renderOperations(role, LIVE);
    await findStrip();
    expect(screen.getByPlaceholderText(/scan an item or invoice barcode/i)).toBeInTheDocument();
  });
});

// ── WMS-OPS-PARITY-03 — Needs attention trailing action: History ─────────────
// Supersedes "Open console →". History is the canonical HISTORY V1 feed
// (useHistory → GET /api/v1/operations/history), opened in place as a dialog;
// it never opens Ops Console, never polls and is not derived from alerts.
// Treatments are V1-allowlisted values (buildHistoryRows keeps only these).

function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    interventionId: 'history-1',
    treatment: 'address_correction',
    lasyncroOrderId: 'LSO-HISTORY-1',
    externalOrderId: '#1001',
    constraintId: 'constraint-1',
    constraintType: null,
    blockType: null,
    occurredAt: '2026-10-07T10:00:00Z',
    resolvedAt: '2026-10-07T11:00:00Z',
    outcome: 'verified_resolved',
    presentation: { title: 'Address correction verified', subtitle: 'Order #1001', actionLabel: 'View order' },
    routing: { kind: 'order_entity', lasyncroOrderId: 'LSO-HISTORY-1' },
    ...overrides,
  };
}
// Backend order (older resolvedAt FIRST) — a local newest-first re-sort would invert it.
const HISTORY_ITEMS = [
  historyItem(),
  historyItem({
    interventionId: 'history-2', treatment: 'inventory_reorder_intent', lasyncroOrderId: 'LSO-HISTORY-2',
    externalOrderId: '#1002', constraintId: 'constraint-2', resolvedAt: '2026-10-07T12:00:00Z',
    presentation: { title: 'Reorder intent verified', subtitle: 'Order #1002', actionLabel: 'View order' },
    routing: { kind: 'order_entity', lasyncroOrderId: 'LSO-HISTORY-2' },
  }),
];
const historyGets = () => (axiosInstance.get as jest.Mock).mock.calls.filter(([url]) => url === HISTORY_URL);
const controlsNamed = (root: HTMLElement, name: RegExp) =>
  [...within(root).queryAllByRole('button', { name }), ...within(root).queryAllByRole('link', { name })];

describe('PARITY-03 — Needs attention trailing action is canonical History', () => {
  beforeEach(() => { mockHistory = { items: HISTORY_ITEMS }; });

  it('Needs attention trailing action opens canonical History without opening Ops Console', async () => {
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    expect(controlsNamed(strip, /open console/i)).toHaveLength(0);
    const history = controlsNamed(strip, /^history$/i);
    expect(history).toHaveLength(1);
    expect(historyGets()).toHaveLength(0);
    expect(consoleState()).toBe('closed');

    fireEvent.click(history[0]);

    const dialog = await screen.findByRole('dialog', { name: /^history$/i });
    await waitFor(() => expect(historyGets().length).toBeGreaterThan(0));
    const first = await within(dialog).findByText('Address correction verified');
    const second = within(dialog).getByText('Reorder intent verified');
    expect(within(dialog).getByText('Order #1001')).toBeInTheDocument();
    expect(within(dialog).getByText('Order #1002')).toBeInTheDocument();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // WMS-OPS-MODAL-PARITY-01 — History uses the canonical EntityDetailModal
    // anatomy: separated read-only rows and the shell's top-right icon close,
    // not a raw Dialog footer with a textual Close action.
    const historyList = within(dialog).getByRole('list');
    const historyItems = within(historyList).getAllByRole('listitem');
    expect(historyItems).toHaveLength(HISTORY_ITEMS.length);
    for (const item of historyItems) {
      expect(item).toHaveAttribute('data-surface', 'raised');
    }
    expect(within(dialog).getByRole('button', { name: /^close$/i })).toHaveTextContent('');

    // Not SET_OPS_CONSOLE: the shared ConfigContext console state never opens.
    expect(consoleState()).toBe('closed');
    expect((axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => /\/api\/v1\/alerts\//.test(url))).toHaveLength(0);
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('empty canonical History renders the canonical empty state', async () => {
    mockHistory = { items: [] };
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    const history = controlsNamed(strip, /^history$/i);
    expect(history).toHaveLength(1);
    fireEvent.click(history[0]);
    const dialog = await screen.findByRole('dialog', { name: /^history$/i });
    expect(await within(dialog).findByText('Nothing verified resolved yet.')).toBeInTheDocument();
    expect(consoleState()).toBe('closed');
  });
});

// ── PARITY-05 — Needs attention overflow → full Needs attention modal (RED) ──
// The rail shows at most VISIBLE_LIMIT canonical NOW rows. When the canonical
// NOW count exceeds it, "{n} more" (n = NOW count − limit, never meta.total)
// sits between the last inline row and History and opens a read-only modal of
// ALL canonical NOW rows from the page's existing projection (no second reader).

const OVERFLOW = NOW_ROWS.length - VISIBLE_LIMIT;
const MORE_NAME = /^\d+ more$/i;
const moreControls = (root: HTMLElement) => controlsNamed(root, MORE_NAME);
const nowFixture = (count: number): InboxMode => {
  const keep = NOW_TITLES.slice(0, count);
  const alerts = INBOX.filter((a) => keep.includes(a.title) || NON_NOW_TITLES.includes(a.title));
  expect(buildNowRows(alerts, alertDeepLink).map((row) => row.label)).toEqual(keep);
  return { kind: 'ok', alerts, total: META_TOTAL };
};
const follows = (first: Node, second: Node) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
async function openFullNeedsAttention() {
  const strip = await findStrip();
  const [more] = controlsNamed(strip, new RegExp(`^${OVERFLOW} more$`, 'i'));
  if (!more) throw new Error(`No "${OVERFLOW} more" control in Needs attention`);
  fireEvent.click(more);
  return screen.findByRole('dialog', { name: /^needs attention$/i });
}

describe('PARITY-05 — Needs attention overflow control', () => {
  it('canonical NOW count > 3: header count, three inline rows, one "{n} more" between the third row and History', async () => {
    expect(OVERFLOW).toBe(2);
    renderOperations('owner', LIVE);
    const strip = await findStrip();
    expect(strip.textContent ?? '').toMatch(new RegExp(`(^|\\D)${NOW_ROWS.length}(\\D|$)`));
    expect(titlesInDomOrder(strip, NOW_TITLES)).toEqual(NOW_TITLES.slice(0, VISIBLE_LIMIT));

    const more = moreControls(strip);
    expect(more).toHaveLength(1);
    expect(more[0]).toHaveAccessibleName(`${OVERFLOW} more`);
    expect(more[0]).toHaveAttribute('data-emphasis', 'secondary');
    const third = within(strip).getByText(NOW_TITLES[VISIBLE_LIMIT - 1]);
    const [history] = controlsNamed(strip, /^history$/i);
    expect(follows(third, more[0])).toBe(true);
    expect(follows(more[0], history)).toBe(true);
  });

  it.each([3, 2])('exactly %i canonical NOW rows: no "more" control', async (count) => {
    renderOperations('owner', nowFixture(count));
    const strip = await findStrip();
    expect(titlesInDomOrder(strip, NOW_TITLES)).toEqual(NOW_TITLES.slice(0, count));
    expect(moreControls(strip)).toHaveLength(0);
    expect(within(strip).queryByText(/\d+ more/i)).toBeNull();
  });
});

describe('PARITY-05 — full Needs attention modal', () => {
  beforeEach(() => { mockHistory = { items: HISTORY_ITEMS }; });

  it('lists ALL canonical NOW rows in backend order as a read-only list, without History items', async () => {
    renderOperations('owner', LIVE);
    const dialog = await openFullNeedsAttention();
    expect(titlesInDomOrder(dialog, [...NOW_TITLES, ...NON_NOW_TITLES])).toEqual(NOW_TITLES);
    const list = within(dialog).getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(NOW_ROWS.length);

    // WMS-OPS-MODAL-PARITY-01 — repeated tasks are visually independent
    // surfaces, never an undifferentiated stack of text/action rows.
    for (const item of items) {
      expect(item).toHaveAttribute('data-surface', 'raised');
    }

    expect(within(dialog).queryByText('Address correction verified')).toBeNull();
    expect(within(dialog).queryByText('Reorder intent verified')).toBeNull();
    const lifecycle = /acknowledge|\back\b|snooze|resolve|dismiss/i;
    expect(controlsNamed(dialog, lifecycle)).toHaveLength(0);
  });

  it('reuses the page-owned canonical NOW projection: opening the modal causes no additional inbox GET', async () => {
    renderOperations('owner', LIVE);
    await findStrip();
    const before = inboxGets().length;
    const dialog = await openFullNeedsAttention();
    await settle();
    await settle();
    expect(within(dialog).getByText(NOW_TITLES[NOW_TITLES.length - 1])).toBeInTheDocument();
    expect(inboxGets().length).toBe(before);
  });

  it.each([0, NOW_ROWS.length - 1].map((i) => [NOW_ROWS[i].label, NOW_ROWS[i].action]))(
    'modal row "%s" uses its canonical buildNowRows action label and route',
    async (_title, action) => {
      if (!action || action.kind !== 'navigate') throw new Error('fixture row lacks a navigate action');
      renderOperations('owner', LIVE);
      const dialog = await openFullNeedsAttention();
      fireEvent.click(actionNamed(dialog, action.label));
      expect(lastLocation).toBe(action.route);
    },
  );

  it('opening and closing has no side effects: no Ops Console, no History, no alert lifecycle writes', async () => {
    renderOperations('owner', LIVE);
    const dialog = await openFullNeedsAttention();
    expect(consoleState()).toBe('closed');
    expect(screen.queryByRole('dialog', { name: /^history$/i })).toBeNull();
    expect(historyGets()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^needs attention$/i })).toBeNull());
    expect(consoleState()).toBe('closed');
    expect(screen.queryByRole('dialog', { name: /^history$/i })).toBeNull();
    expect(historyGets()).toHaveLength(0);
    expect((axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => /\/api\/v1\/alerts\//.test(url))).toHaveLength(0);
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('standard entity-modal close: Escape dismisses the Needs attention dialog', async () => {
    renderOperations('owner', LIVE);
    const dialog = await openFullNeedsAttention();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^needs attention$/i })).toBeNull());
    expect(consoleState()).toBe('closed');
  });
});
