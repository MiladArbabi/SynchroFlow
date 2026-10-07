/**
 * BATCH-DETAIL-HANDOFF-01 — Pick Brief owns the claim boundary.
 *
 * Batch Detail's "Continue to Pick →" / "Resume Picking →" navigate to
 * /wms?batchId=<id>, which WmsOperationsPage passes to WmsModuleFT2 as
 * pendingPickBatchId. Navigation and restoration are never workflow
 * mutations; the consequential claim belongs to the Pick Brief's
 * Start Picking action.
 *
 * PICK-BRIEF-CLAIM-01
 * - pendingPickBatchId restores the exact Pick Brief without claiming
 * - Start Picking calls the canonical onClaimBatch exactly once
 * - the session does not advance to location_scan until the claim succeeds
 * - a successful claim advances into location_scan
 * - opening a pending batch from its Operations card enters Brief first
 *
 * PICK-BRIEF-CLAIM-02
 * - an already-picking batch restored through pendingPickBatchId continues
 *   without a duplicate claim, keeping refresh/session-recovery semantics
 *
 * Pending vs picking derives from canonical WmsData batch.status.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

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

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Records DOM nodes committed during render/effect flushing.
 *
 * This mirrors the already-ratified Counting first-paint regression strategy:
 * eventual DOM is insufficient because the production defect is a transient
 * ordinary-WMS frame before the requested Brief resolves.
 */
function renderRecordingCommits(props: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const observer = new MutationObserver(() => {});
  observer.observe(container, { childList: true, subtree: true });

  const result = render(<WmsModuleFT2 {...(props as any)} />, { container });

  const inserted = observer
    .takeRecords()
    .flatMap((record) => Array.from(record.addedNodes))
    .filter((node): node is HTMLElement => node instanceof HTMLElement);

  observer.disconnect();

  return { ...result, inserted };
}

function containsOrdinaryWarehouseBody(root: HTMLElement): boolean {
  return (
    within(root).queryByText('Warehouse', { exact: true }) !== null ||
    (root.textContent ?? '').includes('Work waiting to be done.')
  );
}

const startPicking = () => screen.findByRole('button', { name: /start picking/i });
const locationScan = () => screen.queryByPlaceholderText(/scan bin barcode/i);

/** The Operations card for a batch: nearest ancestor of its id that holds a pick CTA. */
function batchCardAction(batchId: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(batchId.slice(0, 8).toUpperCase());

  while (node) {
    const action = Array.from(node.querySelectorAll('button')).find((button) =>
      /pick/i.test(button.textContent ?? ''),
    );
    if (action) return action as HTMLElement;
    node = node.parentElement;
  }

  throw new Error(`No pick action on the card for ${batchId}`);
}

afterEach(() => jest.clearAllMocks());

