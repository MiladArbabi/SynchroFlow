// WS-UX-01 S4 — Open POs split list/detail.
//
// Ratified contract (WS-UX-01-S4-IMPLEMENT-002):
//   D1  Details mount on first selection and stay mounted: locks,
//       reconciliation, line-item caches and pending callbacks survive
//       switching POs. A Start receiving claim holds the selection until it
//       resolves.
//   D2  Selection lives in ?po=<PO UUID>. User selections push history;
//       automatic normalization replaces. Unrelated params are kept.
//   D3  action=receive&poId=X runs the certified D5 decision once, then
//       normalizes to ?po=X. Never auto-claims or auto-dispatches.
//   D4  Closed/cancelled POs keep their collapsible group; read-only detail.
//   D6  Row state from the PO projection only; "Receiving" only for an
//       active started job.
// Real router history is used here (useNavigate is not mocked); a probe
// outside the routes records the current location.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  inspectLineItems,
  isPoOverdue,
  poMatchesFilters,
  resolvePoLifecycleSteps,
  sortPurchaseOrders,
  resolvePoRowLabels,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const ME = 3;
const SAM = 9;
const ME_ROW = { id: ME, name: 'Mila Owner', role: 'owner' };
const TEAM = [ME_ROW, { id: SAM, name: 'Sam Rivera', role: 'operator' }];

function po(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    po_number: Number(id.replace(/\D/g, '')) || 1,
    supplier_name: `Supplier ${id}`,
    supplier_contact_email: null,
    supplier_contact_name: null,
    supplier_moq: null,
    supplier_on_time_rate: null,
    supplier_fill_rate: null,
    status: 'shipped',
    // Far future: the On the way fixture must never become overdue as time passes.
    expected_delivery_date: '2099-10-24',
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

const OWN_PENDING = {
  receive_job_id: 'job-own',
  receive_status: 'pending',
  receive_assigned_operator_id: ME,
  receive_assigned_operator_name: 'Mila Owner',
};

// API order is deliberately mixed across groups.
const DRAFT = po('po-101', { status: 'draft', supplier_name: 'Draft Supply' });
const ON_THE_WAY = po('po-102', { status: 'ordered', supplier_name: 'Transit Supply' });
const ARRIVED = po('po-103', { status: 'shipped', supplier_name: 'Dock Supply' });
const PARTIAL = po('po-104', { status: 'partially_received', supplier_name: 'Partial Supply' });
const OWN = po('po-105', { status: 'shipped', supplier_name: 'Own Supply', ...OWN_PENDING });
const RECEIVED = po('po-106', { status: 'received', supplier_name: 'Done Supply' });
const ALL = [DRAFT, ON_THE_WAY, ARRIVED, PARTIAL, OWN, RECEIVED];

function ownDetail() {
  return {
    job: { receive_job_id: 'job-own', po_id: OWN.id, status: 'pending', assigned_operator_id: ME, started_at: null, supplier_name: 'Own Supply' },
    lines: [{ receive_job_line_id: 'line-1', quantity_expected: 3, quantity_accepted: 0 }],
  };
}

function buildProps(purchaseOrders: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    view: 'pos',
    data: { purchase_orders: purchaseOrders, suppliers: [], never_ordered: [], never_ordered_count: 0 },
    isLoading: false,
    isError: false,
    onRefresh: jest.fn(),
    onReconcilePurchaseOrders: jest.fn().mockResolvedValue(purchaseOrders),
    onFetchLineItems: jest.fn().mockResolvedValue([]),
    onUpdatePoStatus: jest.fn().mockResolvedValue(undefined),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'job-new' }),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
    onFetchReceiveJob: jest.fn().mockResolvedValue(ownDetail()),
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

let location = { pathname: '/', search: '' };
function Probe() {
  const current = useLocation();
  const navigate = useNavigate();
  location = { pathname: current.pathname, search: current.search };
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>history back</button>
      <button type="button" onClick={() => navigate(1)}>history forward</button>
    </>
  );
}

function renderAt(url: string, props: ReturnType<typeof buildProps>) {
  const tree = (p: typeof props) => (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<SuppliersPortalModuleFT2 {...p} />} />
        <Route path="*" element={<div>left purchasing</div>} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );
  const view = render(tree(props));
  return { ...view, rerenderWith: (p: typeof props) => view.rerender(tree(p)) };
}

const params = () => new URLSearchParams(location.search);
const row = (id: string) => screen.getByTestId(`po-row-${id}`);
const detail = (id: string) => screen.getByTestId(`po-detail-${id}`);
const isSelected = (id: string) => row(id).getAttribute('aria-current') === 'true';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  location = { pathname: '/', search: '' };
});

