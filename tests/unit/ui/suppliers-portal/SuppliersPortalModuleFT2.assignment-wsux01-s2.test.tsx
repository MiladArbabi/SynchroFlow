// WS-UX-01 S2 — Receive assignment simplification.
//
// Contract (approved S2 brief + Receive handoff):
//   1. "Receive myself" only when the LOADED roster proves the viewer is the
//      sole eligible assignee; it assigns (never claims/starts). WS-UX-01 S3:
//      it stays in Purchasing and the reconciled PO shows the inline brief.
//   2. A team gets a compact popover: nobody preselected, picking a row is the
//      explicit dispatch, no further confirmation.
//   3. Existing work shows its assignee and is never re-created.
//   4. Reassignment is owner/admin only, pending/unstarted only, via the
//      existing reassignment callback (PATCH); others see the restriction.
//   5. Submissions lock while in flight. Outcomes are reconciled against an
//      AWAITED canonical PO re-read (onReconcilePurchaseOrders); the generic
//      onRefresh is fire-and-forget in production and proves nothing.
//      Inconclusive or failed reconciliation locks until a page reload.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2 from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const ME = 3;
const SAM = 9;
const JORDAN = 7;
const PO_ID = 'po-uuid-s2';
const SUPPLIER = 'Fjord Fabrics';
const ME_ROW = { id: ME, name: 'Mila Owner', role: 'owner' };
const TEAM = [
  { id: JORDAN, name: 'Jordan Lee', role: 'operator' },
  ME_ROW,
  { id: SAM, name: 'Sam Rivera', role: 'operator' },
];

function basePo(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    po_number: 2002,
    supplier_name: SUPPLIER,
    supplier_contact_email: null,
    supplier_contact_name: null,
    supplier_moq: null,
    supplier_on_time_rate: null,
    supplier_fill_rate: null,
    status: 'shipped',
    expected_delivery_date: '2026-10-20',
    actual_delivery_date: null,
    line_items_count: 1,
    total_units_ordered: 3,
    total_units_received: 0,
    notes: null,
    document_url: null,
    created_at: '2026-10-01T10:00:00.000Z',
    receive_job_id: null,
    receive_status: null,
    receive_assigned_operator_id: null,
    receive_assigned_operator_name: null,
    ...overrides,
  };
}

function buildProps(po: ReturnType<typeof basePo>, overrides: Record<string, unknown> = {}) {
  return {
    view: 'pos',
    data: { purchase_orders: [po], suppliers: [], never_ordered: [], never_ordered_count: 0 },
    isLoading: false,
    isError: false,
    // Production contract: fire-and-forget, returns undefined.
    onRefresh: jest.fn(),
    onReconcilePurchaseOrders: jest.fn().mockResolvedValue([]),
    onFetchLineItems: jest.fn().mockResolvedValue([]),
    onUpdatePoStatus: jest.fn(),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'receive-new' }),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
    onRetryReceiveAssignees: jest.fn(),
    teamAssignableOperators: TEAM,
    receiveAssigneesStatus: 'ready',
    canManageReceiveAssignment: true,
    currentUserId: ME,
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
    ...overrides,
  } as any;
}

function moduleAt(url: string, props: ReturnType<typeof buildProps>) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <SuppliersPortalModuleFT2 {...props} />
    </MemoryRouter>
  );
}

function renderExpanded(po = basePo(), overrides: Record<string, unknown> = {}) {
  const props = buildProps(po, overrides);
  const view = render(moduleAt('/', props));
  fireEvent.click(screen.getByText(SUPPLIER));
  return { props, view };
}

const DEEP_LINK = `/?action=receive&poId=${PO_ID}`;