describe('BATCH-DETAIL-HANDOFF-01 — Pick Brief claim boundary', () => {
  it('PICK-HANDOFF-FIRST-PAINT-01 — targeted Pick restoration protects first paint until the Brief resolves', async () => {
    const load = deferredValue<typeof lineItems>();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onFetchLineItems: jest.fn(() => load.promise),
    });

    const { inserted } = renderRecordingCommits(props);

    // The URL already names the intended session. Before resolution, the
    // canonical Counting precedent requires a neutral protected hold rather
    // than allowing ordinary Warehouse / Operations content to paint.
    expect(
      screen.getByRole('status', { name: 'Loading pick session' }),
    ).toBeInTheDocument();

    expect(screen.queryByText('Warehouse', { exact: true })).not.toBeInTheDocument();

    expect(
      inserted.some((node) => containsOrdinaryWarehouseBody(node)),
    ).toBe(false);

    // Restoration/navigation is still non-mutating.
    expect(props.onClaimBatch).not.toHaveBeenCalled();

    await act(async () => {
      load.resolve(lineItems);
      await load.promise;
    });

    expect(await startPicking()).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading pick session' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Warehouse', { exact: true })).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('PICK-HANDOFF-FIRST-PAINT-02 — failed targeted Pick resolution holds until an explicit error without claiming', async () => {
    const load = deferredValue<typeof lineItems>();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onFetchLineItems: jest.fn(() => load.promise),
    });

    render(<WmsModuleFT2 {...props} />);

    expect(
      screen.getByRole('status', { name: 'Loading pick session' }),
    ).toBeInTheDocument();

    expect(screen.queryByText('Warehouse', { exact: true })).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();

    await act(async () => {
      load.reject(new Error('Pick session unavailable'));
      await load.promise.catch(() => undefined);
    });

    expect(
      await screen.findByText('Pick session unavailable'),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('status', { name: 'Loading pick session' }),
    ).not.toBeInTheDocument();

    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('PICK-BRIEF-CLAIM-01 — pendingPickBatchId restores the exact pending Pick Brief without claiming', async () => {
    const props = baseProps({ pendingPickBatchId: PENDING_ID });

    render(<WmsModuleFT2 {...props} />);

    await startPicking();
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PENDING_ID);
    expect(screen.getByText(/PENDBAT1/)).toBeInTheDocument();
    expect(locationScan()).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('PICK-BRIEF-CLAIM-01 — Start Picking claims exactly once and advances only after the claim succeeds', async () => {
    const claim = deferred();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onClaimBatch: jest.fn(() => claim.promise),
    });

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(await startPicking());

    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).toHaveBeenCalledWith(PENDING_ID);
    expect(locationScan()).not.toBeInTheDocument();

    await act(async () => {
      claim.resolve();
      await claim.promise;
    });

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
  });

  it('PICK-BRIEF-CLAIM-01 — a failed claim keeps the operator on the Pick Brief', async () => {
    const claim = deferred();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onClaimBatch: jest.fn(() => claim.promise),
    });

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(await startPicking());

    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      claim.reject(new Error('Batch already claimed'));
      await claim.promise.catch(() => undefined);
    });

    expect(locationScan()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start picking/i })).toBeInTheDocument();
  });

  it('PICK-BRIEF-CLAIM-01 — opening a pending batch from its Operations card enters the Brief before any claim', async () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(batchCardAction(PENDING_ID));

    await startPicking();
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PENDING_ID);
    expect(props.onClaimBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /start picking/i }));

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).toHaveBeenCalledWith(PENDING_ID);
  });

  // PICK-RESUME-SEMANTICS-01 — strengthened: a canonical `picking` batch is
  // already started, so restoration resumes execution directly. It never
  // shows the Brief, never offers Start Picking and never claims.
  it('PICK-BRIEF-CLAIM-02 — an already-picking batch restored from pendingPickBatchId resumes execution directly without Brief or claim', async () => {
    const props = baseProps({ pendingPickBatchId: PICKING_ID });

    render(<WmsModuleFT2 {...props} />);

    // Refresh/session recovery: the exact batch session is re-entered and
    // re-reported for URL recovery.
    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PICKING_ID);
    expect(props.onPickSessionEnter).toHaveBeenCalledWith(PICKING_ID);

    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Brief', { exact: true })).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });
});

/**
 * WMS-BRIEF-SYSTEM-01A / WAREHOUSE-SESSION-FOCUS-02A — shared WMS session Brief.
 *
 * Pick is execution-focused from its Brief onward, so the focused Brief hides
 * all app navigation. Like the Opening Inventory Brief (Leave count), the Pick
 * Brief must therefore carry its own explicit, non-mutating exit. Shared Brief
 * contract: stable session identity/title, compact fact rail, operational
 * instruction, primary Start action, secondary Leave action, inline start
 * error, and no scanner execution control before a successful Start.
 *
 * Session exit is observed at the module boundary (onSessionExit), which the
 * host maps to clearing batchId + warehouseFocus and restoring the ordinary
 * Warehouse shell.
 */
const twoLineItems = [
  { ...lineItems[0], lasyncro_line_item_id: 'line-pbc-1', quantity: 2 },
  {
    ...lineItems[0],
    lasyncro_line_item_id: 'line-pbc-2',
    lasyncro_variant_id: 'variant-pbc-2',
    reservation_allocation_id: 'alloc-pbc-2',
    sku: 'PBC-SKU-2',
    location_code: 'A-1-1-2',
    quantity: 3,
  },
];

