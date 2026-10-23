// WS-UX-01 S5-B — responsive Purchasing (contract WS-UX-01-S5-RESPONSIVE-v1.1).
//
//   Measured workspace >= 880px — the certified S4 layout and URL behaviour
//                                  (SuppliersPortalModuleFT2.split-view-wsux01-s4
//                                  stays the authority).
//   Measured workspace <  880px — one pane: no ?po shows the list (?view=
//                                  open|closed), a valid ?po or a D5 deep link
//                                  shows the detail. Selecting and "Back to POs"
//                                  push history; normalization replaces.
//                                  Hidden details stay mounted; a Start receiving
//                                  claim holds the detail; mutations stay
//                                  exactly-once. Narrow actions stack: primary
//                                  first, then Cancel PO….
//
// Fixtures and helpers mirror the S4 split-view suite. The workspace width is
// driven through a controllable ResizeObserver + getBoundingClientRect.
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

// ─── controllable workspace width ────────────────────────────────────────────
let workspaceWidth = 390;
const observers = new Set<() => void>();
const realRect = HTMLElement.prototype.getBoundingClientRect;
const RealResizeObserver = global.ResizeObserver;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this.dataset?.testid === 'purchasing-workspace') {
      return { width: workspaceWidth, height: 800, top: 0, left: 0, right: workspaceWidth, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return realRect.call(this);
  };
  (global as any).ResizeObserver = class {
    private cb: () => void;
    constructor(cb: () => void) { this.cb = () => cb(); }
    observe() { observers.add(this.cb); }
    unobserve() { observers.delete(this.cb); }
    disconnect() { observers.delete(this.cb); }
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  (global as any).ResizeObserver = RealResizeObserver;
});
function setWorkspace(width: number) {
  workspaceWidth = width;
  act(() => { observers.forEach((cb) => cb()); });
}

beforeEach(() => {
  location = { pathname: '/', search: '' };
  workspaceWidth = 390;
  observers.clear();
});

const workspace = () => screen.getByTestId('purchasing-workspace');
// The list pane may carry the hidden attribute, so select it structurally.
const list = () => {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Purchase orders"]');
  if (!nav) throw new Error('Purchase orders list not rendered');
  return nav;
};
const back = () => screen.getByRole('button', { name: /back to pos/i });
const viewBtn = (re: RegExp) => within(screen.getByRole('group', { name: 'Open or closed purchase orders' })).getByRole('button', { name: re });
const historyBack = () => fireEvent.click(screen.getByRole('button', { name: 'history back' }));
const historyForward = () => fireEvent.click(screen.getByRole('button', { name: 'history forward' }));

describe('S5-B (1) — narrow pane selection and URL', () => {
  it('no ?po shows only the list: no detail mounted, no line-item request, no Back', () => {
    const props = buildProps(ALL);
    renderAt('/', props);
    expect(workspace()).toHaveAttribute('data-layout', 'narrow');
    expect(workspace()).toHaveAttribute('data-pane', 'list');
    expect(list()).toBeVisible();
    expect(screen.queryByTestId(/^po-detail-/)).toBeNull();
    expect(props.onFetchLineItems).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /back to pos/i })).toBeNull();
    expect(row(ARRIVED.id)).not.toHaveAttribute('aria-current', 'true');
  });

  it('selecting a PO pushes ?po (dropping view), shows only its detail and focuses Back to POs', async () => {
    renderAt('/?view=open&ref=keep', buildProps(ALL));
    fireEvent.click(row(DRAFT.id));
    expect(params().get('po')).toBe(DRAFT.id);
    expect(params().get('view')).toBeNull();
    expect(params().get('ref')).toBe('keep');
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
    expect(list()).not.toBeVisible();
    expect(detail(DRAFT.id)).toBeVisible();
    await waitFor(() => expect(back()).toHaveFocus());

    historyBack();
    expect(params().get('po')).toBeNull();
    expect(workspace()).toHaveAttribute('data-pane', 'list');
    historyForward();
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
  });

  it('Back to POs pushes a list entry with the PO view, keeping unrelated params', () => {
    renderAt(`/?po=${ON_THE_WAY.id}&ref=keep`, buildProps(ALL));
    fireEvent.click(back());
    expect(location.search).toBe('?ref=keep&view=open');
    expect(workspace()).toHaveAttribute('data-pane', 'list');
    // A pushed entry, not history.go(-1): Back returns to the detail.
    historyBack();
    expect(params().get('po')).toBe(ON_THE_WAY.id);
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
  });

  it('refresh: a valid ?po opens the detail; an unknown ?po is dropped (replace) and shows the list', async () => {
    renderAt(`/?po=${ARRIVED.id}`, buildProps(ALL));
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(list()).not.toBeVisible();
  });

  it('an unknown ?po normalizes to the list', async () => {
    renderAt('/?po=po-gone', buildProps(ALL));
    await waitFor(() => expect(params().get('po')).toBeNull());
    expect(workspace()).toHaveAttribute('data-pane', 'list');
  });
});