/** Canonical PO list as the awaited re-read would return it. */
function canonical(overrides: Record<string, unknown> = {}) {
  return [basePo(overrides)];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Reconciled own pending job, as the awaited canonical re-read returns it. */
function ownPending(jobId: string) {
  return { receive_job_id: jobId, receive_status: 'pending', receive_assigned_operator_id: ME, receive_assigned_operator_name: 'Mila Owner' };
}

/** WS-UX-01 S3 — canonical GET /receive-jobs/:jobId for an own pending job. */
function ownPendingDetail(jobId: string) {
  return {
    job: { receive_job_id: jobId, po_id: PO_ID, status: 'pending', assigned_operator_id: ME, started_at: null, supplier_name: SUPPLIER },
    lines: [{ receive_job_line_id: 'line-1', quantity_expected: 3, quantity_accepted: 0 }],
  };
}

function ambiguousNetworkError() {
  return Object.assign(new Error('Network Error'), { isAxiosError: true });
}

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('WS-UX-01 S2 (1) — single eligible self', () => {
  it('Receive myself assigns the authenticated user and stays in Purchasing without claiming', async () => {
    const { props } = renderExpanded(basePo(), {
      teamAssignableOperators: [ME_ROW],
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(ownPending('receive-new'))),
      onClaimReceiveJob: jest.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));

    await waitFor(() => {
      expect(props.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, { assigned_operator_id: ME });
    });
    expect(await screen.findByText(/receive is assigned to you/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: /assign receive to/i })).toBeNull();
  });

  it('a sole roster entry that is not the viewer is never treated as "myself"', () => {
    renderExpanded(basePo(), { teamAssignableOperators: [{ id: SAM, name: 'Sam Rivera', role: 'operator' }] });

    expect(screen.queryByRole('button', { name: /receive myself/i })).toBeNull();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeEnabled();
  });
});