const leavePick = () => screen.queryByRole('button', { name: /^leave (pick|task)$/i });

function expectNoPickMutation(props: ReturnType<typeof baseProps>) {
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  expect(props.onReportException).not.toHaveBeenCalled();
  expect(props.onCreateProblemTask).not.toHaveBeenCalled();
  expect(props.onPickComplete).not.toHaveBeenCalled();
}

describe('WMS-BRIEF-SYSTEM-01A — Pick Brief shared session Brief contract', () => {
  it('the Pick Brief presents identity, facts, instruction, Start and Leave — with no scanner before Start', async () => {
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onFetchLineItems: jest.fn().mockResolvedValue(twoLineItems),
      onSessionExit: jest.fn(),
    });

    render(<WmsModuleFT2 {...props} />);

    const start = await startPicking();

    // Stable session identity/title.
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    expect(screen.getByText(/PENDBAT1/)).toBeInTheDocument();

    // Compact fact rail: line and unit facts derived from the batch lines.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    // Operational instruction / next step.
    expect(screen.getAllByText(/scan/i).length).toBeGreaterThan(0);

    // Primary Start and secondary Leave.
    expect(start).toBeEnabled();
    expect(leavePick()).toBeInTheDocument();

    // No scanner execution control before a successful Start.
    expect(locationScan()).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('Leave pick on the Brief exits the session without claiming or mutating pick data', async () => {
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onSessionExit: jest.fn(),
    });

    render(<WmsModuleFT2 {...props} />);
    await startPicking();

    const leave = leavePick();
    expect(leave).toBeInTheDocument();
    fireEvent.click(leave!);

    expect(props.onSessionExit).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).not.toHaveBeenCalled();
    expectNoPickMutation(props);
  });

  it('a failed Start Picking stays on the Brief with an inline error, never exits, and Leave pick remains available', async () => {
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onClaimBatch: jest.fn().mockRejectedValue(new Error('Batch already claimed')),
      onSessionExit: jest.fn(),
    });

    render(<WmsModuleFT2 {...props} />);
    fireEvent.click(await startPicking());

    expect(await screen.findByText('Batch already claimed')).toBeInTheDocument();
    expect(locationScan()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start picking/i })).toBeInTheDocument();
    // Failure never ends the focused session on its own.
    expect(props.onSessionExit).not.toHaveBeenCalled();

    const leave = leavePick();
    expect(leave).toBeInTheDocument();
    expect(leave).toBeEnabled();
    fireEvent.click(leave!);

    expect(props.onSessionExit).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expectNoPickMutation(props);
  });

  it('a successful Start Picking enters location scan without exiting the focused session', async () => {
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onSessionExit: jest.fn(),
    });

    render(<WmsModuleFT2 {...props} />);
    fireEvent.click(await startPicking());

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expect(props.onSessionExit).not.toHaveBeenCalled();
  });
});

/**
 * WAREHOUSE-SESSION-FOCUS-02B — focused Pick residual contracts.
 *
 * - Opening Pick from an Operations card reports the Pick session identity
 *   (which the host maps to /wms?batchId=<id>&warehouseFocus=pick) BEFORE the
 *   line-item fetch resolves, following enterReceiveSession's
 *   identity-before-fetch precedent — so ordinary Warehouse chrome is not
 *   left visible while line items load. Entry stays non-mutating and is
 *   reported once.
 * - A failed targeted Pick resolution is a focused surface with navigation
 *   hidden, so it keeps its explicit error and offers a non-mutating Leave
 *   pick through the existing session exit — no claim, no fabricated Brief.
 */
