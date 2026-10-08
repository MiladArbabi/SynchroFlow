/** WMS-OPS-LIFECYCLE-IA-02 — ratified Operations IA. RED ONLY. Real Operations UI, no layout/pixel assertions.
 * The lifecycle stage is the queue: no separate Warehouse Flow navigation, no
 * separate Work Queue, no scroll-derived active stage, no accordion families.
 * Role-differentiated shells are driven through the real page; AuthContext
 * user.role is the only role input. HANDOFF-QUEUE-01 card-scoped Pick/Pack
 * mutation contracts remain in their owning Pick suite.
 */
import React, { useContext } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { ConfigContext, ConfigProvider } from 'contexts/ConfigContext';
import { axiosInstance } from 'api/axiosConfig';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// WMS-OPS-NEEDS-ATTENTION-01 — WmsOperationsPage passively reads the canonical
// alerts inbox (useAlerts); runtime owns QueryClientProvider. Each render gets a
// fresh, isolated client with the inbox seeded fresh, so no alerts request fires.
function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

// Only data/provider boundaries are stubbed; page, module, scanner and config
// reducer are real. Opening Console is the canonical SET_OPS_CONSOLE action.
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
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: mockSubmitScan }),
  useWebPush: jest.fn(), WmsConnectionBadge: () => null,
}));

// Pick scan (/wms/pick/scan) is submitted through the offline scan queue.
const mockSubmitScan = jest.fn();
let mockRole = 'owner';
let mockWms: Record<string, unknown> = wmsState();
let mockReadyToPack: { data: { orders: unknown[]; orderCount: number } } = { data: { orders: [], orderCount: 0 } };

function wmsState(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: [] }, isLoading: false, isError: false, refetch: jest.fn(),
    stowTasks: [], settings: null, openReceiveJobs: [], recountTasks: [],
    recountLocked: false, recountTasksSettled: true, openingInventory: null,
    refetchOpeningInventory: jest.fn(),
    ...overrides,
  };
}

const PENDING_ID = 'pendbat1-0000-4000-8000-00000a1b2c3';
const PICKING_ID = 'pickbat1-0000-4000-8000-00000d4e5f6';

function wmsBatch(pick_batch_id: string, status: 'pending' | 'picking') {
  return {
    pick_batch_id,
    status,
    total_line_items: 1,
    total_units: 1,
    units_picked: 0,
    units_packed: 0,
    picked_by: status === 'picking' ? 3 : null,
    packed_by: null,
    released_at: '2026-09-14T10:00:00.000Z',
  };
}

const lineItems = [
  {
    lasyncro_line_item_id: 'line-pbc-1',
    lasyncro_variant_id: 'variant-pbc-1',
    lasyncro_order_id: 'order-pbc-1',
    reservation_allocation_id: 'alloc-pbc-1',
    sku: 'PBC-SKU-1',
    product_title: 'Pick Brief widget',
    variant_title: 'Default Title',
    quantity: 1,
    location_code: 'A-1-1-1',
    image_url: null,
    unit_ids: null,
  },
];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      batches: [wmsBatch(PENDING_ID, 'pending'), wmsBatch(PICKING_ID, 'picking')],
    },
    isLoading: false,
    isError: false,
    currentUserId: 3,
    openReceiveJobs: [],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    onFetchReceiveJob: jest.fn(),
    onClaimReceiveJob: jest.fn(),
    onInspectReceiveLine: jest.fn(),
    onPersistReceiveLineProgress: jest.fn(),
    onReportReceiveException: jest.fn(),
    onCloseReceiveJob: jest.fn(),
    onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
    onClaimBatch: jest.fn().mockResolvedValue(undefined),
    onFetchLineItems: jest.fn().mockResolvedValue(lineItems),
    onResolveBarcode: jest.fn(),
    onConfirmScan: jest.fn(),
    onReportException: jest.fn(),
    onCreateProblemTask: jest.fn(),
    onPickComplete: jest.fn(),
    onPickSessionEnter: jest.fn(),
    onClaimPack: jest.fn(),
    onFetchPackOrders: jest.fn(),
    onPackFreeScan: jest.fn(),
    onConfirmPackScan: jest.fn(),
    onReportPackException: jest.fn(),
    onPrintLabel: jest.fn(),
    onPrintInvoice: jest.fn(),
    onPackComplete: jest.fn(),
    onConfirmShipment: jest.fn(),
    onRaisePackDecision: jest.fn(),
    onPollPackDecision: jest.fn(),
    onRefresh: jest.fn(),
    stowTasks: [],
    recountLocked: false,
    recountTasks: [],
    onFetchCountingPreview: jest.fn(),
    onFetchCountingAssignees: jest.fn(),
    onCreateCountingTask: jest.fn(),
    onFetchCountingLines: jest.fn(),
    onFetchCountingFindings: jest.fn(),
    onCreateCountingFinding: jest.fn(),
    onClaimCountingTask: jest.fn(),
    onReassignCountingTask: jest.fn(),
    onRecordCountingLine: jest.fn(),
    onSkipCountingLine: jest.fn(),
    onCloseCountingTask: jest.fn(),
    ...overrides,
  } as any;
}


