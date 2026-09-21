// GH-1143 RECEIVE-REASSIGN-UI-01
//
// Approved contract (execution-agent test authoring — see DEVIATIONS in the
// reporting brief for the specific prop/testid names assumed here, since the
// brief did not specify literal identifiers for not-yet-implemented UI):
//
// - Owner/admin may manage reassignment only for pending/unstarted Receive
//   jobs; no reassignment/takeover once claimed/started/in_progress/closed.
// - Owner/admin may see pending Receive work assigned to another operator
//   solely for assignment management (mirrors STOW-LIFECYCLE-02's
//   `canAssignStow` gate — this file assumes an analogous `canReassignReceive`
//   prop on WmsModuleFT2).
// - Another operator's pending Receive card must not expose the execution
//   Open/Resume CTA.
// - Pure operators continue seeing only their own assigned Receive work.
// - Contextual `⋮ → Reassign…`, mirroring Stow semantics where practical.
// - No Receive Pool/unassigned semantics — reassignment always targets a
//   specific operator (no "make first one to claim" analog for Receive).
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const receiveAssignees = [
  { user_id: 3, first_name: 'Admin', last_name: 'User', role: 'owner' },
  { user_id: 7, first_name: 'Jordan', last_name: 'Lee', role: 'operator' },
  { user_id: 9, first_name: 'Sam', last_name: 'Rivera', role: 'operator' },
];

function baseProps() {
  return {
    data: { batches: [] },
    isLoading: false,
    isError: false,
    currentUserId: 3,
    openReceiveJobs: [],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    onFetchReceiveJob: jest.fn().mockResolvedValue({
      job: { po_id: 'PO-1', supplier_name: 'North Dock Supply', status: 'pending' },
      lines: [],
    }),
    onClaimReceiveJob: jest.fn(),
    onInspectReceiveLine: jest.fn(),
    onPersistReceiveLineProgress: jest.fn(),
    onReportReceiveException: jest.fn(),
    onApproveOverDelivery: jest.fn(),
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
    onSetupBinsClick: jest.fn(),
    // GH-1143 — assumed new props (see DEVIATIONS). Not yet declared on
    // WmsModuleFT2Props; passed via `as any` below like the rest of this file.
    canReassignReceive: false,
    onFetchReceiveAssignees: jest.fn().mockResolvedValue(receiveAssignees),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function pendingJobAssignedToOther(overrides: Record<string, unknown> = {}) {
  return {
    receive_job_id: 'receive-other-pending',
    status: 'pending',
    assigned_operator_id: 7,
    started_at: null,
    closed_at: null,
    supplier_name: 'Other Operator Supply',
    po_id: 'PO-OTHER-PENDING',
    po_number: 1143,
    total_units: 4,
    total_variants: 1,
    ...overrides,
  };
}

describe('GH-1143 (1) — owner/admin sees pending Receive assigned to another operator', () => {
  it('renders a Receive work card for a pending job assigned to someone else when canReassignReceive is true', () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.openReceiveJobs = [pendingJobAssignedToOther()];

    render(<WmsModuleFT2 {...props} />);

    expect(
      screen.getByTestId('receive-work-card-receive-other-pending')
    ).toBeInTheDocument();
  });
});

describe('GH-1143 (2) — card offers Reassign via contextual management', () => {
  it('shows a ⋮ options control that opens a Reassign… action for the other-assigned pending job', () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.openReceiveJobs = [pendingJobAssignedToOther()];

    render(<WmsModuleFT2 {...props} />);

    const card = screen.getByTestId('receive-work-card-receive-other-pending');
    const menuTrigger = within(card).getByRole('button', { name: /receive.*options/i });

    fireEvent.click(menuTrigger);

    expect(screen.getByRole('menuitem', { name: /reassign/i })).toBeInTheDocument();
  });
});

describe('GH-1143 (2b) — owner/admin can reassign their own pending Receive', () => {
  it('keeps Open receive and also exposes the contextual Reassign… management action', () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.currentUserId = 3;
    props.openReceiveJobs = [
      pendingJobAssignedToOther({
        receive_job_id: 'receive-self-pending',
        assigned_operator_id: 3,
        assigned_operator_name: 'Admin User',
        supplier_name: 'Self Assigned Supply',
      }),
    ];

    render(<WmsModuleFT2 {...props} />);

    const card = screen.getByTestId('receive-work-card-receive-self-pending');

    expect(
      within(card).getByRole('button', { name: /open receive/i })
    ).toBeInTheDocument();

    const menuTrigger = within(card).getByRole('button', {
      name: /receive.*options/i,
    });

    fireEvent.click(menuTrigger);

    expect(
      screen.getByRole('menuitem', { name: /reassign/i })
    ).toBeInTheDocument();
  });
});

describe('GH-1143 (3) — no execution CTA for another operator\'s pending Receive card', () => {
  it('withholds Open receive / Resume receive for a pending job assigned to someone else', () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.openReceiveJobs = [pendingJobAssignedToOther()];

    render(<WmsModuleFT2 {...props} />);

    const card = screen.getByTestId('receive-work-card-receive-other-pending');
    expect(within(card).queryByRole('button', { name: /open receive/i })).toBeNull();
    expect(within(card).queryByRole('button', { name: /resume receive/i })).toBeNull();
  });
});

describe('GH-1143 (4) — in-progress other-assigned work cannot be reassigned or taken over', () => {
  it('never renders an in_progress Receive job assigned to another operator, even for owner/admin', () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.openReceiveJobs = [
      pendingJobAssignedToOther({
        receive_job_id: 'receive-other-active',
        status: 'in_progress',
        started_at: '2026-09-20T10:00:00.000Z',
      }),
    ];

    render(<WmsModuleFT2 {...props} />);

    expect(screen.queryByTestId('receive-work-card-receive-other-active')).toBeNull();
  });
});

describe('GH-1143 (5) — operator does not see another operator\'s pending job', () => {
  it('excludes a pending job assigned to a different operator when the viewer is a plain operator', () => {
    const props = baseProps();
    props.canReassignReceive = false;
    props.currentUserId = 9;
    props.openReceiveJobs = [pendingJobAssignedToOther()];

    render(<WmsModuleFT2 {...props} />);

    expect(screen.queryByTestId('receive-work-card-receive-other-pending')).toBeNull();
    expect(screen.queryByText('Other Operator Supply')).toBeNull();
  });
});

describe('GH-1143 (6) — Reassign interaction fetches eligible targets and submits selected target', () => {
  it('fetches receive assignees on open, preselects nothing but submits the chosen target, and refreshes', async () => {
    const props = baseProps();
    props.canReassignReceive = true;
    props.openReceiveJobs = [pendingJobAssignedToOther()];

    render(<WmsModuleFT2 {...props} />);

    const card = screen.getByTestId('receive-work-card-receive-other-pending');
    fireEvent.click(within(card).getByRole('button', { name: /receive.*options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /reassign/i }));

    await waitFor(() => {
      expect(props.onFetchReceiveAssignees).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole('dialog');
    // getByText(/reassign/i) is ambiguous here — it matches both the dialog
    // title and the "Reassign" submit button. Scope to the heading.
    expect(within(dialog).getByRole('heading', { name: /reassign/i })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Sam Rivera'));
    fireEvent.click(within(dialog).getByRole('button', { name: /^reassign$|confirm/i }));

    await waitFor(() => {
      expect(props.onReassignReceiveJob).toHaveBeenCalledWith('receive-other-pending', 9);
    });
    expect(props.onRefresh).toHaveBeenCalled();
  });
});
