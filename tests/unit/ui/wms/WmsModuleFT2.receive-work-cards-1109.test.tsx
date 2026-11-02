import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const openReceiveJobs = [
  {
    receive_job_id: 'receive-pending-self',
    status: 'pending',
    assigned_operator_id: 3,
    started_at: null,
    closed_at: null,
    supplier_name: 'North Dock Supply',
    po_id: '550e8400-e29b-41d4-a716-446655440001',
    po_number: 1109,
    total_units: 8,
    total_variants: 2,
  },
  {
    receive_job_id: 'receive-active-self',
    status: 'in_progress',
    assigned_operator_id: 3,
    started_at: '2026-09-14T11:00:00.000Z',
    closed_at: null,
    supplier_name: 'Active Supply',
    po_id: 'PO-ACTIVE',
    total_units: 5,
    total_variants: 1,
  },
  {
    receive_job_id: 'receive-closed-self',
    status: 'closed',
    assigned_operator_id: 3,
    started_at: '2026-09-14T09:00:00.000Z',
    closed_at: '2026-09-14T10:00:00.000Z',
    supplier_name: 'Closed Supply',
    po_id: 'PO-CLOSED',
    total_units: 1,
    total_variants: 1,
  },
  {
    receive_job_id: 'receive-cancelled-self',
    status: 'cancelled',
    assigned_operator_id: 3,
    started_at: null,
    closed_at: null,
    supplier_name: 'Cancelled Supply',
    po_id: 'PO-CANCELLED',
    total_units: 1,
    total_variants: 1,
  },
];

function baseProps() {
  return {
    data: { batches: [] },
    isLoading: false,
    isError: false,
    currentUserId: 3,
    openReceiveJobs,
    receiveAssignedWorkSpotlight: { isDismissed: false, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'should-not-create' }),
    onFetchReceiveJob: jest.fn().mockResolvedValue({
      job: {
        po_id: 'PO-1109',
        po_number: 1109,
        supplier_name: 'North Dock Supply',
        status: 'pending',
        assigned_operator_id: 3,
      },
      lines: [],
    }),
    onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
    onInspectReceiveLine: jest.fn(),
    onPersistReceiveLineProgress: jest.fn(),
    onReportReceiveException: jest.fn(),
    onCloseReceiveJob: jest.fn(),
    onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
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
  } as any;
}