describe('S5-B (2) — Open/Closed list history', () => {
  it('switching views stays in the list, pushes ?view and survives Back/Forward', () => {
    renderAt('/', buildProps(ALL));
    fireEvent.click(viewBtn(/^closed/i));
    expect(params().get('view')).toBe('closed');
    expect(workspace()).toHaveAttribute('data-pane', 'list');
    expect(row(RECEIVED.id)).toBeVisible();
    expect(screen.queryByTestId(`po-row-${DRAFT.id}`)).toBeNull();

    historyBack();
    expect(params().get('view')).toBeNull();
    expect(row(DRAFT.id)).toBeVisible();
    historyForward();
    expect(row(RECEIVED.id)).toBeVisible();
  });

  it('a refreshed ?view=closed list opens Closed; returning from a closed PO restores Closed', () => {
    renderAt('/?view=closed', buildProps(ALL));
    expect(viewBtn(/^closed/i)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(row(RECEIVED.id));
    expect(params().get('view')).toBeNull();
    fireEvent.click(back());
    expect(params().get('view')).toBe('closed');
    expect(viewBtn(/^closed/i)).toHaveAttribute('aria-pressed', 'true');
  });

  it('search survives opening a PO and returning to the list', () => {
    renderAt('/', buildProps(ALL));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search PO or supplier' }), { target: { value: 'Dock' } });
    fireEvent.click(row(ARRIVED.id));
    fireEvent.click(back());
    expect(screen.getByRole('textbox', { name: 'Search PO or supplier' })).toHaveValue('Dock');
    expect(screen.queryByTestId(`po-row-${DRAFT.id}`)).toBeNull();
  });
});

describe('S5-B (3) — D5 deep links on a narrow workspace', () => {
  it('own pending: opens the detail with the brief, normalizes to ?po=X, never claims', async () => {
    const props = buildProps(ALL);
    renderAt(`/?action=receive&poId=${OWN.id}`, props);
    expect(await within(detail(OWN.id)).findByTestId('receive-inline-brief')).toBeVisible();
    await waitFor(() => expect(location.search).toBe(`?po=${OWN.id}`));
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
    expect(props.onClaimReceiveJob).not.toHaveBeenCalled();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });
});

describe('S5-B (4) — claim hold and exactly-once mutations', () => {
  it('a Start receiving claim blocks Back to POs and browser history cannot leave the held detail', async () => {
    const claim = deferred<void>();
    const props = buildProps(ALL, {
      onClaimReceiveJob: jest.fn(() => claim.promise),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue(ALL),
    });
    renderAt('/', props);
    fireEvent.click(row(OWN.id));
    const start = await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(back()).toBeDisabled();
    expect(screen.getByText(/available once start receiving finishes/i)).toBeInTheDocument();
    historyBack();
    // URL moved, but the held PO stays the only visible pane.
    expect(params().get('po')).toBeNull();
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
    expect(detail(OWN.id)).toBeVisible();
    expect(within(detail(OWN.id)).queryByRole('button', { name: /^start receiving$/i })).toBeNull();
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      claim.reject(Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403, data: { error: 'Forbidden' } } }));
    });
    // The hold is released; the display follows the URL again.
    await waitFor(() => expect(workspace()).toHaveAttribute('data-pane', 'list'));
    expect(props.onClaimReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('an in-flight assignment survives Back to POs and returning; exactly one create', async () => {
    const create = deferred<{ receive_job_id: string }>();
    const assigned = { ...ARRIVED, receive_job_id: 'job-new', receive_status: 'pending', receive_assigned_operator_id: SAM, receive_assigned_operator_name: 'Sam Rivera' };
    const props = buildProps(ALL, {
      onCreateReceiveJob: jest.fn(() => create.promise),
      onReconcilePurchaseOrders: jest.fn().mockResolvedValue([assigned]),
    });
    renderAt(`/?po=${ARRIVED.id}`, props);
    fireEvent.click(within(detail(ARRIVED.id)).getByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sam rivera/i }));

    fireEvent.click(back());
    expect(detail(ARRIVED.id)).not.toBeVisible();
    await act(async () => { create.resolve({ receive_job_id: 'job-new' }); });

    fireEvent.click(row(ARRIVED.id));
    expect(await within(detail(ARRIVED.id)).findByText(/receive assigned to sam rivera/i)).toBeInTheDocument();
    expect(props.onCreateReceiveJob).toHaveBeenCalledTimes(1);
  });

  it('line items load once per PO across pane switches', async () => {
    const props = buildProps(ALL);
    renderAt('/', props);
    fireEvent.click(row(ARRIVED.id));
    await waitFor(() => expect(props.onFetchLineItems).toHaveBeenCalledWith(ARRIVED.id));
    fireEvent.click(back());
    fireEvent.click(row(DRAFT.id));
    await waitFor(() => expect(props.onFetchLineItems).toHaveBeenCalledWith(DRAFT.id));
    fireEvent.click(back());
    fireEvent.click(row(ARRIVED.id));
    expect(props.onFetchLineItems.mock.calls.filter(([id]: [string]) => id === ARRIVED.id)).toHaveLength(1);
    expect(props.onFetchLineItems).not.toHaveBeenCalledWith(ON_THE_WAY.id);
  });

  it('Cancel PO keeps its eligibility and named confirmation', async () => {
    const props = buildProps(ALL);
    renderAt(`/?po=${OWN.id}`, props);
    await within(detail(OWN.id)).findByRole('button', { name: /^start receiving$/i });
    expect(within(detail(OWN.id)).getByRole('button', { name: /^cancel po…$/i })).toBeDisabled();
    fireEvent.click(row(DRAFT.id));
    fireEvent.click(within(detail(DRAFT.id)).getByRole('button', { name: /^cancel po…$/i }));
    expect(await screen.findByText(`Cancel PO-101?`)).toBeInTheDocument();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });
});