describe('WS-UX-01 S2 (2) — multiple eligible operators', () => {
  it('opens a popover with nobody preselected, Me first, and dispatches on the picked row with no confirm step', async () => {
    const { props } = renderExpanded(basePo(), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(
        canonical({ receive_job_id: 'receive-new', receive_status: 'pending', receive_assigned_operator_id: SAM })
      ),
    });

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
    const picker = await screen.findByRole('list', { name: /assign receive to/i });
    const rows = within(picker).getAllByRole('button');

    expect(rows.map((r) => r.textContent)).toEqual([
      'Me · Mila Ownerowner',
      'Jordan Leeoperator',
      'Sam Riveraoperator',
    ]);
    for (const row of rows) {
      expect(row).not.toHaveAttribute('aria-pressed', 'true');
      expect(row).not.toHaveAttribute('aria-checked', 'true');
      expect(row).not.toHaveAttribute('aria-selected', 'true');
    }
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();

    fireEvent.click(within(picker).getByRole('button', { name: /sam rivera/i }));

    await waitFor(() => {
      expect(props.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, { assigned_operator_id: SAM });
    });
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText(/receive assigned to sam rivera/i)).toBeInTheDocument();
    expect(props.onReconcilePurchaseOrders).toHaveBeenCalledTimes(1);
  });

  it('picking Me from the team popover assigns self and stays in Purchasing', async () => {
    const { props } = renderExpanded(basePo(), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(ownPending('receive-new'))),
      onClaimReceiveJob: jest.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /me · mila owner/i }));

    expect(await screen.findByText(/receive is assigned to you/i)).toBeInTheDocument();
    expect(props.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, { assigned_operator_id: ME });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S2 (3) — roster loading and failure', () => {
  it('a loading roster is never proof of sole eligibility', () => {
    const { props } = renderExpanded(basePo(), {
      teamAssignableOperators: [ME_ROW],
      receiveAssigneesStatus: 'loading',
    });

    expect(screen.queryByRole('button', { name: /receive myself/i })).toBeNull();
    expect(screen.getByRole('button', { name: /loading team/i })).toBeDisabled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('a failed roster offers Try again and no dispatch', () => {
    const { props } = renderExpanded(basePo(), {
      teamAssignableOperators: [],
      receiveAssigneesStatus: 'error',
    });

    expect(screen.getByText(/couldn't load who can receive this/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /receive myself|assign receive/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(props.onRetryReceiveAssignees).toHaveBeenCalledTimes(1);
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('a loaded but empty roster explains why nothing can be assigned', () => {
    renderExpanded(basePo(), { teamAssignableOperators: [] });

    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(screen.getByText(/no one on your team can receive this yet/i)).toBeInTheDocument();
  });
});

describe('WS-UX-01 S2 (4) — existing pending assignment', () => {
  it("another operator's pending job shows the assignee and never offers a new dispatch", () => {
    const { props } = renderExpanded(
      basePo({
        receive_job_id: 'receive-job-1',
        receive_status: 'pending',
        receive_assigned_operator_id: JORDAN,
        receive_assigned_operator_name: 'Jordan Lee',
      })
    );

    expect(screen.getByText(/assigned to jordan lee · not started/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign receive|receive myself/i })).toBeNull();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('own pending job shows the inline brief for that exact job (pending-job recovery preserved)', async () => {
    const { props } = renderExpanded(basePo(ownPending('receive-job-own')), {
      onFetchReceiveJob: jest.fn().mockResolvedValue(ownPendingDetail('receive-job-own')),
      onClaimReceiveJob: jest.fn(),
    });

    expect(await screen.findByRole('button', { name: /^start receiving$/i })).toBeEnabled();
    expect(props.onFetchReceiveJob).toHaveBeenCalledWith('receive-job-own');
    expect(screen.queryByRole('button', { name: /open receive/i })).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});

const PENDING_OTHER = {
  receive_job_id: 'receive-job-1',
  receive_status: 'pending',
  receive_assigned_operator_id: JORDAN,
  receive_assigned_operator_name: 'Jordan Lee',
};

describe('WS-UX-01 S2 (5) — owner/admin reassignment', () => {
  it('reassigns the existing job through the reassignment callback only', async () => {
    const { props } = renderExpanded(basePo(PENDING_OTHER));

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    const picker = await screen.findByRole('list', { name: /^reassign to$/i });
    expect(within(picker).queryByText('Jordan Lee')).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: /sam rivera/i }));

    await waitFor(() => {
      expect(props.onReassignReceiveJob).toHaveBeenCalledWith('receive-job-1', SAM);
    });
    expect(props.onReassignReceiveJob).toHaveBeenCalledTimes(1);
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S2 (6) — unauthorized reassignment and assignment', () => {
  it('shows Reassign disabled with the permission reason, and never opens a picker', () => {
    const { props } = renderExpanded(basePo(PENDING_OTHER), {
      canManageReceiveAssignment: false,
      receiveAssigneesStatus: 'unavailable',
      teamAssignableOperators: [],
    });

    const reassign = screen.getByRole('button', { name: /^reassign$/i });
    expect(reassign).toBeDisabled();
    expect(screen.getByText(/only owners and admins can reassign receives/i)).toBeInTheDocument();
    fireEvent.click(reassign);
    expect(screen.queryByRole('list', { name: /reassign to/i })).toBeNull();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
  });

  it('a non-manager viewer gets no enabled dispatch action for unassigned work', () => {
    const { props } = renderExpanded(basePo(), {
      canManageReceiveAssignment: false,
      receiveAssigneesStatus: 'unavailable',
      teamAssignableOperators: [],
    });

    expect(screen.queryByRole('button', { name: /receive myself/i })).toBeNull();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(screen.getByText(/only owners and admins can assign receives/i)).toBeInTheDocument();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S2 (7) — started-job protection', () => {
  it("another operator's started job exposes no assign, reassign or resume", () => {
    const { props } = renderExpanded(
      basePo({ ...PENDING_OTHER, receive_status: 'in_progress' })
    );

    expect(
      screen.queryByRole('button', { name: /^(assign receive|reassign|receive myself|resume receive|open receive)$/i })
    ).toBeNull();
    expect(screen.queryByRole('list', { name: /assign receive to|reassign to/i })).toBeNull();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
  });

  it('own started job resumes that exact job', () => {
    renderExpanded(
      basePo({
        receive_job_id: 'receive-job-own',
        receive_status: 'in_progress',
        receive_assigned_operator_id: ME,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /resume receive/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms?receiveJobId=receive-job-own');
  });
});

describe('WS-UX-01 S2 (8) — deep-link behaviour', () => {
  it('sole self: expands to Receive myself but never dispatches on its own', async () => {
    const props = buildProps(basePo(), { teamAssignableOperators: [ME_ROW] });
    render(moduleAt(DEEP_LINK, props));

    expect(await screen.findByRole('button', { name: /^receive myself$/i })).toBeEnabled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('team: waits for the roster to load, then opens the popover without dispatching', async () => {
    const props = buildProps(basePo(), { receiveAssigneesStatus: 'loading', teamAssignableOperators: [] });
    const view = render(moduleAt(DEEP_LINK, props));

    expect(await screen.findByRole('button', { name: /loading team/i })).toBeDisabled();
    expect(screen.queryByRole('list', { name: /assign receive to/i })).toBeNull();

    view.rerender(moduleAt(DEEP_LINK, { ...props, receiveAssigneesStatus: 'ready', teamAssignableOperators: TEAM }));

    expect(await screen.findByRole('list', { name: /assign receive to/i })).toBeInTheDocument();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S2 (9) — submission locking', () => {
  it('repeat clicks dispatch exactly once and the slow notice appears after 2 seconds', async () => {
    jest.useFakeTimers();
    try {
      let resolveCreate!: (v: { receive_job_id: string }) => void;
      const onCreateReceiveJob = jest.fn(
        () => new Promise<{ receive_job_id: string }>((resolve) => { resolveCreate = resolve; })
      );
      const onReconcilePurchaseOrders = jest.fn().mockResolvedValue(canonical(ownPending('receive-new')));
      renderExpanded(basePo(), { teamAssignableOperators: [ME_ROW], onCreateReceiveJob, onReconcilePurchaseOrders });

      const button = screen.getByRole('button', { name: /^receive myself$/i });
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /assigning/i })).toBeDisabled();
      expect(screen.queryByText(/still working/i)).toBeNull();

      act(() => { jest.advanceTimersByTime(2000); });
      expect(screen.getByText(/still working\. your click registered/i)).toBeInTheDocument();

      await act(async () => { resolveCreate({ receive_job_id: 'receive-new' }); });
      expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
      expect(onReconcilePurchaseOrders).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('popover rows cannot dispatch a second operator while the first request is in flight', async () => {
    const onCreateReceiveJob = jest.fn(() => new Promise(() => {}));
    renderExpanded(basePo(), { onCreateReceiveJob });

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
    const picker = await screen.findByRole('list', { name: /assign receive to/i });
    const sam = within(picker).getByRole('button', { name: /sam rivera/i });
    const jordan = within(picker).getByRole('button', { name: /jordan lee/i });
    fireEvent.click(sam);
    fireEvent.click(jordan);

    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /assigning/i })).toBeDisabled();
  });
});

const SAM_JOB = { receive_job_id: 'receive-new', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' };

async function pickSam() {
  fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
  fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));
}

describe('WS-UX-01 S2 (10) — successful mutation reconciliation', () => {
  it('waits for a delayed canonical re-read and never unlocks against the stale projection', async () => {
    const read = deferred<unknown[]>();
    const { props, view } = renderExpanded(basePo(), { onReconcilePurchaseOrders: jest.fn(() => read.promise) });

    await pickSam();
    expect(await screen.findByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.queryByText(/receive assigned to sam rivera/i)).toBeNull();

    await act(async () => { read.resolve(canonical(SAM_JOB)); });

    // Confirmed, but the rendered projection is still stale: stay locked.
    expect(screen.getByText(/receive assigned to sam rivera/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);

    // The projection catches up: the panel shows the persisted owner.
    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical(SAM_JOB) } }));
    expect(await screen.findByText(/assigned to sam rivera · not started/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign receive/i })).toBeNull();
  });

  it('reconciles a successful reassignment and keeps Reassign locked until the projection shows it', async () => {
    const reassigned = { ...PENDING_OTHER, receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' };
    const { props, view } = renderExpanded(basePo(PENDING_OTHER), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(reassigned)),
    });

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/receive reassigned to sam rivera/i)).toBeInTheDocument();
    expect(props.onReassignReceiveJob).toHaveBeenCalledWith('receive-job-1', SAM);
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeDisabled();

    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical(reassigned) } }));
    expect(await screen.findByText(/assigned to sam rivera · not started/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeEnabled();
  });

  it('preserves the server-returned job identity: a canonical PO showing a different job fails closed', async () => {
    renderExpanded(basePo(), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(
        canonical({ ...SAM_JOB, receive_job_id: 'receive-someone-else' })
      ),
    });

    await pickSam();

    expect(await screen.findByText(/the change was saved, but the latest po doesn't show it yet/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it('FINAL-005 A: the returned job with a different canonical assignee is never reported as success', async () => {
    renderExpanded(basePo(), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(
        canonical({ ...SAM_JOB, receive_assigned_operator_id: JORDAN, receive_assigned_operator_name: 'Jordan Lee' })
      ),
    });

    await pickSam();

    expect(await screen.findByText(/the change was saved, but the latest po doesn't show it yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/receive assigned to sam rivera/i)).toBeNull();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it('FINAL-005 B: a competing reassignment is not reported as the intended success', async () => {
    const onReassignReceiveJob = jest.fn().mockResolvedValue(undefined);
    renderExpanded(basePo(PENDING_OTHER), {
      teamAssignableOperators: [...TEAM, { id: 11, name: 'Rio Park', role: 'operator' }],
      onReassignReceiveJob,
      // Same job, but a concurrent reassignment landed on someone else.
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(
        canonical({ ...PENDING_OTHER, receive_assigned_operator_id: 11, receive_assigned_operator_name: 'Rio Park' })
      ),
    });

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/the change was saved, but the latest po doesn't show it yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/receive reassigned to sam rivera/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeDisabled();
    expect(onReassignReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('a rejected canonical re-read after success fails closed and says the change was saved', async () => {
    renderExpanded(basePo(), { onReconcilePurchaseOrders: jest.fn().mockRejectedValue(new Error('500')) });

    await pickSam();

    expect(await screen.findByText(/the change was saved, but this po couldn't be reloaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });
});

describe('WS-UX-01 S2 (11) — ambiguous outcomes (timeout / 5xx)', () => {
  it('timeout with the assignment confirmed: shows the persisted result and never repeats the request', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    const ownJob = { receive_job_id: 'receive-own', receive_status: 'pending', receive_assigned_operator_id: ME, receive_assigned_operator_name: 'Mila Owner' };
    const { props, view } = renderExpanded(basePo(), {
      teamAssignableOperators: [ME_ROW],
      onCreateReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(ownJob)),
    });

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));

    expect(await screen.findByText(/receive is assigned to you/i)).toBeInTheDocument();
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();

    const s3Props = {
      ...props,
      onFetchReceiveJob: jest.fn().mockResolvedValue(ownPendingDetail('receive-own')),
      onClaimReceiveJob: jest.fn(),
    };
    view.rerender(moduleAt('/', { ...s3Props, data: { ...props.data, purchase_orders: canonical(ownJob) } }));
    expect(await screen.findByRole('button', { name: /^start receiving$/i })).toBeEnabled();
    expect(s3Props.onFetchReceiveJob).toHaveBeenCalledWith('receive-own');
    expect(s3Props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('timeout with the PO unchanged: no failure is assumed, and a reload is required before another attempt', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    const { props, view } = renderExpanded(basePo(), {
      teamAssignableOperators: [ME_ROW],
      onCreateReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical()),
    });

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));

    expect(await screen.findByText(/we couldn't confirm that change\. the latest po doesn't show it yet, but it may still be processing/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.queryByText(/checked again/i)).toBeNull();

    const button = screen.getByRole('button', { name: /^receive myself$/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // Still locked after an unrelated re-render with the same projection.
    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical() } }));
    expect(screen.getByRole('button', { name: /^receive myself$/i })).toBeDisabled();
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('5xx with a delayed re-read stays locked and claims nothing until the re-read completes', async () => {
    const read = deferred<unknown[]>();
    const onCreateReceiveJob = jest.fn().mockRejectedValue(
      Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 503 } })
    );
    renderExpanded(basePo(), { onCreateReceiveJob, onReconcilePurchaseOrders: jest.fn(() => read.promise) });

    await pickSam();

    expect(await screen.findByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.queryByText(/couldn't confirm|assigned to sam/i)).toBeNull();

    await act(async () => { read.resolve(canonical()); });

    expect(screen.getByText(/we couldn't confirm that change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('a rejected re-read after an ambiguous failure fails closed', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    renderExpanded(basePo(), { onCreateReceiveJob, onReconcilePurchaseOrders: jest.fn().mockRejectedValue(new Error('timeout')) });

    await pickSam();

    expect(await screen.findByText(/couldn't confirm whether that change was saved, and couldn't reload this po/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it('missing canonical data fails closed: PO absent from the re-read', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    renderExpanded(basePo(), {
      onCreateReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([basePo({ id: 'some-other-po' })]),
    });

    await pickSam();

    expect(await screen.findByText(/we couldn't confirm that change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it('missing reconciliation callback fails closed', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    renderExpanded(basePo(), { onCreateReceiveJob, onReconcilePurchaseOrders: undefined });

    await pickSam();

    expect(await screen.findByText(/couldn't reload this po/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it('an ambiguous reassignment confirmed by the re-read shows the persisted owner', async () => {
    const onReassignReceiveJob = jest.fn().mockRejectedValue(ambiguousNetworkError());
    renderExpanded(basePo(PENDING_OTHER), {
      onReassignReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(
        canonical({ ...PENDING_OTHER, receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' })
      ),
    });

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/receive reassigned to sam rivera/i)).toBeInTheDocument();
    expect(onReassignReceiveJob).toHaveBeenCalledTimes(1);
  });
});

describe('WS-UX-01 S2 (12) — definite refusals and existing 409 recovery', () => {
  // 409 is concurrent activity and is reconciled — see section (13).
  it('a definite non-conflict refusal (403) shows the server reason, re-reads nothing and unlocks', async () => {
    const onReconcilePurchaseOrders = jest.fn();
    const onCreateReceiveJob = jest.fn().mockRejectedValue(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: { error: 'Forbidden: missing receive-job:assign' } },
      })
    );
    renderExpanded(basePo(), { onCreateReceiveJob, onReconcilePurchaseOrders });

    await pickSam();

    expect(await screen.findByText(/forbidden: missing receive-job:assign/i)).toBeInTheDocument();
    expect(onReconcilePurchaseOrders).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeEnabled();
  });

  it("the app wrapper's 409-recovery refusal is shown verbatim", async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(
      wrapperConflict('Receive work is already assigned to another operator.')
    );
    renderExpanded(basePo(), { onCreateReceiveJob });

    await pickSam();

    // The original reason is preserved; the canonical re-read here does not
    // show the conflicting job, so the controls fail closed.
    expect(await screen.findByText(/receive work is already assigned to another operator\./i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
  });

  it("the app wrapper's 409 recovery returning the existing job reconciles to that exact job without navigating", async () => {
    const onCreateReceiveJob = jest.fn().mockResolvedValue({ receive_job_id: 'receive-existing-legacy' });
    const onReconcilePurchaseOrders = jest.fn().mockResolvedValue(canonical(ownPending('receive-existing-legacy')));
    renderExpanded(basePo(), { teamAssignableOperators: [ME_ROW], onCreateReceiveJob, onReconcilePurchaseOrders });

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));

    expect(await screen.findByText(/receive is assigned to you/i)).toBeInTheDocument();
    expect(onReconcilePurchaseOrders).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// WS-UX-01 S2 CONFLICT-004 — a 409 means the Receive changed concurrently.
// The reason is kept, the canonical PO is re-read, and controls unlock only
// once the projection shows the reconciled state; never success, never retry.
function wrapperConflict(message: string) {
  // The app wrapper's 409-recovery refusals carry the conflict status.
  return Object.assign(new Error(message), { status: 409 });
}

function patchConflict() {
  return Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { error: 'Receive job is no longer pending' } },
  });
}

describe('WS-UX-01 S2 (13) — 409 concurrent Receive activity', () => {
  it('create 409: existing job owned by another operator renders the reconciled owner, never success', async () => {
    const otherJob = { receive_job_id: 'receive-other', receive_status: 'pending', receive_assigned_operator_id: JORDAN, receive_assigned_operator_name: 'Jordan Lee' };
    const onCreateReceiveJob = jest.fn().mockRejectedValue(wrapperConflict('Receive work is already assigned to another operator.'));
    const onReconcilePurchaseOrders = jest.fn().mockResolvedValue(canonical(otherJob));
    const { props, view } = renderExpanded(basePo(), { onCreateReceiveJob, onReconcilePurchaseOrders });

    await pickSam();

    expect(await screen.findByText('Receive work is already assigned to another operator.')).toBeInTheDocument();
    expect(onReconcilePurchaseOrders).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/receive assigned to sam rivera/i)).toBeNull();
    // Stale projection: still locked.
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();

    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical(otherJob) } }));
    expect(await screen.findByText(/assigned to jordan lee · not started/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign receive/i })).toBeNull();
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('create 409: already-started work renders the reconciled state with no assign or reassign', async () => {
    const started = { receive_job_id: 'receive-started', receive_status: 'in_progress', receive_assigned_operator_id: JORDAN, receive_assigned_operator_name: 'Jordan Lee' };
    const onCreateReceiveJob = jest.fn().mockRejectedValue(wrapperConflict('Receive work has already started and cannot be reassigned.'));
    const { props, view } = renderExpanded(basePo(), {
      teamAssignableOperators: [ME_ROW],
      onCreateReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(started)),
    });

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));

    expect(await screen.findByText('Receive work has already started and cannot be reassigned.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^receive myself$/i })).toBeDisabled();

    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical(started) } }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^(receive myself|assign receive|reassign)$/i })).toBeNull();
    });
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('reassign 409 after a concurrent claim: no stale Reassign once reconciled, no retry', async () => {
    const claimed = { ...PENDING_OTHER, receive_status: 'in_progress' };
    const onReassignReceiveJob = jest.fn().mockRejectedValue(patchConflict());
    const { props, view } = renderExpanded(basePo(PENDING_OTHER), {
      onReassignReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical(claimed)),
    });

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/receive job is no longer pending/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeDisabled();

    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical(claimed) } }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^reassign$/i })).toBeNull();
    });
    expect(onReassignReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('409 with a failed re-read fails closed and keeps the original reason', async () => {
    const onReassignReceiveJob = jest.fn().mockRejectedValue(patchConflict());
    renderExpanded(basePo(PENDING_OTHER), {
      onReassignReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockRejectedValue(new Error('timeout')),
    });

    fireEvent.click(screen.getByRole('button', { name: /^reassign$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/receive job is no longer pending/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeDisabled();
    expect(onReassignReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('409 with an inconclusive re-read (projection unchanged) fails closed', async () => {
    const onCreateReceiveJob = jest.fn().mockRejectedValue(wrapperConflict('Receive work is already assigned to another operator.'));
    const { props, view } = renderExpanded(basePo(), {
      onCreateReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(canonical()),
    });

    await pickSam();

    expect(await screen.findByText(/receive work is already assigned to another operator/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: canonical() } }));
    expect(screen.getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });
});