function scanner() { return screen.getByPlaceholderText(/scan an item or invoice barcode/i) as HTMLInputElement; }
function ConsoleControl() {
  const { state, dispatch } = useContext(ConfigContext);
  return <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: !state.isOpsConsoleOpen })}>Toggle Console</button>;
}
function renderOperations() {
  return render(<MemoryRouter initialEntries={['/wms']}><ConfigProvider><ConsoleControl /><WmsOperationsPage /></ConfigProvider></MemoryRouter>, { wrapper: alertsQueryWrapper() });
}
function toggleConsole() { fireEvent.click(screen.getByRole('button', { name: 'Toggle Console' })); }
function countTasks() {
  return Array.from({ length: 6 }, (_, i) => ({
    recount_task_id: `ia-count-${i}`, label: `IA count ${i}`, status: 'dispatched',
    purpose: 'cycle_count', scope: 'location', blind: true, assigned_to: 3,
    claimed_by: null, created_at: '2026-10-05T10:00:00Z', claimed_at: null,
    line_count: 1, counted_count: 0,
  }));
}
// WMS-OPS-OWNER-1A-ALIGNMENT — Reconcile inventory is the single management
// inventory-maintenance entry; with Count work due it opens the Count reveal.
function revealCountTasks(root: HTMLElement = document.body) {
  const reconcile = within(root).getByRole('button', { name: /^reconcile inventory$/i });
  if (reconcile.getAttribute('aria-expanded') !== 'true') fireEvent.click(reconcile);
  return reconcile;
}

// ── Ratified-IA harness: real page, role from AuthContext, URL observed ──
const READY_ID = 'readybat-0000-4000-8000-000000000001';
const OWN_PACK_ID = 'ownpack1-0000-4000-8000-000000000002';
const OTHER_PACK_ID = 'otherpak-0000-4000-8000-000000000003';
const DONE_ID = 'donepack-0000-4000-8000-000000000004';
const STAGES = ['Receive', 'Put away', 'Pick', 'Pack', 'Ship'] as const;

const readyOrders = ['order-ready-1', 'order-ready-2', 'order-ready-3'].map((id, index) => ({
  pick_batch_id: READY_ID,
  lasyncro_order_id: id,
  external_order_id: `READY-${index + 1}`,
  wms_barcode: `LSO-READY${index + 1}`,
  line_items: [{
    lasyncro_line_item_id: `line-ready-${index + 1}`,
    product_title: 'Ready inspection widget',
    variant_title: null,
    sku: 'READY-SKU',
    quantity: 1,
    unit_barcode: `LSU-READY${index + 1}`,
  }],
}));

function readyBatch() {
  return { ...wmsBatch(READY_ID, 'picking'), status: 'pick_complete', units_picked: 1, pick_completed_at: '2026-10-05T10:07:00Z' };
}

function lifecycleBatches() {
  return [
    wmsBatch(PENDING_ID, 'pending'),
    wmsBatch(PICKING_ID, 'picking'),
    readyBatch(),
    { ...wmsBatch(OWN_PACK_ID, 'picking'), status: 'packing', units_picked: 1, packed_by: 3, packer_name: 'Mabu' },
    { ...wmsBatch(OTHER_PACK_ID, 'picking'), status: 'packing', units_picked: 1, packed_by: 9, packer_name: 'Alex' },
    { ...wmsBatch(DONE_ID, 'picking'), status: 'pack_complete' },
  ];
}

function lifecycleWms(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: lifecycleBatches() },
    openReceiveJobs: [{
      receive_job_id: 'ia-receive-1', status: 'pending', assigned_operator_id: 3,
      started_at: null, closed_at: null, supplier_name: 'IA Supplier', po_id: 'ia-po-1',
      po_number: 7701, total_units: 4, total_variants: 1,
    }],
    stowTasks: [{
      stow_task_id: 'ia-stow-1', lasyncro_variant_id: 'ia-variant-1', quantity: 2,
      quantity_placed: 0, location_code: null, status: 'pending', trigger: 'receive',
      assigned_operator_id: 3, claimed_by: null, sku: 'IA-STOW', product_title: 'IA stow widget',
    }],
    ...overrides,
  };
}

let lastSearch = '';
function LocationProbe() { lastSearch = useLocation().search; return null; }
function param(name: string) { return new URLSearchParams(lastSearch).get(name); }

function renderOperationsAs(
  role: 'owner' | 'admin' | 'operator',
  wms: Record<string, unknown> = {},
  orders: unknown[] = [],
) {
  mockRole = role;
  mockWms = wmsState(wms);
  mockReadyToPack = { data: { orders, orderCount: orders.length } };
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <ConfigProvider>
        <ConsoleControl />
        <LocationProbe />
        <WmsOperationsPage />
      </ConfigProvider>
    </MemoryRouter>, { wrapper: alertsQueryWrapper() });
}

