// GH-1241 / S3-C — S3C-M2 GROUPED RECEIVE COUNTING — RED regression gate.
//
// Ratified (S3C-M2): a v2 Receive in grouped mode is counted scanner-first.
// Start/claim is required for a pending Receive and writes no count. A valid
// unit scan auto-switches to the scanned product and adds exactly one unit.
// A typed count is the same provisional draft. Counts persist provisionally
// (PATCH progress) without confirming; only the explicit "Confirm count" or
// "None arrived" (explicit zero) calls the canonical confirm-count endpoint,
// and only after the provisional count is durably saved. Expected is a
// reference only and never becomes a count. A confirmed line changes only
// through an explicit Edit. Expected-zero lines are excluded. M2 never
// inspects, reports problems, approves overage, prints labels, closes,
// drafts or finalizes reconciliation, or posts stock. A network/server scan
// failure is never reported as an unrecognised barcode.
//
// Renders the REAL WmsModuleFT2 (and through it the real ReceiveSessionPage)
// with mocked host callbacks only, entering through the pendingReceiveSession
// handoff seam (M1 / RECEIVE-FOCUS-EXIT-02 precedent). The host callbacks are
// backed by a small in-test canonical store, so refreshes return what the
// server would.
//
// PROVISIONAL INTERFACE. The grouped count screen is not implemented. Every
// assumed control name / marker lives in the M2 adapter below; exact spelling
// is for engineering-lead ratification, not a product decision.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

// ── PROVISIONAL S3C-M2 adapter (NOT ratified) ────────────────────────────────
const M2 = {
  /** Brief action for a pending grouped Receive (claim + start). */
  start: /start receiv/i,
  /** Scanner input (same placeholder as the per-line journey). */
  scanPlaceholder: /scan barcode/i,
  /** Current-product panel and its typed physical count. */
  currentTestId: 'receive-count-current',
  countInput: /count/i,
  confirm: /confirm count/i,
  noneArrived: /none arrived/i,
  edit: /edit count/i,
  exit: 'Exit',
  /** One row per applicable line: data-count-state, data-count ('' when uncounted), data-current. */
  lineTestId: (lineId: string) => `receive-count-line-${lineId}`,
  states: { notCounted: 'not_counted', unconfirmed: 'unconfirmed', confirmed: 'confirmed' },
  /** Operator copy (regexes, not exact text). */
  copy: {
    unknownBarcode: /not recogni[sz]ed/i,
    scanUnavailable: /connection|couldn.t check|try again/i,
    notOnDelivery: /not (expected )?on this delivery/i,
    overExpected: (extra: number) => new RegExp(`${extra} more than expected`, 'i'),
    allCounted: /all products counted/i,
    workload: (done: number, total: number) => new RegExp(`${done} of ${total} products counted`, 'i'),
  },
};

const JOB_ID = 'job-s3c-m2';
const OPERATOR_ID = 3;
const BARCODE_A = '5000000000011';
const BARCODE_B = '5000000000028';
const BARCODE_Z = '5000000000035';
const BARCODE_UNKNOWN = '9999999999999';
const BARCODE_NETWORK_FAILURE = '8888888888888';
const BARCODE_OTHER_PRODUCT = '7777777777777';

function line(overrides: Partial<ReceiveJobLine> & Record<string, unknown>): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-x',
    lasyncro_variant_id: 'variant-x',
    sku: 'SKU-X',
    variant_title: 'Default Title',
    description: 'M2 receive line',
    quantity_expected: 1,
    quantity_accepted: 0,
    quantity_rejected: 0,
    quantity_missing: null,
    quantity_deferred: null,
    quantity_sellable_provisional: null,
    reconciliation_started_at: null,
    quantity_count_confirmed: null,
    count_state: 'not_counted',
    inspection_complete: false,
    image_url: null,
    barcode: null,
    product_title: 'M2 widget',
    barcode_ready: false,
    barcode_readiness_reason: 'not_inspected',
    awaiting_label_ack: false,
    accepted_unit_count: 0,
    labelled_unit_count: 0,
    ...overrides,
  } as ReceiveJobLine;
}

const LINE_A = 'line-m2-a';
const LINE_B = 'line-m2-b';
const LINE_C = 'line-m2-c';
const LINE_Z = 'line-m2-z';

