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

    const receiving = screen
      .getAllByText('Receiving')
      .map((label) => label.closest('div'))
      .find(
        (node) =>
          node !== null &&
          within(node as HTMLElement).queryByText('2') !== null
      );

    expect(receiving).not.toBeNull();
    expect(
      within(receiving as HTMLElement).getByText('2')
    ).toBeInTheDocument();

    const pending = screen.getByTestId('receive-work-card-receive-pending-self');
    expect(pending).toHaveTextContent('North Dock Supply');
    expect(pending).toHaveTextContent('PO-1109');
    expect(pending).not.toHaveTextContent('550e8400-e29b-41d4-a716-446655440001');
    expect(pending).toHaveTextContent('8');
    expect(pending).toHaveTextContent('Assigned to you · Not started');
    expect(pending).toHaveTextContent('Review shipment and claim Receive');
    expect(within(pending).getByRole('button', { name: /open receive/i })).toBeInTheDocument();

    const active = screen.getByTestId('receive-work-card-receive-active-self');
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
});