function stageRegion(name: string) { return screen.getByRole('region', { name: new RegExp(`^${name}$`, 'i') }); }
function queryStageRegion(name: string) { return screen.queryByRole('region', { name: new RegExp(`^${name}$`, 'i') }); }
function batchName(batchId: string) { return `Batch ${batchId.slice(0, 8).toUpperCase()}`; }
function articleNames(root: HTMLElement) {
  return within(root).queryAllByRole('article').map((node) => node.getAttribute('aria-label'));
}
function isScrollContainer(node: Element) {
  const style = getComputedStyle(node);
  return /auto|scroll/.test(`${style.overflowY} ${style.overflow}`);
}
function followsInDocument(first: Element, second: Element) {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
function serveLineItems() {
  (axiosInstance.get as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve({ data: url.includes('/line-items') ? { line_items: lineItems } : {} }));
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  mockRole = 'owner';
  mockWms = wmsState();
  mockReadyToPack = { data: { orders: [], orderCount: 0 } };
  lastSearch = '';
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); jest.clearAllMocks(); });

describe('WMS-OPS-LIFECYCLE-IA-02 — inherited orientation guard', () => {
  it('C — orientation has no second independent WorkTally/count strip', () => {
    render(<WmsModuleFT2 {...baseProps()} />);
    expect(screen.queryByRole('region', { name: 'Work counts' })).not.toBeInTheDocument();
  });
});

