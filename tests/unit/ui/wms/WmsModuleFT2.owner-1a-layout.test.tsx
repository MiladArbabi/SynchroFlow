/** WMS-OPS-OWNER-1A-ALIGNMENT — Owner/Admin 1a "Pipeline board" composition. RED ONLY.
 * Real page + module + config reducer + React Query; only data/provider
 * boundaries are stubbed (same set as WmsModuleFT2.operations-lifecycle-ia).
 * Protects semantic/DOM structure, never pixels: jsdom cannot certify the
 * 1440×900 scroll-free intent, only the structure it depends on. Stage grain,
 * previews, Pick/Pack entry, Quick Scan authority and Console inert behaviour
 * stay owned by the lifecycle-IA suite.
 */
import React, { type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { ConfigProvider } from 'contexts/ConfigContext';
import { axiosInstance } from 'api/axiosConfig';

jest.mock('api/axiosConfig', () => ({ axiosInstance: {
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  patch: jest.fn().mockResolvedValue({ data: {} }),
} }));
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, role: mockRole } }) }));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({ useWms: () => mockWms }));
jest.mock('pages/wms/useReadyToPack', () => ({ useReadyToPack: () => mockReadyToPack }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGrid: () => ({ data: { locations: [] } }) }));
jest.mock('hooks/useSpotlight', () => ({ useSpotlight: () => ({ isDismissed: true, dismiss: jest.fn() }) }));
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: jest.requireActual('../../../../modules/wms/src/ui/pages/WmsModuleFT2').default,
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(), WmsConnectionBadge: () => null,
}));

let mockRole = 'owner';
let mockWms: Record<string, unknown> = {};
let mockReadyToPack: { data: { orders: unknown[]; orderCount: number } } = { data: { orders: [], orderCount: 0 } };

// ── Fixture: counts chosen so lifecycle work cannot be confused with units,
// orders, Ship or inventory-check work ──
const id = (prefix: string) => `${prefix.padEnd(8, '0')}-0000-4000-8000-000000000000`;
function batch(prefix: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    pick_batch_id: id(prefix), status, total_line_items: 2, total_units: 5,
    units_picked: 0, units_packed: 0, picked_by: null, packed_by: null,
    released_at: '2026-10-05T10:00:00.000Z', ...extra,
  };
}
const READY = batch('ready1a', 'pick_complete', { units_picked: 5 });
const readyOrders = ['o1', 'o2', 'o3'].map((o, i) => ({
  pick_batch_id: READY.pick_batch_id, lasyncro_order_id: `order-${o}`, external_order_id: `R-${i}`,
  wms_barcode: `LSO-R${i}`, line_items: [],
}));
const receiveJob = (jobId: string, assignee: number) => ({
  receive_job_id: jobId, status: 'pending', assigned_operator_id: assignee, started_at: null,
  closed_at: null, supplier_name: `Supplier ${jobId}`, po_id: `po-${jobId}`, po_number: 7701,
  total_units: 4, total_variants: 1,
});
const countTask = (i: number) => ({
  recount_task_id: `oa-count-${i}`, label: `Owner count ${i}`, status: 'dispatched', purpose: 'cycle_count',
  scope: 'location', blind: true, assigned_to: 3, claimed_by: null, created_at: '2026-10-05T10:00:00Z',
  claimed_at: null, line_count: 1, counted_count: 0,
});

// Receive 2 jobs · Put away 0 · Pick 3 batches · Pack 2 contexts (one ready batch
// of 3 orders + one packing) · pack_complete has no home · Ship structural.
const EXPECTED_TOTAL = 7;
const EXPECTED_ACTIVE_STAGES = 3;
const OPEN_COUNT_TASKS = 4;
// Wrong grains that must NOT appear as the summary total:
//   +count tasks = 11 · ready orders instead of contexts = 9 · Put away/Ship counted as active = 4/5 stages.
function ownerWms(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: [
      batch('pend1a', 'pending'), batch('pend2a', 'pending'), batch('pick1a', 'picking', { picked_by: 3 }),
      READY, batch('pack1a', 'packing', { units_picked: 5, packed_by: 9, packer_name: 'Alex' }),
      batch('done1a', 'pack_complete'),
    ] },
    isLoading: false, isError: false, refetch: jest.fn(),
    stowTasks: [], settings: null,
    openReceiveJobs: [receiveJob('oa-rcv-own', 3), receiveJob('oa-rcv-other', 9)],
    recountTasks: Array.from({ length: OPEN_COUNT_TASKS }, (_, i) => countTask(i)),
    recountLocked: false, recountTasksSettled: true, openingInventory: null, refetchOpeningInventory: jest.fn(),
    ...overrides,
  };
}

function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
function renderAs(role: 'owner' | 'admin' | 'operator', wms: Record<string, unknown> = ownerWms(), probe?: ReactNode) {
  mockRole = role;
  mockWms = wms;
  mockReadyToPack = { data: { orders: readyOrders, orderCount: readyOrders.length } };
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <ConfigProvider><WmsOperationsPage /></ConfigProvider>
      {probe}
    </MemoryRouter>,
    { wrapper: alertsQueryWrapper() },
  );
}

