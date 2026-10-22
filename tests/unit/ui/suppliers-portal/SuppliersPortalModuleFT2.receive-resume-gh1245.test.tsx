// GH-1245 — Receive resume navigation acceptance repair (RED tests).
//
// Contract:
//   1. A PO-1005-equivalent PO whose Receive job is in_progress and assigned
//      to the current user exposes `Resume Receive`.
//   2. Resume navigates to /wms?receiveJobId=<existing job ID>.
//   3. Resume opens no assignment dialog and calls neither the create
//      (POST receive-jobs) nor the reassignment (PATCH assignment) callback.
//   4. A pending job assigned to the current user shows the WS-UX-01 S3
//      inline brief in Purchasing: no navigation, dialog, create or reassign.
//   5. Work owned by another operator is not resumable/openable by the
//      current user, and started work offers no reassignment.
//   6. No-job initial dispatch and explicit pending reassignment are
//      unchanged.
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2 from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const CURRENT_USER_ID = 3;
const OTHER_OPERATOR_ID = 9;
const EXISTING_JOB_ID = 'receive-job-1005';

const teamAssignableOperators = [
  { id: CURRENT_USER_ID, name: 'Me (Owner)', role: 'owner' },
  { id: 7, name: 'Jordan Lee', role: 'operator' },
  { id: OTHER_OPERATOR_ID, name: 'Sam Rivera', role: 'operator' },
];

function basePo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-uuid-1005',
    po_number: 1005,
    supplier_name: 'Nordic Textile Works',
    supplier_contact_email: null,
    supplier_contact_name: null,
    supplier_moq: null,
    supplier_on_time_rate: null,
    supplier_fill_rate: null,
    status: 'shipped',
    expected_delivery_date: null,
    actual_delivery_date: null,
    line_items_count: 3,
    total_units_ordered: 180,
    total_units_received: 0,
    notes: null,
    document_url: null,
    created_at: '2026-09-14T00:00:00.000Z',
    first_line_description: null,
    receive_job_id: EXISTING_JOB_ID,
    receive_status: 'in_progress',
    receive_assigned_operator_id: CURRENT_USER_ID,
    receive_assigned_operator_name: 'Me (Owner)',
    ...overrides,
  };
}

function buildProps(po: ReturnType<typeof basePo>, currentUserId: number | null) {
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
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'receive-new' }),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
    teamAssignableOperators,
    receiveAssigneesStatus: 'ready',
    canManageReceiveAssignment: true,
    currentUserId,
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
  } as any;
}

function moduleAt(url: string, props: ReturnType<typeof buildProps>) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <SuppliersPortalModuleFT2 {...props} />
    </MemoryRouter>
  );
}

function renderModule(
  po: ReturnType<typeof basePo>,
  options: { url?: string; currentUserId?: number | null; expand?: boolean } = {}
) {
  const { url = '/', currentUserId = CURRENT_USER_ID, expand = true } = options;
  const props = buildProps(po, currentUserId);

  render(moduleAt(url, props));
  if (expand) fireEvent.click(screen.getByText(po.supplier_name as string));
  return props;
}

const RECEIVE_DEEP_LINK = '/?action=receive&poId=po-uuid-1005';

function renderDeepLink(
  po: ReturnType<typeof basePo>,
  options: { currentUserId?: number | null } = {}
) {
  return renderModule(po, { ...options, url: RECEIVE_DEEP_LINK, expand: false });
}