describe('OWNER-PIPELINE-01 — Owner/Admin default five-stage pipeline overview', () => {
  it.each(['owner', 'admin'] as const)(
    '%s — default Operations is one five-stage pipeline in physical order, with no separate flow navigation, Work Queue or accordion families',
    (role) => {
      renderOperationsAs(role, lifecycleWms(), readyOrders);
      const regions = STAGES.map(stageRegion);
      for (let i = 1; i < regions.length; i += 1) expect(followsInDocument(regions[i - 1], regions[i])).toBe(true);
      for (const a of regions) for (const b of regions) if (a !== b) expect(a.contains(b)).toBe(false);
      expect(screen.queryByRole('navigation', { name: /warehouse flow/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /^work queue$/i })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^(Receiving|Putting away|Picking|Packing)\b/i })).toHaveLength(0);
    },
  );

  it('each stage owns its bounded work preview; every batch has exactly one lifecycle home; previews are not independent scroll regions', () => {
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    expect(stageRegion('Receive')).toHaveTextContent('IA Supplier');
    expect(stageRegion('Put away')).toHaveTextContent('IA stow widget');
    expect(articleNames(stageRegion('Pick')).sort()).toEqual([batchName(PENDING_ID), batchName(PICKING_ID)].sort());
    expect(articleNames(stageRegion('Pack')).sort())
      .toEqual([batchName(READY_ID), batchName(OWN_PACK_ID), batchName(OTHER_PACK_ID)].sort());
    expect(articleNames(stageRegion('Ship'))).toEqual([]);
    for (const id of [PENDING_ID, PICKING_ID, READY_ID, OWN_PACK_ID, OTHER_PACK_ID]) {
      expect(screen.getAllByRole('article', { name: batchName(id) })).toHaveLength(1);
    }
    expect(screen.queryByText(DONE_ID.slice(0, 8).toUpperCase())).not.toBeInTheDocument();
    for (const name of STAGES) {
      const region = stageRegion(name);
      expect([region, ...Array.from(region.querySelectorAll('*'))].filter(isScrollContainer)).toHaveLength(0);
    }
  });

  it('D — an empty Put away stage stays in the pipeline and teaches its Receive cause', () => {
    renderOperationsAs('owner');
    const putAway = stageRegion('Put away');
    // Assert the workflow cause, not an incidental sentence or heading.
    expect(putAway).toHaveTextContent(/receiv/i);
    expect(putAway).toHaveTextContent(/put away|putting away/i);
  });

  it('high volume View all opens the canonical Pick-batch EntityDetailModal while the five-stage overview stays unchanged', async () => {
    const many = Array.from({ length: 8 }, (_, i) => wmsBatch(`focus00${i}-0000-4000-8000-00000000000${i}`, 'pending'));
    renderOperationsAs('owner', lifecycleWms({ data: { batches: [...many, readyBatch()] } }), readyOrders);

    // Capture the actual overview DOM nodes BEFORE opening the modal.
    // EntityDetailModal correctly makes the background application tree
    // aria-hidden while open, so accessibility queries must not rediscover
    // those background regions during the modal. The invariant is that the
    // same nodes remain mounted and unchanged underneath it.
    const stageRegionsBefore = STAGES.map((name) => stageRegion(name));
    const pickRegionBefore = stageRegion('Pick');
    const packRegionBefore = stageRegion('Pack');

    // These exact DOM nodes must remain mounted underneath the modal.
    // Do not use role queries for the modal-open assertion because MUI
    // correctly aria-hides the background application subtree.
    const pickArticlesBefore = Array.from(
      pickRegionBefore.querySelectorAll('article')
    );
    const packArticlesBefore = Array.from(
      packRegionBefore.querySelectorAll('article')
    );
    const pickPreviewBefore = pickArticlesBefore.map(
      (node) => node.getAttribute('aria-label')
    );
    const packPreviewBefore = packArticlesBefore.map(
      (node) => node.getAttribute('aria-label')
    );

    expect(pickPreviewBefore.length).toBeGreaterThan(0);
    expect(pickPreviewBefore.length).toBeLessThan(many.length);

    fireEvent.click(
      within(stageRegion('Pick')).getByRole('button', {
        name: new RegExp(`^view all ${many.length}$`, 'i'),
      }),
    );

    const dialog = await screen.findByRole('dialog', { name: /^pick$/i });

    expect(within(dialog).getByText(`${many.length} pick batches`)).toBeInTheDocument();
    expect(articleNames(dialog))
      .toEqual(many.map((batch) => batchName(batch.pick_batch_id)));

    // Every full-list task remains a distinct raised work-card surface.
    for (const article of within(dialog).getAllByRole('article')) {
      expect(article).toHaveAttribute('data-surface', 'raised');
    }

    // View all is inspection only: the exact underlying five-stage DOM
    // remains mounted and unchanged. It is intentionally absent from the
    // accessibility tree while the modal owns focus.
    for (const region of stageRegionsBefore) {
      expect(region).toBeInTheDocument();
    }

    expect(
      Array.from(pickRegionBefore.querySelectorAll('article')).map(
        (node) => node.getAttribute('aria-label')
      )
    ).toEqual(pickPreviewBefore);

    expect(
      Array.from(packRegionBefore.querySelectorAll('article')).map(
        (node) => node.getAttribute('aria-label')
      )
    ).toEqual(packPreviewBefore);

    // Stronger persistence proof: the exact preview article nodes captured
    // before opening are still connected to the same stage regions.
    for (const node of pickArticlesBefore) {
      expect(node).toBeInTheDocument();
      expect(pickRegionBefore).toContainElement(node);
    }
    for (const node of packArticlesBefore) {
      expect(node).toBeInTheDocument();
      expect(packRegionBefore).toContainElement(node);
    }

    expect(
      screen.queryByRole('button', { name: /^all stages$/i })
    ).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));

    // EntityDetailModal uses MUI's exit transition. Its accessible title can
    // disappear before the Dialog node is actually unmounted and before MUI
    // restores the background application to the accessibility tree. Wait
    // for the captured modal node itself to leave the DOM.
    await waitFor(() => expect(dialog).not.toBeInTheDocument());

    expect(articleNames(stageRegion('Pick'))).toEqual(pickPreviewBefore);
    expect(articleNames(stageRegion('Pack'))).toEqual(packPreviewBefore);
  });

  // VISUAL-PARITY-02 — superseded "zero buttons/links": Ship may expose exactly
  // one contextual carrier-setup navigation; still no work, count or execution.
  it('Ship is a visible structural stage with no fabricated count, work or execution; only a carrier-setup action', () => {
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const ship = stageRegion('Ship');
    expect(ship).not.toHaveTextContent(/\d/);
    const actions = [...within(ship).queryAllByRole('button'), ...within(ship).queryAllByRole('link')];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName(/^configure carriers/i);
    expect(within(ship).queryAllByRole('button', { name: /ship|label|confirm|handoff|dispatch/i })).toHaveLength(0);
    expect(within(ship).queryAllByRole('article')).toHaveLength(0);
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('stage counts use the ratified work grain: jobs, stow tasks, pick batches, Pack batch contexts; Ship is structural', () => {
    // Every count differs from the alternative grains (units, orders) so the
    // grain itself is under test. Overview Pack count is batch/group grain;
    // Pack execution itself remains order/parcel authority.
    const receiveJob = (id: string) => ({
      receive_job_id: id, status: 'pending', assigned_operator_id: 3, started_at: null, closed_at: null,
      supplier_name: `Supplier ${id}`, po_id: `po-${id}`, po_number: 7700, total_units: 4, total_variants: 1,
    });
    const stowTask = (id: string) => ({
      stow_task_id: id, lasyncro_variant_id: `variant-${id}`, quantity: 2, quantity_placed: 0,
      location_code: null, status: 'pending', trigger: 'receive', assigned_operator_id: 3,
      claimed_by: null, sku: `SKU-${id}`, product_title: `Stow ${id}`,
    });
    renderOperationsAs('owner', {
      data: { batches: [
        { ...wmsBatch(PENDING_ID, 'pending'), total_units: 5 },
        { ...wmsBatch(PICKING_ID, 'picking'), total_units: 5 },
        readyBatch(),
        { ...wmsBatch(DONE_ID, 'picking'), status: 'pack_complete' },
      ] },
      openReceiveJobs: [receiveJob('grain-rcv-1'), receiveJob('grain-rcv-2')],
      stowTasks: [stowTask('grain-stow-1'), stowTask('grain-stow-2'), stowTask('grain-stow-3')],
    }, readyOrders);

    expect(readyOrders).toHaveLength(3);
    // Ratified count seam: the stage region's accessible description states
    // count and grain; visible layout stays free.
    expect(stageRegion('Receive')).toHaveAccessibleDescription(/\b2 receive jobs\b/i);
    expect(stageRegion('Put away')).toHaveAccessibleDescription(/\b3 put-away tasks\b/i);
    expect(stageRegion('Pick')).toHaveAccessibleDescription(/\b2 pick batches\b/i);
    // Critical: one Ready-to-Pack batch of 3 orders is ONE Pack work/group, not 3.
    expect(stageRegion('Pack')).toHaveAccessibleDescription(/\b1 pack batch\b/i);
    expect(stageRegion('Pack')).not.toHaveAccessibleDescription(/\b3\b/);
    // Ship is structural for current scope: no numeric work count.
    expect(stageRegion('Ship')).not.toHaveAccessibleDescription(/\d/);
    expect(stageRegion('Ship')).toHaveTextContent('—');
  });
});