describe('WS-UX-01 S4 (1) — grouping, order and counts', () => {
  it('groups Arrived → On the way → Drafts, keeps API order inside groups, and counts them', () => {
    renderAt('/', buildProps(ALL));
    const list = screen.getByTestId('po-list-rows');
    const groups = within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Arrived', 'On the way', 'Drafts']);

    const arrived = within(within(list).getByRole('group', { name: 'Arrived' })).getAllByRole('button');
    expect(arrived.map((b) => b.getAttribute('data-testid'))).toEqual([
      `po-row-${ARRIVED.id}`, `po-row-${PARTIAL.id}`, `po-row-${OWN.id}`,
    ]);
    expect(screen.getByText('3 arrived · 1 on the way · 1 draft')).toBeInTheDocument();
    // Closed POs live in the Closed view, not under the open list.
    expect(screen.queryByTestId(`po-row-${RECEIVED.id}`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open (5)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Closed (1)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('D6 / polish-008: top line is the PO status, bottom line the Receive assignment (projection only)', () => {
    const labels = (p: unknown) => resolvePoRowLabels(p as any, ME);
    expect(labels(ARRIVED)).toEqual({ status: 'Arrived', overdue: false, assignment: { label: 'Not assigned', tone: 'accent' } });
    expect(labels(PARTIAL)).toMatchObject({ status: 'Partially received', assignment: { label: 'Not assigned' } });
    expect(labels(OWN).assignment.label).toBe('Assigned: Mila Owner');
    expect(labels(po('x', { receive_job_id: 'j', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' })).assignment.label).toBe('Assigned: Sam Rivera');
    expect(labels(po('x', { receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Owner Dev' }))).toMatchObject({ status: 'Arrived', assignment: { label: 'Receiving: Owner Dev', tone: 'accent' } });
    expect(labels(po('x', { status: 'partially_received', receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Owner Dev' }))).toMatchObject({ status: 'Partially received', assignment: { label: 'Receiving: Owner Dev' } });
    // Never fabricate identity: an id without a name stays an id; nothing becomes "Receiving: <someone>".
    expect(labels(po('x', { receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: SAM })).assignment.label).toBe(`Receiving: Operator #${SAM}`);
    expect(labels(ON_THE_WAY)).toMatchObject({ status: 'On the way', assignment: { label: 'Receive not started' } });
    expect(labels(DRAFT)).toMatchObject({ status: 'Draft', assignment: { label: 'Receive not started' } });
    expect(labels(RECEIVED)).toMatchObject({ status: 'Received', assignment: { label: 'Receive complete' } });
  });

  it('D6: a partially received PO without a started job is not called Receiving in the detail', () => {
    renderAt(`/?po=${PARTIAL.id}`, buildProps(ALL));
    expect(within(detail(PARTIAL.id)).getByText('Partially received')).toBeInTheDocument();
    expect(within(detail(PARTIAL.id)).queryByText('Receiving')).toBeNull();
  });
});

describe('WS-UX-01 S4 (2–4) — selection and URL', () => {
  it('selects the first Arrived PO by default without writing the URL', () => {
    renderAt('/', buildProps(ALL));
    expect(isSelected(ARRIVED.id)).toBe(true);
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(params().get('po')).toBeNull();
  });

  it('falls back to On the way, then Drafts, when nothing has arrived', () => {
    renderAt('/', buildProps([DRAFT, ON_THE_WAY]));
    expect(isSelected(ON_THE_WAY.id)).toBe(true);
  });

  it('a click writes ?po (keeping other params) and Back/Forward restore the selection', () => {
    renderAt('/?view=x&utm=1', buildProps(ALL));

    fireEvent.click(row(DRAFT.id));
    expect(params().get('po')).toBe(DRAFT.id);
    expect(params().get('utm')).toBe('1');
    expect(isSelected(DRAFT.id)).toBe(true);

    fireEvent.click(row(ON_THE_WAY.id));
    expect(isSelected(ON_THE_WAY.id)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'history back' }));
    expect(params().get('po')).toBe(DRAFT.id);
    expect(isSelected(DRAFT.id)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'history forward' }));
    expect(isSelected(ON_THE_WAY.id)).toBe(true);
  });

  it('a direct link (refresh) restores the selected PO', () => {
    renderAt(`/?po=${DRAFT.id}`, buildProps(ALL));
    expect(isSelected(DRAFT.id)).toBe(true);
    expect(detail(DRAFT.id)).toBeVisible();
  });

  it('an unknown ?po falls back to the default and is removed (replace)', async () => {
    renderAt('/?po=po-gone&keep=1', buildProps(ALL));
    expect(isSelected(ARRIVED.id)).toBe(true);
    await waitFor(() => expect(params().get('po')).toBeNull());
    expect(params().get('keep')).toBe('1');
  });
});

describe('WS-UX-01 S4 (5) — action=receive deep link (D3 + certified D5)', () => {
  it('own pending: selects the PO, shows the brief, then normalizes to ?po=X; never claims', async () => {
    const props = buildProps(ALL);
    renderAt(`/?action=receive&poId=${OWN.id}`, props);

    expect(isSelected(OWN.id)).toBe(true);
    expect(await within(detail(OWN.id)).findByTestId('receive-inline-brief')).toBeVisible();
    await waitFor(() => expect(location.search).toBe(`?po=${OWN.id}`));
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('unassigned: opens the assignment popover once, dispatches nothing, normalizes', async () => {
    const props = buildProps(ALL);
    const { rerenderWith } = renderAt(`/?action=receive&poId=${PARTIAL.id}`, props);

    expect(await screen.findByRole('list', { name: /assign receive to/i })).toBeInTheDocument();
    await waitFor(() => expect(location.search).toBe(`?po=${PARTIAL.id}`));
    rerenderWith({ ...props });
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('own started: opens that exact job in WMS; no claim', async () => {
    const started = po('po-107', { status: 'shipped', receive_job_id: 'job-run', receive_status: 'in_progress', receive_assigned_operator_id: ME });
    const props = buildProps([started]);
    renderAt(`/?action=receive&poId=${started.id}`, props);

    await waitFor(() => expect(location.pathname).toBe('/wms'));
    expect(location.search).toBe('?receiveJobId=job-run');
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
  });

  it('a PO the Receive decision does not apply to is selected and normalized', async () => {
    renderAt(`/?action=receive&poId=${DRAFT.id}`, buildProps(ALL));
    expect(isSelected(DRAFT.id)).toBe(true);
    await waitFor(() => expect(location.search).toBe(`?po=${DRAFT.id}`));
  });

  it('an unknown poId is dropped and the default is selected', async () => {
    renderAt('/?action=receive&poId=po-gone', buildProps(ALL));
    await waitFor(() => expect(location.search).toBe(''));
    expect(isSelected(ARRIVED.id)).toBe(true);
  });
});

describe('WS-UX-01 S4 (6, 7, 9) — mounted per-PO state', () => {
  it('an in-flight assignment survives switching away and back; exactly one create', async () => {
    const create = deferred<{ receive_job_id: string }>();
    const assigned = { ...ARRIVED, receive_job_id: 'job-new', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' };
    const props = buildProps(ALL, {
      onCreateReceiveJob: jest.fn(() => create.promise),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([assigned]),
    });
    renderAt('/', props);

    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /assigning/i })).toBeDisabled();

    fireEvent.click(row(DRAFT.id));
    expect(detail(ARRIVED.id)).not.toBeVisible();
    await act(async () => { create.resolve({ receive_job_id: 'job-new' }); });

    fireEvent.click(row(ARRIVED.id));
    expect(await within(detail(ARRIVED.id)).findByText(/receive assigned to sam rivera/i)).toBeInTheDocument();
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('a reload lock (inconclusive reconciliation) is still there after switching back', async () => {
    const props = buildProps(ALL, {
      onCreateReceiveJob: jest.fn().mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true })),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(ALL),
    });
    renderAt('/', props);

    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));
    expect(await within(detail(ARRIVED.id)).findByText(/reload the page before making another change/i)).toBeInTheDocument();

    fireEvent.click(row(DRAFT.id));
    fireEvent.click(row(ARRIVED.id));
    expect(within(detail(ARRIVED.id)).getByText(/reload the page before making another change/i)).toBeVisible();
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i })).toBeDisabled();
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });
});

describe('WS-UX-01 S4 (8) — Start receiving holds the selection', () => {
  it('other rows are disabled and URL selection cannot move until the claim resolves', async () => {
    const claim = deferred<void>();
    const props = buildProps(ALL, {
      onClaimReceiveJob: jest.fn(() => claim.promise),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(ALL),
    });
    renderAt(`/?po=${OWN.id}`, props);

    const start = await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(row(DRAFT.id)).toBeDisabled();
    fireEvent.click(row(DRAFT.id));
    expect(isSelected(OWN.id)).toBe(true);
    expect(params().get('po')).toBe(OWN.id);

    // A definite refusal is a resolved state: the hold is released.
    await act(async () => {
      claim.reject(Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403, data: { error: 'Forbidden' } } }));
    });
    await waitFor(() => expect(row(DRAFT.id)).toBeEnabled());
    fireEvent.click(row(DRAFT.id));
    expect(isSelected(DRAFT.id)).toBe(true);
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });
});

describe('WS-UX-01 S4 (10) — popovers and menus close on deselection', () => {
  it('the assignment popover closes when another PO is selected', async () => {
    renderAt('/', buildProps(ALL));
    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    expect(await screen.findByRole('list', { name: /assign receive to/i })).toBeInTheDocument();

    fireEvent.click(row(DRAFT.id));
    await waitFor(() => expect(screen.queryByRole('list', { name: /assign receive to/i })).toBeNull());
  });

  it('polish-008: there is no More menu; Cancel PO is a visible secondary action', () => {
    renderAt('/', buildProps(ALL));
    expect(within(detail(ARRIVED.id)).queryByRole('button', { name: /more actions/i })).toBeNull();
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /^cancel po…$/i })).toBeEnabled();
  });
});

describe('WS-UX-01 S4 (11) — line items load once per PO', () => {
  it('fetches on first selection only and keeps the cache', async () => {
    const props = buildProps(ALL);
    renderAt('/', props);
    await waitFor(() => expect(props.onFetchLineItems).toHaveBeenCalledWith(ARRIVED.id));

    fireEvent.click(row(DRAFT.id));
    await waitFor(() => expect(props.onFetchLineItems).toHaveBeenCalledWith(DRAFT.id));
    fireEvent.click(row(ARRIVED.id));
    fireEvent.click(row(DRAFT.id));

    expect(props.onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id)).toHaveLength(1);
    expect(props.onFetchLineItems.mock.calls.filter(([id]: [string]) => id === DRAFT.id)).toHaveLength(1);
    // Never-selected POs are never fetched.
    expect(props.onFetchLineItems).not.toHaveBeenCalledWith(ON_THE_WAY.id);
  });
});

describe('WS-UX-01 S4 (11b) — line-item load failure recovery', () => {
  const LINE = { id: 'li-1', product_title: 'Ridge 158 Snowboard', sku: 'RDG-158', quantity_ordered: 4, quantity_received: 0 };

  it('a failed first load shows the error with Try again and never retries on its own', async () => {
    const onFetchLineItems = jest.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue([LINE]);
    renderAt('/', buildProps(ALL, { onFetchLineItems }));

    const alert = await within(detail(ARRIVED.id)).findByText(/failed to load line items/i);
    expect(alert).toBeVisible();
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /try again/i })).toBeEnabled();

    // Reselecting is not a hidden retry loop.
    fireEvent.click(row(DRAFT.id));
    fireEvent.click(row(ARRIVED.id));
    await act(async () => { await Promise.resolve(); });
    expect(onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id)).toHaveLength(1);
  });

  it('Try again sends exactly one new request; success clears the error, shows the items and resumes caching', async () => {
    let resolveRetry!: (items: unknown[]) => void;
    const onFetchLineItems = jest.fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }))
      .mockResolvedValue([LINE]);
    renderAt('/', buildProps(ALL, { onFetchLineItems }));
    const arrivedCalls = () => onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id).length;

    const retry = await within(detail(ARRIVED.id)).findByRole('button', { name: /try again/i });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(arrivedCalls()).toBe(2);
    expect(within(detail(ARRIVED.id)).queryByText(/failed to load line items/i)).toBeNull();

    await act(async () => { resolveRetry([LINE]); });
    expect(await within(detail(ARRIVED.id)).findByText('Ridge 158 Snowboard')).toBeVisible();
    expect(within(detail(ARRIVED.id)).queryByRole('button', { name: /try again/i })).toBeNull();

    fireEvent.click(row(DRAFT.id));
    fireEvent.click(row(ARRIVED.id));
    expect(arrivedCalls()).toBe(2);
  });

  it('a failed retry offers Try again again, still one request per click', async () => {
    const onFetchLineItems = jest.fn().mockRejectedValue(new Error('500'));
    renderAt('/', buildProps(ALL, { onFetchLineItems }));

    fireEvent.click(await within(detail(ARRIVED.id)).findByRole('button', { name: /try again/i }));
    fireEvent.click(await within(detail(ARRIVED.id)).findByRole('button', { name: /try again/i }));
    await within(detail(ARRIVED.id)).findByRole('button', { name: /try again/i });
    expect(onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id)).toHaveLength(3);
  });
});

