/**
 * PICK-EXECUTION-SPATIAL-01A — active Pick execution: session header, canonical
 * spatial route, viewport layout and graceful map degradation.
 *
 * Rendered through the WmsModuleFT2 host with its EXISTING inputs only:
 * - canonical batch status (data.batches) — a `picking` batch resumes straight
 *   into execution (PICK-RESUME-SEMANTICS-01);
 * - warehouse geometry (gridLocations: WarehouseLocation[]);
 * - connection state (isOnline / queuedCount).
 * No new host prop is assumed.
 *
 * The canonical renderer (@lasyncro/shared/ui IsometricCanvas) and the existing
 * WmsConnectionBadge are mocked at their boundaries so the props the Pick
 * execution composition sends them can be inspected. Renderer internals are
 * not tested.
 *
 * Truth boundary: an allocation-backed resumed Pick returns only remaining
 * work. Absence from lineItems never means completed / visited / picked, and
 * the composition must not reconstruct history from currentIndex, pickResults
 * or phase. Canonical Trace is GH-1148 and out of scope.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const mockCanvasProps: Record<string, any>[] = [];
jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return {
    ...actual,
    IsometricCanvas: (props: Record<string, any>) => {
      mockCanvasProps.push(props);
      return <div data-testid="isometric-canvas-stub" />;
    },
  };
});

const mockBadgeProps: Record<string, any>[] = [];
jest.mock('../../../../modules/wms/src/ui/components/WmsConnectionBadge', () => ({
  WmsConnectionBadge: (props: Record<string, any>) => {
    mockBadgeProps.push(props);
    return <div data-testid="connection-badge-stub" />;
  },
}));

const PICKING_ID = 'pickbat1-0000-4000-8000-00000d4e5f6';
const PENDING_ID = 'pendbat1-0000-4000-8000-00000a1b2c3';
const SHORT_ID = 'D4E5F6';

function wmsBatch(pick_batch_id: string, status: 'pending' | 'picking') {
  return {
    pick_batch_id,
    status,
    total_line_items: 5,
    total_units: 6,
    units_picked: 0,
    units_packed: 0,
    picked_by: status === 'picking' ? 3 : null,
    packed_by: null,
    released_at: '2026-10-01T10:00:00.000Z',
  };
}

function line(index: number, location_code: string, quantity = 1) {
  return {
    lasyncro_line_item_id: `line-sp-${index}`,
    lasyncro_variant_id: `variant-sp-${index}`,
    lasyncro_order_id: `order-sp-${index}`,
    reservation_allocation_id: `alloc-sp-${index}`,
    sku: `SP-SKU-${index}`,
    product_title: `Spatial widget ${index}`,
    variant_title: 'Default Title',
    quantity,
    location_code,
    image_url: null,
    unit_ids: null,
  };
}

// Route fixture from the ratified contract: B-4, B-4, C-2, D-6, C-2.
// The first line needs quantity confirmation so every execution phase is
// reachable (location_scan → product_scan → qty_confirm).
const ROUTE_LINES = [
  line(0, 'B-4', 2),
  line(1, 'B-4'),
  line(2, 'C-2'),
  line(3, 'D-6'),
  line(4, 'C-2'),
];

// Resumed allocation-backed response: only remaining work.
const RESUMED_LINES = [line(2, 'C-2'), line(3, 'D-6')];

function location(location_code: string, x: number, y: number) {
  return {
    location_code,
    type: 'bin' as const,
    parent_location_code: null,
    barcode: null,
    active: true,
    position_x: x,
    position_y: y,
    width: 1,
    depth: 1,
    orientation: 0,
    rack_levels: 2,
    zone_type: null,
  };
}

// A-1 and E-9 are real, positioned bins that are not on this Pick route.
const GRID_LOCATIONS = [
  location('A-1', 0, 0),
  location('B-4', 2, 0),
  location('C-2', 4, 0),
  location('D-6', 6, 0),
  location('E-9', 8, 0),
];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: [wmsBatch(PENDING_ID, 'pending'), wmsBatch(PICKING_ID, 'picking')] },
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
    onFetchLineItems: jest.fn().mockResolvedValue(ROUTE_LINES),
    onResolveBarcode: jest.fn(async (value: string) => ({
      lasyncro_variant_id: value.replace(/^LSP-/, ''),
    })),
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn(),
    onCreateProblemTask: jest.fn(),
    onPickComplete: jest.fn(),
    onPickSessionEnter: jest.fn(),
    onSessionExit: jest.fn(),
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
    isOnline: true,
    queuedCount: 0,
    gridLocations: GRID_LOCATIONS,
    pendingPickBatchId: PICKING_ID,
    ...overrides,
  } as any;
}

const locationInput = () => screen.queryByPlaceholderText(/scan bin barcode/i);
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i);
const qtyInput = () => screen.queryByPlaceholderText(/count and enter qty/i);
const reportProblem = () => screen.queryByRole('button', { name: /report problem/i });

/** Renders the host on a resumed (canonical `picking`) batch and waits for execution. */
async function renderExecution(overrides: Record<string, unknown> = {}) {
  const props = baseProps(overrides);
  const result = render(<WmsModuleFT2 {...props} />);
  await waitFor(() => expect(locationInput()).toBeInTheDocument());
  return { props, ...result };
}