describe('OWNER-PIPELINE-02 — Pick and Pack entry from the pipeline keep existing claim/custody semantics', () => {
  it('Pack stage: ready → Start packing, same owner → Resume packing, other owner → static Packing in progress; entering Pack performs no Pack mutation', async () => {
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const pack = stageRegion('Pack');
    const ready = within(pack).getByRole('article', { name: batchName(READY_ID) });
    const own = within(pack).getByRole('article', { name: batchName(OWN_PACK_ID) });
    const other = within(pack).getByRole('article', { name: batchName(OTHER_PACK_ID) });

    const start = within(ready).getByRole('button', { name: /^start packing\s*→?$/i });
    expect(start).toBeEnabled();
    expect(within(own).getByRole('button', { name: /^resume packing\s*→?$/i })).toBeEnabled();
    expect(within(other).getByText('Packing in progress')).toBeInTheDocument();
    expect(within(other).queryAllByRole('button')).toHaveLength(0);

    await act(async () => { fireEvent.click(start); });
    // Navigation-only handoff of the exact batch; no claim, scan, completion or shipment write.
    expect(param('packBatchId')).toBe(READY_ID);
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('Pick stage: pending → Pick Brief with explicit Start Picking, never an entry claim', async () => {
    serveLineItems();
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const pending = within(stageRegion('Pick')).getByRole('article', { name: batchName(PENDING_ID) });
    fireEvent.click(within(pending).getByRole('button', { name: /^start picking/i }));
    expect(await screen.findByRole('button', { name: /^leave (pick|task)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start picking/i })).toBeEnabled();
    expect(param('batchId')).toBe(PENDING_ID);
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });

  it('Pick stage: picking → Continue Picking resumes execution directly without a duplicate claim', async () => {
    serveLineItems();
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const picking = within(stageRegion('Pick')).getByRole('article', { name: batchName(PICKING_ID) });
    fireEvent.click(within(picking).getByRole('button', { name: /^continue picking/i }));
    expect(await screen.findByPlaceholderText(/scan bin barcode/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start picking/i })).not.toBeInTheDocument();
    expect(param('batchId')).toBe(PICKING_ID);
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });
});

describe('OPERATOR-SHELL-01 — Operator task-focused shell', () => {
  const UP_A = 'upnexta1-0000-4000-8000-00000000000a';
  const UP_B = 'upnextb1-0000-4000-8000-00000000000b';
  function operatorBatches(order: 'ab' | 'ba' = 'ab') {
    const a = { ...wmsBatch(UP_A, 'pending'), released_at: '2026-09-14T09:00:00.000Z' };
    const b = { ...wmsBatch(UP_B, 'pending'), released_at: '2026-09-14T10:00:00.000Z' };
    const current = wmsBatch(PICKING_ID, 'picking');
    return order === 'ab' ? [current, a, b] : [b, current, a];
  }

  it('shows current in-progress work plus Up Next; lifecycle labels orient but no stage presents a management preview', () => {
    renderOperationsAs('operator', { data: { batches: operatorBatches() } });
    const current = screen.getByRole('region', { name: /^current work$/i });
    const currentCard = within(current).getByRole('article', { name: batchName(PICKING_ID) });
    expect(within(currentCard).getByRole('button', { name: /^continue picking/i })).toBeEnabled();

    const upNext = screen.getByRole('region', { name: /^up next$/i });
    expect(articleNames(upNext).length).toBeGreaterThan(0);
    expect(articleNames(upNext)).not.toContain(batchName(PICKING_ID));

    const labels = STAGES.map((name) => screen.getAllByText(new RegExp(`^${name}$`, 'i'))[0]);
    for (let i = 1; i < labels.length; i += 1) expect(followsInDocument(labels[i - 1], labels[i])).toBe(true);
    for (const name of STAGES) {
      const region = queryStageRegion(name);
      if (region) expect(articleNames(region)).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: /^view all\b/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /warehouse flow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^work queue$/i })).not.toBeInTheDocument();
  });

  it('Up Next is deterministic for the same work regardless of input order', () => {
    const first = renderOperationsAs('operator', { data: { batches: operatorBatches('ab') } });
    const upNextFirst = articleNames(screen.getByRole('region', { name: /^up next$/i }));
    first.unmount();
    renderOperationsAs('operator', { data: { batches: operatorBatches('ba') } });
    expect(upNextFirst.length).toBeGreaterThan(0);
    expect(articleNames(screen.getByRole('region', { name: /^up next$/i }))).toEqual(upNextFirst);
  });

  it('carries no reconciliation, admin, commercial or settings clutter', () => {
    renderOperationsAs('operator', {
      data: { batches: operatorBatches() },
      recountLocked: true,
      settings: { problem_bin_location: null },
      stowTasks: [{
        stow_task_id: 'op-stow-1', lasyncro_variant_id: 'op-variant-1', quantity: 1,
        quantity_placed: 0, location_code: null, status: 'pending', trigger: 'receive',
        assigned_operator_id: null, claimed_by: null, sku: 'OP-STOW', product_title: 'Operator stow widget',
      }],
    });
    expect(screen.queryByRole('button', { name: /^reconcile inventory$/i })).not.toBeInTheDocument();
    expect(screen.queryAllByText(/problem bin not configured/i)).toHaveLength(0);
    expect(screen.queryAllByText(/upgrade/i)).toHaveLength(0);
    expect(screen.queryAllByText(/^core$/i)).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /task options|job options|reassign|assign/i })).toHaveLength(0);
    // Not vacuous: the operator shell itself rendered.
    expect(screen.getByRole('region', { name: /^current work$/i })).toBeInTheDocument();
  });

  it('Up Next entry opens the Pick Brief without claiming; current work resumes without claiming', async () => {
    serveLineItems();
    const first = renderOperationsAs('operator', { data: { batches: operatorBatches() } });
    const next = within(screen.getByRole('region', { name: /^up next$/i })).getAllByRole('article')[0];
    fireEvent.click(within(next).getByRole('button', { name: /^start picking/i }));
    expect(await screen.findByRole('button', { name: /^leave (pick|task)$/i })).toBeInTheDocument();
    expect(axiosInstance.post).not.toHaveBeenCalled();
    first.unmount();

    renderOperationsAs('operator', { data: { batches: operatorBatches() } });
    const current = within(screen.getByRole('region', { name: /^current work$/i })).getByRole('article', { name: batchName(PICKING_ID) });
    fireEvent.click(within(current).getByRole('button', { name: /^continue picking/i }));
    expect(await screen.findByPlaceholderText(/scan bin barcode/i)).toBeInTheDocument();
    expect(param('batchId')).toBe(PICKING_ID);
    expect(axiosInstance.post).not.toHaveBeenCalled();
  });
});