describe('WAREHOUSE-SESSION-FOCUS-02B — Pick entry focus and focused error exit', () => {
  it('opening Pick from an Operations card reports session identity before line items resolve, once, without claiming', async () => {
    const load = deferredValue<typeof lineItems>();
    const props = baseProps({ onFetchLineItems: jest.fn(() => load.promise) });

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(batchCardAction(PENDING_ID));

    // Fetch still unresolved: identity is already reported, nothing claimed.
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PENDING_ID);
    expect(props.onPickSessionEnter).toHaveBeenCalledTimes(1);
    expect(props.onPickSessionEnter).toHaveBeenCalledWith(PENDING_ID);
    expect(props.onClaimBatch).not.toHaveBeenCalled();

    await act(async () => {
      load.resolve(lineItems);
      await load.promise;
    });

    expect(await startPicking()).toBeInTheDocument();
    // No duplicate session-entry report once the Brief resolves.
    expect(props.onPickSessionEnter).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('a failed targeted Pick resolution keeps its error and offers Leave pick, which exits without claiming', async () => {
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onFetchLineItems: jest.fn().mockRejectedValue(new Error('Pick session unavailable')),
      onSessionExit: jest.fn(),
    });

    render(<WmsModuleFT2 {...props} />);

    expect(await screen.findByText('Pick session unavailable')).toBeInTheDocument();
    // The failure never fabricates a Brief.
    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();

    const leave = leavePick();
    expect(leave).toBeInTheDocument();
    fireEvent.click(leave!);

    expect(props.onSessionExit).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).not.toHaveBeenCalled();
    expectNoPickMutation(props);
  });
});

/**
 * PICK-RESUME-SEMANTICS-01 — only an exact canonical `picking` status bypasses
 * the Brief, on every entry path.
 *
 * - pending → focused Brief; Start Picking stays the claim boundary
 *   (covered by PICK-BRIEF-CLAIM-01 above).
 * - picking → active execution directly: no Brief, no Start Picking, no claim
 *   (restore covered by PICK-BRIEF-CLAIM-02 above; Operations card below).
 * - unknown / not-yet-resolved status never counts as picking. Canonical batch
 *   data can resolve AFTER the Pick session (the restore effect is mount-only
 *   and WmsData polls), so the resume must follow late status — without
 *   resetting execution on later polls.
 */
describe('PICK-RESUME-SEMANTICS-01 — canonical picking status resumes execution', () => {
  it('Operations-card Continue picking on a canonical picking batch resumes execution directly', async () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(batchCardAction(PICKING_ID));

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PICKING_ID);
    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Brief', { exact: true })).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
    expect(props.onPickSessionEnter).toHaveBeenCalledTimes(1);
    expect(props.onPickSessionEnter).toHaveBeenCalledWith(PICKING_ID);
  });

  it('unresolved batch status never bypasses the Brief; a later canonical picking status resumes execution and later polls keep it', async () => {
    const props = baseProps({
      pendingPickBatchId: PICKING_ID,
      data: { batches: [] },
    });

    const { rerender } = render(<WmsModuleFT2 {...props} />);

    // Status unknown: the Brief is shown and execution is not.
    expect(await startPicking()).toBeInTheDocument();
    expect(locationScan()).not.toBeInTheDocument();

    // Canonical WmsData resolves after the Pick session: exact `picking`.
    rerender(
      <WmsModuleFT2
        {...props}
        data={{ batches: [wmsBatch(PENDING_ID, 'pending'), wmsBatch(PICKING_ID, 'picking')] }}
      />,
    );

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();

    // A later poll (fresh data object, same status) does not reset execution.
    rerender(
      <WmsModuleFT2
        {...props}
        data={{ batches: [wmsBatch(PENDING_ID, 'pending'), wmsBatch(PICKING_ID, 'picking')] }}
      />,
    );

    expect(locationScan()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
    expect(props.onPickSessionEnter).toHaveBeenCalledTimes(1);
  });
});


/**
 * HANDOFF-QUEUE-01 — card-scoped Pick→Pack claim/custody contracts and
 * explicit Pick completion handoff. Exercises the real module/card/Pick UI.
 * Pack entry is observed at the existing onPackSessionEnter boundary.
 * Lifecycle placement (which stage owns each batch) is owned by the ratified
 * Operations IA suite (WmsModuleFT2.operations-lifecycle-ia.test.tsx); the
 * retired L1.1 Picking/Ready to pack/Packing queue and family-control
 * assertions were removed from this suite.
 */
