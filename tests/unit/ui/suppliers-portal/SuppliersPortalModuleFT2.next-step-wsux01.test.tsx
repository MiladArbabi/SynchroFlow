// WS-UX-01 S1 — simplified PO actions and status UI.
//
// Contract:
//   1. Each open PO exposes one contextual next step derived from its
//      canonical stored status: draft → Mark as sent (draft → ordered),
//      ordered/confirmed/in_production → Mark as arrived (→ shipped).
//   2. "Prepare to send" and Copy for supplier are removed; Mark as sent is
//      the only Draft step and never happens automatically.
//   3. Receive-eligible POs keep the GH-1245 resolveReceiveAction() decision.
//      S1 adds no new Receive affordance (no claim). WS-UX-01 S2 later owns
//      "Receive myself" and the assignment popover (assignment-wsux01-s2 suite).
//   4. Cancel PO sits under More, requires a confirmation naming the PO, is
//      not actionable while any Receive job is known, and a backend rejection
//      is surfaced without retry.
//   5. Before Receive counting starts, received quantities render as "—".
//
// Assignment/reassignment/resume behaviour stays protected by
// ReceiveDispatchAssignment, receive-reassign-1143 and receive-resume-gh1245.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import SuppliersPortalModuleFT2, {
  canCancelPo,
  isReceiveCountingStarted,
  resolvePoNextAction,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

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
    status: 'draft',
    expected_delivery_date: null,
    actual_delivery_date: null,
    line_items_count: 1,
    total_units_ordered: 5,
    total_units_received: 0,
    notes: null,
    document_url: null,
    created_at: '2026-10-01T00:00:00.000Z',
    first_line_description: null,
    receive_job_id: null,
    receive_status: null,
    receive_assigned_operator_id: null,
    receive_assigned_operator_name: null,
    ...overrides,
  } as any;
}

const LINE_ITEM = {
  id: 'li-1',
  lasyncro_variant_id: 'v-1',
  description: 'Wool Throw',
  quantity_ordered: 5,
  quantity_received: 0,
  unit_cost_cents: null,
  sku: 'WT-01',
  image_url: null,
  product_title: 'Wool Throw',
};

function buildProps(
  po: ReturnType<typeof basePo>,
  overrides: Record<string, unknown> = {}
) {
  return {
    view: 'pos',
    data: { purchase_orders: [po], suppliers: [], never_ordered: [], never_ordered_count: 0 },
    isLoading: false,
    isError: false,
    onRefresh: jest.fn(),
    onFetchLineItems: jest.fn().mockResolvedValue([LINE_ITEM]),
    onUpdatePoStatus: jest.fn().mockResolvedValue(undefined),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'receive-new' }),
    onReassignReceiveJob: jest.fn().mockResolvedValue(undefined),
    teamAssignableOperators: [{ id: CURRENT_USER_ID, name: 'Me (Owner)', role: 'owner' }],
    currentUserId: CURRENT_USER_ID,
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

async function renderExpanded(
  po: ReturnType<typeof basePo>,
  overrides: Record<string, unknown> = {}
) {
  const props = buildProps(po, overrides);
  render(
    <MemoryRouter initialEntries={['/']}>
      <SuppliersPortalModuleFT2 {...props} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByText(po.supplier_name));
  await screen.findByText('WT-01');
  return props;
}

function openCancelFromMore() {
  fireEvent.click(screen.getByRole('button', { name: /more actions for po-1005/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /cancel po/i }));
}

beforeEach(() => {
  mockNavigate.mockReset();
});