describe('GH-1109 — WmsModuleFT2 Receive work queue', () => {
  it('derives Receiving tally, cards, and session entry from canonical openReceiveJobs rows', async () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    // The Receive lifecycle stage is the queue (WMS-OPS-LIFECYCLE-IA-02): its
    // accessible name and count description are the tally contract — the
    // same assertion WmsModuleFT2.operations-lifecycle-ia.test.tsx makes.
    const receiveStage = screen.getByRole('region', { name: /^Receive$/i });
    expect(receiveStage).toHaveAccessibleDescription(/\b2 receive jobs\b/i);

    const pending = within(receiveStage).getByTestId('receive-work-card-receive-pending-self');
    expect(pending).toHaveTextContent('North Dock Supply');
    expect(pending).toHaveTextContent('PO-1109');
    expect(pending).not.toHaveTextContent('550e8400-e29b-41d4-a716-446655440001');
    expect(pending).toHaveTextContent('8');
    // Ownership and lifecycle state are both shown; their grouping is presentation.
    expect(pending).toHaveTextContent('Assigned to you');
    expect(pending).toHaveTextContent('Not started');
    expect(pending).toHaveTextContent('Review shipment and claim Receive');
    expect(within(pending).getByRole('button', { name: /open receive/i })).toBeInTheDocument();

    const active = within(receiveStage).getByTestId('receive-work-card-receive-active-self');
    expect(within(active).getByRole('button', { name: /resume receive/i })).toBeInTheDocument();

    expect(screen.queryByText('Closed Supply')).toBeNull();
    expect(screen.queryByText('Cancelled Supply')).toBeNull();

    fireEvent.click(
      within(pending).getByRole('button', { name: /open receive/i })
    );
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReceiveSessionEnter).toHaveBeenCalledWith(
      'receive-pending-self'
    );
  });

  it('resumes an existing in-progress Receive job without creating new work', () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    const active = screen.getByTestId(
      'receive-work-card-receive-active-self'
    );

    fireEvent.click(
      within(active).getByRole('button', { name: /resume receive/i })
    );

    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReceiveSessionEnter).toHaveBeenCalledWith(
      'receive-active-self'
    );
  });

  it('S4-4D F2: keeps an assigned, finalized-but-unclosed Receive visible and resumable; excludes foreign active work', () => {
    const finalized = (['inspection', 'barcode_assignment', 'stow_ready'] as const).flatMap((status) => [
      {
        receive_job_id: `receive-${status}-self`,
        status,
        assigned_operator_id: 3,
        started_at: '2026-10-28T09:00:00.000Z',
        closed_at: null,
        supplier_name: `Own ${status}`,
        po_id: `PO-OWN-${status}`,
        total_units: 4,
        total_variants: 1,
      },
      {
        receive_job_id: `receive-${status}-foreign`,
        status,
        assigned_operator_id: 9,
        assigned_operator_name: 'Other Operator',
        started_at: '2026-10-28T09:00:00.000Z',
        closed_at: null,
        supplier_name: `Foreign ${status}`,
        po_id: `PO-FOREIGN-${status}`,
        total_units: 4,
        total_variants: 1,
      },
    ]);
    // Own pending/in_progress rows are omitted so all three finalized cards fit the stage preview.
    const terminal = openReceiveJobs.filter((job) => job.status === 'closed' || job.status === 'cancelled');
    const props = { ...baseProps(), openReceiveJobs: [...terminal, ...finalized] };

    render(<WmsModuleFT2 {...props} />);

    const receiveStage = screen.getByRole('region', { name: /^Receive$/i });
    expect(receiveStage).toHaveAccessibleDescription(/\b3 receive jobs\b/i);
    for (const status of ['inspection', 'barcode_assignment', 'stow_ready']) {
      const card = within(receiveStage).getByTestId(`receive-work-card-receive-${status}-self`);
      expect(within(card).getByRole('button', { name: /resume receive/i })).toBeInTheDocument();
      expect(screen.queryByText(`Foreign ${status}`)).toBeNull();
    }
    expect(screen.queryByText('Closed Supply')).toBeNull();
    expect(screen.queryByText('Cancelled Supply')).toBeNull();

    const stowReady = within(receiveStage).getByTestId('receive-work-card-receive-stow_ready-self');
    fireEvent.click(within(stowReady).getByRole('button', { name: /resume receive/i }));
    expect(props.onReceiveSessionEnter).toHaveBeenCalledWith('receive-stow_ready-self');
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('GH-1109 residual: shows the Receive onboarding coach mark when assigned work exists and it is not dismissed', () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    expect(
      screen.getByText('Receive work assigned to you')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/claim & start receive/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not start the job/i)
    ).toBeInTheDocument();

    // Existing queue copy remains unchanged alongside the coach mark.
    const pending = screen.getByTestId('receive-work-card-receive-pending-self');
    expect(pending).toHaveTextContent('Assigned to you');
    expect(pending).toHaveTextContent('Not started');
    expect(within(pending).getByRole('button', { name: /open receive/i })).toBeInTheDocument();
  });

  it('GH-1109 residual: does not show the Receive onboarding coach mark when dismissed', () => {
    const props = baseProps();
    props.receiveAssignedWorkSpotlight = { isDismissed: true, dismiss: jest.fn() };

    render(<WmsModuleFT2 {...props} />);

    expect(
      screen.queryByText('Receive work assigned to you')
    ).not.toBeInTheDocument();
  });

  it('GH-1109 residual: does not show the Receive onboarding coach mark when there is no Receive work', () => {
    const props = baseProps();
    props.openReceiveJobs = [];

    render(<WmsModuleFT2 {...props} />);

    expect(
      screen.queryByText('Receive work assigned to you')
    ).not.toBeInTheDocument();
  });
});