describe('G — canonical Ops Console state preserves the real Quick Scan', () => {
  it('input node and current value survive open/close without Pack or shipment calls', () => {
    renderOperations();
    const input = scanner();
    fireEvent.change(input, { target: { value: 'IA-UNSUBMITTED' } });
    toggleConsole();
    expect(scanner()).toBe(input);
    expect(scanner()).toHaveValue('IA-UNSUBMITTED');
    toggleConsole();
    expect(scanner()).toBe(input);
    expect(scanner()).toHaveValue('IA-UNSUBMITTED');
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  // WMS-OPS-OWNER-1A-VISUAL-PARITY-02 — superseded "suppresses visibility":
  // Operations stays visibly present underneath the Console overlay (same
  // nodes, same geometry); only interaction is withdrawn via a shared inert root.
  it('open Console keeps Quick Scan and Reconcile mounted and visible underneath, under one inert Operations ancestor', () => {
    renderOperations();
    const input = scanner();
    const reconcile = screen.getByRole('button', { name: /^reconcile inventory$/i });
    toggleConsole();
    expect(input).toBeInTheDocument();
    expect(reconcile).toBeInTheDocument();
    expect(input).toBeVisible();
    expect(reconcile).toBeVisible();
    const inertRoot = input.closest('[inert]');
    expect(inertRoot).not.toBeNull();
    expect(inertRoot!.contains(reconcile)).toBe(true);
    toggleConsole();
    expect(scanner()).toBe(input);
    expect(screen.getByRole('button', { name: /^reconcile inventory$/i })).toBe(reconcile);
    expect(input.closest('[inert]')).toBeNull();
    expect(input).toBeVisible();
    expect(input).toBeEnabled();
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('open Console keeps the lifecycle pipeline mounted as the same nodes and inert, without remount', () => {
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const pick = stageRegion('Pick');
    const card = within(pick).getByRole('article', { name: batchName(PENDING_ID) });
    toggleConsole();
    expect(pick).toBeInTheDocument();
    expect(card).toBeInTheDocument();
    expect(pick.closest('[inert]')).not.toBeNull();
    toggleConsole();
    expect(stageRegion('Pick')).toBe(pick);
    expect(within(pick).getByRole('article', { name: batchName(PENDING_ID) })).toBe(card);
    expect(pick.closest('[inert]')).toBeNull();
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it('opening Console before the pending scanner autofocus fires prevents focus theft', () => {
    jest.useFakeTimers();
    renderOperations();
    const input = scanner();
    const focus = jest.spyOn(input, 'focus');
    toggleConsole();
    act(() => { jest.advanceTimersByTime(150); });
    expect(focus).not.toHaveBeenCalled();
    expect(input).not.toHaveFocus();
  });

  it('closing Console refocuses the scanner if it owned focus before opening', () => {
    jest.useFakeTimers();
    renderOperations();
    act(() => { jest.advanceTimersByTime(150); });
    const input = scanner();
    input.focus();
    expect(input).toHaveFocus();
    toggleConsole();
    expect(input).not.toHaveFocus();
    toggleConsole();
    act(() => { jest.advanceTimersByTime(150); });
    expect(scanner()).toBe(input);
    expect(input).toHaveFocus();
  });

  it('closing Console does not take focus when scanner did not own it', () => {
    jest.useFakeTimers();
    renderOperations();
    act(() => { jest.advanceTimersByTime(150); });
    const other = screen.getByRole('button', { name: 'Toggle Console' });
    act(() => {
      other.focus();
    });
    const focus = jest.spyOn(scanner(), 'focus');
    toggleConsole();
    act(() => { jest.advanceTimersByTime(150); });
    toggleConsole();
    act(() => { jest.advanceTimersByTime(150); });
    expect(focus).not.toHaveBeenCalled();
    expect(other).toHaveFocus();
  });
});

describe('QUICK-SCAN-AUTHORITY-01 — overview Quick Scan resolves read-only via /wms/scan/resolve', () => {
  // POST /api/v1/wms/scan/resolve is the ratified non-consequential resolver:
  // a read-only POST is permitted; consequential POSTs are not. Pack execution
  // free-scan (/wms/pack/free-scan) remains consequential and is not used here.
  const READ_ONLY_RESOLVE = '/api/v1/wms/scan/resolve';
  const CONSEQUENTIAL = [
    /\/wms\/pack\/free-scan/,
    /\/wms\/pick\/scan/,
    /\/wms\/batch\/[^/]+\/pack\/claim/,
    /\/wms\/pack\/scan/,
    /\/wms\/batch\/[^/]+\/pack-complete/,
    /\/wms\/batch\/[^/]+\/ship/,
  ];

  it('scanning on the overview calls the resolver and no consequential Pick/Pack/Ship endpoint', async () => {
    renderOperationsAs('owner', lifecycleWms(), readyOrders);
    const input = scanner();
    await act(async () => {
      fireEvent.change(input, { target: { value: 'LSU-READY1' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    const posts = (axiosInstance.post as jest.Mock).mock.calls;
    expect(posts).toContainEqual([READ_ONLY_RESOLVE, expect.objectContaining({ scanned_value: 'LSU-READY1' })]);
    const urls = posts.map(([url]) => String(url));
    for (const pattern of CONSEQUENTIAL) expect(urls.filter((url) => pattern.test(url))).toEqual([]);
    // No other physical warehouse evidence: the resolver is the only POST.
    expect(urls.filter((url) => url !== READ_ONLY_RESOLVE)).toEqual([]);
    expect(mockSubmitScan).not.toHaveBeenCalled();
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });
});

describe('H — Reconcile inventory preserves Count and reconciliation authority outside the lifecycle', () => {
  it('Reconcile inventory is the single management inventory-maintenance control, outside every lifecycle stage', () => {
    renderOperationsAs('owner', lifecycleWms({ recountTasks: countTasks() }), readyOrders);
    expect(screen.queryByRole('button', { name: /^inventory checks\b/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^reconcile inventory$/i })).toHaveLength(1);
    const reconcile = screen.getByRole('button', { name: /^reconcile inventory$/i });
    for (const name of STAGES) expect(stageRegion(name).contains(reconcile)).toBe(false);
  });

  it('Count due: Reconcile opens the bounded Count reveal with full count and reset after collapse', () => {
    render(<WmsModuleFT2 {...baseProps({ canManageRecount: true, recountTasks: countTasks() })} />);
    const reconcile = revealCountTasks();
    expect(reconcile).toHaveAccessibleDescription(/\b6 due\b/i);
    expect(screen.getAllByRole('button', { name: /^start count$/i })).toHaveLength(4);
    fireEvent.click(screen.getByText('See 2 more'));
    expect(screen.getAllByRole('button', { name: /^start count$/i })).toHaveLength(6);
    fireEvent.click(reconcile);
    fireEvent.click(reconcile);
    expect(screen.getAllByRole('button', { name: /^start count$/i })).toHaveLength(4);
  });

  it('Count due: Start count via Reconcile still enters the exact task without a reconciliation write', async () => {
    const props = baseProps({ canManageRecount: true, recountTasks: countTasks(), onCountSessionEnter: jest.fn(),
      onFetchCountingLines: jest.fn().mockResolvedValue([]), onFetchCountingFindings: jest.fn().mockResolvedValue([]),
    });
    render(<WmsModuleFT2 {...props} />);
    revealCountTasks();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^start count$/i })[0]); });
    expect(props.onCountSessionEnter).toHaveBeenCalledWith('ia-count-0');
    expect(props.onCreateCountingTask).not.toHaveBeenCalled();
  });

  it('locked: the unified Reconcile control keeps upgrade gating and makes no Count or reconciliation requests', () => {
    const props = baseProps({ canManageRecount: true, recountLocked: true, recountTasks: countTasks(), onRecountUpgrade: jest.fn() });
    render(<WmsModuleFT2 {...props} />);
    const reconcile = screen.getByRole('button', { name: /^reconcile inventory$/i });
    expect(reconcile).toHaveAccessibleDescription(/\b6 due\b/i);
    fireEvent.click(reconcile);
    expect(props.onRecountUpgrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^start count$/i })).not.toBeInTheDocument();
    expect(props.onFetchCountingPreview).not.toHaveBeenCalled();
    expect(props.onFetchCountingAssignees).not.toHaveBeenCalled();
    expect(props.onCreateCountingTask).not.toHaveBeenCalled();
  });

  it('0 due: unlocked Reconcile retains its preview action without creating a task merely on open', async () => {
    const props = baseProps({ canManageRecount: true, recountTasks: [], onFetchCountingPreview: jest.fn().mockResolvedValue([]), onFetchCountingAssignees: jest.fn().mockResolvedValue([]) });
    render(<WmsModuleFT2 {...props} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^reconcile inventory$/i })); });
    expect(props.onFetchCountingPreview).toHaveBeenCalledTimes(1);
    expect(props.onFetchCountingAssignees).toHaveBeenCalledTimes(1);
    expect(props.onCreateCountingTask).not.toHaveBeenCalled();
  });
});