describe('WS-UX-01 S1 — resolvePoNextAction (canonical statuses only)', () => {
  it.each([
    ['draft', 'mark_sent'],
    ['ordered', 'mark_arrived'],
    ['confirmed', 'mark_arrived'],
    ['in_production', 'mark_arrived'],
    ['shipped', 'receive'],
    ['partially_received', 'receive'],
    ['received', 'none'],
    ['cancelled', 'none'],
  ])('%s → %s', (status, kind) => {
    expect(resolvePoNextAction(basePo({ status }), CURRENT_USER_ID).kind).toBe(kind);
  });

  it('Receive-eligible POs keep the existing GH-1245 Receive decision', () => {
    const cases: [Record<string, unknown>, number | null, string][] = [
      [{}, CURRENT_USER_ID, 'assign'],
      [{ receive_job_id: 'j', receive_status: 'pending', receive_assigned_operator_id: CURRENT_USER_ID }, CURRENT_USER_ID, 'open_own'],
      [{ receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: CURRENT_USER_ID }, CURRENT_USER_ID, 'resume_own'],
      [{ receive_job_id: 'j', receive_status: 'pending', receive_assigned_operator_id: OTHER_OPERATOR_ID }, CURRENT_USER_ID, 'reassign'],
      [{ receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: OTHER_OPERATOR_ID }, CURRENT_USER_ID, 'none'],
      // Fail closed on inconsistent projections.
      [{ receive_job_id: null, receive_status: 'pending' }, CURRENT_USER_ID, 'none'],
      [{ receive_job_id: 'j', receive_status: null }, CURRENT_USER_ID, 'none'],
    ];
    for (const [overrides, userId, receiveAction] of cases) {
      expect(resolvePoNextAction(basePo({ status: 'shipped', ...overrides }), userId)).toEqual({
        kind: 'receive',
        receiveAction,
      });
    }
  });
});

