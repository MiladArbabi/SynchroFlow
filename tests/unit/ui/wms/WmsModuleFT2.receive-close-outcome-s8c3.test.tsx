/**
 * WS-UX-RECEIVE-D4R S8-C3 — host-level close-outcome reconciliation.
 *
 * The REAL WmsModuleFT2 around the REAL ReceiveSessionPage. After an
 * unanswered close, only the host's canonical GET /receive-jobs/:id result
 * (applied to the active session) may show Completion; a failed read keeps
 * Close disabled behind Check status. Harness: S3C-M1 mode-routing precedent.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const JOB_ID = 'job-s8-c3';
const OPERATOR_ID = 3;

const inspected: ReceiveJobLine = {
  receive_job_line_id: 'line-s8-c3',
  lasyncro_variant_id: 'variant-s8-c3',
  sku: 'C3-SKU',
  variant_title: 'Default Title',
  description: 'C3 line',
  quantity_expected: 4,
  quantity_accepted: 4,
  quantity_rejected: 0,
  quantity_count_confirmed: 4,
  count_state: 'inspected',
  inspection_complete: true,
  image_url: null,
  barcode: '5012345678900',
  product_title: 'C3 widget',
  barcode_ready: true,
  barcode_readiness_reason: 'external_barcode',
  awaiting_label_ack: false,
} as ReceiveJobLine;

function job(overrides: Record<string, unknown> = {}) {
  return {
    po_id: 'po-s8-c3',
    po_number: 1803,
    supplier_name: 'C3 Supplier',
    status: 'in_progress',
    assigned_operator_id: OPERATOR_ID,
    closed_at: null,
    actual_delivery_date: null,
    delivery_accounting_version: 1,
    ...overrides,
  };
}

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
      supplier_name: 'C3 Supplier',
      po_id: 'po-s8-c3',
      po_number: 1803,
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
    onFetchReceiveReconciliation: jest.fn(),
    onSaveReceiveReconciliationDraft: jest.fn().mockResolvedValue({ revision_id: 'rev-new', revision_number: 3, base_revision_id: null }),
    onFinalizeReceiveReconciliation: jest.fn().mockResolvedValue({ status: 'finalized', reconciliation_id: 'recon-new' }),
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

async function reachReview(props: any) {
  render(<WmsModuleFT2 {...props} />);
  fireEvent.click(within(screen.getByTestId(`receive-work-card-${JOB_ID}`)).getByRole('button', { name: /resume receive/i }));
  fireEvent.change(await screen.findByLabelText(/actual delivery date/i), { target: { value: '2026-10-24' } });
  fireEvent.click(screen.getByRole('button', { name: /^close receive$/i }));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

describe('WS-UX-RECEIVE-D4R S8-C3 — host close-outcome reconciliation', () => {
  it('C3-H1 — an unanswered close whose canonical read is closed reaches Completion once', async () => {
    const props = baseProps({ onCloseReceiveJob: jest.fn().mockRejectedValue(new Error('Network Error')) });
    props.onFetchReceiveJob
      .mockResolvedValueOnce({ job: job(), lines: [inspected] })
      .mockResolvedValue({ job: job({ status: 'closed', closed_at: '2026-10-25T14:32:00', actual_delivery_date: '2026-10-24' }), lines: [inspected] });
    props.onFetchReceiveReconciliation.mockResolvedValue({ receive_job_id: JOB_ID, status: 'open', current_revision_id: null, revisions: [], lines: [], finalization: null });

    await reachReview(props);

    expect(await screen.findByText('Receive complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^close receive$/i })).not.toBeInTheDocument();
    expect(props.onCloseReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('C3-H2 — an unanswered close whose canonical read fails never completes and keeps Close disabled', async () => {
    const props = baseProps({ onCloseReceiveJob: jest.fn().mockRejectedValue(new Error('Network Error')) });
    props.onFetchReceiveJob
      .mockResolvedValueOnce({ job: job(), lines: [inspected] })
      .mockRejectedValue(new Error('Network Error'));
    props.onFetchReceiveReconciliation.mockResolvedValue({ receive_job_id: JOB_ID, status: 'open', current_revision_id: null, revisions: [], lines: [], finalization: null });

    await reachReview(props);

    expect(await screen.findByRole('button', { name: /^check status$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^close receive$/i })).toBeDisabled();
    expect(screen.queryByText('Receive complete')).not.toBeInTheDocument();
    expect(props.onCloseReceiveJob).toHaveBeenCalledTimes(1);
  });
});
