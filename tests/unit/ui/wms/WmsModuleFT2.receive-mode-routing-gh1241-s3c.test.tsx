// GH-1241 / S3-C — S3C-M1 RECEIVE SESSION MODE ROUTING — RED regression gate.
//
// Ratified modes (S3C-M1 brief): a Receive session is routed from canonical
// job data (receive_jobs.delivery_accounting_version, per-line
// inspection_complete) plus GET /receive-jobs/:jobId/reconciliation evidence:
//   M1 legacy v1                     → existing per-line journey; no grouped writes
//   M2 fresh v2 (open, none inspected) → grouped journey
//   M3 v2 draft                      → restore the current revision; never a new revision on mount
//   M4 v2 grouped-finalized          → restore finalization; continue to close; no accounting writes
//   M5 v2 inspected per-line, no draft → keep the per-line journey; never grouped finalization
//   M6 unknown / unavailable evidence → fail closed; no accounting writes
//   M7 v2 draft + per-line inspection → conflicting state; fail closed
// Safety: no grouped action before mode resolution; no legacy accounting
// callback in grouped mode; expected visible, physical count never
// prefilled/auto-confirmed; refresh preserves the canonical mode; a closed job
// keeps the canonical completion handoff.
//
// Renders the REAL WmsModuleFT2 (and through it the real ReceiveSessionPage)
// with mocked host/API callbacks only, entering through the real Receive work
// card (GH-1109 precedent) or the pendingReceiveSession refresh seam
// (RECEIVE-FOCUS-EXIT-02 precedent).
//
// PROVISIONAL INTERFACE. Grouped routing is not implemented. Every assumed
// prop / marker name lives in the S3C adapter below (GH-1143 precedent: new
// props passed via `as any`); exact spelling is for engineering-lead
// ratification, not a product decision.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

// ── PROVISIONAL S3-C adapter (NOT ratified) ──────────────────────────────────
const S3C = {
  /** Host callback: GET /receive-jobs/:jobId/reconciliation body (S3-B read contract). */
  fetchReconciliationProp: 'onFetchReceiveReconciliation',
  /** Host callback: PUT /reconciliation/draft. */
  saveDraftProp: 'onSaveReceiveReconciliationDraft',
  /** Host callback: POST /reconciliation/finalize. */
  finalizeProp: 'onFinalizeReceiveReconciliation',
  /** pendingReceiveSession field normalized from job.delivery_accounting_version (§22 data seam). */
  versionField: 'deliveryAccountingVersion',
  /** Machine-readable resolved mode of the active Receive session. */
  modeTestId: 'receive-session-mode',
  modeAttr: 'data-receive-mode',
  revisionAttr: 'data-current-revision-id',
  modes: { perLine: 'per_line', grouped: 'grouped', finalized: 'grouped_finalized', unavailable: 'unavailable' },
};

const JOB_ID = 'job-s3c-m1';
const OPERATOR_ID = 3;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-s3c-1',
    lasyncro_variant_id: 'variant-s3c-1',
    sku: 'S3C-SKU-1',
    variant_title: 'Default Title',
    description: 'S3-C receive line',
    quantity_expected: 10,
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
    product_title: 'S3-C widget',
    barcode_ready: false,
    barcode_readiness_reason: 'not_inspected',
    awaiting_label_ack: false,
    accepted_unit_count: 0,
    labelled_unit_count: 0,
    ...overrides,
  };
}

/** A per-line-finished line (GET receive job shape after inspect). */
function inspectedLine(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return line({
    receive_job_line_id: 'line-s3c-2',
    lasyncro_variant_id: 'variant-s3c-2',
    sku: 'S3C-SKU-2',
    quantity_expected: 4,
    quantity_accepted: 4,
    quantity_count_confirmed: 4,
    count_state: 'inspected',
    inspection_complete: true,
    barcode: '5012345678900',
    barcode_ready: true,
    barcode_readiness_reason: 'external_barcode',
    ...overrides,
  });
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    po_id: 'po-s3c-m1',
    po_number: 1241,
    supplier_name: 'S3-C Supplier',
    status: 'in_progress',
    assigned_operator_id: OPERATOR_ID,
    closed_at: null,
    actual_delivery_date: null,
    delivery_accounting_version: 2,
    ...overrides,
  };
}

/** S3-B GET /reconciliation shapes. */
function reconciliationLine(l: ReceiveJobLine) {
  return {
    receive_job_line_id: l.receive_job_line_id,
    po_line_item_id: `poli-${l.receive_job_line_id}`,
    lasyncro_variant_id: l.lasyncro_variant_id,
    quantity_expected: l.quantity_expected,
    quantity_count_confirmed: l.quantity_count_confirmed ?? null,
    count_state: l.quantity_count_confirmed == null ? 'not_counted' : 'confirmed',
    inspection_complete: Boolean(l.inspection_complete),
  };
}

