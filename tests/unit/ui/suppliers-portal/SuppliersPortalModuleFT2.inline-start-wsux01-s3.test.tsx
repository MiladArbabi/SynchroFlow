// WS-UX-01 S3 — inline Receive brief and explicit Start receiving in Purchasing.
//
// Ratified contract (WS-UX-01-S3-IMPLEMENT-003):
//   - Assignment and start stay separate: assigning (self included) never
//     claims or navigates.
//   - The viewer's own pending job shows an inline brief read from the
//     canonical GET /receive-jobs/:jobId. Expected quantities are display-only.
//   - Start is disabled unless the canonical job is pending, assigned to the
//     viewer, never started, this PO, and has valid lines (D2).
//   - Claim is the single start transition (D3): exactly one claim per click,
//     never retried automatically. 200 opens that exact job in WMS. An
//     ambiguous outcome is decided by one canonical job read; a definite
//     refusal keeps its reason and reconciles. Failed or inconclusive reads
//     fail closed.
//   - Resume and deep links never claim.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  resolveReceiveBrief,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const ME = 3;
const SAM = 9;
const PO_ID = 'po-uuid-s3';
const JOB_ID = 'receive-job-s3';
const SUPPLIER = 'Fjord Fabrics';
const ME_ROW = { id: ME, name: 'Mila Owner', role: 'owner' };
const TEAM = [ME_ROW, { id: SAM, name: 'Sam Rivera', role: 'operator' }];

