// GH-1241 / S3-C — S3C-M3 GROUPED REVIEW / FINALIZATION — RED regression gate.
//
// Ratified (S3C-M3): a counted grouped Receive is reviewed before it is
// finalized. Counted means usable/good units; damaged units are recorded
// separately as rejected. Every applicable line needs a confirmed count. A
// difference is never assumed: the shortfall is split explicitly into Missing
// (never arrived), Coming later and Damaged, summing exactly; an over-count
// needs explicit overage approval. Existing missing evidence is referenced,
// never duplicated. The client saves a revision, then finalizes exactly that
// payload against that revision. A count changed after a saved decision
// invalidates it; a stale revision never finalizes. No stock, label or close
// write in M3; finalization hands over to the M4 label/close flow.
//
// Renders the REAL WmsModuleFT2 (and through it the real ReceiveSessionPage)
// with mocked host callbacks only. The callbacks are backed by an in-test store
// that applies the S3-B backend rules (receiveReconciliation.service.ts and
// inspectReceiveJobLine): base-revision check, identical-payload finalize,
// applicable lines only, confirmed count == accepted, balanced accounting,
// persisted overage approval, canonical missing evidence. Shapes follow the
// real endpoints (UUID ids; draft → { revision_id, revision_number,
// base_revision_id, status }; errors → response.data { error, code }).
//
// PROVISIONAL INTERFACE. Review/finalization is not implemented. Every assumed
// prop, control name and marker lives in the M3 adapter below; exact spelling
// is for engineering-lead ratification, not a product decision.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

// ── PROVISIONAL S3C-M3 adapter (NOT ratified) ────────────────────────────────
const M3 = {
  /** Host callbacks (module props): (jobId, payload) => response body. */
  saveDraftProp: 'onSaveReceiveReconciliationDraft',
  finalizeProp: 'onFinalizeReceiveReconciliation',
  /** Counting → review entry, offered once every applicable line is confirmed. */
  review: /^review/i,
  reviewTestId: 'receive-review',
  /** One row per line with a difference: data-difference (count − expected), data-settled. */
  rowTestId: (lineId: string) => `receive-review-line-${lineId}`,
  missing: /missing/i,
  later: /coming later/i,
  damaged: /damaged/i,
  keepExtra: /keep extra units/i,
  editCount: /edit count/i,
  confirm: /confirm and continue/i,
  exit: 'Back to WMS',
  copy: {
    remaining: (n: number) => new RegExp(`assign ${n} more`, 'i'),
    matching: /\d+ products? match/i,
    countChanged: /count changed/i,
    changedElsewhere: /changed.*check again/i,
    goodUnits: /good/i,
  },
};

const JOB_ID = 'a1b2c3d4-1006-4000-8000-000000001006';
const LINE_P = '11111111-1006-4000-8000-000000000001'; // PO-1006: expected 3, counted 1
const LINE_M = '11111111-1006-4000-8000-000000000002'; // matches
const LINE_X = '11111111-1006-4000-8000-000000000003'; // over-count
const LINE_Z = '11111111-1006-4000-8000-000000000004'; // expected-zero, excluded
const EXISTING_MISSING = '22222222-1006-4000-8000-000000000001';
const EXISTING_DEFECT = '22222222-1006-4000-8000-000000000002';
const revisionId = (n: number) => `33333333-1006-4000-8000-${String(n).padStart(12, '0')}`;
const OPERATOR_ID = 3;

function line(id: string, expected: number, confirmed: number | null, overrides: Record<string, unknown> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: id,
    lasyncro_variant_id: `variant-${id.slice(-4)}`,
    sku: `SKU-${id.slice(-4)}`,
    variant_title: 'Default Title',
    description: 'M3 receive line',
    quantity_expected: expected,
    quantity_accepted: 0,
    quantity_rejected: 0,
    quantity_missing: null,
    quantity_deferred: null,
    quantity_sellable_provisional: confirmed,
    reconciliation_started_at: null,
    quantity_count_confirmed: confirmed,
    count_state: confirmed == null ? 'not_counted' : 'confirmed',
    inspection_complete: false,
    image_url: null,
    barcode: `50000000${id.slice(-5)}`,
    product_title: `Widget ${id.slice(-1)}`,
    barcode_ready: false,
    barcode_readiness_reason: 'not_inspected',
    awaiting_label_ack: false,
    accepted_unit_count: 0,
    labelled_unit_count: 0,
    reported_problems: [],
    ...overrides,
  } as ReceiveJobLine;
}