function expectNoDispatchSideEffects(props: ReturnType<typeof renderModule>) {
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('list', { name: /assign receive to|reassign to/i })).toBeNull();
  expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('GH-1245 — own in_progress Receive resumes the existing job', () => {
  it('(1) shows Resume Receive for an in_progress job assigned to the current user', () => {
    renderModule(basePo());

    expect(screen.getByRole('button', { name: /resume receive/i })).toBeInTheDocument();
  });

  it('(2)(3) navigates to the existing job with no dialog, create, or reassignment', async () => {
    const props = renderModule(basePo());

    fireEvent.click(screen.getByRole('button', { name: /resume receive/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${EXISTING_JOB_ID}`);
    });
    expectNoDispatchSideEffects(props);
  });
});

describe('GH-1245 — own pending Receive opens the existing brief', () => {
  it('(4) shows the inline brief for the existing pending job with no navigation, dialog, create, or reassignment', () => {
    const props = renderModule(basePo({ receive_status: 'pending' }));

    expect(screen.getByTestId('receive-inline-brief')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open receive/i })).toBeNull();
    // Without canonical job data Start stays disabled (WS-UX-01 S3 D2).
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expectNoDispatchSideEffects(props);
  });
});

describe('GH-1245 — other-operator ownership remains protected', () => {
  it('(5) offers no create, open, resume, or reassignment of in_progress work owned by another operator', () => {
    const props = renderModule(
      basePo({
        receive_assigned_operator_id: OTHER_OPERATOR_ID,
        receive_assigned_operator_name: 'Sam Rivera',
      })
    );

    expect(screen.queryByRole('button', { name: /resume receive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open receive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /assign receive|receive myself/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reassign/i })).toBeNull();
    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('GH-1245 — existing dispatch branches unchanged', () => {
  it('(6a) no-job PO still opens assignment before creating work', async () => {
    const props = renderModule(
      basePo({
        receive_job_id: null,
        receive_status: null,
        receive_assigned_operator_id: null,
        receive_assigned_operator_name: null,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));

    const picker = await screen.findByRole('list', { name: /assign receive to/i });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(within(picker).getByRole('button', { name: /sam rivera/i }));

    await waitFor(() => {
      expect(props.onCreateReceiveJob).toHaveBeenCalledWith('po-uuid-1005', {
        assigned_operator_id: OTHER_OPERATOR_ID,
      });
    });
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
  });

  it('(6b) pending job assigned to another operator still uses explicit reassignment', async () => {
    const props = renderModule(
      basePo({
        receive_status: 'pending',
        receive_assigned_operator_id: 7,
        receive_assigned_operator_name: 'Jordan Lee',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));

    const picker = await screen.findByRole('list', { name: /^reassign to$/i });
    fireEvent.click(within(picker).getByRole('button', { name: /sam rivera/i }));

    await waitFor(() => {
      expect(props.onReassignReceiveJob).toHaveBeenCalledWith(EXISTING_JOB_ID, OTHER_OPERATOR_ID);
    });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('GH-1245 — action=receive deep-link uses the same job-aware decision', () => {
  it('(D1) own in_progress job resumes the existing job exactly once, never Assign Receive', async () => {
    const props = renderDeepLink(basePo());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${EXISTING_JOB_ID}`);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expectNoDispatchSideEffects(props);
  });

  it('(D2) own pending job expands the PO to the WS-UX-01 S3 inline brief without navigation or redispatch', async () => {
    const props = renderDeepLink(basePo({ receive_status: 'pending' }));

    expect(await screen.findByTestId('receive-inline-brief')).toBeVisible();
    expect(mockNavigate).not.toHaveBeenCalled();
    expectNoDispatchSideEffects(props);
  });

  it('(D3) other operator in_progress job: no dialog, navigation, creation, or reassignment', () => {
    const props = renderDeepLink(
      basePo({
        receive_assigned_operator_id: OTHER_OPERATOR_ID,
        receive_assigned_operator_name: 'Sam Rivera',
      })
    );

    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('(D4) other operator pending job keeps explicit Reassign, no silent initial assignment', () => {
    const props = renderDeepLink(
      basePo({
        receive_status: 'pending',
        receive_assigned_operator_id: 7,
        receive_assigned_operator_name: 'Jordan Lee',
      })
    );

    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Nordic Textile Works'));
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeInTheDocument();
  });

  it('(D5) no job: deep-link opens the initial assignment popover without creating work', async () => {
    const props = renderDeepLink(
      basePo({
        receive_job_id: null,
        receive_status: null,
        receive_assigned_operator_id: null,
        receive_assigned_operator_name: null,
      })
    );

    await screen.findByRole('list', { name: /assign receive to/i });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('(D6) legacy pending unassigned job: deep-link still opens guarded assignment', async () => {
    const props = renderDeepLink(
      basePo({
        receive_status: 'pending',
        receive_assigned_operator_id: null,
        receive_assigned_operator_name: null,
      })
    );

    await screen.findByRole('list', { name: /assign receive to/i });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('(D7) missing currentUserId fails closed on an existing started job', () => {
    const props = renderDeepLink(basePo(), { currentUserId: null });

    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('(D8) inconsistent active-job state (status/assignee without job ID) fails closed', () => {
    const props = renderDeepLink(basePo({ receive_job_id: null }));

    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('GH-1245 — deep-link waits for authenticated identity hydration', () => {
  it('(D9) unresolved currentUserId does nothing, then resumes the existing job exactly once when it resolves', async () => {
    const props = buildProps(basePo(), null);
    const view = render(moduleAt(RECEIVE_DEEP_LINK, props));

    expectNoDispatchSideEffects(props);
    expect(mockNavigate).not.toHaveBeenCalled();

    view.rerender(moduleAt(RECEIVE_DEEP_LINK, { ...props, currentUserId: CURRENT_USER_ID }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${EXISTING_JOB_ID}`);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expectNoDispatchSideEffects(props);
  });
});