/** Props of the most recent IsometricCanvas render; fails clearly if none rendered. */
function lastCanvasProps(): Record<string, any> {
  expect(mockCanvasProps.length).toBeGreaterThan(0);
  return mockCanvasProps[mockCanvasProps.length - 1];
}
const lastBadge = () => mockBadgeProps[mockBadgeProps.length - 1];
const zoneCodes = (props: Record<string, any>) =>
  (props.zones as { location_code: string }[]).map((zone) => zone.location_code);

function scan(input: HTMLElement | null, value: string) {
  expect(input).toBeInTheDocument();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}

/** The ordered textual route companion (accessible list named as a route). */
function routeStops(): string[] {
  const route = screen.getByRole('list', { name: /route/i });
  return within(route)
    .getAllByRole('listitem')
    .map((item) => (item.textContent ?? '').trim());
}

const pickMap = () => screen.getByRole('region', { name: /map/i });

beforeEach(() => {
  mockCanvasProps.length = 0;
  mockBadgeProps.length = 0;
});

afterEach(() => jest.clearAllMocks());

describe('PICK-EXECUTION-SPATIAL-01A — session identity header', () => {
  it('HEADER-01 — active Pick shows a header with Pick, short batch identity and progress', async () => {
    await renderExecution();

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { name: /\bpick\b/i })).toBeInTheDocument();
    expect(within(header).getByText(new RegExp(SHORT_ID))).toBeInTheDocument();
    expect(within(header).getByText(/item\s+1\s+of\s+5/i)).toBeInTheDocument();
  });

  it('HEADER-01 — the header stays visible through location_scan, product_scan and qty_confirm', async () => {
    await renderExecution();

    const expectHeader = () => {
      const header = screen.getByRole('banner');
      expect(within(header).getByRole('heading', { name: /\bpick\b/i })).toBeInTheDocument();
      expect(within(header).getByText(/item\s+1\s+of\s+5/i)).toBeInTheDocument();
    };

    expectHeader(); // location_scan

    scan(locationInput(), 'B-4');
    await waitFor(() => expect(productInput()).toBeInTheDocument());
    expectHeader(); // product_scan

    scan(productInput(), 'LSP-variant-sp-0');
    await waitFor(() => expect(qtyInput()).toBeInTheDocument());
    expectHeader(); // qty_confirm
  });

  it('HEADER-02 — the existing connection badge renders in the header from canonical connection data', async () => {
    await renderExecution({ isOnline: false, queuedCount: 2 });

    const header = screen.getByRole('banner');
    expect(within(header).getByTestId('connection-badge-stub')).toBeInTheDocument();
    expect(lastBadge()).toEqual(expect.objectContaining({ isOnline: false, queuedCount: 2 }));
  });

  it('the pending Brief does not use the active-execution header', async () => {
    render(<WmsModuleFT2 {...baseProps({ pendingPickBatchId: PENDING_ID })} />);

    expect(await screen.findByRole('button', { name: /start picking/i })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });
});