type Exception = { exception_type: string; quantity_affected: number; accounting_role: string | null; notes?: string | null };
type GroupedLine = {
  receive_job_line_id: string;
  quantity_accepted: number;
  quantity_rejected: number;
  quantity_missing: number;
  quantity_deferred: number;
  quantity_held_recoverable?: number;
  new_exceptions?: Exception[];
  existing_exception_ids?: string[];
};
type Revision = { revision_id: string; revision_number: number; base_revision_id: string | null; lines: GroupedLine[] };

function httpError(status: number, code: string) {
  return Object.assign(new Error(`${code}: refused`), { response: { status, data: { error: `${code}: refused`, code } } });
}

/** Canonical form, as parseGroupedLines produces it: order and omitted defaults never change identity. */
function canonical(lines: GroupedLine[]) {
  return [...lines]
    .map((l) => ({
      receive_job_line_id: l.receive_job_line_id.toLowerCase(),
      quantity_accepted: l.quantity_accepted,
      quantity_rejected: l.quantity_rejected,
      quantity_missing: l.quantity_missing,
      quantity_deferred: l.quantity_deferred,
      quantity_held_recoverable: l.quantity_held_recoverable ?? 0,
      new_exceptions: [...(l.new_exceptions ?? [])]
        .map((e) => ({ exception_type: e.exception_type, quantity_affected: e.quantity_affected,
          accounting_role: e.accounting_role ?? (['missing_item', 'defect', 'wrong_item', 'wrong_variant'].includes(e.exception_type) ? 'shortfall' : null) }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      existing_exception_ids: [...(l.existing_exception_ids ?? [])].map((x) => x.toLowerCase()).sort(),
    }))
    .sort((a, b) => a.receive_job_line_id.localeCompare(b.receive_job_line_id));
}

/**
 * In-test canonical store applying the S3-B / S3-A1 backend rules behind the
 * host callbacks (draft, finalize, overage approval, count edits, reads).
 */
function reviewStore(initialLines: ReceiveJobLine[], options: { revisions?: Revision[] } = {}) {
  let job = {
    po_id: 'po-1006', po_number: 1006, supplier_name: 'PO-1006 Supplier', status: 'in_progress',
    assigned_operator_id: OPERATOR_ID, closed_at: null, actual_delivery_date: null, delivery_accounting_version: 2,
  };
  const lines: any[] = initialLines.map((l) => ({ ...l, reported_problems: [...((l as any).reported_problems ?? [])] }));
  const revisions: Revision[] = (options.revisions ?? []).map((r) => ({ ...r, lines: canonical(r.lines) }));
  let finalization: any = null;
  const current = () => revisions[revisions.length - 1] ?? null;
  const applicable = () => lines.filter((l) => Number(l.quantity_expected) > 0);
  const byId = (id: string) => lines.find((l) => l.receive_job_line_id === id);

  const reconciliation = () => ({
    receive_job_id: JOB_ID,
    status: finalization ? 'finalized' : current() ? 'draft' : 'open',
    current_revision_id: current()?.revision_id ?? null,
    revisions: revisions.map((r) => ({ ...r, status: r === current() ? 'current' : 'superseded', created_by: OPERATOR_ID,
      created_at: '2026-10-13T12:00:00.000Z' })),
    lines: applicable().map((l) => ({
      receive_job_line_id: l.receive_job_line_id, po_line_item_id: `poli-${l.receive_job_line_id}`,
      lasyncro_variant_id: l.lasyncro_variant_id, quantity_expected: l.quantity_expected,
      quantity_count_confirmed: l.quantity_count_confirmed,
      count_state: l.quantity_count_confirmed == null ? 'not_counted' : 'confirmed',
      inspection_complete: Boolean(l.inspection_complete),
    })),
    finalization,
  });

  return {
    lines,
    revisions,
    finalized: () => finalization,
    fetchJob: jest.fn(async () => ({ job, lines: lines.map((l) => ({ ...l, reported_problems: [...l.reported_problems] })) })),
    fetchReconciliation: jest.fn(async () => reconciliation()),
    progress: jest.fn(async (_jobId: string, lineId: string, params: { quantity_sellable_provisional: number }) => {
      const l = byId(lineId);
      l.quantity_sellable_provisional = params.quantity_sellable_provisional;
      if (l.quantity_count_confirmed != null && l.quantity_count_confirmed !== params.quantity_sellable_provisional) {
        l.quantity_count_confirmed = null;
        l.count_state = 'not_counted';
      }
    }),
    confirm: jest.fn(async (_jobId: string, lineId: string, params: { quantity_confirmed: number }) => {
      if (finalization) throw httpError(409, 'RECEIVE_RECONCILIATION_FINALIZED');
      const l = byId(lineId);
      l.quantity_count_confirmed = params.quantity_confirmed;
      l.quantity_sellable_provisional = params.quantity_confirmed;
      l.count_state = 'confirmed';
      return { quantity_count_confirmed: params.quantity_confirmed };
    }),
    approveOverDelivery: jest.fn(async (_jobId: string, params: { receive_job_line_id: string; quantity_affected: number }) => {
      byId(params.receive_job_line_id).reported_problems.push({
        receive_exception_id: `44444444-1006-4000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
        exception_type: 'extra_item', quantity_affected: params.quantity_affected, accounting_role: 'overage',
        counts_toward_shortfall: false, resolved: false, notes: null, raised_at: '2026-10-13T12:00:00.000Z',
      });
    }),
    saveDraft: jest.fn(async (_jobId: string, body: { base_revision_id: string | null; lines: GroupedLine[] }) => {
      if (finalization) throw httpError(409, 'RECEIVE_RECONCILIATION_FINALIZED');
      if ((current()?.revision_id ?? null) !== (body.base_revision_id ?? null)) throw httpError(409, 'RECEIVE_RECONCILIATION_REVISION_STALE');
      const known = new Set(lines.map((l) => l.receive_job_line_id));
      if (body.lines.some((l) => !known.has(l.receive_job_line_id))) throw httpError(400, 'RECEIVE_RECONCILIATION_LINE_UNKNOWN');
      const revision: Revision = {
        revision_id: revisionId(revisions.length + 1),
        revision_number: revisions.length + 1,
        base_revision_id: body.base_revision_id ?? null,
        lines: canonical(body.lines),
      };
      revisions.push(revision);
      return { revision_id: revision.revision_id, revision_number: revision.revision_number, base_revision_id: revision.base_revision_id, status: 'current' };
    }),
    finalize: jest.fn(async (_jobId: string, body: { current_revision_id: string; lines: GroupedLine[] }) => {
      if (finalization) throw httpError(409, 'RECEIVE_RECONCILIATION_FINALIZED');
      const head = current();
      if (!head) throw httpError(409, 'RECEIVE_RECONCILIATION_REVISION_REQUIRED');
      if (head.revision_id !== body.current_revision_id) throw httpError(409, 'RECEIVE_RECONCILIATION_REVISION_STALE');
      const payload = canonical(body.lines);
      if (JSON.stringify(payload) !== JSON.stringify(head.lines)) throw httpError(409, 'RECEIVE_RECONCILIATION_PAYLOAD_MISMATCH');
      for (const p of payload) {
        if (Number(byId(p.receive_job_line_id).quantity_expected) <= 0) throw httpError(409, 'RECEIVE_RECONCILIATION_LINE_NOT_APPLICABLE');
      }
      if (applicable().some((l) => !payload.some((p) => p.receive_job_line_id === l.receive_job_line_id))) {
        throw httpError(409, 'RECEIVE_RECONCILIATION_LINES_INCOMPLETE');
      }
      for (const p of payload) {
        const l = byId(p.receive_job_line_id);
        const expected = Number(l.quantity_expected);
        const missingEvidence = l.reported_problems.filter((e: any) => e.exception_type === 'missing_item');
        if (missingEvidence.some((e: any) => !p.existing_exception_ids.includes(e.receive_exception_id))) {
          throw httpError(409, 'RECEIVE_RECONCILIATION_EVIDENCE_UNREFERENCED');
        }
        if (l.quantity_count_confirmed == null) throw httpError(409, 'RECEIVE_COUNT_NOT_CONFIRMED');
        if (Number(l.quantity_count_confirmed) !== p.quantity_accepted) throw httpError(409, 'RECEIVE_COUNT_MISMATCH');
        if (p.quantity_held_recoverable !== 0) throw httpError(409, 'RECEIVE_RECONCILIATION_LINE_INVALID');
        const delivered = p.quantity_accepted + p.quantity_rejected;
        const extra = Math.max(0, delivered - expected);
        const approved = l.reported_problems.filter((e: any) => e.accounting_role === 'overage' && e.exception_type === 'extra_item')
          .reduce((n: number, e: any) => n + Number(e.quantity_affected), 0);
        if (extra > approved) throw httpError(409, 'RECEIVE_RECONCILIATION_LINE_INVALID');
        const canonicalMissing = missingEvidence.reduce((n: number, e: any) => n + Number(e.quantity_affected), 0)
          + p.new_exceptions.filter((e) => e.exception_type === 'missing_item').reduce((n, e) => n + e.quantity_affected, 0);
        if (p.quantity_missing !== canonicalMissing) throw httpError(409, 'RECEIVE_RECONCILIATION_LINE_INVALID');
        if (delivered + p.quantity_missing + p.quantity_deferred !== expected + extra) throw httpError(409, 'RECEIVE_RECONCILIATION_LINE_INVALID');
      }
      // Success: the certified per-line inspection of each applicable line. No stock, no close.
      for (const p of payload) {
        const l = byId(p.receive_job_line_id);
        Object.assign(l, {
          inspection_complete: true, count_state: 'inspected', quantity_accepted: p.quantity_accepted,
          quantity_rejected: p.quantity_rejected, quantity_missing: p.quantity_missing, quantity_deferred: p.quantity_deferred,
          quantity_sellable_provisional: null, barcode_ready: true, barcode_readiness_reason: 'external_barcode',
        });
      }
      job = { ...job, status: 'stow_ready' };
      finalization = {
        reconciliation_id: '55555555-1006-4000-8000-000000000001', revision_id: head.revision_id,
        lines: payload.map((p) => ({ ...p, quantity_expected: Number(byId(p.receive_job_line_id).quantity_expected),
          quantity_count_confirmed: Number(byId(p.receive_job_line_id).quantity_count_confirmed) })),
      };
      return { status: 'finalized', reconciliation_id: finalization.reconciliation_id, revision_id: head.revision_id,
        receive_job_id: JOB_ID, device_event_id: 'host-owned', finalized_at: '2026-10-13T12:05:00.000Z' };
    }),
    pending: () => ({
      receiveJobId: JOB_ID, poId: job.po_id, poNumber: job.po_number, supplierName: job.supplier_name,
      jobStatus: job.status, assignedOperatorId: job.assigned_operator_id, closedAt: job.closed_at,
      actualDeliveryDate: job.actual_delivery_date, deliveryAccountingVersion: job.delivery_accounting_version,
      lines: lines.map((l) => ({ ...l, reported_problems: [...l.reported_problems] })),
    }),
  };
}

type Store = ReturnType<typeof reviewStore>;

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
    onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
    onPersistReceiveLineProgress: store.progress,
    onConfirmReceiveLineCount: store.confirm,
    onApproveOverDelivery: store.approveOverDelivery,
    onResolveBarcode: jest.fn().mockResolvedValue(null),
    [M3.saveDraftProp]: store.saveDraft,
    [M3.finalizeProp]: store.finalize,
    // Writers M3 must never call.
    onInspectReceiveLine: jest.fn().mockResolvedValue(undefined),
    onReportReceiveException: jest.fn().mockResolvedValue(undefined),
    onCloseReceiveJob: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
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

async function renderGrouped(store: Store, overrides: Record<string, unknown> = {}) {
  const props = moduleProps(store, overrides);
  render(<WmsModuleFT2 {...props} />);
  await waitFor(() => expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-receive-mode', 'grouped'));
  await screen.findByPlaceholderText(/scan barcode/i);
  return props;
}

async function openReview() {
  fireEvent.click(await screen.findByRole('button', { name: M3.review }));
  return screen.findByTestId(M3.reviewTestId);
}

const row = (lineId: string) => screen.getByTestId(M3.rowTestId(lineId));
const allocation = (lineId: string, name: RegExp) =>
  within(row(lineId)).getByRole('spinbutton', { name }) as HTMLInputElement;
function assign(lineId: string, name: RegExp, value: number) {
  fireEvent.change(allocation(lineId, name), { target: { value: String(value) } });
}
const confirmButton = () => screen.getByRole('button', { name: M3.confirm });

/** Writers M3 never calls. */
function expectNoForbiddenWrites(props: any) {
  for (const name of ['onInspectReceiveLine', 'onReportReceiveException', 'onCloseReceiveJob', 'onPrintUnitLabels',
    'onConfirmUnitLabelsPrinted', 'onCreateProblemTask']) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

function expectNoWrites(props: any) {
  expectNoForbiddenWrites(props);
  for (const name of ['onPersistReceiveLineProgress', 'onConfirmReceiveLineCount', 'onApproveOverDelivery', M3.saveDraftProp, M3.finalizeProp]) {
    expect({ name, calls: props[name].mock.calls.length }).toEqual({ name, calls: 0 });
  }
}

const savedLine = (store: Store, lineId: string) =>
  store.revisions[store.revisions.length - 1]?.lines.find((l) => l.receive_job_line_id === lineId);

/** The submitted finalize payload is exactly the saved revision's payload, against that revision. */
function expectFinalizedAgainstSavedRevision(store: Store) {
  expect(store.finalize).toHaveBeenCalled();
  const [, body] = store.finalize.mock.calls[store.finalize.mock.calls.length - 1];
  const head = store.revisions[store.revisions.length - 1];
  expect(body.current_revision_id).toBe(head.revision_id);
  expect(canonical(body.lines)).toEqual(head.lines);
  if (store.saveDraft.mock.calls.length > 0) {
    const [, draftBody] = store.saveDraft.mock.calls[store.saveDraft.mock.calls.length - 1];
    expect(body.lines).toEqual(draftBody.lines);
  }
  expect(store.finalized()).not.toBeNull();
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── cases ────────────────────────────────────────────────────────────────────

describe('GH-1241 S3C-M3 — grouped Receive review and finalization', () => {
  it('R1 — review is offered only once every applicable line is confirmed; expected-zero lines never take part; nothing is written', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, null), line(LINE_Z, 0, null)]);
    const props = await renderGrouped(store);
    await settle();
    expect(screen.queryByRole('button', { name: M3.review })).toBeNull();
    expect(screen.queryByTestId(M3.reviewTestId)).toBeNull();
    expectNoWrites(props);

    // Confirming the last applicable line (Z stays untouched) unlocks review.
    fireEvent.click(screen.getByTestId(`receive-count-line-${LINE_M}`));
    fireEvent.change(within(screen.getByTestId('receive-count-current')).getByRole('spinbutton', { name: /count/i }), { target: { value: '2' } });
    fireEvent.click(within(screen.getByTestId('receive-count-current')).getByRole('button', { name: /confirm count/i }));
    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_M, { quantity_confirmed: 2 }));
    const review = await openReview();
    expect(within(review).queryByTestId(M3.rowTestId(LINE_Z))).toBeNull();
    expect(store.saveDraft).not.toHaveBeenCalled();
    expect(store.finalize).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('R2 — PO-1006: expected 3, counted 1 → the 2 short must be assigned; Missing 2 saves a revision, then finalizes exactly it', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2), line(LINE_Z, 0, null)]);
    const props = await renderGrouped(store);
    await openReview();

    expect(row(LINE_P)).toHaveAttribute('data-difference', '-2');
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(row(LINE_P)).toHaveTextContent(M3.copy.remaining(2));
    expect(screen.getByTestId(M3.reviewTestId)).toHaveTextContent(M3.copy.matching);
    expect(confirmButton()).toBeDisabled();

    assign(LINE_P, M3.missing, 2);
    await waitFor(() => expect(row(LINE_P)).toHaveAttribute('data-settled', 'true'));
    expect(store.saveDraft).not.toHaveBeenCalled();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    expect(store.saveDraft.mock.calls[0][1].base_revision_id).toBeNull();
    expect(store.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(store.finalize.mock.invocationCallOrder[0]);
    expect(savedLine(store, LINE_P)).toEqual({
      receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
      quantity_held_recoverable: 0, existing_exception_ids: [],
      new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }],
    });
    expect(savedLine(store, LINE_M)).toEqual({
      receive_job_line_id: LINE_M, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0,
      quantity_held_recoverable: 0, existing_exception_ids: [], new_exceptions: [],
    });
    expect(savedLine(store, LINE_Z)).toBeUndefined();
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R3 — Coming later 2 is deferred, never missing, and creates no exception', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();

    assign(LINE_P, M3.later, 2);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(savedLine(store, LINE_P)).toMatchObject({
      quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 2, new_exceptions: [], existing_exception_ids: [],
    });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R4 — counted means good units: Damaged is rejected beside the good count, never inside it', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    // The count screen asks for usable units only.
    expect(document.body).toHaveTextContent(M3.copy.goodUnits);
    await openReview();

    assign(LINE_P, M3.damaged, 1);
    assign(LINE_P, M3.missing, 1);
    await waitFor(() => expect(row(LINE_P)).toHaveAttribute('data-settled', 'true'));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    // accepted stays the confirmed good count (1); the damaged unit is rejected.
    expect(savedLine(store, LINE_P)).toEqual({
      receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 1, quantity_missing: 1, quantity_deferred: 0,
      quantity_held_recoverable: 0, existing_exception_ids: [],
      new_exceptions: [
        { exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall' },
        { exception_type: 'missing_item', quantity_affected: 1, accounting_role: 'shortfall' },
      ],
    });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R5 — an assignment that does not sum exactly to the difference cannot be confirmed and writes nothing', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();

    assign(LINE_P, M3.missing, 1);
    expect(row(LINE_P)).toHaveTextContent(M3.copy.remaining(1));
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(confirmButton()).toBeDisabled();

    assign(LINE_P, M3.later, 2); // 1 + 2 = 3 > 2
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    await settle();
    expectNoWrites(props);
  });

  it('R6 — matching lines need no decision: accepted is exactly the confirmed count', async () => {
    const store = reviewStore([line(LINE_M, 2, 2), line(LINE_P, 3, 3)]);
    const props = await renderGrouped(store);
    await openReview();
    expect(confirmButton()).toBeEnabled();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(savedLine(store, LINE_P)).toMatchObject({ quantity_accepted: 3, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0, new_exceptions: [] });
    expect(savedLine(store, LINE_M)).toMatchObject({ quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0, new_exceptions: [] });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R7 — an over-count needs explicit "Keep extra units" (one overage approval) before it can be finalized', async () => {
    const store = reviewStore([line(LINE_X, 3, 4), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();

    expect(row(LINE_X)).toHaveAttribute('data-difference', '1');
    expect(row(LINE_X)).toHaveAttribute('data-settled', 'false');
    expect(confirmButton()).toBeDisabled();

    fireEvent.click(within(row(LINE_X)).getByRole('button', { name: M3.keepExtra }));
    await waitFor(() => expect(store.approveOverDelivery).toHaveBeenCalledTimes(1));
    expect(store.approveOverDelivery).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({
      receive_job_line_id: LINE_X, quantity_affected: 1,
    }));
    await waitFor(() => expect(row(LINE_X)).toHaveAttribute('data-settled', 'true'));

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(savedLine(store, LINE_X)).toMatchObject({ quantity_accepted: 4, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0, new_exceptions: [] });
    expect(store.approveOverDelivery).toHaveBeenCalledTimes(1);
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R8 — a saved revision matching the counts restores its decisions with no writes on mount; finishing builds on that revision', async () => {
    const saved: Revision = {
      revision_id: revisionId(1), revision_number: 1, base_revision_id: null,
      lines: [
        { receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
          new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }] },
        { receive_job_line_id: LINE_M, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0 },
      ],
    };
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)], { revisions: [saved] });
    const props = await renderGrouped(store);
    expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-current-revision-id', revisionId(1));
    await settle();
    expectNoWrites(props);

    await openReview();
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'true');
    expect(allocation(LINE_P, M3.missing).value).toBe('2');
    await settle();
    expectNoWrites(props);

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    for (const [, body] of store.saveDraft.mock.calls) expect(body.base_revision_id).toBe(revisionId(1));
    expect(savedLine(store, LINE_P)).toMatchObject({ quantity_accepted: 1, quantity_missing: 2 });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R8b — existing missing evidence is shown and referenced, never duplicated', async () => {
    const store = reviewStore([
      line(LINE_P, 3, 1, { reported_problems: [{
        receive_exception_id: EXISTING_MISSING, exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall',
        counts_toward_shortfall: true, resolved: false, notes: null, raised_at: '2026-10-13T11:00:00.000Z',
      }] }),
      line(LINE_M, 2, 2),
    ]);
    const props = await renderGrouped(store);
    await openReview();

    expect(allocation(LINE_P, M3.missing).value).toBe('2');
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'true');
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(savedLine(store, LINE_P)).toEqual({
      receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
      quantity_held_recoverable: 0, existing_exception_ids: [EXISTING_MISSING], new_exceptions: [],
    });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R9 — a count changed after a saved decision invalidates it: the old revision is never finalized and a new decision is required', async () => {
    const saved: Revision = {
      revision_id: revisionId(1), revision_number: 1, base_revision_id: null,
      lines: [
        { receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
          new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall' }] },
        { receive_job_line_id: LINE_M, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0 },
      ],
    };
    // P was re-confirmed at 2 after revision 1 recorded accepted 1 / missing 2.
    const store = reviewStore([line(LINE_P, 3, 2), line(LINE_M, 2, 2)], { revisions: [saved] });
    const props = await renderGrouped(store);
    await openReview();

    expect(row(LINE_P)).toHaveTextContent(M3.copy.countChanged);
    expect(row(LINE_P)).toHaveAttribute('data-difference', '-1');
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(allocation(LINE_P, M3.missing).value).not.toBe('2');
    expect(confirmButton()).toBeDisabled();
    expectNoWrites(props);

    assign(LINE_P, M3.missing, 1);
    await waitFor(() => expect(row(LINE_P)).toHaveAttribute('data-settled', 'true'));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(store.finalize.mock.calls.every(([, body]) => body.current_revision_id !== revisionId(1))).toBe(true);
    expect(store.saveDraft.mock.calls[0][1].base_revision_id).toBe(revisionId(1));
    expect(savedLine(store, LINE_P)).toMatchObject({ quantity_accepted: 2, quantity_missing: 1 });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R10 — a stale revision is refused: the Receive is re-read, the operator is told, and nothing is finalized', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();
    assign(LINE_P, M3.missing, 2);

    // Another device saved a revision first.
    store.revisions.push({ revision_id: revisionId(9), revision_number: 1, base_revision_id: null, lines: canonical([
      { receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 2 },
      { receive_job_line_id: LINE_M, quantity_accepted: 2, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 0 },
    ]) });
    const readsBefore = store.fetchReconciliation.mock.calls.length;
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.saveDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(M3.copy.changedElsewhere)).toBeInTheDocument();
    await waitFor(() => expect(store.fetchReconciliation.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(store.finalize).not.toHaveBeenCalled();
    expect(store.finalized()).toBeNull();
    expectNoForbiddenWrites(props);
  });

  it('R11 — a lost finalize response retries the same revision and payload; a refusal keeps the operator in review', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();
    assign(LINE_P, M3.missing, 2);

    store.finalize.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { request: {}, response: undefined }));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId(M3.reviewTestId)).toBeInTheDocument();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(2));
    const [first, second] = store.finalize.mock.calls.map(([, body]) => body);
    expect(second.current_revision_id).toBe(first.current_revision_id);
    expect(second.lines).toEqual(first.lines);
    // The retry finalized the revision already saved; no needless new revision.
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    expectFinalizedAgainstSavedRevision(store);

    // A semantic refusal (e.g. the count changed underneath) keeps review open.
    cleanup();
    const refused = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const refusedProps = await renderGrouped(refused);
    await openReview();
    assign(LINE_P, M3.missing, 2);
    refused.finalize.mockRejectedValueOnce(httpError(409, 'RECEIVE_COUNT_MISMATCH'));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(refused.finalize).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId(M3.reviewTestId)).toBeInTheDocument();
    expect(refused.finalized()).toBeNull();
    expectNoForbiddenWrites(refusedProps);
    expectNoForbiddenWrites(props);
  });

  it('R12 — finalization hands over to the label/close flow (M4) without closing, labelling or crediting stock', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();
    assign(LINE_P, M3.missing, 2);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('receive-session-mode')).toHaveAttribute('data-receive-mode', 'grouped_finalized'));
    expect(await screen.findByRole('button', { name: /close receive/i })).toBeInTheDocument();
    await settle();
    expect(props.onCloseReceiveJob).not.toHaveBeenCalled();
    expect(props.onPrintUnitLabels).not.toHaveBeenCalled();
    expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    expect(store.finalize).toHaveBeenCalledTimes(1);
    expectNoForbiddenWrites(props);
  });

  it('R13 — Edit count from review returns to counting; the re-confirmed count recalculates the difference', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();

    fireEvent.click(within(row(LINE_P)).getByRole('button', { name: M3.editCount }));
    const counted = await waitFor(() =>
      within(screen.getByTestId('receive-count-current')).getByRole('spinbutton', { name: /count/i }) as HTMLInputElement);
    await waitFor(() => expect(counted).not.toBeDisabled());
    fireEvent.change(counted, { target: { value: '2' } });
    fireEvent.click(within(screen.getByTestId('receive-count-current')).getByRole('button', { name: /confirm count/i }));
    await waitFor(() => expect(store.confirm).toHaveBeenCalledWith(JOB_ID, LINE_P, { quantity_confirmed: 2 }));

    await openReview();
    expect(row(LINE_P)).toHaveAttribute('data-difference', '-1');
    expect(row(LINE_P)).toHaveTextContent(M3.copy.remaining(1));
    expect(store.saveDraft).not.toHaveBeenCalled();
    expect(store.finalize).not.toHaveBeenCalled();
    expectNoForbiddenWrites(props);
  });

  it('R14 — leaving with unsaved review choices warns first; leaving anyway writes nothing and decides nothing', async () => {
    const store = reviewStore([line(LINE_P, 3, 1), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();
    assign(LINE_P, M3.missing, 2);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: M3.exit }));
    const leaveAnyway = await screen.findByRole('button', { name: /leave without saving/i });
    await settle();
    expect(props.onSessionExit).not.toHaveBeenCalled();
    expect(screen.getByTestId(M3.reviewTestId)).toBeInTheDocument();

    fireEvent.click(leaveAnyway);
    await waitFor(() => expect(props.onSessionExit).toHaveBeenCalledTimes(1));
    await settle();
    expectNoWrites(props);
    expect(store.revisions).toHaveLength(0);
    expect(store.finalized()).toBeNull();
  });

  it('R14b — with no unsaved review choice, Back to WMS leaves at once and writes nothing', async () => {
    const store = reviewStore([line(LINE_P, 3, 3), line(LINE_M, 2, 2)]);
    const props = await renderGrouped(store);
    await openReview();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: M3.exit }));
    await waitFor(() => expect(props.onSessionExit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /leave without saving/i })).toBeNull();
    await settle();
    expectNoWrites(props);
  });
  // ── S3C-M4 / L4 — preexisting per-line defect evidence (older client) ──────

  it('R15 — existing defect evidence counts as Damaged and is referenced by ID; no duplicate defect is created', async () => {
    const store = reviewStore([
      line(LINE_P, 3, 1, { reported_problems: [{
        receive_exception_id: EXISTING_DEFECT, exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall',
        counts_toward_shortfall: true, resolved: false, notes: 'Crushed box', raised_at: '2026-10-13T11:00:00.000Z',
      }] }),
      line(LINE_M, 2, 2),
    ]);
    const props = await renderGrouped(store);
    await openReview();

    // The recorded damaged unit is already part of the explanation.
    expect(allocation(LINE_P, M3.damaged).value).toBe('1');
    expect(row(LINE_P)).toHaveTextContent(M3.copy.remaining(1));
    assign(LINE_P, M3.missing, 1);
    await waitFor(() => expect(row(LINE_P)).toHaveAttribute('data-settled', 'true'));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(store.finalize).toHaveBeenCalledTimes(1));
    expect(savedLine(store, LINE_P)).toEqual({
      receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 1, quantity_missing: 1, quantity_deferred: 0,
      quantity_held_recoverable: 0, existing_exception_ids: [EXISTING_DEFECT],
      new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 1, accounting_role: 'shortfall' }],
    });
    expectFinalizedAgainstSavedRevision(store);
    expectNoForbiddenWrites(props);
  });

  it('R15b — existing defect evidence larger than the shortfall cannot be explained here: review fails closed and writes nothing', async () => {
    const store = reviewStore([
      line(LINE_P, 3, 1, { reported_problems: [{
        receive_exception_id: EXISTING_DEFECT, exception_type: 'defect', quantity_affected: 3, accounting_role: 'shortfall',
        counts_toward_shortfall: true, resolved: false, notes: null, raised_at: '2026-10-13T11:00:00.000Z',
      }] }),
      line(LINE_M, 2, 2),
    ]);
    const props = await renderGrouped(store);
    await openReview();

    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(confirmButton()).toBeDisabled();
    // No assignment can make 3 recorded damaged units fit a shortfall of 2.
    assign(LINE_P, M3.damaged, 2);
    assign(LINE_P, M3.missing, 0);
    await settle();
    expect(row(LINE_P)).toHaveAttribute('data-settled', 'false');
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    await settle();
    expectNoWrites(props);
  });
});