describe('HANDOFF-QUEUE-01 — exclusive lifecycle queues and Pick Done', () => {
  const READY_ID = 'readybat-0000-4000-8000-000000000001';
  const OWN_PACK_ID = 'ownpack1-0000-4000-8000-000000000002';
  const OTHER_PACK_ID = 'otherpak-0000-4000-8000-000000000003';
  const DONE_ID = 'donepack-0000-4000-8000-000000000004';

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

  function queueProps() {
    return baseProps({
      data: { batches: [
        wmsBatch(PENDING_ID, 'pending'),
        wmsBatch(PICKING_ID, 'picking'),
        { ...wmsBatch(READY_ID, 'picking'), status: 'pick_complete', units_picked: 1, pick_completed_at: '2026-10-05T10:07:00Z' },
        { ...wmsBatch(OWN_PACK_ID, 'picking'), status: 'packing', units_picked: 1, packed_by: 3, packer_name: 'Mabu' },
        { ...wmsBatch(OTHER_PACK_ID, 'picking'), status: 'packing', units_picked: 1, packed_by: 9, packer_name: 'Alex' },
        { ...wmsBatch(DONE_ID, 'picking'), status: 'pack_complete' },
      ] },
      readyToPackOrders: readyOrders,
      readyToPackCount: readyOrders.length,
      onClaimPack: jest.fn().mockResolvedValue(undefined),
      onFetchPackOrders: jest.fn().mockResolvedValue([]),
      onPackSessionEnter: jest.fn(),
      onSessionExit: jest.fn(),
    });
  }

  function card(batchId: string) {
    return screen.getByRole('article', { name: `Batch ${batchId.slice(0, 8).toUpperCase()}` });
  }

  function expectNoPhysicalPack(props: ReturnType<typeof baseProps>) {
    expect(props.onPackFreeScan).not.toHaveBeenCalled();
    expect(props.onConfirmPackScan).not.toHaveBeenCalled();
    expect(props.onConfirmShipment).not.toHaveBeenCalled();
    expect(props.onPackComplete).not.toHaveBeenCalled();
  }

  async function completePick() {
    const props = baseProps({
      data: { batches: [wmsBatch(PICKING_ID, 'picking')] },
      pendingPickBatchId: PICKING_ID,
      onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: lineItems[0].lasyncro_variant_id }),
      onConfirmScan: jest.fn().mockResolvedValue(undefined),
      onPickComplete: jest.fn().mockResolvedValue(undefined),
      onPackSessionEnter: jest.fn(),
      onClaimPack: jest.fn().mockResolvedValue(undefined),
      onFetchPackOrders: jest.fn().mockResolvedValue([]),
      onSessionExit: jest.fn(),
    });
    render(<WmsModuleFT2 {...props} />);
    const binInput = await screen.findByPlaceholderText(/scan bin barcode/i);
    jest.useFakeTimers();
    fireEvent.change(binInput, { target: { value: lineItems[0].location_code } });
    fireEvent.keyDown(binInput, { key: 'Enter' });
    const productInput = screen.getByPlaceholderText(/scan product barcode/i);
    await act(async () => {
      fireEvent.change(productInput, { target: { value: 'PBC-SKU-1' } });
      fireEvent.keyDown(productInput, { key: 'Enter' });
    });
    act(() => { jest.advanceTimersByTime(400); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm pick complete/i }));
    });
    expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
    expect(props.onPickComplete).toHaveBeenCalledWith(PICKING_ID);
    expect(screen.getByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
    return props;
  }

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('B — ready batch Start packing is enabled and hands off its exact identity without Pack evidence', async () => {
    const props = queueProps();
    render(<WmsModuleFT2 {...props} />);
    const start = within(card(READY_ID)).getByRole('button', { name: /^start packing\s*→?$/i });
    expect(start).toBeEnabled();
    expect(start.tagName).toBe('BUTTON');
    expect(start).toHaveStyle({ borderRadius: '6px' });
    expect(Array.from(card(READY_ID).querySelectorAll('*')).map((node) =>
      getComputedStyle(node).fontFamily).join(' ')).not.toMatch(/DM Mono/i);
    await act(async () => { fireEvent.click(start); });
    expect(props.onPackSessionEnter).toHaveBeenCalledTimes(1);
    expect(props.onPackSessionEnter).toHaveBeenCalledWith(READY_ID);
    expectNoPhysicalPack(props);
  });

  it('C — owned packing batch Resume packing hands off without physical Pack mutation', async () => {
    const props = queueProps();
    render(<WmsModuleFT2 {...props} />);
    const action = within(card(OWN_PACK_ID)).getByRole('button', { name: /^resume packing\s*→?$/i });
    expect(action).toBeEnabled();
    await act(async () => { fireEvent.click(action); });
    expect(props.onPackSessionEnter).toHaveBeenCalledWith(OWN_PACK_ID);
    expect(props.onClaimPack).not.toHaveBeenCalled();
    expectNoPhysicalPack(props);
  });

  it('C — another operator packing batch offers no executable Pack action', () => {
    const props = queueProps();
    render(<WmsModuleFT2 {...props} />);
    expect(within(card(OTHER_PACK_ID)).getByText('Packing in progress')).toBeInTheDocument();
    expect(within(card(OTHER_PACK_ID)).getByText('Packer: Alex')).toBeInTheDocument();
    expect(within(card(OTHER_PACK_ID)).queryAllByRole('button')).toHaveLength(0);
    expect(props.onPackSessionEnter).not.toHaveBeenCalled();
    expectNoPhysicalPack(props);
  });

  it('D — successful Pick Done never exits automatically when the old exit timer elapses', async () => {
    const props = await completePick();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(props.onSessionExit).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
    expectNoPhysicalPack(props);
  });

  it('D — Pick Done preserves batch identity and offers Start packing plus Return to Operations', async () => {
    await completePick();
    expect(screen.getByText(new RegExp(PICKING_ID.slice(0, 8), 'i'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start packing\s*→?$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^return to operations$/i })).toBeEnabled();
    expect(screen.queryByPlaceholderText(/scan bin barcode|scan product barcode/i)).not.toBeInTheDocument();
  });

  it('D — Return to Operations exits explicitly and exactly once', async () => {
    const props = await completePick();
    fireEvent.click(screen.getByRole('button', { name: /^return to operations$/i }));
    expect(props.onSessionExit).toHaveBeenCalledTimes(1);
    expect(props.onPackSessionEnter).not.toHaveBeenCalled();
    expectNoPhysicalPack(props);
  });

  it('D — Start packing from Pick Done hands off the exact batch without confirming Pack evidence', async () => {
    const props = await completePick();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start packing\s*→?$/i }));
    });
    expect(props.onPackSessionEnter).toHaveBeenCalledTimes(1);
    expect(props.onPackSessionEnter).toHaveBeenCalledWith(PICKING_ID);
    expect(props.onSessionExit).not.toHaveBeenCalled();
    expectNoPhysicalPack(props);
  });

  it('E — Ready batch keeps batch context: no duplicate order queue or disabled fake Pack CTA', () => {
    const props = queueProps();
    render(<WmsModuleFT2 {...props} />);
    expect(screen.queryAllByText(/orders ready to be packed/i)).toHaveLength(0);
    for (const order of readyOrders) {
      expect(screen.queryByText(`#${order.external_order_id}`)).not.toBeInTheDocument();
    }
    expect(within(card(READY_ID)).getByText(/3 orders · 1 unit · Picked/)).toBeInTheDocument();
    const packActions = screen.queryAllByRole('button', { name: /^(?:start|resume|continue|ready to) pack/i });
    expect(packActions).toHaveLength(2);
    for (const action of packActions) expect(action).toBeEnabled();
    expect(within(card(OWN_PACK_ID)).getByText('Packer: Mabu')).toBeInTheDocument();
    expect(props.onPackSessionEnter).not.toHaveBeenCalled();
    expectNoPhysicalPack(props);
  });
});