function basePo(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    po_number: 3003,
    supplier_name: SUPPLIER,
    supplier_contact_email: null,
    supplier_contact_name: null,
    supplier_moq: null,
    supplier_on_time_rate: null,
    supplier_fill_rate: null,
    status: 'shipped',
    expected_delivery_date: '2026-10-20',
    actual_delivery_date: null,
    line_items_count: 2,
    total_units_ordered: 10,
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

const OWN_PENDING = {
  receive_job_id: JOB_ID,
  receive_status: 'pending',
  receive_assigned_operator_id: ME,
  receive_assigned_operator_name: 'Mila Owner',
};

function detail(
  job: Record<string, unknown> = {},
  lines: unknown = [{ receive_job_line_id: 'line-1', quantity_expected: 3, quantity_accepted: 0 }]
) {
  return {
    job: {
      receive_job_id: JOB_ID,
      po_id: PO_ID,
      status: 'pending',
      assigned_operator_id: ME,
      started_at: null,
      supplier_name: SUPPLIER,
      ...job,
    },
    lines,
  } as any;
}

const STARTED = { status: 'in_progress', started_at: '2026-10-22T09:24:00.000Z' };

function buildProps(po: ReturnType<typeof basePo>, overrides: Record<string, unknown> = {}) {
  return {
    view: 'pos',
    data: { purchase_orders: [po], suppliers: [], never_ordered: [], never_ordered_count: 0 },
    isLoading: false,
    isError: false,
    onRefresh: jest.fn(),
    onReconcilePurchaseOrders: jest.fn().mockResolvedValue([po]),
    onFetchLineItems: jest.fn().mockResolvedValue([]),
    onUpdatePoStatus: jest.fn(),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: JOB_ID }),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
    onFetchReceiveJob: jest.fn().mockResolvedValue(detail()),
    onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
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

function renderExpanded(po = basePo(OWN_PENDING), overrides: Record<string, unknown> = {}) {
  const props = buildProps(po, overrides);
  const view = render(moduleAt('/', props));
  fireEvent.click(screen.getByText(SUPPLIER));
  return { props, view };
}

async function readyStart() {
  const button = await screen.findByRole('button', { name: /^start receiving$/i });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

function axiosError(status?: number, error?: string) {
  return Object.assign(new Error(status ? `Request failed with status ${status}` : 'Network Error'), {
    isAxiosError: true,
    ...(status ? { response: { status, data: error ? { error } : {} } } : {}),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('WS-UX-01 S3 — assignment never starts', () => {
  it('self-assignment stays in Purchasing and then shows the inline brief without claiming', async () => {
    const props = buildProps(basePo(), {
      teamAssignableOperators: [ME_ROW],
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([basePo(OWN_PENDING)]),
    });
    const view = render(moduleAt('/', props));
    fireEvent.click(screen.getByText(SUPPLIER));

    fireEvent.click(screen.getByRole('button', { name: /^receive myself$/i }));
    expect(await screen.findByText(/receive is assigned to you/i)).toBeInTheDocument();

    // The page's PO projection catches up with the reconciled assignment.
    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: [basePo(OWN_PENDING)] } }));

    await readyStart();
    expect(props.onFetchReceiveJob).toHaveBeenCalledWith(JOB_ID);
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('assigning another operator never claims', async () => {
    const { props } = renderExpanded(basePo(), {
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([
        basePo({ receive_job_id: JOB_ID, receive_status: 'pending', receive_assigned_operator_id: SAM }),
      ]),
    });

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    expect(await screen.findByText(/receive assigned to sam rivera/i)).toBeInTheDocument();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S3 — inline brief from the canonical job', () => {
  it('uses the canonical job lines: partial-delivery expected and remaining, not the PO order totals', async () => {
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob: jest.fn().mockResolvedValue(detail({}, [
        { receive_job_line_id: 'line-1', quantity_expected: 2, quantity_accepted: 0 },
        { receive_job_line_id: 'line-2', quantity_expected: 5, quantity_accepted: 1 },
      ])),
    });

    await readyStart();
    expect(screen.getByText(/2 products · 7 units expected · 6 remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/assigned to you · not started/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`receive from ${SUPPLIER}`, 'i'))).toBeInTheDocument();
    expect(screen.getByText(/count good, usable units only/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('receive-inline-brief')).queryByText(/10 units/i)).toBeNull();
  });

  it('does not fetch the brief while the PO is collapsed', () => {
    const props = buildProps(basePo(OWN_PENDING));
    render(moduleAt('/', props));
    expect(props.onFetchReceiveJob).not.toHaveBeenCalled();
  });

  it.each([
    ['no lines', detail({}, [])],
    ['malformed lines', detail({}, [{ receive_job_line_id: 'line-1', quantity_expected: 'x' }])],
    ['zero expected units', detail({}, [{ receive_job_line_id: 'line-1', quantity_expected: 0 }])],
    ['a job that is no longer pending', detail(STARTED)],
    ['a job assigned to someone else', detail({ assigned_operator_id: SAM })],
    ['a different job', detail({ receive_job_id: 'other-job' })],
    ['a job for another PO', detail({ po_id: 'other-po' })],
    ['pending but already started (inconsistent)', detail({ started_at: '2026-10-22T09:00:00.000Z' })],
  ])('disables Start for %s', async (_label, jobDetail) => {
    const { props } = renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob: jest.fn().mockResolvedValue(jobDetail),
    });

    await waitFor(() => expect(props.onFetchReceiveJob).toHaveBeenCalledWith(JOB_ID));
    await waitFor(() => {
      expect(screen.queryByText(/loading receive details/i)).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^start receiving$/i }));
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('disables Start while the canonical job is loading', () => {
    renderExpanded(basePo(OWN_PENDING), { onFetchReceiveJob: jest.fn(() => new Promise(() => undefined)) });

    expect(screen.getByText(/loading receive details/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();
  });

  it('disables Start after a failed read; Try again re-reads explicitly', async () => {
    const onFetchReceiveJob = jest.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce(detail());
    const { props } = renderExpanded(basePo(OWN_PENDING), { onFetchReceiveJob });

    expect(await screen.findByText(/couldn't load this receive/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await readyStart();
    expect(onFetchReceiveJob).toHaveBeenCalledTimes(2);
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('expected quantities never prefill or confirm counts', () => {
    const model = resolveReceiveBrief(detail(), { jobId: JOB_ID, poId: PO_ID, currentUserId: ME });
    expect(model).toEqual({ ok: true, supplierName: SUPPLIER, lineCount: 1, expectedUnits: 3, remainingUnits: 3 });
  });
});

describe('WS-UX-01 S3 — Start receiving claims exactly once', () => {
  it('200 navigates to the exact clicked job', async () => {
    const { props } = renderExpanded();

    fireEvent.click(await readyStart());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`));
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
    expect(props.onClaimReceiveJob).toHaveBeenCalledWith(JOB_ID);
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
  });

  it('repeat clicks claim once, lock before re-render, and speak up after 2 seconds', async () => {
    const claim = deferred<void>();
    const onClaimReceiveJob = jest.fn(() => claim.promise);
    renderExpanded(basePo(OWN_PENDING), { onClaimReceiveJob });
    const button = await readyStart();

    jest.useFakeTimers();
    try {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      expect(onClaimReceiveJob).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled();
      expect(screen.queryByText(/still working/i)).toBeNull();

      act(() => { jest.advanceTimersByTime(2000); });
      expect(screen.getByText(/still working\. your click registered/i)).toBeInTheDocument();

      await act(async () => { claim.resolve(); });
      expect(onClaimReceiveJob).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`);
    } finally {
      jest.useRealTimers();
    }
  });

  it('timeout with the canonical job started by the viewer: navigates once, no second claim', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail(STARTED));
    const { props } = renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError()),
    });

    fireEvent.click(await readyStart());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`));
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
    expect(onFetchReceiveJob).toHaveBeenLastCalledWith(JOB_ID);
  });

  it('5xx with the canonical job still pending and owned: no navigation, no automatic retry, explicit retry allowed', async () => {
    const onClaimReceiveJob = jest.fn().mockRejectedValueOnce(axiosError(502));
    const onFetchReceiveJob = jest.fn().mockResolvedValue(detail());
    renderExpanded(basePo(OWN_PENDING), { onFetchReceiveJob, onClaimReceiveJob });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/we couldn't confirm that receive started\. it still shows as not started/i)).toBeInTheDocument();
    expect(screen.queryByText(/didn't start|nothing changed/i)).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onClaimReceiveJob).toHaveBeenCalledTimes(1);
    const retry = await readyStart();

    onClaimReceiveJob.mockResolvedValueOnce(undefined);
    fireEvent.click(retry);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`));
    expect(onClaimReceiveJob).toHaveBeenCalledTimes(2);
  });

  it('timeout with a failed reconciliation read fails closed', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new Error('500'));
    const { props } = renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError()),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/couldn't confirm whether receive started, and couldn't reload it/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start receiving|checking|starting/i })).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('timeout with an inconclusive canonical job (now someone else) fails closed', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ ...STARTED, assigned_operator_id: SAM }));
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(503)),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/the latest receive doesn't show it/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('409 keeps the refusal, reconciles the job and PO, and does not navigate', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ assigned_operator_id: SAM }));
    const onReconcilePurchaseOrders = jest.fn().mockResolvedValue([
      basePo({ ...OWN_PENDING, receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' }),
    ]);
    const { props } = renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onReconcilePurchaseOrders,
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(409, 'JOB_CLAIMED_BY_OTHER')),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/this receive is now assigned to someone else/i)).toBeInTheDocument();
    await waitFor(() => expect(onReconcilePurchaseOrders).toHaveBeenCalledTimes(1));
    expect(onFetchReceiveJob).toHaveBeenCalledTimes(2);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();
  });

  it('409 whose canonical state is still pending and mine contradicts the refusal and fails closed', async () => {
    const onFetchReceiveJob = jest.fn().mockResolvedValue(detail());
    const { props } = renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([basePo(OWN_PENDING)]),
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(409, 'JOB_CLAIM_CONFLICT')),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/this receive changed while you were starting it\. the latest receive and po don't show a consistent state yet/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start receiving|checking|starting/i })).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('409 with the job and PO disagreeing fails closed', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ assigned_operator_id: SAM }));
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      // The PO still claims the job is pending and the viewer's.
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([basePo(OWN_PENDING)]),
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(409, 'JOB_CLAIMED_BY_OTHER')),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/don't show a consistent state yet/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('409 with a missing canonical PO fails closed', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ assigned_operator_id: SAM }));
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([]),
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(409, 'JOB_CLAIMED_BY_OTHER')),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/don't show a consistent state yet/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('409 for a job cancelled meanwhile reconciles: the PO no longer offers Start', async () => {
    const cancelledPo = basePo();
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ status: 'cancelled' }));
    const props = buildProps(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([cancelledPo]),
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(409, 'JOB_NOT_CLAIMABLE')),
    });
    const view = render(moduleAt('/', props));
    fireEvent.click(screen.getByText(SUPPLIER));

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/this receive can no longer be started/i)).toBeInTheDocument();
    expect(screen.queryByText(/reload the page before making another change/i)).toBeNull();
    // Stale projection: still locked until the page renders the reconciled PO.
    expect(screen.getByRole('button', { name: /^start receiving$/i })).toBeDisabled();

    view.rerender(moduleAt('/', { ...props, data: { ...props.data, purchase_orders: [cancelledPo] } }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /start receiving/i })).toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('a non-conflict refusal (403) with unchanged canonical state keeps the reason and allows only an explicit retry', async () => {
    const onClaimReceiveJob = jest.fn().mockRejectedValue(axiosError(403, 'Forbidden: missing receive-job:read'));
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob: jest.fn().mockResolvedValue(detail()),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([basePo(OWN_PENDING)]),
      onClaimReceiveJob,
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/forbidden: missing receive-job:read/i)).toBeInTheDocument();
    await readyStart();
    expect(onClaimReceiveJob).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('404 keeps the refusal and fails closed when the job cannot be re-read', async () => {
    const onFetchReceiveJob = jest.fn()
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(axiosError(404));
    renderExpanded(basePo(OWN_PENDING), {
      onFetchReceiveJob,
      onClaimReceiveJob: jest.fn().mockRejectedValue(axiosError(404, 'Job not found')),
    });

    fireEvent.click(await readyStart());

    expect(await screen.findByText(/this receive no longer exists\. this receive couldn't be reloaded/i)).toBeInTheDocument();
    expect(screen.getByText(/reload the page before making another change/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S3 D5 — action=receive deep-link state matrix', () => {
  const DEEP = `/?action=receive&poId=${PO_ID}`;

  it('own pending job: expands the PO to the inline brief; no navigation, claim or dispatch', async () => {
    const props = buildProps(basePo(OWN_PENDING));
    render(moduleAt(DEEP, props));

    expect(await screen.findByTestId('receive-inline-brief')).toBeVisible();
    await readyStart();
    expect(props.onFetchReceiveJob).toHaveBeenCalledWith(JOB_ID);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
  });

  it('own started job: opens that exact job in WMS once; no claim', async () => {
    const props = buildProps(basePo({ ...OWN_PENDING, receive_status: 'in_progress' }));
    render(moduleAt(DEEP, props));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('unassigned: keeps S2 (expands to assignment), no dispatch or claim', async () => {
    const props = buildProps(basePo());
    render(moduleAt(DEEP, props));

    expect(await screen.findByRole('list', { name: /assign receive to/i })).toBeInTheDocument();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('other operator: no brief, Start, navigation, read or claim', async () => {
    const props = buildProps(basePo({ ...OWN_PENDING, receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' }));
    render(moduleAt(DEEP, props));

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByTestId('receive-inline-brief')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(props.onFetchReceiveJob).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S3 — never claims outside an explicit Start', () => {
  it("another operator's pending job offers no Start and reads nothing", () => {
    const { props } = renderExpanded(
      basePo({ ...OWN_PENDING, receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' })
    );

    expect(screen.queryByRole('button', { name: /start receiving/i })).toBeNull();
    expect(props.onFetchReceiveJob).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('Resume Receive navigates to the started job and never claims', () => {
    const { props } = renderExpanded(basePo({ ...OWN_PENDING, receive_status: 'in_progress' }));

    fireEvent.click(screen.getByRole('button', { name: /resume receive/i }));

    expect(mockNavigate).toHaveBeenCalledWith(`/wms?receiveJobId=${JOB_ID}`);
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onFetchReceiveJob).not.toHaveBeenCalled();
  });

  it.each([
    ['own pending job', basePo(OWN_PENDING)],
    ['own started job', basePo({ ...OWN_PENDING, receive_status: 'in_progress' })],
    ['unassigned arrived PO', basePo()],
  ])('the action=receive deep link never claims (%s)', async (_label, po) => {
    const props = buildProps(po);
    render(moduleAt(`/?action=receive&poId=${PO_ID}`, props));

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});