describe('S5-B (5) — responsive actions and layout switching', () => {
  const actionLabels = (id: string) => within(within(detail(id)).getByTestId('po-next-step-actions')).getAllByRole('button').map((b) => b.textContent);

  it('narrow: the primary comes first, then Cancel PO… (DOM and focus order)', () => {
    renderAt(`/?po=${DRAFT.id}`, buildProps(ALL));
    expect(actionLabels(DRAFT.id)).toEqual(['Mark as sent', 'Cancel PO…']);
    fireEvent.click(back());
    fireEvent.click(row(ARRIVED.id));
    expect(actionLabels(ARRIVED.id)).toEqual(['Assign receive', 'Cancel PO…']);
  });

  it('wide (>= 880px): the S4 split view, default selection and Cancel-first order are unchanged; ?view is ignored', () => {
    workspaceWidth = 1200;
    renderAt('/?view=closed', buildProps(ALL));
    expect(workspace()).toHaveAttribute('data-layout', 'wide');
    expect(isSelected(ARRIVED.id)).toBe(true);
    expect(list()).toBeVisible();
    expect(detail(ARRIVED.id)).toBeVisible();
    expect(screen.queryByRole('button', { name: /back to pos/i })).toBeNull();
    expect(actionLabels(ARRIVED.id)).toEqual(['Cancel PO…', 'Assign receive']);
  });

  it('resizing across 880px keeps the selection and mounted state', async () => {
    workspaceWidth = 1200;
    const props = buildProps(ALL);
    renderAt(`/?po=${DRAFT.id}`, props);
    expect(list()).toBeVisible();
    setWorkspace(600);
    expect(workspace()).toHaveAttribute('data-pane', 'detail');
    expect(detail(DRAFT.id)).toBeVisible();
    expect(list()).not.toBeVisible();
    setWorkspace(1200);
    expect(list()).toBeVisible();
    expect(isSelected(DRAFT.id)).toBe(true);
    await waitFor(() => expect(props.onFetchLineItems).toHaveBeenCalledWith(DRAFT.id));
    expect(props.onFetchLineItems.mock.calls.filter(([id]: [string]) => id === DRAFT.id)).toHaveLength(1);
  });

  it('exactly 880px is wide; 879px is narrow', () => {
    workspaceWidth = 880;
    renderAt('/', buildProps(ALL));
    expect(workspace()).toHaveAttribute('data-layout', 'wide');
    setWorkspace(879);
    expect(workspace()).toHaveAttribute('data-layout', 'narrow');
  });
});