describe('PICK-EXECUTION-SPATIAL-01A — canonical spatial route', () => {
  it('SPATIAL-01/06 — active execution renders the shared IsometricCanvas as an embedded, fixed-frame map', async () => {
    await renderExecution();

    expect(within(pickMap()).getByTestId('isometric-canvas-stub')).toBeInTheDocument();
    expect(lastCanvasProps()).toEqual(
      expect.objectContaining({
        showLegend: false,
        showControls: false,
        disablePan: true,
        autoFit: true,
      }),
    );
  });

  it('SPATIAL-02 — the current line location is the selected location', async () => {
    await renderExecution();

    expect(lastCanvasProps().selectedLocationCode).toBe('B-4');
  });

  it('SPATIAL-03 — the remaining route keeps line order and de-duplicates locations', async () => {
    await renderExecution();

    expect(routeStops()).toEqual(['B-4', 'C-2', 'D-6']);
  });

  it('SPATIAL-04/05 — only remaining route stops carry Pick-active state; unrelated geometry stays neutral', async () => {
    await renderExecution();

    const props = lastCanvasProps();
    expect(props.operationalStateByLocation).toEqual({
      'B-4': 'active',
      'C-2': 'active',
      'D-6': 'active',
    });

    // Unrelated bins are still drawn as warehouse context, just neutral.
    expect(zoneCodes(props)).toEqual(expect.arrayContaining(['A-1', 'B-4', 'C-2', 'D-6', 'E-9']));
    expect(props.operationalStateByLocation).not.toHaveProperty('A-1');
    expect(props.operationalStateByLocation).not.toHaveProperty('E-9');
  });

  it('SPATIAL-07 — a resumed remaining-only response never fabricates completed or visited locations', async () => {
    await renderExecution({ onFetchLineItems: jest.fn().mockResolvedValue(RESUMED_LINES) });

    expect(lastCanvasProps().selectedLocationCode).toBe('C-2');
    expect(lastCanvasProps().operationalStateByLocation).toEqual({
      'C-2': 'active',
      'D-6': 'active',
    });
    expect(routeStops()).toEqual(['C-2', 'D-6']);

    // Nothing absent from lineItems is presented as done.
    expect(screen.queryByText(/A-1|B-4/)).not.toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('SPATIAL-07 — locations picked in this session are not reconstructed as completed history', async () => {
    const { props } = await renderExecution();

    // Item 1 (B-4, qty 2) and item 2 (B-4, qty 1).
    scan(locationInput(), 'B-4');
    scan(await screen.findByPlaceholderText(/scan product barcode/i), 'LSP-variant-sp-0');
    scan(await screen.findByPlaceholderText(/count and enter qty/i), '2');
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/item\s+2\s+of\s+5/i)).toBeInTheDocument());

    scan(locationInput(), 'B-4');
    scan(await screen.findByPlaceholderText(/scan product barcode/i), 'LSP-variant-sp-1');
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/item\s+3\s+of\s+5/i)).toBeInTheDocument());

    // Current is C-2; B-4 is behind the operator but is NOT marked completed.
    await waitFor(() => expect(lastCanvasProps().selectedLocationCode).toBe('C-2'));
    expect(lastCanvasProps().operationalStateByLocation).toEqual({
      'C-2': 'active',
      'D-6': 'active',
    });
    expect(routeStops()).toEqual(['C-2', 'D-6']);
  });

  it('SPATIAL-08 — missing geometry degrades only the spatial area; scanning and Report problem remain', async () => {
    const { props } = await renderExecution({ gridLocations: undefined });

    // The spatial area stays present with a quiet unavailable state…
    expect(pickMap()).toBeInTheDocument();
    // …and never turns missing geometry into an empty floor.
    for (const canvasProps of mockCanvasProps) {
      expect(zoneCodes(canvasProps).length).toBeGreaterThan(0);
    }

    // Execution is untouched.
    expect(locationInput()).toBeEnabled();
    expect(reportProblem()).toBeEnabled();
    scan(locationInput(), 'B-4');
    await waitFor(() => expect(productInput()).toBeInTheDocument());
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });
});

describe('PICK-EXECUTION-SPATIAL-01A — focused viewport layout', () => {
  it('VIEWPORT-01 — the active execution root is viewport-bound', async () => {
    const { container } = await renderExecution();

    const root = container.firstElementChild as HTMLElement;
    const style = getComputedStyle(root);
    expect([style.height, style.maxHeight]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^100d?vh$/)]),
    );
    expect(root).toHaveStyle({ display: 'flex', flexDirection: 'column' });
  });

  it('VIEWPORT-02 — the spatial region fills the remaining height instead of using a fixed height', async () => {
    await renderExecution();

    const map = pickMap();
    expect(map).toHaveStyle({ flexGrow: '1', minHeight: '0' });
    expect(getComputedStyle(map).height).not.toMatch(/px$/);
    expect(within(map).getByTestId('isometric-canvas-stub')).toBeInTheDocument();
  });

  it('VIEWPORT-04 — the execution root does not unconditionally hide vertical overflow', async () => {
    const { container } = await renderExecution();

    // jsdom does not expand the `overflow` shorthand into its longhands, so
    // resolve the effective vertical value: overflow-y when set, otherwise the
    // shorthand's second token (or its only token). Horizontal overflow may
    // stay hidden; vertical must allow a graceful constrained-height fallback.
    const style = getComputedStyle(container.firstElementChild as HTMLElement);
    const shorthand = style.overflow.trim().split(/\s+/).filter(Boolean);
    const overflowY = style.overflowY || shorthand[1] || shorthand[0] || 'visible';

    expect(overflowY).not.toBe('hidden');
  });

  it('VIEWPORT-03 — scan and action controls live outside the map region', async () => {
    await renderExecution();

    const map = pickMap();
    expect(map).not.toContainElement(locationInput());
    expect(map).not.toContainElement(reportProblem());
    expect(map).not.toContainElement(screen.getByRole('banner'));
  });
});

describe('PICK-EXECUTION-SPATIAL-01A — Trace stays out of scope (GH-1148)', () => {
  it('TRACE-01 — active execution introduces no activity / trace panel', async () => {
    await renderExecution();

    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity|trace|log/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/operator scanned|product confirmed|batch resumed/i)).not.toBeInTheDocument();
  });
});