describe('J and color — reserved Ship boundary and semantic styling', () => {
  it('J — existing batch states never fabricate Ship counts, actions or Outbound execution', () => {
    const props = baseProps({ data: { batches: [
      { ...wmsBatch('ia-ready', 'picking'), status: 'pick_complete' },
      { ...wmsBatch('ia-packing', 'picking'), status: 'packing', packed_by: 3 },
      { ...wmsBatch('ia-complete', 'picking'), status: 'pack_complete' },
    ] } });
    const { rerender } = render(<WmsModuleFT2 {...props} />);
    function assertShipBoundary() {
      expect(screen.queryByRole('button', { name: /confirm ship|ship order|ship batch|start shipping/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /ship|outbound/i })).not.toBeInTheDocument();
      // Ship is permitted to be absent or structural; no derived zero/count.
      for (const ship of screen.queryAllByText(/^Ship\b/i)) expect(ship).not.toHaveTextContent(/\d/);
      expect(screen.queryByRole('button', { name: /^Ship.*\d/i })).not.toBeInTheDocument();
      expect(props.onConfirmShipment).not.toHaveBeenCalled();
      expect(props.onPackComplete).not.toHaveBeenCalled();
    }
    assertShipBoundary();
    rerender(<WmsModuleFT2 {...props} data={{ batches: [] }} />);
    assertShipBoundary();
  });

  it('color — Quick Scan typography inherits the operator sans contract', () => {
    render(<WmsModuleFT2 {...baseProps()} />);
    expect(getComputedStyle(scanner()).fontFamily).not.toMatch(/DM Mono/i);
  });

  it('color — Quick Scan status uses semantic tokens instead of raw status colors', () => {
    render(<WmsModuleFT2 {...baseProps()} />);
    let row: HTMLElement | null = screen.getByText('Quick scan');
    while (row && !row.contains(scanner())) row = row.parentElement;
    expect(row).not.toBeNull();
    const colors = [row!, ...Array.from(row!.querySelectorAll<HTMLElement>('*'))].flatMap((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor, style.borderColor, node.getAttribute('stroke') ?? ''];
    });
    expect(colors.join(' ')).not.toMatch(/#E5484D|#4CAF7A|rgba?\(\s*(229,\s*72,\s*77|76,\s*175,\s*122)/i);
  });

  it('color — fresh Start actions use secondary treatment; ongoing actions reserve primary treatment', () => {
    render(<WmsModuleFT2 {...baseProps()} />);
    const start = screen.getByRole('button', { name: /^start picking/i });
    expect(start).toHaveAttribute('data-emphasis', 'secondary');
    expect(start).toHaveAttribute('data-size', 'overview-work-action');
  });
});