const STAGES = ['Receive', 'Put away', 'Pick', 'Pack', 'Ship'] as const;
const stageRegion = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}$`, 'i') });
const scanner = () => screen.getByPlaceholderText(/scan an item or invoice barcode/i);
const reconcile = () => screen.getByRole('button', { name: /^reconcile inventory$/i });
const header = () => screen.getByRole('region', { name: /^warehouse$/i });
const board = () => screen.getByRole('region', { name: /^(warehouse )?pipeline$/i });
function isScrollContainer(node: Element) {
  const style = getComputedStyle(node);
  return /auto|scroll/.test(`${style.overflowX} ${style.overflowY} ${style.overflow}`);
}
function trackCount(columns: string) {
  const repeat = /^repeat\((\d+),/.exec(columns.trim());
  if (repeat) return Number(repeat[1]);
  return columns.trim() ? columns.trim().split(/\s+(?![^(]*\))/).length : 0;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('fixture sanity — existing canonical stage grain (owned by lifecycle-IA)', () => {
  it('stage seams already report the fixture grain the summary must add up', () => {
    renderAs('owner');
    expect(stageRegion('Receive')).toHaveAccessibleDescription(/\b2 receive jobs\b/i);
    expect(stageRegion('Put away')).toHaveAccessibleDescription(/\b0 put-away tasks\b/i);
    expect(stageRegion('Pick')).toHaveAccessibleDescription(/\b3 pick batches\b/i);
    expect(stageRegion('Pack')).toHaveAccessibleDescription(/\b2 pack batches\b/i);
    expect(stageRegion('Ship')).not.toHaveAccessibleDescription(/\d/);
    // jsdom resolves non-responsive emotion sx, so structural style checks below are evaluable.
    expect(getComputedStyle(stageRegion('Ship').parentElement as Element).display).toMatch(/grid|flex/);
  });
});

describe('A — compact Owner header composition', () => {
  it.each(['owner', 'admin'] as const)('%s: one Warehouse header holds the heading, Quick Scan, Listening state and Reconcile', (role) => {
    renderAs(role);
    const composition = header();
    expect(within(composition).getByRole('heading', { name: /^warehouse$/i })).toBeInTheDocument();
    expect(composition).toContainElement(scanner());
    expect(within(composition).getByText(/^listening$/i)).toBeInTheDocument();
    expect(composition).toContainElement(reconcile());
    for (const name of STAGES) expect(stageRegion(name).contains(reconcile())).toBe(false);
  });

  it('default Owner overview has no Warehouse control shell and no Inventory checks dropdown', () => {
    renderAs('owner');
    expect(screen.queryByRole('region', { name: /^warehouse control$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^inventory checks\b/i })).not.toBeInTheDocument();
  });
});

describe('B — operational summary', () => {
  it('states open lifecycle work and active stages from the stage grain, excluding Ship and inventory checks', () => {
    renderAs('owner');
    const composition = header();
    expect(composition).toHaveAccessibleDescription(new RegExp(`\\b${EXPECTED_TOTAL}\\b`));
    expect(composition).toHaveAccessibleDescription(new RegExp(`\\b${EXPECTED_ACTIVE_STAGES} stages\\b`, 'i'));
    expect(composition).not.toHaveAccessibleDescription(/\b(9|11)\b/);
    expect(composition).not.toHaveAccessibleDescription(/\b[45] stages\b/i);
  });
});

describe('C — Reconcile stays outside the lifecycle with due-aware emphasis', () => {
  it('0 due: available, states "0 due", secondary emphasis, and render creates no count task', () => {
    renderAs('owner', ownerWms({ recountTasks: [] }));
    const control = reconcile();
    expect(control).toBeEnabled();
    expect(control).toHaveAccessibleDescription(/\b0 due\b/i);
    expect(control).toHaveAttribute('data-emphasis', 'secondary');
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('>0 due: exposes the canonical open count-task total', () => {
    renderAs('owner');
    expect(reconcile()).toHaveAccessibleDescription(new RegExp(`\\b${OPEN_COUNT_TASKS} due\\b`, 'i'));
  });
});

describe('D — one pipeline board', () => {
  it.each(['owner', 'admin'] as const)('%s: one board whose direct children are exactly the five stages in order', (role) => {
    renderAs(role);
    const pipeline = board();
    expect(screen.getAllByRole('region', { name: /^(warehouse )?pipeline$/i })).toHaveLength(1);
    expect(Array.from(pipeline.children)).toEqual(STAGES.map(stageRegion));
  });
});

describe('E — responsive structure: the board, not a stage, owns overflow', () => {
  // PARITY-04: the base desktop board is not a scroll container; only the
  // narrower responsive breakpoint may own horizontal overflow (see Q).
  it('base desktop board is not a scroll container, has one five-track definition; stages never scroll', () => {
    renderAs('owner');
    const pipeline = board();
    expect(isScrollContainer(pipeline)).toBe(false);
    expect(trackCount(getComputedStyle(pipeline).gridTemplateColumns)).toBe(STAGES.length);
    for (const name of STAGES) expect(isScrollContainer(stageRegion(name))).toBe(false);
  });
});

describe('F — operator non-regression control', () => {
  it('operator keeps Current work / Up next and gets no Owner header, Reconcile or Inventory admin', () => {
    renderAs('operator');
    expect(screen.getByRole('region', { name: /^current work$/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^up next$/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^warehouse$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reconcile inventory$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^inventory checks\b/i })).not.toBeInTheDocument();
  });
});

// ── WMS-OPS-OWNER-1A-VISUAL-PARITY-02 ─────────────────────────────────────────
// Explicit visual contracts expressed through stable semantic seams
// (data-surface / data-emphasis) plus the two ratified geometry/typography
// values (44px controls, 32px stage count). No raw colours.

function isVisuallyHidden(node: HTMLElement) {
  const style = getComputedStyle(node);
  return style.position === 'absolute' && (style.width === '1px' || /rect\(0/.test(style.clip));
}

describe('B — management Quick Scan is one compact 44px control', () => {
  it.each(['owner', 'admin'] as const)('%s: header holds one Quick Scan group with the textbox and Listening, no visible label or helper', (role) => {
    renderAs(role);
    const composition = header();
    const group = within(composition).getByRole('group', { name: /^quick scan$/i });
    expect(group).toContainElement(scanner());
    expect(within(group).getByText(/^listening$/i)).toBeInTheDocument();
    expect(scanner()).toHaveAccessibleName(/quick scan/i);
    expect(scanner()).toHaveAttribute('placeholder', 'Scan an item or invoice barcode');
    for (const label of within(composition).queryAllByText(/^quick scan$/i)) expect(isVisuallyHidden(label)).toBe(true);
    expect(within(composition).queryByText(/look up anything in the warehouse/i)).not.toBeInTheDocument();
    expect(getComputedStyle(group).height).toBe('44px');
    expect(getComputedStyle(reconcile()).height).toBe('44px');
  });

  it('operator control: existing operator scanner presentation is unchanged', () => {
    renderAs('operator');
    expect(scanner()).toBeInTheDocument();
    expect(screen.getByText(/^quick scan$/i)).toBeVisible();
    expect(screen.getByText(/look up anything in the warehouse/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^quick scan$/i })).not.toBeInTheDocument();
  });
});

describe('C — pipeline surface hierarchy', () => {
  it('stages are canvas surfaces on one board; every rendered work card is a raised surface', () => {
    renderAs('owner');
    expect(screen.getAllByRole('region', { name: /^(warehouse )?pipeline$/i })).toHaveLength(1);
    for (const name of STAGES) expect(stageRegion(name)).toHaveAttribute('data-surface', 'canvas');
    const articles = STAGES.flatMap((name) => within(stageRegion(name)).queryAllByRole('article'));
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) expect(article).toHaveAttribute('data-surface', 'raised');
    const receiveCard = within(stageRegion('Receive')).getByText('Supplier oa-rcv-own').closest('[data-surface="raised"]');
    expect(receiveCard).not.toBeNull();
    expect(stageRegion('Receive').contains(receiveCard)).toBe(true);
  });

  it('operator control: no pipeline board in the operator shell', () => {
    renderAs('operator');
    expect(screen.queryByRole('region', { name: /^(warehouse )?pipeline$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^current work$/i })).toBeInTheDocument();
  });
});

describe('D — stage header: uppercase stage name opposite a dominant 32px count', () => {
  it('each stage header row pairs the uppercase name with its count; 0 is kept; Ship is "—"', () => {
    renderAs('owner');
    const expected: Record<(typeof STAGES)[number], string> = { Receive: '2', 'Put away': '0', Pick: '3', Pack: '2', Ship: '—' };
    for (const name of STAGES) {
      const region = stageRegion(name);
      const heading = within(region).getByRole('heading', { name: new RegExp(`^${name}$`, 'i') });
      expect(getComputedStyle(heading).textTransform).toBe('uppercase');
      const row = heading.parentElement as HTMLElement;
      const count = within(row).getByText(expected[name], { exact: true });
      expect(count.parentElement).toBe(row);
      expect(followsInDocumentOrder(heading, count)).toBe(true);
      expect(getComputedStyle(count).fontSize).toBe('32px');
    }
    expect(stageRegion('Ship')).not.toHaveAccessibleDescription(/\d/);
  });
});

describe('E — current-user active work emphasis (canonical custody predicates only)', () => {
  const started = { status: 'in_progress', started_at: '2026-10-07T08:00:00Z' };
  function emphasisWms() {
    return ownerWms({
      data: { batches: [
        batch('pend3a', 'pending'),
        batch('mypick', 'picking', { picked_by: 3 }),
        batch('otpick', 'picking', { picked_by: 9 }),
        batch('ready3a', 'pick_complete', { units_picked: 5 }),
        batch('mypack', 'packing', { units_picked: 5, packed_by: 3, packer_name: 'Me' }),
        batch('otpack', 'packing', { units_picked: 5, packed_by: 9, packer_name: 'Alex' }),
      ] },
      openReceiveJobs: [
        { ...receiveJob('em-rcv-started', 3), ...started },
        receiveJob('em-rcv-assigned', 3),
        receiveJob('em-rcv-other', 9),
      ],
      stowTasks: [
        { stow_task_id: 'em-stow-mine', lasyncro_variant_id: 'v-em-1', quantity: 2, quantity_placed: 0, location_code: null,
          status: 'in_progress', trigger: 'receive', assigned_operator_id: 3, claimed_by: 3, sku: 'EM-1', product_title: 'Claimed stow widget' },
        { stow_task_id: 'em-stow-assigned', lasyncro_variant_id: 'v-em-2', quantity: 2, quantity_placed: 0, location_code: null,
          status: 'pending', trigger: 'receive', assigned_operator_id: 3, claimed_by: null, sku: 'EM-2', product_title: 'Assigned stow widget' },
      ],
    });
  }
  const card = (stage: string, text: string) => within(stageRegion(stage)).getByText(text).closest('[data-emphasis="current"]');
  const batchArticle = (stage: string, prefix: string) =>
    within(stageRegion(stage)).getByRole('article', { name: `Batch ${id(prefix).slice(0, 8).toUpperCase()}` });

  it('own started Receive, own claimed Stow, own picking and own packing work are "current"', () => {
    renderAs('owner', emphasisWms());
    expect(card('Receive', 'Supplier em-rcv-started')).not.toBeNull();
    expect(card('Put away', 'Claimed stow widget')).not.toBeNull();
    expect(batchArticle('Pick', 'mypick')).toHaveAttribute('data-emphasis', 'current');
    expect(batchArticle('Pack', 'mypack')).toHaveAttribute('data-emphasis', 'current');
  });

  it('assigned-but-not-started, pending, ready and another user\'s active work are never "current"', () => {
    renderAs('owner', emphasisWms());
    // Fixture sanity: every "current" candidate is rendered in its lifecycle home.
    expect(within(stageRegion('Receive')).getByText('Supplier em-rcv-started')).toBeInTheDocument();
    expect(within(stageRegion('Put away')).getByText('Claimed stow widget')).toBeInTheDocument();
    expect(batchArticle('Pick', 'mypick')).toBeInTheDocument();
    expect(batchArticle('Pack', 'mypack')).toBeInTheDocument();
    expect(card('Receive', 'Supplier em-rcv-assigned')).toBeNull();
    expect(card('Receive', 'Supplier em-rcv-other')).toBeNull();
    expect(card('Put away', 'Assigned stow widget')).toBeNull();
    for (const [stage, prefix] of [['Pick', 'pend3a'], ['Pick', 'otpick'], ['Pack', 'ready3a'], ['Pack', 'otpack']] as const) {
      expect(batchArticle(stage, prefix)).not.toHaveAttribute('data-emphasis', 'current');
    }
    expect(document.querySelectorAll('[data-emphasis="current"]').length).toBeLessThanOrEqual(4);
  });
});

function followsInDocumentOrder(first: Element, second: Element) {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

// ── WMS-OPS-OWNER-1A-VISUAL-PARITY-02 (consolidated) ─────────────────────────
// F–K: compact work cards, safe card layout family, scan balance, Ship carrier
// orientation, scroll ownership and the finite board edge. Equal card height is
// a browser certification over the shared data-size family, not a fixed height.

const NORDIC = {
  ...receiveJob('em-nordic', 3), supplier_name: 'Nordic Textile Works', po_number: 1005,
  total_variants: 3, total_units: 180, status: 'in_progress', started_at: '2026-10-07T08:00:00Z',
};
const raisedCards = () => STAGES.flatMap((name) =>
  Array.from(stageRegion(name).querySelectorAll<HTMLElement>('[data-surface="raised"]')));
const isActionButton = (button: HTMLElement) => !/options/i.test(button.getAttribute('aria-label') ?? '');
const pxValue = (value: string) => Number.parseFloat(value);
let lastPath = '';
function PathProbe() { const l = useLocation(); lastPath = `${l.pathname}${l.search}`; return null; }

describe('F — compact work-card content', () => {
  it('active own Receive card keeps identity, compact metadata, ownership/state and one action, without restating the CTA', () => {
    renderAs('owner', ownerWms({ openReceiveJobs: [NORDIC] }));
    const receive = stageRegion('Receive');
    const card = within(receive).getByText('Nordic Textile Works').closest('[data-surface="raised"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText('PO-1005 · 3 products · 180 units')).toBeInTheDocument();
    expect(card).toHaveTextContent(/assigned to you/i);
    expect(card).toHaveTextContent(/in progress/i);
    expect(within(card).getByRole('button', { name: /^resume receive/i })).toBeInTheDocument();
    expect(within(card).queryByText(/continue receiving shipment/i)).not.toBeInTheDocument();
  });
});

describe('G — safe compact work-card layout family', () => {
  it('every management work card is a compact-work / overview-work flex column with content before a bottom action region', () => {
    renderAs('owner', ownerWms({ openReceiveJobs: [NORDIC, receiveJob('oa-rcv-other', 9)] }));
    const cards = raisedCards();
    expect(cards.length).toBeGreaterThan(3);
    for (const card of cards) {
      expect(card).toHaveAttribute('data-layout', 'compact-work');
      expect(card).toHaveAttribute('data-size', 'overview-work');
      const style = getComputedStyle(card);
      expect(style.display).toBe('flex');
      expect(style.flexDirection).toBe('column');
      expect(style.minWidth).toMatch(/^0(px)?$/);
      for (const action of within(card).queryAllByRole('button').filter(isActionButton)) {
        expect(card.children.length).toBeGreaterThan(1);
        expect((card.firstElementChild as HTMLElement).contains(action)).toBe(false);
        expect((card.lastElementChild as HTMLElement).contains(action)).toBe(true);
      }
    }
  });
});

describe('H — scan balance', () => {
  it('44px scanner is width-capped, Listening never grows or shrinks, Reconcile matches at 44px', () => {
    renderAs('owner');
    const group = within(header()).getByRole('group', { name: /^quick scan$/i });
    const style = getComputedStyle(group);
    expect(style.height).toBe('44px');
    expect(style.maxWidth).toMatch(/px$/);
    expect(pxValue(style.maxWidth)).toBeGreaterThanOrEqual(400);
    expect(pxValue(style.maxWidth)).toBeLessThanOrEqual(520);
    const pill = within(group).getByText(/^listening$/i).parentElement as HTMLElement;
    expect(['', '0']).toContain(getComputedStyle(pill).flexGrow);
    expect(getComputedStyle(pill).flexShrink).toBe('0');
    expect(getComputedStyle(reconcile()).height).toBe('44px');
  });
});

describe('I — Ship carrier-setup orientation (structural, status-neutral, no execution)', () => {
  it('Ship offers one contextual Configure carriers setup action to /settings/carriers, with no count, work, carrier-status claim or execution', () => {
    lastPath = '';
    renderAs('owner', ownerWms(), <PathProbe />);
    const ship = stageRegion('Ship');
    expect(within(ship).getByText('—')).toBeInTheDocument();
    expect(within(ship).getByText('Carrier setup')).toBeInTheDocument();
    expect(within(ship).getByText('Packed orders queue here for label and handoff.')).toBeInTheDocument();
    // Operations has no canonical carrier status: no connected/not-connected claim.
    expect(within(ship).queryByText(/no carrier connected|carrier connected/i)).not.toBeInTheDocument();
    expect(ship).not.toHaveAccessibleDescription(/\d/);
    expect(within(ship).queryAllByRole('article')).toHaveLength(0);
    const actions = [...within(ship).queryAllByRole('button'), ...within(ship).queryAllByRole('link')];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName(/^configure carriers/i);
    fireEvent.click(actions[0]);
    expect(lastPath).toBe('/settings/carriers');
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });
});

describe('J — scroll ownership', () => {
  // PARITY-04: base board overflowX is not auto/scroll; the narrower
  // responsive breakpoint may own horizontal scrolling (see Q).
  it('desktop board is five minmax(0,1fr) tracks with no base horizontal overflow; nothing scrolls inside it', () => {
    renderAs('owner');
    const pipeline = board();
    const style = getComputedStyle(pipeline);
    expect(style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))');
    expect(style.overflowX).not.toMatch(/auto|scroll/);
    expect(style.overflowY).not.toMatch(/auto|scroll/);
    for (const node of Array.from(pipeline.querySelectorAll('*'))) expect(isScrollContainer(node)).toBe(false);
  });
});

describe('K — finite pipeline board edge', () => {
  it('the board alone owns the outer boundary and bottom radius; stages carry no lower shell of their own', () => {
    renderAs('owner');
    const pipeline = getComputedStyle(board());
    expect(pipeline.borderBottomStyle).toBe('solid');
    expect(pipeline.borderBottomLeftRadius).toBe('12px');
    expect(pipeline.borderBottomRightRadius).toBe('12px');
    for (const name of STAGES) {
      const stage = getComputedStyle(stageRegion(name));
      expect(['', 'none']).toContain(stage.borderBottomStyle);
      expect(['', '0', '0px']).toContain(stage.borderBottomLeftRadius);
      expect(['', '0', '0px']).toContain(stage.borderBottomRightRadius);
    }
  });
});

// ── PARITY-02 addendum — ACTIVE PROGRESS VS FRESH WORK ──────────────────────
// Ongoing Put away / Pick / Pack show persisted completion as a progressbar
// seam (data-progress="active"); fresh, ready and Receive work show none.
// Receive has no canonical completed-unit value in the overview projection.

describe('L — active progress vs fresh work', () => {
  function progressWms() {
    return ownerWms({
      data: { batches: [
        batch('frpend', 'pending'),
        batch('acpick', 'picking', { picked_by: 3, units_picked: 2 }),
        batch('frready', 'pick_complete', { units_picked: 5, pick_completed_at: '2026-10-07T09:00:00Z' }),
        batch('acpack', 'packing', { units_picked: 5, units_packed: 1, packed_by: 9, packer_name: 'Alex' }),
      ] },
      openReceiveJobs: [NORDIC, receiveJob('pr-rcv-fresh', 3)],
      stowTasks: [
        { stow_task_id: 'pr-stow-active', lasyncro_variant_id: 'v-pr-1', quantity: 4, quantity_placed: 1, location_code: null,
          status: 'in_progress', trigger: 'receive', assigned_operator_id: 3, claimed_by: 3, sku: 'PR-1', product_title: 'Active stow widget' },
        { stow_task_id: 'pr-stow-fresh', lasyncro_variant_id: 'v-pr-2', quantity: 3, quantity_placed: 0, location_code: null,
          status: 'pending', trigger: 'receive', assigned_operator_id: null, claimed_by: null, sku: 'PR-2', product_title: 'Fresh stow widget' },
      ],
    });
  }
  const article = (stage: string, prefix: string) =>
    within(stageRegion(stage)).getByRole('article', { name: `Batch ${id(prefix).slice(0, 8).toUpperCase()}` });
  const cardOf = (stage: string, text: string) =>
    within(stageRegion(stage)).getByText(text).closest('[data-surface="raised"]') as HTMLElement;
  function expectActive(card: HTMLElement, completed: number, total: number, verb: string) {
    const bar = within(card).getByRole('progressbar');
    expect(bar).toHaveAttribute('data-progress', 'active');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', String(total));
    expect(bar).toHaveAttribute('aria-valuenow', String(completed));
    expect(within(card).getByText(`${completed} of ${total} ${verb}`)).toBeInTheDocument();
    // Progress belongs to the content region; the CTA region stays last.
    expect((card.firstElementChild as HTMLElement).contains(bar)).toBe(true);
  }
  function expectFresh(card: HTMLElement) {
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(card.querySelector('[data-progress]')).toBeNull();
  }

  it('ongoing Pick, Pack and Put away expose persisted completion as one active progress anatomy', () => {
    renderAs('owner', progressWms());
    expectActive(article('Pick', 'acpick'), 2, 5, 'picked');
    expectActive(article('Pack', 'acpack'), 1, 5, 'packed');
    expectActive(cardOf('Put away', 'Active stow widget'), 1, 4, 'put away');
  });

  it('fresh, ready and Receive work show no progress rail and no fabricated 0/N or percentage', () => {
    renderAs('owner', progressWms());
    expectFresh(article('Pick', 'frpend'));
    expectFresh(article('Pack', 'frready'));
    expectFresh(cardOf('Put away', 'Fresh stow widget'));
    const started = cardOf('Receive', 'Nordic Textile Works');
    expectFresh(started);
    expect(started).not.toHaveTextContent(/\b\d+ of \d+\b|%/);
    expect(started).toHaveTextContent(/assigned to you/i);
    expect(started).toHaveTextContent(/in progress/i);
    expect(within(started).getByRole('button', { name: /^resume receive/i })).toBeInTheDocument();
    expectFresh(cardOf('Receive', 'Supplier pr-rcv-fresh'));
  });
});

// ── PARITY-03 — STATE-AWARE CARD HEIGHT ─────────────────────────────────────
// Fresh work is the compact card state and reserves no progress slot; ongoing
// work (exactly the cards rendering data-progress="active") is the minimally
// taller state. Semantic seam only — the browser certifies the height delta.

describe('M — state-aware work-card height (fresh vs ongoing)', () => {
  function workStateWms() {
    return ownerWms({
      data: { batches: [
        batch('wspend', 'pending'),
        batch('wspick', 'picking', { picked_by: 3, units_picked: 2 }),
        batch('wsready', 'pick_complete', { units_picked: 5, pick_completed_at: '2026-10-07T09:00:00Z' }),
        batch('wspack', 'packing', { units_picked: 5, units_packed: 1, packed_by: 9, packer_name: 'Alex' }),
      ] },
      stowTasks: [
        { stow_task_id: 'ws-stow-fresh', lasyncro_variant_id: 'v-ws-1', quantity: 3, quantity_placed: 0, location_code: null,
          status: 'pending', trigger: 'receive', assigned_operator_id: null, claimed_by: null, sku: 'WS-1', product_title: 'Fresh state widget' },
        { stow_task_id: 'ws-stow-ongoing', lasyncro_variant_id: 'v-ws-2', quantity: 4, quantity_placed: 1, location_code: null,
          status: 'in_progress', trigger: 'receive', assigned_operator_id: 3, claimed_by: 3, sku: 'WS-2', product_title: 'Ongoing state widget' },
      ],
    });
  }
  const batchCard = (stage: string, prefix: string) =>
    within(stageRegion(stage)).getByRole('article', { name: `Batch ${id(prefix).slice(0, 8).toUpperCase()}` });
  const stowCard = (text: string) =>
    within(stageRegion('Put away')).getByText(text).closest('[data-surface="raised"]') as HTMLElement;

  function expectFresh(card: HTMLElement) {
    expect(card).toHaveAttribute('data-work-state', 'fresh');
    expect(card.querySelector('[data-progress="active"]')).toBeNull();
    // No dedicated empty progress spacer/container of any kind.
    expect(card.querySelector('[data-progress], [role="progressbar"], [data-progress-slot]')).toBeNull();
  }
  function expectOngoing(card: HTMLElement) {
    expect(card).toHaveAttribute('data-work-state', 'ongoing');
    expect(card.querySelectorAll('[data-progress="active"]')).toHaveLength(1);
  }

  it('Pick: pending is fresh; picking is ongoing', () => {
    renderAs('owner', workStateWms());
    expectFresh(batchCard('Pick', 'wspend'));
    expectOngoing(batchCard('Pick', 'wspick'));
  });

  it('Pack: ready (pick_complete) is fresh; packing is ongoing', () => {
    renderAs('owner', workStateWms());
    expectFresh(batchCard('Pack', 'wsready'));
    expectOngoing(batchCard('Pack', 'wspack'));
  });

  it('Put away: pending stow is fresh; in-progress stow is ongoing', () => {
    renderAs('owner', workStateWms());
    expectFresh(stowCard('Fresh state widget'));
    expectOngoing(stowCard('Ongoing state widget'));
  });

  it('ongoing state corresponds exactly to cards rendering active progress', () => {
    renderAs('owner', workStateWms());
    const cards = STAGES.flatMap((name) =>
      Array.from(stageRegion(name).querySelectorAll<HTMLElement>('[data-surface="raised"]')));
    const pipelineCards = cards.filter((card) => !card.matches('[data-testid^="receive-work-card-"]'));
    expect(pipelineCards.length).toBeGreaterThanOrEqual(6);
    for (const card of pipelineCards) {
      const hasActive = card.querySelector('[data-progress="active"]') !== null;
      expect(card).toHaveAttribute('data-work-state', hasActive ? 'ongoing' : 'fresh');
    }
  });
});

// ── PARITY-03 — RECEIVE CARD CONSISTENCY (RED ONLY) ─────────────────────────
// Shared card seams and separate compact status tokens; dimensions remain
// browser-certified. Receive never gains numeric progress in this contract.
describe('N — Receive overview card consistency', () => {
  it('started own Receive work uses the compact family with distinct ownership/lifecycle tokens and no extra prose or spacer before its CTA', () => {
    renderAs('owner', ownerWms({ openReceiveJobs: [NORDIC] }));
    const card = within(stageRegion('Receive')).getByTestId(`receive-work-card-${NORDIC.receive_job_id}`);
    expect(card).toHaveAttribute('data-layout', 'compact-work');
    expect(card).toHaveAttribute('data-size', 'overview-work');
    expect(card).toHaveAttribute('data-surface', 'raised');
    expect(card.querySelector('[data-progress="active"]')).toBeNull();
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(card).queryByText('Continue receiving shipment')).not.toBeInTheDocument();

    const metadata = within(card).getByText('PO-1005 · 3 products · 180 units');
    expect(metadata).toHaveTextContent(/^PO-1005 · 3 products · 180 units$/);
    const cta = within(card).getByRole('button', { name: 'Resume receive →' });
    expect(cta).toBeInTheDocument();

    // Combined prose cannot satisfy the two distinct visual-token contract.
    expect(within(card).queryByText('Assigned to you · In progress')).not.toBeInTheDocument();
    const ownership = within(card).getByText('Assigned to you', { exact: true });
    const lifecycle = within(card).getByText('In progress', { exact: true });
    expect(ownership).not.toBe(lifecycle);

    // A token has its own rounded visual container, rather than being plain
    // prose. Allow either a direct chip or text nested inside a chip.
    function tokenContainer(label: HTMLElement) {
      let node: HTMLElement | null = label;
      while (node && node !== card) {
        const style = getComputedStyle(node);
        if (Number.parseFloat(style.borderRadius) > 0 &&
          (style.borderStyle === 'solid' || (style.backgroundColor !== '' &&
            style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)'))) {
          return node;
        }
        node = node.parentElement;
      }
      throw new Error(`Receive status lacks a compact visual token: ${label.textContent}`);
    }
    const ownershipToken = tokenContainer(ownership);
    const lifecycleToken = tokenContainer(lifecycle);
    expect(ownershipToken).not.toBe(lifecycleToken);
    const statusGroup = ownershipToken.parentElement as HTMLElement;
    expect(lifecycleToken.parentElement).toBe(statusGroup);
    expect(Array.from(statusGroup.children)).toEqual([ownershipToken, lifecycleToken]);

    // Status ends the content region and the CTA immediately follows it:
    // no dedicated spacer or additional prose block can sit between them.
    const content = card.firstElementChild as HTMLElement;
    expect(content.lastElementChild).toBe(statusGroup);
    expect(metadata.parentElement).toBe(content);
    const action = content.nextElementSibling as HTMLElement;
    expect(action).toBe(card.lastElementChild);
    expect(action).toContainElement(cta);
    expect(action.textContent?.trim()).toBe('Resume receive →');
    expect(card.querySelector('[data-progress-slot], [data-spacer]')).toBeNull();
  });
});

// ── PARITY-03 — OVERVIEW TASK CTA PARITY (RED ONLY) ─────────────────────────
// Shared minimum control size and wrapping contract across fresh/ongoing task
// cards. Ship's structural Configure carriers action is deliberately excluded.
describe('O — overview task CTA parity', () => {
  it('Receive, Put away, Pick and Pack task CTAs share a wrapping 36px-minimum family beneath card content and progress', () => {
    renderAs('owner', ownerWms({
      openReceiveJobs: [NORDIC],
      data: { batches: [
        batch('ctapend', 'pending'),
        batch('ctapick', 'picking', { picked_by: 3, units_picked: 2 }),
        batch('ctaready', 'pick_complete', { units_picked: 5 }),
        batch('ctapack', 'packing', { units_picked: 5, units_packed: 1, packed_by: 3 }),
      ] },
      stowTasks: [
        { stow_task_id: 'cta-stow-fresh', lasyncro_variant_id: 'v-cta-1', quantity: 3, quantity_placed: 0, location_code: null,
          status: 'pending', trigger: 'receive', assigned_operator_id: null, claimed_by: null, sku: 'CTA-1', product_title: 'Fresh CTA stow' },
        { stow_task_id: 'cta-stow-ongoing', lasyncro_variant_id: 'v-cta-2', quantity: 4, quantity_placed: 1, location_code: null,
          status: 'in_progress', trigger: 'receive', assigned_operator_id: 3, claimed_by: 3, sku: 'CTA-2', product_title: 'Ongoing CTA stow' },
      ],
    }));
    const receiveCta = within(stageRegion('Receive')).getByRole('button', { name: 'Resume receive →' });
    const freshStow = within(stageRegion('Put away')).getByRole('button', { name: 'Start stow →' });
    const ongoingStow = within(stageRegion('Put away')).getByRole('button', { name: 'Resume stow →' });
    const freshPick = within(stageRegion('Pick')).getByRole('button', { name: 'Start picking →' });
    const ongoingPick = within(stageRegion('Pick')).getByRole('button', { name: 'Continue picking →' });
    const freshPack = within(stageRegion('Pack')).getByRole('button', { name: 'Start packing →' });
    const ongoingPack = within(stageRegion('Pack')).getByRole('button', { name: 'Resume packing →' });
    const taskCtas = [receiveCta, freshStow, ongoingStow, freshPick, ongoingPick, freshPack, ongoingPack];

    function dimensions(cta: HTMLElement) {
      const style = getComputedStyle(cta);
      return {
        minHeight: style.minHeight,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
        fontSize: style.fontSize, lineHeight: style.lineHeight,
      };
    }
    for (const cta of taskCtas) {
      expect(cta).toHaveAttribute('data-size', 'overview-work-action');
      const style = getComputedStyle(cta);
      expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(36);
      // A minimum permits growth for wrapped labels; a fixed height does not.
      expect(['', 'auto']).toContain(style.height);
      expect(style.maxWidth).toBe('100%');
      expect(style.whiteSpace).toBe('normal');
      expect(['anywhere', 'break-word']).toContain(style.overflowWrap);
      expect(style.position).not.toBe('absolute');
      expect(dimensions(cta)).toEqual(dimensions(receiveCta));

      const card = cta.closest('[data-size="overview-work"]') as HTMLElement;
      expect(card).not.toBeNull();
      const content = card.firstElementChild as HTMLElement;
      const action = card.lastElementChild as HTMLElement;
      expect(action).not.toBe(content);
      expect(action).toContainElement(cta);
      expect(content).not.toContainElement(cta);
      expect(followsInDocumentOrder(content, cta)).toBe(true);
      expect(getComputedStyle(action).position).not.toBe('absolute');
      expect(getComputedStyle(action).flexWrap).toBe('wrap');
      for (const progress of Array.from(card.querySelectorAll('[data-progress="active"]'))) {
        expect(content).toContainElement(progress as HTMLElement);
        expect(followsInDocumentOrder(progress, cta)).toBe(true);
      }
    }
    // Progress affects the card content, never the task button dimensions.
    expect(dimensions(freshStow)).toEqual(dimensions(ongoingStow));
    expect(dimensions(freshPick)).toEqual(dimensions(ongoingPick));
    expect(dimensions(freshPack)).toEqual(dimensions(ongoingPack));
  });
});

// ── PARITY-04 — FINAL POLISH (RED ONLY) ─────────────────────────────────────
// P: task-CTA emphasis follows lifecycle state (ongoing = primary, fresh =
// secondary/ghost) via the data-emphasis seam, never colours. Q: structural
// desktop overflow/shrink seams only — the browser certifies 1440×900. R: Ship
// carrier setup is one centered empty-state group.

describe('P — task CTA hierarchy by lifecycle state', () => {
  it('ongoing/resume/continue CTAs are primary; fresh/start CTAs are secondary; all keep the shared action size', () => {
    renderAs('owner', ownerWms({
      openReceiveJobs: [NORDIC],
      data: { batches: [
        batch('hipend', 'pending'),
        batch('hipick', 'picking', { picked_by: 3, units_picked: 2 }),
        batch('hiready', 'pick_complete', { units_picked: 5 }),
        batch('hipack', 'packing', { units_picked: 5, units_packed: 1, packed_by: 3 }),
      ] },
      stowTasks: [
        { stow_task_id: 'hi-stow-fresh', lasyncro_variant_id: 'v-hi-1', quantity: 3, quantity_placed: 0, location_code: null,
          status: 'pending', trigger: 'receive', assigned_operator_id: null, claimed_by: null, sku: 'HI-1', product_title: 'Fresh hierarchy stow' },
        { stow_task_id: 'hi-stow-ongoing', lasyncro_variant_id: 'v-hi-2', quantity: 4, quantity_placed: 1, location_code: null,
          status: 'in_progress', trigger: 'receive', assigned_operator_id: 3, claimed_by: 3, sku: 'HI-2', product_title: 'Ongoing hierarchy stow' },
      ],
    }));
    const cta = (stage: string, name: string) => within(stageRegion(stage)).getByRole('button', { name });
    const ongoing = [
      cta('Receive', 'Resume receive →'), cta('Pick', 'Continue picking →'),
      cta('Pack', 'Resume packing →'), cta('Put away', 'Resume stow →'),
    ];
    const fresh = [cta('Pick', 'Start picking →'), cta('Pack', 'Start packing →'), cta('Put away', 'Start stow →')];
    for (const button of ongoing) {
      expect(button).toHaveAttribute('data-size', 'overview-work-action');
      expect(button).toHaveAttribute('data-emphasis', 'primary');
    }
    for (const button of fresh) {
      expect(button).toHaveAttribute('data-size', 'overview-work-action');
      expect(button).toHaveAttribute('data-emphasis', 'secondary');
    }
    // Ship's structural setup action is outside the task-CTA hierarchy.
    const configure = within(stageRegion('Ship')).getByRole('button', { name: /^configure carriers/i });
    expect(configure).not.toHaveAttribute('data-size', 'overview-work-action');
  });
});

// jsdom does not evaluate @media, so computed style is the base (desktop)
// layout; the responsive rules are read from the emotion CSSOM by class.
function boardRules(node: Element) {
  const classes = Array.from(node.classList).map((c) => `.${c}`);
  const base: CSSStyleDeclaration[] = [];
  const media: { condition: string; style: CSSStyleDeclaration }[] = [];
  const matches = (rule: CSSStyleRule) => classes.some((c) => rule.selectorText.split(',').map((s) => s.trim()).includes(c));
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && matches(rule)) base.push(rule.style);
      if (rule instanceof CSSMediaRule) {
        for (const inner of Array.from(rule.cssRules)) {
          if (inner instanceof CSSStyleRule && matches(inner)) media.push({ condition: rule.media.mediaText, style: inner.style });
        }
      }
    }
  }
  return { base, media };
}

describe('Q — desktop board overflow and shrink contract (structural only)', () => {
  it('base board is five minmax(0,1fr) tracks with no min-width track and no horizontal scroll; overflow only at the narrower breakpoint', () => {
    renderAs('owner');
    const pipeline = board();
    const style = getComputedStyle(pipeline);
    expect(style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))');
    expect(style.gridTemplateColumns).not.toMatch(/minmax\(\s*\d+px/);
    // Base (desktop) layout does not require horizontal scrolling.
    expect(style.overflowX).not.toMatch(/auto|scroll/);
    expect(style.overflow).not.toMatch(/auto|scroll/);

    const { base, media } = boardRules(pipeline);
    expect(base.length).toBeGreaterThan(0);
    for (const rule of base) {
      expect(rule.getPropertyValue('grid-template-columns')).not.toMatch(/minmax\(\s*\d+px/);
      expect(rule.getPropertyValue('overflow-x')).not.toMatch(/auto|scroll/);
    }
    // Horizontal overflow (and min-width tracks) exist only inside the
    // existing narrower max-width breakpoint.
    const narrow = media.filter(({ condition }) => /max-width/.test(condition));
    expect(narrow.some(({ style: s }) => /auto|scroll/.test(s.getPropertyValue('overflow-x')))).toBe(true);
    for (const { condition, style: s } of media) {
      if (/auto|scroll/.test(s.getPropertyValue('overflow-x'))) expect(condition).toMatch(/max-width/);
    }
  });

  it('board and its management column can shrink vertically (minHeight 0, shrinkable flex); no stage or card scrolls', () => {
    renderAs('owner');
    const pipeline = board();
    const column = pipeline.parentElement as HTMLElement;
    expect(getComputedStyle(column).display).toBe('flex');
    expect(getComputedStyle(column).flexDirection).toBe('column');
    for (const node of [pipeline, column]) {
      const style = getComputedStyle(node);
      expect(style.minHeight).toMatch(/^0(px)?$/);
      // flex: 1 0 auto forces content height past the viewport; shrink must be allowed.
      expect(style.flexShrink).not.toBe('0');
    }
    for (const name of STAGES) {
      const stage = stageRegion(name);
      expect(isScrollContainer(stage)).toBe(false);
      for (const node of Array.from(stage.querySelectorAll('*'))) expect(isScrollContainer(node)).toBe(false);
    }
  });
});

describe('R — Ship carrier setup is a centered empty state', () => {
  it('structural Ship renders one centered empty-state group with heading, description and Configure carriers', () => {
    lastPath = '';
    renderAs('owner', ownerWms(), <PathProbe />);
    const ship = stageRegion('Ship');
    expect(within(ship).getByText('—')).toBeInTheDocument();
    expect(within(ship).queryAllByRole('article')).toHaveLength(0);

    const groups = ship.querySelectorAll<HTMLElement>('[data-layout="ship-empty-state"]');
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group).toContainElement(within(ship).getByText('Carrier setup'));
    expect(group).toContainElement(within(ship).getByText('Packed orders queue here for label and handoff.'));
    const configure = within(group).getByRole('button', { name: /^configure carriers/i });

    const style = getComputedStyle(group);
    expect(style.textAlign).toBe('center');
    // Fills the available Ship-stage body space.
    const parent = getComputedStyle(group.parentElement as HTMLElement);
    const growsInFlex = parent.display === 'flex' && parent.flexDirection === 'column' && Number(style.flexGrow) >= 1;
    expect(growsInFlex || style.height === '100%').toBe(true);
    // Vertically and horizontally centered (flex column or grid).
    if (style.display === 'flex') {
      expect(style.flexDirection).toBe('column');
      expect(style.justifyContent).toBe('center');
      expect(style.alignItems).toBe('center');
    } else {
      expect(style.display).toBe('grid');
      expect([style.alignContent, style.placeContent.split(' ')[0]]).toContain('center');
      expect([style.justifyItems, style.placeItems.split(' ').pop()]).toContain('center');
    }

    fireEvent.click(configure);
    expect(lastPath).toBe('/settings/carriers');
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });
});