describe('WS-UX-01 S1 — Draft: Mark as sent only', () => {
  it('offers Mark as sent as the primary action and no Prepare to send', async () => {
    const props = await renderExpanded(basePo());

    expect(screen.getByRole('button', { name: 'Mark as sent' })).toBeInTheDocument();
    expect(screen.queryByText(/prepare to send/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(props.onUpdatePoStatus).toHaveBeenCalledTimes(1));
    expect(props.onUpdatePoStatus).toHaveBeenCalledWith('po-uuid-1005', 'ordered', undefined);
  });

  it('Copy for supplier and its send guidance are removed, not hidden', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const props = await renderExpanded(basePo(), {
      spotlights: {
        neverOrdered: { isDismissed: true, dismiss: jest.fn() },
        alertTriggered: { isDismissed: true, dismiss: jest.fn() },
        accumulator: { isDismissed: true, dismiss: jest.fn() },
        poSendFlow: { isDismissed: false, dismiss: jest.fn() },
      },
    });

    expect(screen.queryByRole('button', { name: /copy for supplier/i })).toBeNull();
    expect(screen.queryByText(/copy for supplier/i)).toBeNull();
    expect(screen.queryByText(/ready to order\? send it to your supplier/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });
});

describe('WS-UX-01 S1 — sentence-case actions under the app theme', () => {
  // The app theme sets typography.button.textTransform = 'capitalize'.
  it('S1 actions override the theme capitalize transform', async () => {
    const theme = createTheme({ typography: { button: { textTransform: 'capitalize' } } });
    const props = buildProps(basePo());
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/']}>
          <SuppliersPortalModuleFT2 {...props} />
        </MemoryRouter>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByText('Nordic Textile Works'));
    await screen.findByText('WT-01');

    expect(screen.getByRole('button', { name: 'Mark as sent' })).toHaveStyle({ textTransform: 'none' });
  });
});

describe('WS-UX-01 S1 — On the way: Mark as arrived', () => {
  it.each(['ordered', 'confirmed', 'in_production'])(
    '%s PO invokes the canonical shipped transition',
    async (status) => {
      const props = await renderExpanded(basePo({ status }));
      expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Mark as arrived' }));
      await waitFor(() => expect(props.onUpdatePoStatus).toHaveBeenCalledTimes(1));
      expect(props.onUpdatePoStatus).toHaveBeenCalledWith('po-uuid-1005', 'shipped', undefined);
    }
  );
});

describe('WS-UX-01 S1 — Arrived: existing Receive dispatch unchanged', () => {
  it.each([
    ['only the current user is eligible', [{ id: CURRENT_USER_ID, name: 'Me (Owner)', role: 'owner' }], CURRENT_USER_ID],
    ['operator list empty (unresolved or failed query)', [], CURRENT_USER_ID],
    ['current user unresolved', [], null],
  ])('%s → no new privileged action, no automatic dispatch', async (_label, operators, userId) => {
    const props = await renderExpanded(basePo({ status: 'shipped' }), {
      teamAssignableOperators: operators,
      currentUserId: userId,
    });

    expect(screen.queryByText(/receive myself/i)).toBeNull();
    expect(screen.queryByText(/start receiving/i)).toBeNull();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(props.onReassignReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('team assignment opens the S2 picker without creating work', async () => {
    const props = await renderExpanded(basePo({ status: 'shipped' }), {
      canManageReceiveAssignment: true,
      receiveAssigneesStatus: 'ready',
      teamAssignableOperators: [
        { id: CURRENT_USER_ID, name: 'Me (Owner)', role: 'owner' },
        { id: OTHER_OPERATOR_ID, name: 'Sam Rivera', role: 'operator' },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /assign receive/i }));
    expect(await screen.findByRole('list', { name: /assign receive to/i })).toBeInTheDocument();
    expect(props.onCreateReceiveJob).not.toHaveBeenCalled();
  });

  it('own in-progress job still resumes that exact job', async () => {
    await renderExpanded(
      basePo({
        status: 'shipped',
        receive_job_id: 'receive-job-1005',
        receive_status: 'in_progress',
        receive_assigned_operator_id: CURRENT_USER_ID,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /resume receive/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/wms?receiveJobId=receive-job-1005');
  });

  it("another operator's pending job still offers explicit Reassign", async () => {
    await renderExpanded(
      basePo({
        status: 'shipped',
        receive_job_id: 'receive-job-1005',
        receive_status: 'pending',
        receive_assigned_operator_id: OTHER_OPERATOR_ID,
        receive_assigned_operator_name: 'Sam Rivera',
      }),
      { canManageReceiveAssignment: true, receiveAssigneesStatus: 'ready' }
    );

    expect(screen.getByRole('button', { name: /^reassign$/i })).toBeInTheDocument();
  });
});

describe('WS-UX-01 S1 — Cancel PO under More, with confirmation', () => {
  it('is not a direct action-rail button', async () => {
    await renderExpanded(basePo());

    expect(screen.queryByRole('button', { name: /cancel po/i })).toBeNull();
    expect(screen.getByRole('button', { name: /more actions for po-1005/i })).toBeInTheDocument();
  });

  it('requires a confirmation naming the PO; Keep PO changes nothing', async () => {
    const props = await renderExpanded(basePo());

    openCancelFromMore();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel PO-1005?')).toBeInTheDocument();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep PO' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();

    openCancelFromMore();
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel PO' }));
    await waitFor(() => expect(props.onUpdatePoStatus).toHaveBeenCalledTimes(1));
    expect(props.onUpdatePoStatus).toHaveBeenCalledWith('po-uuid-1005', 'cancelled');
  });

  it.each([
    ['pending job', { receive_job_id: 'j', receive_status: 'pending', receive_assigned_operator_id: OTHER_OPERATOR_ID }],
    ['in-progress job', { receive_job_id: 'j', receive_status: 'in_progress', receive_assigned_operator_id: CURRENT_USER_ID }],
  ])('known %s → Cancel is not actionable', async (_label, job) => {
    const props = await renderExpanded(basePo({ status: 'shipped', ...job }));

    fireEvent.click(screen.getByRole('button', { name: /more actions for po-1005/i }));
    const item = screen.getByRole('menuitem', { name: /cancel po/i });
    expect(item).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(item);
    expect(screen.queryByText('Cancel PO-1005?')).toBeNull();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });

  it('canCancelPo fails closed on any Receive job reference', () => {
    expect(canCancelPo(basePo())).toBe(true);
    expect(canCancelPo(basePo({ status: 'shipped' }))).toBe(true);
    expect(canCancelPo(basePo({ receive_job_id: 'j' }))).toBe(false);
    expect(canCancelPo(basePo({ receive_status: 'pending' }))).toBe(false);
    expect(canCancelPo(basePo({ receive_assigned_operator_id: OTHER_OPERATOR_ID }))).toBe(false);
    expect(canCancelPo(basePo({ status: 'received' }))).toBe(false);
    expect(canCancelPo(basePo({ status: 'cancelled' }))).toBe(false);
  });

  it('Cancel is unavailable once counting has started, regardless of job projection', () => {
    const noJob = { receive_job_id: null, receive_status: null, receive_assigned_operator_id: null };
    // partially_received with absent job references, with and without reported units
    expect(canCancelPo(basePo({ status: 'partially_received', ...noJob, total_units_received: 3 }))).toBe(false);
    expect(canCancelPo(basePo({ status: 'partially_received', ...noJob, total_units_received: 0 }))).toBe(false);
    // a positive received quantity blocks Cancel even with an inconsistent status/job projection
    expect(canCancelPo(basePo({ status: 'shipped', ...noJob, total_units_received: 1 }))).toBe(false);
    expect(canCancelPo(basePo({ status: 'draft', ...noJob, total_units_received: 2 }))).toBe(false);
  });

  it('an eligible draft with no Receive work still opens the confirmation', async () => {
    const props = await renderExpanded(basePo());

    openCancelFromMore();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel PO-1005?')).toBeInTheDocument();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['partially_received, null job fields, received > 0', { status: 'partially_received', total_units_received: 3 }],
    ['partially_received, null job fields, zero units', { status: 'partially_received', total_units_received: 0 }],
    ['shipped with stale projection and received > 0', { status: 'shipped', total_units_received: 1 }],
  ])('%s → disabled Cancel never invokes the status mutation', async (_label, state) => {
    const props = await renderExpanded(basePo(state));

    fireEvent.click(screen.getByRole('button', { name: /more actions for po-1005/i }));
    const item = screen.getByRole('menuitem', { name: /cancel po/i });
    expect(item).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(item);
    expect(screen.queryByText('Cancel PO-1005?')).toBeNull();
    expect(props.onUpdatePoStatus).not.toHaveBeenCalled();
  });

  it('a backend rejection is surfaced without retry or bypass', async () => {
    const onUpdatePoStatus = jest.fn().mockRejectedValue(new Error('Request failed with status code 409'));
    await renderExpanded(basePo(), { onUpdatePoStatus });

    openCancelFromMore();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel PO' }));

    expect(await within(dialog).findByText(/couldn't be cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onUpdatePoStatus).toHaveBeenCalledTimes(1);
    expect(onUpdatePoStatus).toHaveBeenCalledWith('po-uuid-1005', 'cancelled');
  });
});

describe('WS-UX-01 S1 — unstarted Receive counts', () => {
  it('renders — before counting starts', async () => {
    await renderExpanded(basePo({ status: 'shipped' }));

    const row = screen.getByText('WT-01').closest('tr') as HTMLElement;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('0')).toBeNull();
  });

  it('keeps a legitimate zero once receiving has started', async () => {
    await renderExpanded(
      basePo({
        status: 'shipped',
        receive_job_id: 'j',
        receive_status: 'in_progress',
        receive_assigned_operator_id: CURRENT_USER_ID,
      })
    );

    const row = screen.getByText('WT-01').closest('tr') as HTMLElement;
    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  it('isReceiveCountingStarted', () => {
    expect(isReceiveCountingStarted(basePo({ status: 'shipped' }))).toBe(false);
    expect(isReceiveCountingStarted(basePo({ status: 'shipped', receive_status: 'pending', receive_job_id: 'j' }))).toBe(false);
    expect(isReceiveCountingStarted(basePo({ status: 'shipped', receive_status: 'in_progress', receive_job_id: 'j' }))).toBe(true);
    expect(isReceiveCountingStarted(basePo({ status: 'partially_received' }))).toBe(true);
    expect(isReceiveCountingStarted(basePo({ status: 'received' }))).toBe(true);
    expect(isReceiveCountingStarted(basePo({ status: 'shipped', total_units_received: '2' }))).toBe(true);
  });
});

describe('WS-UX-01 S1/S2 — module boundary (S3: claim is wired by the app wrapper)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx'),
    'utf8'
  );

  it('makes no direct claim HTTP call and introduces no Unassign', () => {
    expect(src).not.toMatch(/\/claim/);
    expect(src).not.toMatch(/Unassign/);
  });
});
