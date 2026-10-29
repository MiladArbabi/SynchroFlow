// S8-C5 / S4-4C — held-for-repair custody in the grouped-finalized Receive:
// held labels → problem-bin scan (barcode or typed) → scan each held LSU →
// server-authoritative placement → Close only when every held unit is placed.
// Renders the REAL WmsModuleFT2 → ReceiveSessionPage with a canonical store
// behind the host callbacks (harness copied from the S3C-M4 suite).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const JOB_ID = 'a1b2c3d4-1006-4000-8000-000000000444';
const LINE_A = '11111111-1006-4000-8000-0000000000a1';
const LINE_B = '11111111-1006-4000-8000-0000000000b2';
const OPERATOR_ID = 3;
const DELIVERY_DATE = '2026-10-13';

type LineSpec = { id: string; title: string; accepted: number; expected?: number; barcode?: string | null; labelled?: boolean; held?: string[] };

/** A finalized line (inspection complete) as GET /receive-jobs/:id projects it. */
function finalizedLine(spec: LineSpec): ReceiveJobLine {
  const external = spec.barcode != null;
  const held = spec.held ?? [];
  const ready = (spec.accepted <= 0 || external || spec.labelled === true) && (held.length === 0 || spec.labelled === true);
  return {
    receive_job_line_id: spec.id,
    lasyncro_variant_id: `variant-${spec.id.slice(-2)}`,
    sku: `SKU-${spec.id.slice(-2)}`,
    variant_title: 'Default Title',
    // The label hold names the product by its line description.
    description: spec.title,
    quantity_expected: spec.expected ?? spec.accepted + held.length,
    quantity_accepted: spec.accepted,
    quantity_rejected: 0,
    quantity_missing: (spec.expected ?? spec.accepted + held.length) - spec.accepted - held.length,
    quantity_deferred: 0,
    quantity_sellable_provisional: null,
    reconciliation_started_at: null,
    quantity_count_confirmed: spec.accepted,
    count_state: 'inspected',
    inspection_complete: true,
    image_url: null,
    barcode: spec.barcode ?? null,
    product_title: spec.title,
    barcode_ready: ready,
    barcode_readiness_reason: spec.accepted <= 0 ? 'no_accepted_units' : external ? 'external_barcode' : spec.labelled ? 'labels_acknowledged' : 'labels_outstanding',
    awaiting_label_ack: !ready,
    accepted_unit_count: spec.accepted,
    labelled_unit_count: spec.labelled ? spec.accepted : 0,
    reported_problems: held.length > 0
      ? [{ receive_exception_id: `ex-${spec.id.slice(-2)}`, exception_type: 'defect', quantity_affected: held.length, accounting_role: null, counts_toward_shortfall: false, disposition: 'recoverable_held' }]
      : [],
    held_units: held.map((id) => ({ lasyncro_unit_id: id, label_acknowledged: spec.labelled === true, location_code: null, placed: false })),
  } as ReceiveJobLine;
}

function httpError(status: number, error: string) {
  return Object.assign(new Error(error), { response: { status, data: { error } } });
}

function httpError409(code: string) {
  return Object.assign(new Error(`${code}: refused`), { response: { status: 409, data: { error: `${code}: refused`, code } } });
}

/** Failures the next custody calls throw, in order (interrupted requests, refusals). */
const finalizedStorePlaceFailures: unknown[] = [];