function groupedPayload(l: ReceiveJobLine, overrides: Record<string, unknown> = {}) {
  return {
    receive_job_line_id: l.receive_job_line_id,
    quantity_accepted: 8,
    quantity_rejected: 0,
    quantity_missing: 0,
    quantity_deferred: 2,
    quantity_held_recoverable: 0,
    new_exceptions: [],
    existing_exception_ids: [],
    ...overrides,
  };
}

function openReconciliation(lines: ReceiveJobLine[]) {
  return {
    receive_job_id: JOB_ID,
    status: 'open',
    current_revision_id: null,
    revisions: [],
    lines: lines.filter((l) => l.quantity_expected > 0).map(reconciliationLine),
    finalization: null,
  };
}

function draftReconciliation(lines: ReceiveJobLine[]) {
  const applicable = lines.filter((l) => l.quantity_expected > 0);
  return {
    ...openReconciliation(lines),
    status: 'draft',
    current_revision_id: 'rev-b',
    revisions: [
      { revision_id: 'rev-a', revision_number: 1, base_revision_id: null, status: 'superseded', created_by: OPERATOR_ID,
        created_at: '2026-10-13T09:00:00.000Z', lines: applicable.map((l) => groupedPayload(l, { quantity_deferred: 0, quantity_missing: 2,
          new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall', notes: null }] })) },
      { revision_id: 'rev-b', revision_number: 2, base_revision_id: 'rev-a', status: 'current', created_by: OPERATOR_ID,
        created_at: '2026-10-13T09:05:00.000Z', lines: applicable.map((l) => groupedPayload(l)) },
    ],
  };
}

function finalizedReconciliation(lines: ReceiveJobLine[]) {
  const draft = draftReconciliation(lines);
  return {
    ...draft,
    status: 'finalized',
    finalization: {
      reconciliation_id: 'recon-s3c',
      revision_id: 'rev-b',
      device_event_id: '6f1f0e1c-0000-4000-8000-000000000001',
      finalized_by: OPERATOR_ID,
      finalized_at: '2026-10-13T09:10:00.000Z',
      lines: draft.revisions[1].lines.map((p: any) => ({
        ...p, quantity_expected: 10, quantity_count_confirmed: 8, count_confirmation_event_id: 'ce-1',
        quantity_overage_approved: 0, created_exception_ids: [], referenced_exception_ids: [],
      })),
    },
  };
}

// ── host props (WmsModuleFT2 Receive precedent: GH-1109 / RECEIVE-FOCUS-EXIT-02) ──

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: [] },
    isLoading: false,
    isError: false,
    currentUserId: OPERATOR_ID,
    openReceiveJobs: [{
      receive_job_id: JOB_ID,
      status: 'in_progress',
      assigned_operator_id: OPERATOR_ID,
      started_at: '2026-10-13T08:00:00.000Z',
      closed_at: null,
      supplier_name: 'S3-C Supplier',
      po_id: 'po-s3c-m1',
      po_number: 1241,
      total_units: 10,
      total_variants: 1,
    }],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    onFetchReceiveJob: jest.fn(),
    onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
    onInspectReceiveLine: jest.fn().mockResolvedValue(undefined),
    onPersistReceiveLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmReceiveLineCount: jest.fn().mockResolvedValue(undefined),
    onReportReceiveException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onCloseReceiveJob: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    [S3C.fetchReconciliationProp]: jest.fn(),
    [S3C.saveDraftProp]: jest.fn().mockResolvedValue({ revision_id: 'rev-new', revision_number: 3, base_revision_id: null }),
    [S3C.finalizeProp]: jest.fn().mockResolvedValue({ status: 'finalized', reconciliation_id: 'recon-new' }),
    onClaimBatch: jest.fn(),
    onFetchLineItems: jest.fn(),
    onResolveBarcode: jest.fn(),
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

/** Real in-module entry: the operator's own in-progress Receive work card. */
function enterViaWorkCard(props: any) {
  const view = render(<WmsModuleFT2 {...props} />);
  fireEvent.click(
    within(screen.getByTestId(`receive-work-card-${JOB_ID}`)).getByRole('button', { name: /resume receive/i })
  );
  return view;
}

/** Refresh / deep-link seam: WmsOperationsPage → pendingReceiveSession. */
function pendingSession(jobData: Record<string, any>, lines: ReceiveJobLine[]) {
  return {
    receiveJobId: JOB_ID,
    poId: jobData.po_id,
    poNumber: jobData.po_number,
    supplierName: jobData.supplier_name,
    jobStatus: jobData.status,
    assignedOperatorId: jobData.assigned_operator_id,
    closedAt: jobData.closed_at,
    actualDeliveryDate: jobData.actual_delivery_date,
    [S3C.versionField]: jobData.delivery_accounting_version,
    lines,
  };
}

async function resolvedMode(expected: string) {
  const marker = await screen.findByTestId(S3C.modeTestId);
  await waitFor(() => expect(marker).toHaveAttribute(S3C.modeAttr, expected));
  return marker;
}

/** No accounting write of either journey. Count confirmation is the operator's explicit act only. */
function expectNoAccountingWrites(props: any) {
  for (const name of [
    'onInspectReceiveLine', 'onPersistReceiveLineProgress', 'onConfirmReceiveLineCount',
    'onReportReceiveException', 'onApproveOverDelivery', 'onCloseReceiveJob',
    S3C.saveDraftProp, S3C.finalizeProp,
  ]) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

function expectNoGroupedWrites(props: any) {
  expect(props[S3C.saveDraftProp]).not.toHaveBeenCalled();
  expect(props[S3C.finalizeProp]).not.toHaveBeenCalled();
}

/** Fail-closed surface: an explanation, and no count/close action of either journey. */
async function expectFailedClosed() {
  await resolvedMode(S3C.modes.unavailable);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /finish count/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start receive/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /close receive/i })).not.toBeInTheDocument();
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

describe('GH-1241 S3C-M1 — Receive session mode routing', () => {
  it('M1 — legacy v1 keeps the existing per-line journey and never writes grouped evidence', async () => {
    const lines = [line()];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job({ delivery_accounting_version: 1 }), lines });
    props[S3C.fetchReconciliationProp].mockResolvedValue(openReconciliation(lines));

    enterViaWorkCard(props);

    await resolvedMode(S3C.modes.perLine);
    expect(await screen.findByRole('button', { name: /finish count/i })).toBeInTheDocument();
    expectNoGroupedWrites(props);
    expect(props.onConfirmReceiveLineCount).not.toHaveBeenCalled();
  });

  it('M2 — fresh v2 (open, nothing inspected) selects the grouped journey only after evidence resolves, with no writes and no prefilled count', async () => {
    const lines = [line()];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });
    let resolveReconciliation!: (value: unknown) => void;
    props[S3C.fetchReconciliationProp].mockReturnValue(new Promise((resolve) => { resolveReconciliation = resolve; }));

    enterViaWorkCard(props);

    // Before the canonical evidence resolves: no journey action of either kind.
    await waitFor(() => expect(props[S3C.fetchReconciliationProp]).toHaveBeenCalledWith(JOB_ID));
    expect(screen.queryByRole('button', { name: /finish count/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId(S3C.modeTestId)?.getAttribute(S3C.modeAttr) ?? null)
      .not.toBe(S3C.modes.grouped);
    expectNoAccountingWrites(props);

    resolveReconciliation(openReconciliation(lines));
    const marker = await resolvedMode(S3C.modes.grouped);
    // Nothing to restore: no revision exists, and none is created on mount.
    expect(marker.getAttribute(S3C.revisionAttr) ?? '').toBe('');

    // Expected is shown; the physical count is never inferred or auto-confirmed.
    await waitFor(() => expect(document.body).toHaveTextContent(/expected/i));
    expect(document.body).toHaveTextContent('10');
    expectNoAccountingWrites(props);
  });

  it('M3 — v2 draft restores the current revision on mount and across refresh, never creating a new revision', async () => {
    const lines = [line({ quantity_count_confirmed: 8, count_state: 'confirmed', quantity_sellable_provisional: 8 })];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });
    props[S3C.fetchReconciliationProp].mockResolvedValue(draftReconciliation(lines));

    enterViaWorkCard(props);
    const marker = await resolvedMode(S3C.modes.grouped);
    expect(marker).toHaveAttribute(S3C.revisionAttr, 'rev-b');
    expectNoAccountingWrites(props);

    // Browser refresh: the session is rebuilt from the pendingReceiveSession seam.
    cleanup();
    const refreshed = baseProps({ pendingReceiveSession: pendingSession(job(), lines) });
    refreshed[S3C.fetchReconciliationProp].mockResolvedValue(draftReconciliation(lines));
    render(<WmsModuleFT2 {...refreshed} />);
    const restored = await resolvedMode(S3C.modes.grouped);
    expect(restored).toHaveAttribute(S3C.revisionAttr, 'rev-b');
    expect(refreshed[S3C.fetchReconciliationProp]).toHaveBeenCalledWith(JOB_ID);
    expectNoAccountingWrites(refreshed);
  });

  it('M4 — v2 grouped-finalized restores the finalization and continues to close past an excluded expected-zero line, with no accounting writes', async () => {
    const finalized = line({
      quantity_accepted: 8, quantity_deferred: 2, quantity_count_confirmed: 8, count_state: 'inspected',
      inspection_complete: true, barcode: '5012345678900', barcode_ready: true, barcode_readiness_reason: 'external_barcode',
    });
    // Excluded by S3-B: no count, no inspection, absent from readiness.
    const excludedZero = line({
      receive_job_line_id: 'line-s3c-zero', lasyncro_variant_id: 'variant-s3c-zero', sku: 'S3C-ZERO', quantity_expected: 0,
    });
    const lines = [finalized, excludedZero];
    const props = baseProps({ pendingReceiveSession: pendingSession(job({ status: 'stow_ready' }), lines) });
    props[S3C.fetchReconciliationProp].mockResolvedValue(finalizedReconciliation([finalized]));

    render(<WmsModuleFT2 {...props} />);

    await resolvedMode(S3C.modes.finalized);
    expect(await screen.findByRole('button', { name: /close receive/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finish count/i })).not.toBeInTheDocument();
    expectNoAccountingWrites(props);
  });

  it('M4b — a closed grouped job keeps the canonical completion handoff and writes nothing', async () => {
    const finalized = line({
      quantity_accepted: 8, quantity_deferred: 2, quantity_count_confirmed: 8, count_state: 'inspected',
      inspection_complete: true, barcode: '5012345678900', barcode_ready: true, barcode_readiness_reason: 'external_barcode',
    });
    const props = baseProps({
      pendingReceiveSession: pendingSession(
        job({ status: 'closed', closed_at: '2026-10-13T10:00:00.000Z', actual_delivery_date: '2026-10-13' }), [finalized]
      ),
    });
    props[S3C.fetchReconciliationProp].mockResolvedValue(finalizedReconciliation([finalized]));

    render(<WmsModuleFT2 {...props} />);

    expect(await screen.findByRole('button', { name: 'Back to WMS' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close receive/i })).not.toBeInTheDocument();
    expectNoAccountingWrites(props);
  });

  it('M5 — v2 already inspected per-line without a draft keeps the per-line journey and never attempts grouped finalization', async () => {
    const lines = [line(), inspectedLine()];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });
    props[S3C.fetchReconciliationProp].mockResolvedValue(openReconciliation(lines));

    enterViaWorkCard(props);

    await resolvedMode(S3C.modes.perLine);
    expect(await screen.findByRole('button', { name: /finish count/i })).toBeInTheDocument();
    expectNoGroupedWrites(props);
  });

  it('M6a — unavailable reconciliation evidence fails closed with no accounting writes', async () => {
    const lines = [line()];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });
    props[S3C.fetchReconciliationProp].mockRejectedValue(new Error('Request failed with status code 503'));

    enterViaWorkCard(props);

    await expectFailedClosed();
    expectNoAccountingWrites(props);
  });

  it('M6b — an unknown delivery-accounting version fails closed with no accounting writes', async () => {
    const lines = [line()];
    const props = baseProps();
    const unknownVersionJob: Record<string, unknown> = job();
    delete unknownVersionJob.delivery_accounting_version;
    props.onFetchReceiveJob.mockResolvedValue({ job: unknownVersionJob, lines });
    props[S3C.fetchReconciliationProp].mockResolvedValue(openReconciliation(lines));

    enterViaWorkCard(props);

    await expectFailedClosed();
    expectNoAccountingWrites(props);
  });

  it('M6c — a v2 session whose host cannot read reconciliation evidence fails closed instead of falling back', async () => {
    const lines = [line()];
    const props = baseProps();
    delete props[S3C.fetchReconciliationProp];
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });

    enterViaWorkCard(props);

    await expectFailedClosed();
    expectNoAccountingWrites(props);
  });

  it('M7 — a v2 draft alongside a per-line inspected line is conflicting and fails closed', async () => {
    const counted = line({ quantity_count_confirmed: 8, count_state: 'confirmed', quantity_sellable_provisional: 8 });
    const lines = [counted, inspectedLine()];
    const props = baseProps();
    props.onFetchReceiveJob.mockResolvedValue({ job: job(), lines });
    props[S3C.fetchReconciliationProp].mockResolvedValue(draftReconciliation(lines));

    enterViaWorkCard(props);

    await expectFailedClosed();
    expectNoAccountingWrites(props);
  });
});