describe('WS-UX-01 S4 (12) — closed and cancelled POs', () => {
  it('the Closed view lists closed POs, and a closed PO shows a read-only detail', () => {
    renderAt('/', buildProps(ALL));
    fireEvent.click(screen.getByRole('button', { name: 'Closed (1)' }));
    fireEvent.click(row(RECEIVED.id));

    const closed = detail(RECEIVED.id);
    expect(closed).toBeVisible();
    expect(within(closed).queryByTestId('po-next-step')).toBeNull();
    expect(within(closed).queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('a direct link to a closed PO opens its group and selects it', () => {
    renderAt(`/?po=${RECEIVED.id}`, buildProps(ALL));
    expect(isSelected(RECEIVED.id)).toBe(true);
    expect(detail(RECEIVED.id)).toBeVisible();
  });
});

describe('WS-UX-01 S4 (13) — empty, loading and error', () => {
  it('no POs: the empty state with Create your first PO, and no split view', () => {
    renderAt('/', buildProps([]));
    expect(screen.getByText(/no open purchase orders/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create your first po/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /purchase orders/i })).toBeNull();
  });

  it('loading shows the skeleton and no list', () => {
    const { container } = renderAt('/', buildProps(ALL, { isLoading: true }));
    expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: /purchase orders/i })).toBeNull();
  });

  it('a failed load shows the error and no list', () => {
    renderAt('/', buildProps(ALL, { isError: true }));
    expect(screen.getByText(/failed to load supplier data/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /purchase orders/i })).toBeNull();
  });
});