/** A and B carry barcodes; C has none (select + type); Z is expected-zero (excluded). */
function deliveryLines(overrides: Partial<Record<string, Record<string, unknown>>> = {}): ReceiveJobLine[] {
  return [
    line({ receive_job_line_id: LINE_A, lasyncro_variant_id: 'variant-a', sku: 'M2-A', product_title: 'Widget A',
      quantity_expected: 10, barcode: BARCODE_A, ...overrides[LINE_A] }),
    line({ receive_job_line_id: LINE_B, lasyncro_variant_id: 'variant-b', sku: 'M2-B', product_title: 'Widget B',
      quantity_expected: 4, barcode: BARCODE_B, ...overrides[LINE_B] }),
    // The GET projection's optimistic sellable for an untouched line is a
    // projection, never a count (S3-A1): it must not appear as the count.
    line({ receive_job_line_id: LINE_C, lasyncro_variant_id: 'variant-c', sku: 'M2-C', product_title: 'Widget C',
      quantity_expected: 6, barcode: null,
      reconciliation: { sellable: 6, sellable_basis: 'uncounted_projection' }, ...overrides[LINE_C] }),
    line({ receive_job_line_id: LINE_Z, lasyncro_variant_id: 'variant-z', sku: 'M2-Z', product_title: 'Widget Z',
      quantity_expected: 0, barcode: BARCODE_Z, ...overrides[LINE_Z] }),
  ];
}

const VARIANT_BY_BARCODE: Record<string, string> = {
  [BARCODE_A]: 'variant-a',
  [BARCODE_B]: 'variant-b',
  [BARCODE_Z]: 'variant-z',
  [BARCODE_OTHER_PRODUCT]: 'variant-not-on-this-job',
};

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    po_id: 'po-s3c-m2',
    po_number: 2412,
    supplier_name: 'M2 Supplier',
    status: 'in_progress',
    assigned_operator_id: OPERATOR_ID,
    closed_at: null,
    actual_delivery_date: null,
    delivery_accounting_version: 2,
    ...overrides,
  };
}

/**
 * In-test canonical store behind the host callbacks: progress drafts, explicit
 * confirmations (a count-changing draft voids a confirmation, S3-A1 C5), and
 * the GET receive job / GET reconciliation reads that a refresh performs.
 */
function canonicalStore(initialLines: ReceiveJobLine[], options: { job?: Record<string, unknown>; draftRevision?: boolean } = {}) {
  let job = jobRow(options.job);
  const counts = new Map(initialLines.map((l: any) => [l.receive_job_line_id, {
    provisional: l.quantity_sellable_provisional ?? null as number | null,
    confirmed: l.quantity_count_confirmed ?? null as number | null,
  }]));
  const lines = () => initialLines.map((l: any) => {
    const c = counts.get(l.receive_job_line_id)!;
    return {
      ...l,
      quantity_sellable_provisional: c.provisional,
      quantity_count_confirmed: c.confirmed,
      count_state: c.confirmed == null ? 'not_counted' : 'confirmed',
    };
  });
  const reconciliation = () => {
    const applicable = lines().filter((l: any) => l.quantity_expected > 0);
    const base = {
      receive_job_id: JOB_ID,
      status: options.draftRevision ? 'draft' : 'open',
      current_revision_id: options.draftRevision ? 'rev-b' : null,
      revisions: options.draftRevision
        ? [{ revision_id: 'rev-b', revision_number: 1, base_revision_id: null, status: 'current', created_by: OPERATOR_ID,
          created_at: '2026-10-13T09:05:00.000Z',
          lines: applicable.map((l: any) => ({ receive_job_line_id: l.receive_job_line_id, quantity_accepted: l.quantity_expected,
            quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0, quantity_held_recoverable: 0,
            new_exceptions: [], existing_exception_ids: [] })) }]
        : [],
      lines: applicable.map((l: any) => ({
        receive_job_line_id: l.receive_job_line_id,
        po_line_item_id: `poli-${l.receive_job_line_id}`,
        lasyncro_variant_id: l.lasyncro_variant_id,
        quantity_expected: l.quantity_expected,
        quantity_count_confirmed: l.quantity_count_confirmed,
        count_state: l.quantity_count_confirmed == null ? 'not_counted' : 'confirmed',
        inspection_complete: false,
      })),
      finalization: null,
    };
    return base;
  };
  return {
    lines,
    claim: jest.fn(async () => { job = { ...job, status: 'in_progress' }; }),
    progress: jest.fn(async (_jobId: string, lineId: string, params: { quantity_sellable_provisional: number }) => {
      const c = counts.get(lineId)!;
      c.provisional = params.quantity_sellable_provisional;
      if (c.confirmed != null && c.confirmed !== params.quantity_sellable_provisional) c.confirmed = null;
    }),
    confirm: jest.fn(async (_jobId: string, lineId: string, params: { quantity_confirmed: number }) => {
      const c = counts.get(lineId)!;
      c.confirmed = params.quantity_confirmed;
      c.provisional = params.quantity_confirmed;
      return { quantity_count_confirmed: params.quantity_confirmed };
    }),
    fetchJob: jest.fn(async () => ({ job, lines: lines() })),
    fetchReconciliation: jest.fn(async () => reconciliation()),
    resolveBarcode: jest.fn(async (value: string) => {
      if (value === BARCODE_NETWORK_FAILURE) throw new Error('Network Error');
      const variant = VARIANT_BY_BARCODE[value];
      return variant ? { lasyncro_variant_id: variant } : null;
    }),
    pending: () => ({
      receiveJobId: JOB_ID,
      poId: job.po_id,
      poNumber: job.po_number,
      supplierName: job.supplier_name,
      jobStatus: job.status,
      assignedOperatorId: job.assigned_operator_id,
      closedAt: job.closed_at,
      actualDeliveryDate: job.actual_delivery_date,
      deliveryAccountingVersion: job.delivery_accounting_version,
      lines: lines(),
    }),
  };
}