/** Canonical store of one grouped-finalized job behind the host callbacks. */
function finalizedStore(specs: LineSpec[], options: { closed?: boolean } = {}) {
  const lines: any[] = specs.map(finalizedLine);
  const job: any = {
    po_id: 'po-m4', po_number: 1006, supplier_name: 'PO-1006 Supplier',
    status: options.closed ? 'closed' : lines.every((l) => l.barcode_ready) ? 'stow_ready' : 'barcode_assignment',
    assigned_operator_id: OPERATOR_ID,
    closed_at: options.closed ? '2026-10-13T13:00:00.000Z' : null,
    actual_delivery_date: options.closed ? DELIVERY_DATE : null,
    delivery_accounting_version: 2,
  };
  const reconciliation = () => ({
    receive_job_id: JOB_ID,
    status: 'finalized',
    current_revision_id: '33333333-1006-4000-8000-000000000001',
    revisions: [{ revision_id: '33333333-1006-4000-8000-000000000001', revision_number: 1, base_revision_id: null,
      status: 'current', created_by: OPERATOR_ID, created_at: '2026-10-13T12:00:00.000Z',
      lines: lines.map((l) => ({ receive_job_line_id: l.receive_job_line_id, quantity_accepted: l.quantity_accepted,
        quantity_rejected: 0, quantity_missing: l.quantity_missing, quantity_deferred: 0, quantity_held_recoverable: 0,
        new_exceptions: [], existing_exception_ids: [] })) }],
    lines: lines.map((l) => ({ receive_job_line_id: l.receive_job_line_id, po_line_item_id: `poli-${l.receive_job_line_id}`,
      lasyncro_variant_id: l.lasyncro_variant_id, quantity_expected: l.quantity_expected,
      quantity_count_confirmed: l.quantity_count_confirmed, count_state: 'confirmed', inspection_complete: true })),
    finalization: { reconciliation_id: '55555555-1006-4000-8000-000000000001', revision_id: '33333333-1006-4000-8000-000000000001',
      lines: lines.map((l) => ({ receive_job_line_id: l.receive_job_line_id, quantity_accepted: l.quantity_accepted })) },
  });
  const markReadiness = () => {
    if (job.status !== 'closed') job.status = lines.every((l) => l.barcode_ready) ? 'stow_ready' : 'barcode_assignment';
  };
  return {
    lines,
    job,
    fetchJob: jest.fn(async () => ({ job: { ...job }, lines: lines.map((l) => ({ ...l })) })),
    fetchReconciliation: jest.fn(async () => reconciliation()),
    printLabels: jest.fn(async (_lineId: string) => undefined),
    acknowledgeLabels: jest.fn(async (lineId: string) => {
      const l = lines.find((candidate) => candidate.receive_job_line_id === lineId);
      Object.assign(l, { barcode_ready: true, barcode_readiness_reason: 'labels_acknowledged', awaiting_label_ack: false,
        labelled_unit_count: l.quantity_accepted,
        held_units: l.held_units.map((u: any) => ({ ...u, label_acknowledged: true })) });
      markReadiness();
    }),
    bins: { 'BC-PROB-1': 'PROB-1', 'PROB-1': 'PROB-1', 'PROB-2': 'PROB-2' } as Record<string, string>,
    resolveBin: jest.fn(async (_jobId: string, scanned: string) => {
      const code = ({ 'BC-PROB-1': 'PROB-1', 'PROB-1': 'PROB-1', 'PROB-2': 'PROB-2' } as Record<string, string>)[scanned];
      if (!code) throw httpError409('RECEIVE_PROBLEM_BIN_INVALID');
      return { location_code: code, barcode: scanned === code ? null : scanned };
    }),
    placeFailures: [] as unknown[],
    place: jest.fn(async (_jobId: string, params: { lasyncro_unit_id: string; location_code: string }): Promise<{ replayed: boolean }> => {
      const next = (finalizedStorePlaceFailures as unknown[]).shift();
      if (next) throw next;
      const unit = lines.flatMap((l) => l.held_units).find((u: any) => u.lasyncro_unit_id === params.lasyncro_unit_id);
      if (unit.placed) return { replayed: true };
      Object.assign(unit, { placed: true, location_code: params.location_code });
      return { replayed: false };
    }),
    close: jest.fn(async (_jobId: string, _params: { actual_delivery_date?: string }) => {
      Object.assign(job, { status: 'closed', closed_at: '2026-10-13T13:00:00.000Z', actual_delivery_date: DELIVERY_DATE });
    }),
    pending: () => ({
      receiveJobId: JOB_ID, poId: job.po_id, poNumber: job.po_number, supplierName: job.supplier_name,
      jobStatus: job.status, assignedOperatorId: job.assigned_operator_id, closedAt: job.closed_at,
      actualDeliveryDate: job.actual_delivery_date, deliveryAccountingVersion: job.delivery_accounting_version,
      lines: lines.map((l) => ({ ...l })),
    }),
  };
}

type Store = ReturnType<typeof finalizedStore>;

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
    onPrintUnitLabels: store.printLabels,
    onConfirmUnitLabelsPrinted: store.acknowledgeLabels,
    onResolveReceiveProblemBin: store.resolveBin,
    onPlaceReceiveHeldUnit: store.place,
    onCloseReceiveJob: store.close,
    onResolveBarcode: jest.fn().mockResolvedValue(null),
    // Accounting writers: refused after grouped finalization, never called.
    onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
    onInspectReceiveLine: jest.fn().mockResolvedValue(undefined),
    onPersistReceiveLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmReceiveLineCount: jest.fn().mockResolvedValue(undefined),
    onReportReceiveException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onSaveReceiveReconciliationDraft: jest.fn().mockResolvedValue({ revision_id: 'never' }),
    onFinalizeReceiveReconciliation: jest.fn().mockResolvedValue({ status: 'finalized' }),
    onCreateProblemTask: jest.fn().mockResolvedValue(undefined),
    onClaimBatch: jest.fn(),
    onFetchLineItems: jest.fn(),
    onConfirmScan: jest.fn(),
    onReportException: jest.fn(),
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

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