describe('WS-UX-01 S4 (14) — S1–S3 action parity in the detail', () => {
  it('Draft: Mark as sent; On the way: Mark as arrived', async () => {
    const props = buildProps(ALL);
    renderAt(`/?po=${DRAFT.id}`, props);
    fireEvent.click(within(detail(DRAFT.id)).getByRole('button', { name: /^mark as sent$/i }));
    await waitFor(() => expect(props.onUpdatePoStatus).toHaveBeenCalledWith(DRAFT.id, 'ordered', undefined));

    fireEvent.click(row(ON_THE_WAY.id));
    fireEvent.click(within(detail(ON_THE_WAY.id)).getByRole('button', { name: /^mark as arrived$/i }));
    await waitFor(() => expect(props.onUpdatePoStatus).toHaveBeenCalledWith(ON_THE_WAY.id, 'shipped', undefined));
  });

  it('each lifecycle control appears once, in the Next step section of the selected PO', () => {
    renderAt('/', buildProps(ALL));
    const nextStep = within(detail(ARRIVED.id)).getByTestId('po-next-step');
    expect(within(nextStep).getAllByRole('button', { name: /assign receive/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /assign receive/i })).toHaveLength(1);
  });

  it("another operator's pending job: assignee shown, Reassign for owners, no Start", () => {
    const other = po('po-108', { status: 'shipped', receive_job_id: 'job-o', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' });
    renderAt('/', buildProps([other]));
    expect(within(detail(other.id)).getByText(/assigned to sam rivera · not started/i)).toBeInTheDocument();
    expect(within(detail(other.id)).getByRole('button', { name: /^reassign$/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /start receiving/i })).toBeNull();
  });
});

describe('WS-UX-01 S4 polish — overdue dates (local calendar day)', () => {
  const TODAY = new Date(2026, 9, 22, 0, 30); // 22 Oct 2026, just after local midnight
  const onTheWay = (expected: unknown, status = 'ordered') => po('x', { status, expected_delivery_date: expected }) as any;

  it('before today is overdue; today and future are not', () => {
    expect(isPoOverdue(onTheWay('2026-10-21'), TODAY)).toBe(true);
    expect(isPoOverdue(onTheWay('2026-10-12T00:00:00.000Z'), TODAY)).toBe(true);
    expect(isPoOverdue(onTheWay('2026-10-22'), TODAY)).toBe(false);
    expect(isPoOverdue(onTheWay('2026-10-23'), TODAY)).toBe(false);
  });

  it('missing or malformed dates are never overdue', () => {
    for (const value of [null, undefined, '', 'soon', '2026-13-40', '2026-02-30']) {
      expect(isPoOverdue(onTheWay(value), TODAY)).toBe(false);
    }
  });

  it('only outstanding On the way POs can be overdue', () => {
    for (const status of ['draft', 'shipped', 'partially_received', 'received', 'cancelled']) {
      expect(isPoOverdue(onTheWay('2020-01-01', status), TODAY)).toBe(false);
    }
    for (const status of ['ordered', 'confirmed', 'in_production']) {
      expect(isPoOverdue(onTheWay('2020-01-01', status), TODAY)).toBe(true);
    }
  });

  it('the list row, detail meta and Next step all say Overdue for a past date', () => {
    const late = po('po-201', { status: 'ordered', supplier_name: 'Harbour Supply Co', expected_delivery_date: '2020-10-12' });
    renderAt(`/?po=${late.id}`, buildProps([late]));
    expect(within(row(late.id)).getByTestId('po-row-status')).toHaveTextContent('On the way · Overdue 12 Oct');
    expect(within(detail(late.id)).getByText('Overdue · 12 Oct 2020')).toBeInTheDocument();
    expect(within(detail(late.id)).getByText('On the way · Overdue · 12 Oct 2020')).toBeInTheDocument();
  });

  it('a future date keeps Due, and a missing date shows no date', () => {
    const future = po('po-202', { status: 'ordered', expected_delivery_date: '2099-03-04' });
    const undated = po('po-203', { status: 'ordered', expected_delivery_date: null });
    expect(resolvePoRowLabels(future as any, ME)).toMatchObject({ status: 'On the way', overdue: false });
    expect(resolvePoRowLabels(undated as any, ME)).toMatchObject({ status: 'On the way', overdue: false });
    expect(resolvePoLifecycleSteps(future as any)[1].when).toBe('Due 4 Mar');
    expect(resolvePoLifecycleSteps(undated as any)[1].when).toBe('Sent');
    // A date-only value is never shifted to the previous day by UTC parsing.
    expect(resolvePoLifecycleSteps(po('x', { status: 'ordered', expected_delivery_date: '2099-01-01' }) as any)[1].when).toBe('Due 1 Jan');
  });
});

describe('WS-UX-01 S4 polish — line rows and Receiving status', () => {
  it('product lines are informational: no hover styling', async () => {
    const props = buildProps(ALL, {
      onFetchLineItems: jest.fn().mockResolvedValue([{ id: 'li-1', product_title: 'Ridge 158', sku: 'R-158', quantity_ordered: 4, quantity_received: 0 }]),
    });
    renderAt('/', props);
    const cell = await within(detail(ARRIVED.id)).findByText('Ridge 158');
    expect(cell.closest('tr')).not.toHaveClass('MuiTableRow-hover');
  });

  it('an active started Receive uses one Receiving pill whatever the PO lifecycle status', () => {
    const arrivedStarted = po('po-301', { status: 'shipped', receive_job_id: 'j1', receive_status: 'in_progress', receive_assigned_operator_id: SAM });
    const partialStarted = po('po-302', { status: 'partially_received', receive_job_id: 'j2', receive_status: 'in_progress', receive_assigned_operator_id: SAM });
    const { unmount } = renderAt(`/?po=${arrivedStarted.id}`, buildProps([arrivedStarted, partialStarted]));
    const first = within(detail(arrivedStarted.id)).getByText('Receiving').closest('.MuiChip-root')!;
    fireEvent.click(row(partialStarted.id));
    const second = within(detail(partialStarted.id)).getByText('Receiving').closest('.MuiChip-root')!;
    expect(first.className).toBe(second.className);
    expect(first).not.toHaveClass('MuiChip-colorSuccess');
    expect(second).not.toHaveClass('MuiChip-colorWarning');
    unmount();
  });

  it('a partially received PO without a started job is not shown as Receiving or Received', () => {
    renderAt(`/?po=${PARTIAL.id}`, buildProps(ALL));
    expect(within(detail(PARTIAL.id)).getByText('Partially received')).toBeInTheDocument();
    expect(within(detail(PARTIAL.id)).queryByText(/^Received$/)).toBeNull();
  });
});

describe('WS-UX-01 S4 polish-007 — Draft → On the way → Arrived indicator', () => {
  const states = (status: string, extra: Record<string, unknown> = {}) =>
    resolvePoLifecycleSteps(po('x', { status, created_at: '2026-10-18T10:00:00.000Z', ...extra }) as any).map((s) => s.state);

  it("polish-008: the PO's own stage is current; only Received completes Arrived", () => {
    expect(states('draft')).toEqual(['current', 'upcoming', 'upcoming']);
    for (const s of ['ordered', 'confirmed', 'in_production']) expect(states(s)).toEqual(['done', 'current', 'upcoming']);
    for (const s of ['shipped', 'partially_received']) expect(states(s)).toEqual(['done', 'done', 'current']);
    expect(states('shipped', { receive_job_id: 'j', receive_status: 'in_progress' })).toEqual(['done', 'done', 'current']);
    expect(states('received')).toEqual(['done', 'done', 'done']);
    // Overdue annotates On the way and never activates Arrived.
    expect(states('ordered', { expected_delivery_date: '2020-01-01' })).toEqual(['done', 'current', 'upcoming']);
  });

  it('a cancelled PO completes no stage', () => {
    const steps = resolvePoLifecycleSteps(po('x', { status: 'cancelled' }) as any);
    expect(steps.map((s) => s.state)).toEqual(['stopped', 'stopped', 'stopped']);
    expect(steps.some((s) => s.state === 'done')).toBe(false);
  });

  it('uses only stored data: no invented sent or arrival timestamps', () => {
    const otw = resolvePoLifecycleSteps(po('x', { status: 'ordered', created_at: '2026-10-18T10:00:00.000Z', expected_delivery_date: '2099-10-24' }) as any);
    expect(otw.map((s) => s.when)).toEqual(['Created 18 Oct', 'Due 24 Oct', 'Not yet']);
    const late = resolvePoLifecycleSteps(po('x', { status: 'ordered', expected_delivery_date: '2020-10-12' }) as any);
    expect(late.map((s) => s.when).slice(1)).toEqual(['Overdue · 12 Oct', 'Not yet']);
    expect(resolvePoLifecycleSteps(po('x', { status: 'received' }) as any)[2].when).toBe('Received');
    const arrivedNoDate = resolvePoLifecycleSteps(po('x', { status: 'shipped', actual_delivery_date: null }) as any);
    expect(arrivedNoDate[2].when).toBe('Arrived');
    const draft = resolvePoLifecycleSteps(po('x', { status: 'draft', expected_delivery_date: null }) as any);
    expect(draft.map((s) => s.when).slice(1)).toEqual(['Not yet', 'Not yet']);
  });

  it('renders once in the detail, informational only; only the current stage pulses, only done stages are green', () => {
    renderAt(`/?po=${ON_THE_WAY.id}`, buildProps(ALL));
    const steps = within(detail(ON_THE_WAY.id)).getByTestId('po-lifecycle');
    expect(within(steps).queryAllByRole('button')).toHaveLength(0);
    expect(steps.querySelectorAll('a, input, [tabindex]')).toHaveLength(0);
    const current = steps.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('On the way');
    expect(steps.querySelectorAll('[data-pulse="true"]')).toHaveLength(1);
    expect(current[0].querySelector('[data-pulse="true"]')).not.toBeNull();
    expect([...steps.querySelectorAll('li[data-step-state]')].map((li) => li.getAttribute('data-step-state'))).toEqual(['done', 'current', 'upcoming']);
    expect(steps.querySelectorAll('li[data-step-state="done"] svg')).toHaveLength(1);
  });
});

describe('WS-UX-01 S4 polish-008/009 — list filters, sort and Open/Closed', () => {
  const filters = (o: Record<string, unknown> = {}) => ({ search: '', status: 'all', assignment: 'any', ...o }) as any;
  const OTHER = po('po-110', { status: 'shipped', supplier_name: 'Other Supply', receive_job_id: 'job-o', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' });
  const RUNNING = po('po-111', { status: 'partially_received', supplier_name: 'Running Supply', receive_job_id: 'job-r', receive_status: 'in_progress', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' });
  const CANCELLED = po('po-112', { status: 'cancelled', supplier_name: 'Gone Supply' });
  const search = () => screen.getByRole('textbox', { name: /search po or supplier/i });
  const pick = (menu: 'Filters' | 'Sort', option: RegExp | string) => {
    fireEvent.click(menu === 'Filters' ? screen.getByRole('button', { name: /^filters/i }) : screen.getByRole('button', { name: /^sort:/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
    const openMenu = screen.queryByRole('menu'); // Sort closes itself on selection; Filters stays open
    if (openMenu) fireEvent.keyDown(openMenu, { key: 'Escape' });
  };

  it('matches search, status and assignment against the in-memory projection', () => {
    expect(poMatchesFilters(DRAFT as any, filters({ search: 'draft sup' }), ME)).toBe(true);
    expect(poMatchesFilters(DRAFT as any, filters({ search: 'PO-101' }), ME)).toBe(true);
    expect(poMatchesFilters(DRAFT as any, filters({ search: 'nope' }), ME)).toBe(false);
    expect(poMatchesFilters(ON_THE_WAY as any, filters({ status: 'on_the_way' }), ME)).toBe(true);
    expect(poMatchesFilters(PARTIAL as any, filters({ status: 'shipped' }), ME)).toBe(false);
    expect(poMatchesFilters(PARTIAL as any, filters({ status: 'partially_received' }), ME)).toBe(true);
    expect(poMatchesFilters(ARRIVED as any, filters({ assignment: 'unassigned' }), ME)).toBe(true);
    expect(poMatchesFilters(DRAFT as any, filters({ assignment: 'unassigned' }), ME)).toBe(false);
    expect(poMatchesFilters(OWN as any, filters({ assignment: 'mine' }), ME)).toBe(true);
    expect(poMatchesFilters(OTHER as any, filters({ assignment: 'others' }), ME)).toBe(true);
    expect(poMatchesFilters(OTHER as any, filters({ assignment: 'receiving' }), ME)).toBe(false);
    expect(poMatchesFilters(RUNNING as any, filters({ assignment: 'receiving' }), ME)).toBe(true);
    // Intersection: both must hold.
    expect(poMatchesFilters(RUNNING as any, filters({ status: 'shipped', assignment: 'receiving' }), ME)).toBe(false);
    expect(poMatchesFilters(RUNNING as any, filters({ status: 'partially_received', assignment: 'receiving' }), ME)).toBe(true);
  });

  it('sorts stably inside a group; missing dates last; default keeps API order', () => {
    const a = po('a', { supplier_name: 'beta', created_at: '2026-10-01T00:00:00Z', expected_delivery_date: '2099-01-05' });
    const b = po('b', { supplier_name: 'Alpha', created_at: '2026-10-03T00:00:00Z', expected_delivery_date: null });
    const c = po('c', { supplier_name: 'alpha', created_at: 'garbage', expected_delivery_date: '2099-01-02' });
    const ids = (k: string) => sortPurchaseOrders([a, b, c] as any, k as any).map((x) => x.id);
    expect(ids('default')).toEqual(['a', 'b', 'c']);
    expect(ids('newest')).toEqual(['b', 'a', 'c']);
    expect(ids('expected')).toEqual(['c', 'a', 'b']);
    expect(ids('supplier')).toEqual(['b', 'c', 'a']); // case-insensitive tie keeps API order
  });

  it('Sort reorders rows within groups and never moves groups', () => {
    const late = po('po-120', { status: 'shipped', supplier_name: 'Aardvark Co' });
    renderAt('/', buildProps([...ALL, late]));
    pick('Sort', /supplier a–z/i);
    const list = screen.getByTestId('po-list-rows');
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Arrived', 'On the way', 'Drafts']);
    const arrived = within(within(list).getByRole('group', { name: 'Arrived' })).getAllByRole('button').map((b) => b.getAttribute('data-testid'));
    expect(arrived[0]).toBe(`po-row-${late.id}`);
    expect(screen.getByRole('button', { name: /sort: supplier a–z/i })).toBeInTheDocument();
  });

  it('search filters rows, shows filtered vs total counts, and recovers from an empty result', () => {
    renderAt('/', buildProps([...ALL, OTHER]));
    fireEvent.change(search(), { target: { value: 'dock' } });
    expect(screen.getByTestId(`po-row-${ARRIVED.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`po-row-${DRAFT.id}`)).toBeNull();
    expect(screen.getByText('Showing 1 of 6 POs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open (1 of 6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Closed (0 of 1)' })).toBeInTheDocument();
    // The header keeps unfiltered totals.
    expect(screen.getByText('4 arrived · 1 on the way · 1 draft')).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(screen.getByText(/no purchase orders match these filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(screen.getByTestId(`po-row-${DRAFT.id}`)).toBeInTheDocument();
    expect(screen.queryByText(/showing/i)).toBeNull();
  });

  it('Filters menu: status and assignment intersect; the button shows the active count', () => {
    renderAt('/', buildProps([...ALL, OTHER, RUNNING]));
    pick('Filters', 'Assigned to others');
    expect(screen.getByRole('button', { name: 'Filters · 1' })).toBeInTheDocument();
    expect(screen.getByTestId(`po-row-${OTHER.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`po-row-${RUNNING.id}`)).toBeInTheDocument();
    pick('Filters', 'Partially received');
    expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeInTheDocument();
    expect(screen.queryByTestId(`po-row-${OTHER.id}`)).toBeNull();
    expect(screen.getByTestId(`po-row-${RUNNING.id}`)).toBeInTheDocument();
  });

  it('Closed view: received and cancelled groups with counts; direct links open it', () => {
    renderAt(`/?po=${CANCELLED.id}`, buildProps([...ALL, CANCELLED]));
    expect(screen.getByRole('button', { name: 'Closed (2)' })).toHaveAttribute('aria-pressed', 'true');
    expect(isSelected(CANCELLED.id)).toBe(true);
    const list = screen.getByTestId('po-list-rows');
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Received', 'Cancelled']);
    // correct-011: Open is navigation — the closed detail is never shown under
    // Open; the first Open PO is selected, and Closed restores the closed PO.
    fireEvent.click(screen.getByRole('button', { name: 'Open (5)' }));
    expect(detail(CANCELLED.id)).not.toBeVisible();
    expect(params().get('po')).toBe(ARRIVED.id);
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(screen.queryByText(/is selected but hidden here/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Closed (2)' }));
    expect(isSelected(CANCELLED.id)).toBe(true);
    expect(detail(CANCELLED.id)).toBeVisible();
  });

  it('Back/Forward between an open and a closed PO switches the view with the selection', () => {
    renderAt(`/?po=${DRAFT.id}`, buildProps(ALL));
    fireEvent.click(screen.getByRole('button', { name: 'Closed (1)' }));
    expect(params().get('po')).toBe(RECEIVED.id);
    expect(isSelected(RECEIVED.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'history back' }));
    expect(screen.getByRole('button', { name: 'Open (5)' })).toHaveAttribute('aria-pressed', 'true');
    expect(isSelected(DRAFT.id)).toBe(true);
    expect(detail(DRAFT.id)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'history forward' }));
    expect(screen.getByRole('button', { name: 'Closed (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(isSelected(RECEIVED.id)).toBe(true);
    expect(detail(DRAFT.id)).not.toBeVisible();
  });

  it('a filter that hides the selected PO keeps its detail and offers to reveal it', () => {
    renderAt(`/?po=${ARRIVED.id}`, buildProps(ALL));
    fireEvent.change(search(), { target: { value: 'draft' } });
    expect(screen.queryByTestId(`po-row-${ARRIVED.id}`)).toBeNull();
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(screen.getByText('PO-103 is selected but hidden here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show PO-103' }));
    expect(isSelected(ARRIVED.id)).toBe(true);
    expect(search()).toHaveValue('');
  });

  it('filters, sort and Open/Closed keep URL selection, mounted details and an in-flight assignment lock', async () => {
    const create = deferred<{ receive_job_id: string }>();
    const props = buildProps(ALL, { onCreateReceiveJob: jest.fn(() => create.promise) });
    renderAt(`/?po=${ARRIVED.id}&keep=1`, props);

    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /assigning/i })).toBeDisabled();

    pick('Filters', 'Draft');
    pick('Sort', /newest first/i);
    expect(params().get('po')).toBe(ARRIVED.id);
    // correct-011: Closed navigates away; the Open detail stays mounted, hidden.
    fireEvent.click(screen.getByRole('button', { name: /^closed/i }));
    expect(params().get('po')).toBe(RECEIVED.id);
    expect(detail(ARRIVED.id)).not.toBeVisible();
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /assigning/i, hidden: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(within(detail(ARRIVED.id)).getByRole('button', { name: /assigning/i })).toBeDisabled();
    expect(params().get('po')).toBe(ARRIVED.id);
    expect(params().get('keep')).toBe('1');
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
    // No duplicate line-item fetch for the selected PO.
    expect(props.onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id)).toHaveLength(1);
  });

  it('filters, sort and Open/Closed cannot bypass the Start receiving selection hold', async () => {
    const claim = deferred<void>();
    const props = buildProps(ALL, { onClaimReceiveJob: jest.fn(() => claim.promise) });
    renderAt(`/?po=${OWN.id}`, props);
    const start = await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    pick('Sort', /supplier a–z/i);
    fireEvent.change(search(), { target: { value: 'draft' } });
    expect(row(DRAFT.id)).toBeDisabled();
    fireEvent.click(row(DRAFT.id));
    fireEvent.click(screen.getByRole('button', { name: /^closed/i }));
    expect(detail(OWN.id)).toBeVisible();
    expect(params().get('po')).toBe(OWN.id);
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('rows are keyboard-activatable buttons with full identity in a tooltip', async () => {
    renderAt('/', buildProps(ALL));
    const draftRow = row(DRAFT.id);
    expect(draftRow.tagName).toBe('BUTTON');
    // correct-011: the app's MUI Tooltip replaces the native title.
    expect(draftRow).not.toHaveAttribute('title');
    fireEvent.mouseOver(draftRow);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Draft Supply · PO-101 · Draft · Receive not started');
    draftRow.focus();
    expect(draftRow).toHaveFocus();
    fireEvent.click(draftRow); // Enter/Space on a native button dispatch click
    expect(isSelected(DRAFT.id)).toBe(true);
  });
});

describe('WS-UX-01 S4 polish-008 — visible Cancel PO', () => {
  it('opens the named confirmation; never cancels on one click', async () => {
    const props = buildProps(ALL);
    renderAt(`/?po=${DRAFT.id}`, props);
    fireEvent.click(within(detail(DRAFT.id)).getByRole('button', { name: /^cancel po…$/i }));
    expect(await screen.findByText('Cancel PO-101?')).toBeInTheDocument();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });

  it('is disabled with an explanation once Receive work exists', () => {
    renderAt(`/?po=${OWN.id}`, buildProps(ALL));
    const cancel = within(detail(OWN.id)).getByRole('button', { name: /^cancel po…$/i });
    expect(cancel).toBeDisabled();
    expect(cancel).toHaveAccessibleDescription(/unavailable while this po has receive work/i);
  });

  it('is disabled while a Receive mutation is unresolved', async () => {
    const create = deferred<{ receive_job_id: string }>();
    const props = buildProps(ALL, { onCreateReceiveJob: jest.fn(() => create.promise) });
    renderAt(`/?po=${ARRIVED.id}`, props);
    const cancel = within(detail(ARRIVED.id)).getByRole('button', { name: /^cancel po…$/i });
    expect(cancel).toBeEnabled();
    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S4 correct-011 — Open/Closed is navigation', () => {
  const view = (name: RegExp) => screen.getByRole('button', { name });

  it('Open → Closed → Open restores the last Open PO; Closed restores its own', () => {
    renderAt(`/?po=${PARTIAL.id}`, buildProps(ALL));
    fireEvent.click(view(/^closed/i));
    expect(params().get('po')).toBe(RECEIVED.id);
    expect(detail(RECEIVED.id)).toBeVisible();
    expect(detail(PARTIAL.id)).not.toBeVisible();
    fireEvent.click(view(/^open/i));
    expect(params().get('po')).toBe(PARTIAL.id);
    expect(isSelected(PARTIAL.id)).toBe(true);
    expect(detail(RECEIVED.id)).not.toBeVisible();
  });

  it('the heading and its counts follow the active view', () => {
    renderAt('/', buildProps(ALL));
    expect(screen.getByText('Open POs')).toBeInTheDocument();
    fireEvent.click(view(/^closed/i));
    expect(screen.getByText('Closed POs')).toBeInTheDocument();
    expect(screen.getByText('1 received · 0 cancelled')).toBeInTheDocument();
  });

  it('an empty view shows its empty state, never the other view\'s PO; selection is kept', () => {
    renderAt(`/?po=${ARRIVED.id}`, buildProps([DRAFT, ARRIVED]));
    fireEvent.click(view(/^closed \(0\)/i));
    expect(view(/^closed \(0\)/i)).toHaveAttribute('aria-pressed', 'true');
    expect(detail(ARRIVED.id)).not.toBeVisible();
    expect(screen.getAllByText('No closed purchase orders yet.').length).toBeGreaterThan(0);
    expect(params().get('po')).toBe(ARRIVED.id);
    fireEvent.click(view(/^open/i));
    expect(detail(ARRIVED.id)).toBeVisible();
  });

  it('the view switch is disabled while a Start receiving claim holds the selection', async () => {
    const claim = deferred<void>();
    renderAt(`/?po=${OWN.id}`, buildProps(ALL, { onClaimReceiveJob: jest.fn(() => claim.promise) }));
    const start = await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(view(/^closed/i)).toBeDisabled();
    await act(async () => { claim.resolve(); });
  });
});

describe('WS-UX-01 S4 correct-011 — Next step action group', () => {
  const group = (id: string) => within(detail(id)).getByTestId('po-next-step-actions');
  const labels = (id: string) => within(group(id)).getAllByRole('button').map((b) => b.textContent);

  it('Cancel PO… and the primary sit together in one group, Cancel first', async () => {
    renderAt(`/?po=${DRAFT.id}`, buildProps(ALL));
    expect(labels(DRAFT.id)).toEqual(['Cancel PO…', 'Mark as sent']);
    fireEvent.click(row(ARRIVED.id));
    expect(labels(ARRIVED.id)).toEqual(['Cancel PO…', 'Assign receive']);
  });

  it('supporting messages stay outside the group; disabled Cancel keeps its place', async () => {
    renderAt(`/?po=${OWN.id}`, buildProps(ALL));
    await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    expect(labels(OWN.id)).toEqual(['Cancel PO…', 'Start receiving']);
    expect(within(group(OWN.id)).getByRole('button', { name: /^cancel po…$/i })).toBeDisabled();
    expect(within(group(OWN.id)).queryByText(/assigned to you/i)).toBeNull();
    expect(within(group(OWN.id)).queryByText(/cancel is unavailable/i)).toBeNull();
  });
});

describe('WS-UX-01 S4 correct-011 — conditional product-line inspection', () => {
  const line = (n: number, o: Record<string, unknown> = {}) => ({
    id: `line-${n}`, lasyncro_variant_id: null, description: `Desc ${n}`, quantity_ordered: n, quantity_received: 0,
    unit_cost_cents: null, sku: `SKU-${String(n).padStart(2, '0')}`, image_url: null, product_title: `Product ${String.fromCharCode(64 + n)}`, ...o,
  });
  const lines = (count: number) => Array.from({ length: count }, (_, i) => line(i + 1));
  const productNames = () => screen.getAllByText(/^Product [A-Z]$/).map((el) => el.textContent);

  it('inspectLineItems: search name/SKU, outstanding vs fully received, stable sorts', () => {
    const items = [line(1, { quantity_received: 1 }), line(2), line(3, { quantity_received: 3, product_title: null, description: 'alpha' })] as any;
    expect(inspectLineItems(items, { search: 'sku-02', filter: 'all', sort: 'default' }).map((i) => i.id)).toEqual(['line-2']);
    expect(inspectLineItems(items, { search: 'ALPHA', filter: 'all', sort: 'default' }).map((i) => i.id)).toEqual(['line-3']);
    expect(inspectLineItems(items, { search: '', filter: 'outstanding', sort: 'default' }).map((i) => i.id)).toEqual(['line-2']);
    expect(inspectLineItems(items, { search: '', filter: 'received', sort: 'default' }).map((i) => i.id)).toEqual(['line-1', 'line-3']);
    expect(inspectLineItems(items, { search: '', filter: 'all', sort: 'ordered' }).map((i) => i.id)).toEqual(['line-3', 'line-2', 'line-1']);
    expect(inspectLineItems(items, { search: '', filter: 'all', sort: 'received' }).map((i) => i.id)).toEqual(['line-3', 'line-1', 'line-2']);
    expect(inspectLineItems(items, { search: '', filter: 'all', sort: 'product' }).map((i) => i.id)).toEqual(['line-3', 'line-1', 'line-2']);
  });

  it.each([1, 5])('a %i-line PO keeps the plain list with no inspection toolbar', async (count) => {
    renderAt(`/?po=${ARRIVED.id}`, buildProps(ALL, { onFetchLineItems: jest.fn().mockResolvedValue(lines(count)) }));
    await within(detail(ARRIVED.id)).findByText('Product A');
    expect(screen.queryByRole('textbox', { name: /search product or sku/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^sort lines/i })).toBeNull();
  });

  it('a 15-line PO searches, filters and sorts in memory without refetching or moving selection', async () => {
    const fifteen = lines(15).map((l, i) => ({ ...l, quantity_received: i < 4 ? l.quantity_ordered : 0 }));
    const props = buildProps(ALL, { onFetchLineItems: jest.fn().mockResolvedValue(fifteen) });
    renderAt(`/?po=${PARTIAL.id}`, props);
    const box = await within(detail(PARTIAL.id)).findByRole('search', { name: /filter product lines/i });
    expect(productNames()).toHaveLength(15);

    fireEvent.change(within(box).getByRole('textbox', { name: /search product or sku/i }), { target: { value: 'sku-1' } });
    expect(productNames()).toEqual(['Product J', 'Product K', 'Product L', 'Product M', 'Product N', 'Product O']);
    expect(within(box).getByRole('status')).toHaveTextContent('6 of 15 lines');

    fireEvent.change(within(box).getByRole('textbox', { name: /search product or sku/i }), { target: { value: '' } });
    fireEvent.click(within(box).getByRole('button', { name: /^show:/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Fully received' }));
    expect(productNames()).toEqual(['Product A', 'Product B', 'Product C', 'Product D']);

    fireEvent.click(within(box).getByRole('button', { name: /^sort lines/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ordered quantity' }));
    expect(productNames()).toEqual(['Product D', 'Product C', 'Product B', 'Product A']);

    fireEvent.change(within(box).getByRole('textbox', { name: /search product or sku/i }), { target: { value: 'zzz' } });
    expect(within(detail(PARTIAL.id)).getByText(/no product lines match/i)).toBeInTheDocument();
    fireEvent.click(within(detail(PARTIAL.id)).getByRole('button', { name: 'Show all lines' }));
    expect(productNames()).toHaveLength(15);

    expect(props.onFetchLineItems).toHaveBeenCalledTimes(1);
    expect(params().get('po')).toBe(PARTIAL.id);
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });
});