type Store = ReturnType<typeof canonicalStore>;

function moduleProps(store: Store, overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: [] },
    isLoading: false,
    isError: false,
    currentUserId: OPERATOR_ID,
    openReceiveJobs: [],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    pendingReceiveSession: store.pending(),
    onReceiveSessionEnter: jest.fn(),
    onReceiveSessionFocusChange: jest.fn(),
    onSessionExit: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    onFetchReceiveJob: store.fetchJob,
    onFetchReceiveReconciliation: store.fetchReconciliation,
    onClaimReceiveJob: store.claim,
    onPersistReceiveLineProgress: store.progress,
    onConfirmReceiveLineCount: store.confirm,
    onResolveBarcode: store.resolveBarcode,
    // Writers M2 must never call.
    onInspectReceiveLine: jest.fn().mockResolvedValue(undefined),
    onReportReceiveException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onCloseReceiveJob: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onSaveReceiveReconciliationDraft: jest.fn().mockResolvedValue({ revision_id: 'rev-new', revision_number: 2, base_revision_id: 'rev-b' }),
    onFinalizeReceiveReconciliation: jest.fn().mockResolvedValue({ status: 'finalized', reconciliation_id: 'recon-new' }),
    onClaimBatch: jest.fn(),
    onFetchLineItems: jest.fn(),
    onConfirmScan: jest.fn(),
    onReportException: jest.fn(),
    onCreateProblemTask: jest.fn(),
    onPickComplete: jest.fn(),
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
    ...overrides,
  } as any;
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Deferred<T = unknown> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

