// GH-1241 / S3-C — S3C-M4 LABELS, CLOSE, STOW HANDOFF — RED regression gate.
//
// After grouped finalization (M3) the session routes to grouped_finalized and
// the existing label / close / handoff flow takes over. Ratified (S3C-M4):
//   L1 a barcode-less finalized product offers "Print labels" for its own line,
//      and also allows an explicit acknowledgement when the labels were printed
//      and attached elsewhere; nothing is acknowledged automatically.
//   L2 several label-held products are handled one after another, each with
//      its own print and acknowledgement; none can be skipped.
//   L3 a lost close response followed by "Already closed" re-reads the
//      canonical job; only a confirmed closed job shows the handoff, any other
//      refusal stays an error.
//   L5 a close that accepted nothing says so: "Receive complete. No usable
//      items received. Nothing to put away." — no Stow claim.
// Controls: external barcodes skip labels; readiness gates Close; accounting
// writers stay refused after finalization; no stock/Stow writer before Close;
// reload restores the correct held line; nothing is written on mount.
//
// Renders the REAL WmsModuleFT2 (and through it the real ReceiveSessionPage)
// entered through the pendingReceiveSession handoff seam, with mocked host
// callbacks backed by a small canonical store of the finalized job.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const JOB_ID = 'a1b2c3d4-1006-4000-8000-000000000404';
const LINE_A = '11111111-1006-4000-8000-0000000000a1';
const LINE_B = '11111111-1006-4000-8000-0000000000b2';
const OPERATOR_ID = 3;
const DELIVERY_DATE = '2026-10-13';

type LineSpec = { id: string; title: string; accepted: number; expected?: number; barcode?: string | null; labelled?: boolean };

/** A finalized line (inspection complete) as GET /receive-jobs/:id projects it. */
function finalizedLine(spec: LineSpec): ReceiveJobLine {
  const external = spec.barcode != null;
  const ready = spec.accepted <= 0 || external || spec.labelled === true;
  return {
    receive_job_line_id: spec.id,
    lasyncro_variant_id: `variant-${spec.id.slice(-2)}`,
    sku: `SKU-${spec.id.slice(-2)}`,
    variant_title: 'Default Title',
    // The label hold names the product by its line description.
    description: spec.title,
    quantity_expected: spec.expected ?? spec.accepted,
    quantity_accepted: spec.accepted,
    quantity_rejected: 0,
    quantity_missing: (spec.expected ?? spec.accepted) - spec.accepted,
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
    reported_problems: [],
  } as ReceiveJobLine;
}

function httpError(status: number, error: string) {
  return Object.assign(new Error(error), { response: { status, data: { error } } });
}

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
        labelled_unit_count: l.quantity_accepted });
      markReadiness();
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
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── cases ────────────────────────────────────────────────────────────────────