async function renderFinalized(store: Store) {
  const props = moduleProps(store);
  render(<WmsModuleFT2 {...props} />);
  await waitFor(() => expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-receive-mode', 'grouped_finalized'));
  await settle();
  return props;
}

/** The label-hold panel for the product currently awaiting labels. */
const acknowledgeButton = () => screen.findByTestId('confirm-unit-labels-printed');
const holdPanel = async () => (await acknowledgeButton()).parentElement as HTMLElement;
const printButton = () => screen.queryByRole('button', { name: /^print labels/i });
const closeButton = () => screen.queryByRole('button', { name: /^close receive/i });

async function closeWithDate() {
  fireEvent.change(await screen.findByLabelText(/actual delivery date/i), { target: { value: DELIVERY_DATE } });
  fireEvent.click(closeButton()!);
}

/** Accounting writers stay refused after finalization; nothing re-counts, re-inspects or re-reconciles. */
function expectNoAccountingWrites(props: any) {
  for (const name of ['onInspectReceiveLine', 'onPersistReceiveLineProgress', 'onConfirmReceiveLineCount',
    'onReportReceiveException', 'onApproveOverDelivery', 'onSaveReceiveReconciliationDraft',
    'onFinalizeReceiveReconciliation', 'onCreateProblemTask', 'onClaimReceiveJob']) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

afterEach(() => {
  finalizedStorePlaceFailures.length = 0;
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── cases ────────────────────────────────────────────────────────────────────

const LSU_1 = 'LSU-0000a001';
const LSU_2 = 'LSU-0000a002';
const EXTERNAL = '5012345678900';

const custodyPanel = () => screen.findByTestId('receive-held-custody');
const binInput = () => screen.getByLabelText('Problem bin');
const unitInput = () => screen.getByLabelText('Held unit label');
const scan = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

async function heldJobAtReview(store: Store) {
  const props = await renderFinalized(store);
  // Held labels hold the product first; acknowledgement is explicit.
  fireEvent.click(await acknowledgeButton());
  await waitFor(() => expect(store.acknowledgeLabels).toHaveBeenCalledWith(LINE_A));
  await settle();
  await custodyPanel();
  return props;
}

describe('S4-4C — held-for-repair custody before Receive close', () => {
  it('H1 — held labels hold the product; after acknowledgement every held LSU is listed unplaced and Close is gated', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1, LSU_2] }]);
    const props = await renderFinalized(store);
    expect(await acknowledgeButton()).toBeEnabled();
    expect(screen.queryByTestId('receive-held-custody')).toBeNull();

    fireEvent.click(await acknowledgeButton());
    await settle();
    const panel = await custodyPanel();
    expect(within(panel).getByText('0 of 2 placed')).toBeInTheDocument();
    for (const id of [LSU_1, LSU_2]) {
      expect(screen.getByTestId(`receive-held-unit-${id}`)).toHaveAttribute('data-placed', 'false');
    }
    fireEvent.change(await screen.findByLabelText(/actual delivery date/i), { target: { value: DELIVERY_DATE } });
    expect(closeButton()).toBeDisabled();
    expect(screen.getByText('2 held units need a problem bin before closing.')).toBeInTheDocument();
    expect(store.place).not.toHaveBeenCalled();
    expectNoAccountingWrites(props);
  });

  it('H2 — a scanned bin barcode resolves and stays selected; each scanned LSU is placed, refreshed, then Close succeeds', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1, LSU_2] }]);
    const props = await heldJobAtReview(store);

    scan(binInput(), 'BC-PROB-1');
    await waitFor(() => expect(store.resolveBin).toHaveBeenCalledWith(JOB_ID, 'BC-PROB-1'));
    expect(await screen.findByTestId('receive-problem-bin')).toHaveTextContent('PROB-1');

    scan(unitInput(), LSU_1);
    await waitFor(() => expect(store.place).toHaveBeenCalledWith(JOB_ID, { lasyncro_unit_id: LSU_1, location_code: 'PROB-1' }));
    await settle();
    expect(screen.getByTestId(`receive-held-unit-${LSU_1}`)).toHaveAttribute('data-placed', 'true');
    // The bin is still selected for the next unit.
    expect(screen.getByTestId('receive-problem-bin')).toHaveTextContent('PROB-1');

    scan(unitInput(), LSU_2.toLowerCase());
    await waitFor(() => expect(store.place).toHaveBeenCalledTimes(2));
    await settle();
    expect(within(await custodyPanel()).getByText('2 of 2 placed')).toBeInTheDocument();
    expect(store.resolveBin).toHaveBeenCalledTimes(1);

    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expectNoAccountingWrites(props);
  });

  it('H3 — manual entry: a typed location code resolves; an invalid bin is refused and nothing is selected', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1] }]);
    await heldJobAtReview(store);

    scan(binInput(), 'PICK-7');
    expect(await screen.findByText("That isn't an active problem bin. Scan a bin in a problem zone.")).toBeInTheDocument();
    expect(screen.queryByTestId('receive-problem-bin')).toBeNull();
    expect(screen.queryByLabelText('Held unit label')).toBeNull();

    scan(binInput(), 'PROB-2');
    expect(await screen.findByTestId('receive-problem-bin')).toHaveTextContent('PROB-2');
    fireEvent.click(screen.getByRole('button', { name: /change bin/i }));
    expect(screen.queryByTestId('receive-problem-bin')).toBeNull();
    expect(store.place).not.toHaveBeenCalled();
  });

  it('H4 — unknown labels and duplicate scans of a placed unit never reach the server', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1, LSU_2] }]);
    await heldJobAtReview(store);
    scan(binInput(), 'PROB-1');
    await screen.findByTestId('receive-problem-bin');

    scan(unitInput(), 'LSU-ffffffff');
    expect(await screen.findByText('That label isn’t a held unit of this Receive.')).toBeInTheDocument();
    expect(store.place).not.toHaveBeenCalled();

    scan(unitInput(), LSU_1);
    await waitFor(() => expect(store.place).toHaveBeenCalledTimes(1));
    await settle();
    scan(unitInput(), LSU_1);
    expect(await screen.findByText(`${LSU_1} is already in PROB-1.`)).toBeInTheDocument();
    expect(store.place).toHaveBeenCalledTimes(1);
  });

  it('H5 — an interrupted placement is retried by scanning again; a replayed response and a conflict are reported', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1, LSU_2] }]);
    await heldJobAtReview(store);
    scan(binInput(), 'PROB-1');
    await screen.findByTestId('receive-problem-bin');

    // Network loss: no response at all.
    finalizedStorePlaceFailures.push(new Error('Network Error'));
    scan(unitInput(), LSU_1);
    expect(await screen.findByText("Couldn't reach the server. Scan again to retry — nothing is placed twice.")).toBeInTheDocument();
    expect(screen.getByTestId(`receive-held-unit-${LSU_1}`)).toHaveAttribute('data-placed', 'false');

    // The server had placed it before the response was lost (the screen still
    // shows the last fetched state): the retry is answered as a replay.
    // New objects: the store's fetch copies lines shallowly, so mutating the
    // shared unit object would also change what is already on screen.
    store.lines[0].held_units = store.lines[0].held_units.map((u: any, i: number) => (
      i === 0 ? { ...u, placed: true, location_code: 'PROB-1' } : u));
    scan(unitInput(), LSU_1);
    await waitFor(() => expect(store.place).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(`${LSU_1} was already recorded in PROB-1.`)).toBeInTheDocument();
    await settle();
    expect(screen.getByTestId(`receive-held-unit-${LSU_1}`)).toHaveAttribute('data-placed', 'true');

    finalizedStorePlaceFailures.push(httpError409('RECEIVE_HELD_CUSTODY_REPLAY_CONFLICT'));
    scan(unitInput(), LSU_2);
    expect(await screen.findByText('That scan conflicts with a placement already recorded. Scan the unit again.')).toBeInTheDocument();
    expect(screen.getByTestId(`receive-held-unit-${LSU_2}`)).toHaveAttribute('data-placed', 'false');
    expect(closeButton()).toBeDisabled();
  });

  it('H6 — a server refusal for incomplete custody at Close is explained, not treated as closed', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, barcode: EXTERNAL, held: [LSU_1] }]);
    await heldJobAtReview(store);
    scan(binInput(), 'PROB-1');
    await screen.findByTestId('receive-problem-bin');
    scan(unitInput(), LSU_1);
    await waitFor(() => expect(store.place).toHaveBeenCalledTimes(1));
    await settle();
    // Another device moved the job back out of custody readiness: the server refuses.
    store.close.mockRejectedValueOnce(httpError409('RECEIVE_HELD_CUSTODY_REQUIRED'));
    await closeWithDate();
    expect(await screen.findByText('Some units held for repair still need placing in a problem bin before this Receive can close.')).toBeInTheDocument();
    expect(screen.queryByText('Receive complete')).toBeNull();
  });

  it('H7 — a Receive without held units shows no custody step and closes as before (control)', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 2, barcode: EXTERNAL }]);
    await renderFinalized(store);
    expect(screen.queryByTestId('receive-held-custody')).toBeNull();
    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    expect(store.resolveBin).not.toHaveBeenCalled();
    expect(store.place).not.toHaveBeenCalled();
  });
});