/** Render and wait until the grouped count screen (not the brief) is ready to scan. */
async function renderCounting(store: Store, overrides: Record<string, unknown> = {}) {
  const props = moduleProps(store, overrides);
  render(<WmsModuleFT2 {...props} />);
  await waitFor(() => expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-receive-mode', 'grouped'));
  await screen.findByPlaceholderText(M2.scanPlaceholder);
  return props;
}

async function scan(value: string) {
  const input = await screen.findByPlaceholderText(M2.scanPlaceholder);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

function lineState(lineId: string) {
  const row = screen.getByTestId(M2.lineTestId(lineId));
  return {
    state: row.getAttribute('data-count-state'),
    count: row.getAttribute('data-count'),
    current: row.getAttribute('data-current') === 'true',
  };
}

const currentPanel = () => screen.getByTestId(M2.currentTestId);
const countInput = () => within(currentPanel()).getByRole('spinbutton', { name: M2.countInput }) as HTMLInputElement;
const confirmButton = () => within(currentPanel()).getByRole('button', { name: M2.confirm });

function progressValues(store: Store, lineId: string) {
  return store.progress.mock.calls
    .filter(([, id]) => id === lineId)
    .map(([, , params]) => params.quantity_sellable_provisional);
}

/** Writers M2 never calls, in any phase. */
function expectNoForbiddenWrites(props: any) {
  for (const name of [
    'onInspectReceiveLine', 'onReportReceiveException', 'onApproveOverDelivery', 'onCloseReceiveJob',
    'onPrintUnitLabels', 'onConfirmUnitLabelsPrinted',
    'onSaveReceiveReconciliationDraft', 'onFinalizeReceiveReconciliation',
  ]) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

/** No write of any kind (mount, refresh, resolution, exit). */
function expectNoWrites(props: any) {
  expectNoForbiddenWrites(props);
  for (const name of ['onClaimReceiveJob', 'onPersistReceiveLineProgress', 'onConfirmReceiveLineCount']) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── cases ────────────────────────────────────────────────────────────────────

/**
 * WS-UX-RECEIVE-D4R S7-CORRECT — once everything is saved, Exit shows the
 * V3.1 Saved sheet without leaving; its Back to WMS performs the exit.
 */
async function confirmCleanExit(props: any) {
  const sheet = await screen.findByRole('dialog', { name: /leave this receive/i });
  expect(props.onSessionExit).not.toHaveBeenCalled();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Back to WMS' }));
}

describe('GH-1241 S3C-M2 — grouped Receive counting', () => {
  it('G1 — a pending grouped Receive starts only through Start/claim, which writes no count; counting is focused, the brief is not', async () => {
    const store = canonicalStore(deliveryLines(), { job: { status: 'pending' } });
    const props = moduleProps(store);
    render(<WmsModuleFT2 {...props} />);

    const start = await screen.findByRole('button', { name: M2.start });
    await settle();
    expect(screen.queryByPlaceholderText(M2.scanPlaceholder)).not.toBeInTheDocument();
    expect(props.onReceiveSessionFocusChange).not.toHaveBeenCalledWith(JOB_ID, true);
    expectNoWrites(props);

    fireEvent.click(start);

    const input = await screen.findByPlaceholderText(M2.scanPlaceholder);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(store.claim).toHaveBeenCalledTimes(1);
    expect(store.claim).toHaveBeenCalledWith(JOB_ID);
    await waitFor(() => expect(props.onReceiveSessionFocusChange).toHaveBeenCalledWith(JOB_ID, true));
    await settle();
    // Start never seeds a count (unlike the per-line Start projection).
    expect(store.progress).not.toHaveBeenCalled();
    expect(store.confirm).not.toHaveBeenCalled();
    for (const id of [LINE_A, LINE_B, LINE_C]) {
      expect(lineState(id)).toMatchObject({ state: M2.states.notCounted, count: '' });
    }
    expect(document.body).toHaveTextContent(M2.copy.workload(0, 3));
    expectNoForbiddenWrites(props);
  });

  it('G2 — a valid scan auto-switches to the scanned product and adds one unit per scan, persisted in order without confirming', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    expect(lineState(LINE_A).current).toBe(true);

    await scan(BARCODE_B);
    await waitFor(() => expect(lineState(LINE_B).current).toBe(true));
    await scan(BARCODE_B);
    await scan(BARCODE_B);

    await waitFor(() => expect(progressValues(store, LINE_B)).toEqual([1, 2, 3]));
    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '3', current: true }));
    // Expected is shown as a reference, separately from the physical count.
    expect(currentPanel()).toHaveTextContent(/expected/i);
    expect(currentPanel()).toHaveTextContent('4');
    expect(countInput().value).toBe('3');
    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.notCounted, count: '' });
    expect(store.confirm).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('G2b — rapid repeated scans that arrive before earlier scans resolve lose no increment', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    const resolutions = [deferred(), deferred(), deferred()];
    resolutions.forEach((d) => store.resolveBarcode.mockImplementationOnce(() => d.promise as any));

    await scan(BARCODE_B);
    await scan(BARCODE_B);
    await scan(BARCODE_B);
    await act(async () => {
      resolutions.forEach((d) => d.resolve({ lasyncro_variant_id: 'variant-b' }));
    });

    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '3' }));
    const values = progressValues(store, LINE_B);
    expect(values[values.length - 1]).toBe(3);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(store.confirm).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('G3 — Confirm count waits for the provisional count to be saved, then confirms exactly it once and moves to the next uncounted product', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    const save = deferred<void>();
    store.progress.mockImplementationOnce(() => save.promise as any);

    await scan(BARCODE_B);
    await waitFor(() => expect(store.progress).toHaveBeenCalledTimes(1));
    fireEvent.click(confirmButton());
    await settle();
    expect(store.confirm).not.toHaveBeenCalled();

    await act(async () => { save.resolve(); });
    await waitFor(() => expect(store.confirm).toHaveBeenCalledTimes(1));
    expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_B, { quantity_confirmed: 1 });
    expect(store.progress.mock.invocationCallOrder[0]).toBeLessThan(store.confirm.mock.invocationCallOrder[0]);

    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.confirmed, count: '1', current: false }));
    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.notCounted, current: true });
    expect(document.body).toHaveTextContent(M2.copy.workload(1, 3));
    await settle();
    expect(store.confirm).toHaveBeenCalledTimes(1);
    expectNoForbiddenWrites(props);
  });

  it('G3b — a failed save never confirms and never shows the line as counted', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    store.progress.mockRejectedValueOnce(new Error('Request failed with status code 503'));

    await scan(BARCODE_B);
    await waitFor(() => expect(store.progress).toHaveBeenCalledTimes(1));
    fireEvent.click(confirmButton());
    await settle();

    expect(store.confirm).not.toHaveBeenCalled();
    expect(lineState(LINE_B).state).not.toBe(M2.states.confirmed);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expectNoForbiddenWrites(props);
  });

  it('G4 — zero is only ever the explicit "None arrived"; untouched products are never confirmed', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.notCounted, current: true });
    expect(confirmButton()).toBeDisabled();

    fireEvent.click(within(currentPanel()).getByRole('button', { name: M2.noneArrived }));

    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_A, { quantity_confirmed: 0 }));
    expect(store.confirm).toHaveBeenCalledTimes(1);
    expect(progressValues(store, LINE_A).every((v) => v === 0)).toBe(true);
    await waitFor(() => expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '0' }));
    expect(lineState(LINE_B)).toMatchObject({ state: M2.states.notCounted, count: '' });
    expect(lineState(LINE_C)).toMatchObject({ state: M2.states.notCounted, count: '' });
    expectNoForbiddenWrites(props);
  });

  it('G5 — a product without a barcode is selected and its typed count is saved before it is confirmed', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);

    fireEvent.click(screen.getByTestId(M2.lineTestId(LINE_C)));
    await waitFor(() => expect(lineState(LINE_C).current).toBe(true));
    // Never prefilled from expected (6) or the optimistic projection.
    expect(countInput().value).toBe('');

    fireEvent.change(countInput(), { target: { value: '7' } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_C, { quantity_confirmed: 7 }));
    const sevens = store.progress.mock.calls
      .map((call, index) => ({ call, order: store.progress.mock.invocationCallOrder[index] }))
      .filter(({ call }) => call[1] === LINE_C && call[2].quantity_sellable_provisional === 7);
    expect(sevens.length).toBeGreaterThan(0);
    expect(sevens[sevens.length - 1].order).toBeLessThan(store.confirm.mock.invocationCallOrder[0]);
    await waitFor(() => expect(lineState(LINE_C)).toMatchObject({ state: M2.states.confirmed, count: '7' }));
    expectNoForbiddenWrites(props);
  });

  it('G6 — unknown, unavailable, foreign and expected-zero scans write nothing; a failed lookup is never "not recognised"', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);

    await scan(BARCODE_UNKNOWN);
    expect(await screen.findByText(M2.copy.unknownBarcode)).toBeInTheDocument();
    expect(lineState(LINE_A).current).toBe(true);

    await scan(BARCODE_NETWORK_FAILURE);
    await waitFor(() => expect(document.body).toHaveTextContent(M2.copy.scanUnavailable));
    expect(screen.queryByText(M2.copy.unknownBarcode)).not.toBeInTheDocument();

    await scan(BARCODE_OTHER_PRODUCT);
    expect(await screen.findByText(M2.copy.notOnDelivery)).toBeInTheDocument();

    // Expected-zero lines are excluded: never listed, never counted.
    await scan(BARCODE_Z);
    await waitFor(() => expect(store.resolveBarcode).toHaveBeenCalledWith(BARCODE_Z));
    await settle();
    expect(screen.queryByTestId(M2.lineTestId(LINE_Z))).not.toBeInTheDocument();
    expect(document.body).toHaveTextContent(M2.copy.workload(0, 3));

    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.notCounted, count: '', current: true });
    expect(store.progress).not.toHaveBeenCalled();
    expect(store.confirm).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('G7 — reload recovery restores confirmed, unconfirmed and untouched counts exactly, writes nothing, and leaves cleanly', async () => {
    const store = canonicalStore(deliveryLines({
      [LINE_A]: { quantity_count_confirmed: 5, quantity_sellable_provisional: 5, count_state: 'confirmed' },
      [LINE_B]: { quantity_sellable_provisional: 2 },
    }));
    const props = await renderCounting(store);
    await settle();

    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '5' });
    expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '2', current: true });
    expect(lineState(LINE_C)).toMatchObject({ state: M2.states.notCounted, count: '' });
    expect(document.body).toHaveTextContent(M2.copy.workload(1, 3));

    fireEvent.click(screen.getByTestId(M2.lineTestId(LINE_C)));
    await waitFor(() => expect(lineState(LINE_C).current).toBe(true));
    expect(countInput().value).toBe('');
    expectNoWrites(props);

    fireEvent.click(screen.getByRole('button', { name: M2.exit }));
    await confirmCleanExit(props);
    await waitFor(() => expect(props.onSessionExit).toHaveBeenCalledTimes(1));
    await settle();
    expectNoWrites(props);
  });

  it('G8 — a confirmed count changes only through Edit: scans and typing are refused until then, and the new count is re-confirmed', async () => {
    const store = canonicalStore(deliveryLines({
      [LINE_A]: { quantity_count_confirmed: 5, quantity_sellable_provisional: 5, count_state: 'confirmed' },
    }));
    const props = await renderCounting(store);

    fireEvent.click(screen.getByTestId(M2.lineTestId(LINE_A)));
    await waitFor(() => expect(lineState(LINE_A).current).toBe(true));
    expect(countInput()).toBeDisabled();
    expect(within(currentPanel()).queryByRole('button', { name: M2.confirm })).toBeNull();

    await scan(BARCODE_A);
    await settle();
    expect(store.progress).not.toHaveBeenCalled();
    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '5' });

    fireEvent.click(within(currentPanel()).getByRole('button', { name: M2.edit }));
    await waitFor(() => expect(countInput()).not.toBeDisabled());
    fireEvent.change(countInput(), { target: { value: '4' } });
    await waitFor(() => expect(progressValues(store, LINE_A)).toContain(4));
    await waitFor(() => expect(lineState(LINE_A)).toMatchObject({ state: M2.states.unconfirmed, count: '4' }));

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_A, { quantity_confirmed: 4 }));
    await waitFor(() => expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '4' }));
    expectNoForbiddenWrites(props);
  });

  it('G9 — a count above expected is confirmed as counted and only noted; no overage approval is made', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);

    fireEvent.click(screen.getByTestId(M2.lineTestId(LINE_B)));
    await waitFor(() => expect(lineState(LINE_B).current).toBe(true));
    fireEvent.change(countInput(), { target: { value: '6' } });
    expect(await screen.findByText(M2.copy.overExpected(2))).toBeInTheDocument();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_B, { quantity_confirmed: 6 }));
    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.confirmed, count: '6' }));
    expect(props.onApproveOverDelivery).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('G10 — counting every product under an existing draft ends at "All products counted" and never drafts or finalizes', async () => {
    const store = canonicalStore(deliveryLines({
      [LINE_A]: { quantity_count_confirmed: 10, quantity_sellable_provisional: 10, count_state: 'confirmed' },
      [LINE_B]: { quantity_count_confirmed: 4, quantity_sellable_provisional: 4, count_state: 'confirmed' },
    }), { draftRevision: true });
    const props = await renderCounting(store);
    expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-current-revision-id', 'rev-b');
    expect(lineState(LINE_C).current).toBe(true);

    fireEvent.change(countInput(), { target: { value: '6' } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_C, { quantity_confirmed: 6 }));
    expect(await screen.findByText(M2.copy.allCounted)).toBeInTheDocument();
    expect(document.body).toHaveTextContent(M2.copy.workload(3, 3));
    await settle();
    // The stale draft is neither amended nor finalized behind the operator.
    expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-current-revision-id', 'rev-b');
    expectNoForbiddenWrites(props);
  });

  it('G11 — a failed confirmation keeps the count unconfirmed and retries once; a refusal re-reads the canonical Receive', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);

    store.confirm.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    await scan(BARCODE_B);
    await waitFor(() => expect(progressValues(store, LINE_B)).toEqual([1]));
    fireEvent.click(confirmButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '1' });

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.confirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.confirmed, count: '1' }));

    // The server refuses (e.g. finalized elsewhere): the canonical job is re-read.
    const readsBefore = store.fetchJob.mock.calls.length;
    store.confirm.mockRejectedValueOnce(Object.assign(new Error('RECEIVE_RECONCILIATION_FINALIZED'), {
      response: { status: 409, data: { error: 'RECEIVE_RECONCILIATION_FINALIZED' } },
    }));
    fireEvent.click(screen.getByTestId(M2.lineTestId(LINE_C)));
    fireEvent.change(countInput(), { target: { value: '6' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.fetchJob.mock.calls.length).toBeGreaterThan(readsBefore));
    expectNoForbiddenWrites(props);
  });

  it('G13 — a refresh holding the server state from before a newer saved count never resets that count', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    expect(lineState(LINE_A).current).toBe(true);

    // The post-confirmation refresh reads the server now (A confirmed, B
    // untouched) but its response is held until after B is counted and saved.
    const readCanonical = store.fetchJob.getMockImplementation()!;
    const release = deferred<void>();
    let refreshRequested = false;
    store.fetchJob.mockImplementationOnce(async (...args: any[]) => {
      refreshRequested = true;
      const olderState = await (readCanonical as any)(...args);
      await release.promise;
      return olderState;
    });

    fireEvent.change(countInput(), { target: { value: '10' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_A, { quantity_confirmed: 10 }));
    await waitFor(() => expect(refreshRequested).toBe(true));
    await waitFor(() => expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '10' }));

    await scan(BARCODE_B);
    await waitFor(() => expect(progressValues(store, LINE_B)).toEqual([1]));
    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '1' }));
    await settle();

    // The older response lands.
    await act(async () => { release.resolve(); });
    await settle();
    expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '1' });
    expect(lineState(LINE_A)).toMatchObject({ state: M2.states.confirmed, count: '10' });

    await scan(BARCODE_B);
    await waitFor(() => expect(progressValues(store, LINE_B)).toEqual([1, 2]));
    await waitFor(() => expect(lineState(LINE_B)).toMatchObject({ state: M2.states.unconfirmed, count: '2' }));

    // A's confirmation is the only one; B was never implicitly confirmed.
    expect(store.confirm.mock.calls).toEqual([[JOB_ID, LINE_A, { quantity_confirmed: 10 }]]);
    expect(progressValues(store, LINE_A)).toEqual([10]);
    expectNoForbiddenWrites(props);
  });

  it('G11b — Back to WMS waits for an in-flight save, and a failed save keeps the operator in the session', async () => {
    const store = canonicalStore(deliveryLines());
    const props = await renderCounting(store);
    const save = deferred<void>();
    store.progress.mockImplementationOnce(() => save.promise as any);

    await scan(BARCODE_B);
    await waitFor(() => expect(store.progress).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: M2.exit }));
    await settle();
    expect(props.onSessionExit).not.toHaveBeenCalled();

    await act(async () => { save.resolve(); });
    await confirmCleanExit(props);
    await waitFor(() => expect(props.onSessionExit).toHaveBeenCalledTimes(1));
    expect(store.confirm).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);

    // Failed in-flight save: the count is not silently dropped on exit.
    cleanup();
    const failing = canonicalStore(deliveryLines());
    const failingProps = await renderCounting(failing);
    const failingSave = deferred<void>();
    failing.progress.mockImplementationOnce(() => failingSave.promise as any);
    await scan(BARCODE_B);
    await waitFor(() => expect(failing.progress).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: M2.exit }));
    await act(async () => { failingSave.reject(new Error('Network Error')); });
    await settle();

    expect(failingProps.onSessionExit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(lineState(LINE_B)).toMatchObject({ count: '1' });
    expectNoForbiddenWrites(failingProps);
  });
});