describe('GH-1241 S3C-M4 — grouped-finalized labels, close and Stow handoff', () => {
  it('L1 — a barcode-less finalized product offers Print labels for its line; acknowledgement stays explicit', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 2 }]);
    const props = await renderFinalized(store);

    const panel = await holdPanel();
    expect(panel).toHaveTextContent('Widget A');
    // Printed and attached on another device: acknowledgement is available without printing here.
    expect(await acknowledgeButton()).toBeEnabled();
    expect(store.acknowledgeLabels).not.toHaveBeenCalled();

    expect(printButton()).not.toBeNull();
    fireEvent.click(printButton()!);
    await waitFor(() => expect(store.printLabels).toHaveBeenCalledTimes(1));
    expect(store.printLabels).toHaveBeenCalledWith(LINE_A);
    await settle();
    // Printing is not acknowledgement, and Close stays gated.
    expect(store.acknowledgeLabels).not.toHaveBeenCalled();
    expect(closeButton()).toBeNull();
    expectNoAccountingWrites(props);
  });

  it('L2 — two label-held products: acknowledging A moves to B, and B is acknowledged for B; neither is skipped', async () => {
    const store = finalizedStore([
      { id: LINE_A, title: 'Widget A', accepted: 2 },
      { id: LINE_B, title: 'Widget B', accepted: 1 },
    ]);
    const props = await renderFinalized(store);

    expect(await holdPanel()).toHaveTextContent('Widget A');
    fireEvent.click(await acknowledgeButton());
    await waitFor(() => expect(store.acknowledgeLabels).toHaveBeenCalledWith(LINE_A));

    await waitFor(async () => expect(await holdPanel()).toHaveTextContent('Widget B'));
    expect(closeButton()).toBeNull();
    fireEvent.click(await acknowledgeButton());
    await waitFor(() => expect(store.acknowledgeLabels).toHaveBeenCalledTimes(2));
    expect(store.acknowledgeLabels.mock.calls).toEqual([[LINE_A], [LINE_B]]);

    await waitFor(() => expect(closeButton()).not.toBeNull());
    expect(store.close).not.toHaveBeenCalled();
    expectNoAccountingWrites(props);
  });

  it('L2b — the second held product prints its own labels', async () => {
    const store = finalizedStore([
      { id: LINE_A, title: 'Widget A', accepted: 2 },
      { id: LINE_B, title: 'Widget B', accepted: 1 },
    ]);
    const props = await renderFinalized(store);

    fireEvent.click(await acknowledgeButton());
    await waitFor(() => expect(store.acknowledgeLabels).toHaveBeenCalledWith(LINE_A));
    await waitFor(async () => expect(await holdPanel()).toHaveTextContent('Widget B'));

    expect(printButton()).not.toBeNull();
    fireEvent.click(printButton()!);
    await waitFor(() => expect(store.printLabels).toHaveBeenCalledWith(LINE_B));
    expect(store.printLabels.mock.calls).toEqual([[LINE_B]]);
    expectNoAccountingWrites(props);
  });

  // Ratified: an ambiguous (unanswered) close response and an "Already closed"
  // refusal both re-read the canonical job; only a confirmed closed job shows
  // the handoff. Split into the two triggers (the original single case assumed
  // no re-read after the lost response, which contradicts the ratified rule).
  it('L3 — a lost close response re-reads the job and shows the handoff because it is canonically closed', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, expected: 3, barcode: '5012345678900' }]);
    const props = await renderFinalized(store);
    expect(closeButton()).not.toBeNull();

    // The server closed the job, but the response never arrived.
    store.close.mockImplementationOnce(async () => {
      Object.assign(store.job, { status: 'closed', closed_at: '2026-10-13T13:00:00.000Z', actual_delivery_date: DELIVERY_DATE });
      throw Object.assign(new Error('Network Error'), { request: {}, response: undefined });
    });

    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.fetchJob).toHaveBeenCalled());
    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(store.close).toHaveBeenCalledTimes(1);
    expectNoAccountingWrites(props);
  });

  it('L3c — "Already closed" re-reads the job and shows the handoff only once it is confirmed closed', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, expected: 3, barcode: '5012345678900' }]);
    const props = await renderFinalized(store);

    // Closed elsewhere (another device, or an earlier lost response).
    Object.assign(store.job, { status: 'closed', closed_at: '2026-10-13T13:00:00.000Z', actual_delivery_date: DELIVERY_DATE });
    store.close.mockRejectedValueOnce(httpError(409, `[RECEIVE_JOB_CLOSE] Already closed: ${JOB_ID}`));

    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.fetchJob).toHaveBeenCalled());
    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(store.close).toHaveBeenCalledTimes(1);
    expectNoAccountingWrites(props);
  });

  it('L3b — any other close refusal stays an error and never shows the handoff', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, expected: 3, barcode: '5012345678900' }]);
    const props = await renderFinalized(store);
    store.close.mockRejectedValueOnce(httpError(409, 'RECEIVE_BARCODE_READINESS_REQUIRED: labels outstanding'));

    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByText('Receive complete')).toBeNull();
    expect(closeButton()).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Some unit labels still need confirmation before this Receive can close.');
    expectNoAccountingWrites(props);
  });

  it('L5 — a closed Receive that accepted nothing says so and makes no Stow claim', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 0, expected: 3 }], { closed: true });
    const props = moduleProps(store);
    render(<WmsModuleFT2 {...props} />);

    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/No usable items received\./);
    expect(document.body).toHaveTextContent(/Nothing to put away\./);
    expect(document.body).not.toHaveTextContent(/available for Stow/i);
    await settle();
    expectNoAccountingWrites(props);
    expect(store.close).not.toHaveBeenCalled();
  });

  it('L5b — a closed Receive with accepted units still hands them to Stow (control)', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, expected: 3, barcode: '5012345678900' }], { closed: true });
    const props = moduleProps(store);
    render(<WmsModuleFT2 {...props} />);

    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/available for Stow/i);
    expect(document.body).not.toHaveTextContent(/Nothing to put away/i);
    expectNoAccountingWrites(props);
  });

  it('C1 — external barcodes skip labels; Close needs the delivery date and is the only stock-side write (control)', async () => {
    const store = finalizedStore([{ id: LINE_A, title: 'Widget A', accepted: 1, expected: 3, barcode: '5012345678900' }]);
    const props = await renderFinalized(store);

    expect(screen.queryByTestId('confirm-unit-labels-printed')).toBeNull();
    expect(store.printLabels).not.toHaveBeenCalled();
    expect(closeButton()).toBeDisabled();
    expect(store.close).not.toHaveBeenCalled();

    await closeWithDate();
    await waitFor(() => expect(store.close).toHaveBeenCalledTimes(1));
    expect(store.close).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ actual_delivery_date: DELIVERY_DATE }));
    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(store.acknowledgeLabels).not.toHaveBeenCalled();
    expectNoAccountingWrites(props);
  });

  it('C2 — reload restores the product still awaiting labels; Close stays gated and nothing is written on mount (control)', async () => {
    const store = finalizedStore([
      { id: LINE_A, title: 'Widget A', accepted: 2, labelled: true },
      { id: LINE_B, title: 'Widget B', accepted: 1 },
    ]);
    const props = await renderFinalized(store);

    expect(await holdPanel()).toHaveTextContent('Widget B');
    expect(closeButton()).toBeNull();
    await settle();
    expect(store.printLabels).not.toHaveBeenCalled();
    expect(store.acknowledgeLabels).not.toHaveBeenCalled();
    expect(store.close).not.toHaveBeenCalled();
    expectNoAccountingWrites(props);
  });
});
