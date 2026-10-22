// GH-1143 RECEIVE-REASSIGN-UI-01
//
// Approved contract:
//   - Open POs exposes explicit `Reassign Receive` for an already-assigned
//     pending Receive job.
//   - WS-UX-01 S2: the compact assignment popover, in Reassign state, replaces
//     the dialog. The current assignee is represented on the PO panel and is
//     not offered as a reassignment target.
//   - Reassignment must use the canonical Receive assignee source
//     (teamAssignableOperators, already wired from
//     GET /api/v1/operators/receive-assignees) and the existing assignment
//     PATCH — via a distinct reassignment callback, not onCreateReceiveJob
//     (whose GH-1109 "legacy recovery" branch explicitly rejects reassigning
//     pending work already assigned to a different operator; see
//     tests/unit/ui/suppliers-portal/SuppliersPortalPage.receive-recovery-1109.test.tsx,
//     left untouched by this file).
//
// This file assumes a new `onReassignReceiveJob` prop on
// SuppliersPortalModuleFT2 (see DEVIATIONS in the reporting brief) since the
// brief does not specify a literal callback name for not-yet-implemented UI.
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2 from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const teamAssignableOperators = [
  { id: 3, name: 'Me (Admin)', role: 'owner' },
  { id: 7, name: 'Jordan Lee', role: 'operator' },
  { id: 9, name: 'Sam Rivera', role: 'operator' },
];

function basePo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1143',
    po_number: 1143,
    supplier_name: 'North Dock Supply',
    supplier_contact_email: null,
    supplier_contact_name: null,
    supplier_moq: null,
    supplier_on_time_rate: null,
    supplier_fill_rate: null,
    status: 'shipped',
    expected_delivery_date: null,
    actual_delivery_date: null,
    line_items_count: 2,
    total_units_ordered: 8,
    total_units_received: 0,
    notes: null,
    document_url: null,
    created_at: '2026-09-14T00:00:00.000Z',
    first_line_description: null,
    receive_job_id: 'receive-job-1143',
    receive_status: 'pending',
    receive_assigned_operator_id: 7,
    receive_assigned_operator_name: 'Jordan Lee',
    ...overrides,
  };
}

function baseProps(po: ReturnType<typeof basePo>) {
  return {
    view: 'pos',
    data: {
      purchase_orders: [po],
      suppliers: [],
      never_ordered: [],
      never_ordered_count: 0,
    },
    isLoading: false,
    isError: false,
    onRefresh: jest.fn(),
    onFetchLineItems: jest.fn().mockResolvedValue([]),
    onUpdatePoStatus: jest.fn(),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    teamAssignableOperators,
    receiveAssigneesStatus: 'ready',
    canManageReceiveAssignment: true,
    currentUserId: 3,
    onSearchVariants: jest.fn(),
    onFetchSourcingRecommendations: jest.fn(),
    onFetchSourcingWorklist: jest.fn(),
    onFetchPreferences: jest.fn(),
    onCreatePreference: jest.fn(),
    onUpdatePreference: jest.fn(),
    onDeletePreference: jest.fn(),
    onFetchReorderRequests: jest.fn(),
    onCreateReorderRequest: jest.fn(),
    onDeleteReorderRequest: jest.fn(),
    onConvertReorderRequests: jest.fn(),
    // GH-1143 — assumed new callback (see DEVIATIONS).
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function renderModule(po: ReturnType<typeof basePo>) {
  const props = baseProps(po);
  render(
    <MemoryRouter initialEntries={['/']}>
      <SuppliersPortalModuleFT2 {...props} />
    </MemoryRouter>
  );
  return props;
}

function expandPo(supplierName: string) {
  fireEvent.click(screen.getByText(supplierName));
}

describe('GH-1143 (3a) — already-assigned pending Receive exposes Reassign', () => {
  it('shows an explicit Reassign action instead of the generic Assign flow', () => {
    renderModule(basePo());
    expandPo('North Dock Supply');

    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /assign receive/i })).toBeNull();
  });
});

describe('GH-1143 (3b) — popover is explicitly Reassign state', () => {
  it('opens a picker titled to reflect Reassign, not the generic Assign title', async () => {
    renderModule(basePo());
    expandPo('North Dock Supply');

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

    expect(await screen.findByRole('list', { name: /^reassign to$/i })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /assign receive to/i })).toBeNull();
  });
});

describe('GH-1143 (3c) — current assignee is represented', () => {
  it('names the current assignee on the panel and does not offer them as a target', async () => {
    renderModule(basePo());
    expandPo('North Dock Supply');

    expect(screen.getByText(/assigned to jordan lee · not started/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    const picker = await screen.findByRole('list', { name: /^reassign to$/i });
    expect(within(picker).queryByText('Jordan Lee')).toBeNull();
    expect(within(picker).getByText('Sam Rivera')).toBeInTheDocument();
  });
});

describe('GH-1143 (3d) — submission calls reassignment callback, not create callback', () => {
  it('calls onReassignReceiveJob with the new target and never onCreateReceiveJob', async () => {
    const props = renderModule(basePo());
    expandPo('North Dock Supply');
    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

    const picker = await screen.findByRole('list', { name: /^reassign to$/i });
    fireEvent.click(within(picker).getByRole('button', { name: /sam rivera/i }));

    await waitFor(() => {
      expect(props.onReassignReceiveJob).toHaveBeenCalledWith('receive-job-1143', 9);
    });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});

describe('GH-1143 (3e) — in-progress/closed Receive exposes no reassign action', () => {
  it('shows no Reassign action once the Receive job has started', () => {
    renderModule(
      basePo({ receive_status: 'in_progress', status: 'shipped' })
    );
    expandPo('North Dock Supply');

    expect(screen.queryByRole('button', { name: /reassign/i })).toBeNull();
  });

  it('shows no Reassign action once the Receive job is closed', () => {
    renderModule(
      basePo({ receive_status: 'closed', status: 'received' })
    );

    // 'received' falls outside OPEN_STATUSES, so the PO renders under the
    // collapsed "closed / cancelled" group rather than expanding inline —
    // either way, no Reassign control should exist anywhere.
    expect(screen.queryByRole('button', { name: /reassign/i })).toBeNull();
  });
});
