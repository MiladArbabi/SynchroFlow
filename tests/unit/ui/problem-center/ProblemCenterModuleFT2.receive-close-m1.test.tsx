// tests/unit/ui/problem-center/ProblemCenterModuleFT2.receive-close-m1.test.tsx
//
// SF-PC-V2-I5-M1-CORRECT-006 — no Receive recovery decision before the
// originating Receive job is closed (RISK-REVIEW-001 M1).
// ==========================================================================
// The I2 resolve service refuses every held-unit decision with 409
// `receive_not_closed` until the unit's Receive job is closed. Custody is
// placed while the job is open, so "custody verified, job open" is a normal
// state. Contracts:
//   M1  open job + valid custody: "Awaiting Receive close", an explanation,
//       no Approve recovery / Discard / Write off, nothing submitted.
//   M2  closed job + valid custody: the existing three decisions.
//   M3  missing or unknown job status fails closed (no decision).
//   M4  operators: the same waiting state, never an owner/admin hand-off.
//   M5  open → closed → approved transitions render in order.
//   M6  other eligibility rules still apply after close (custody).
//   M7  the host hook passes the projected job status through; absent → null.
//
// Harness: REAL ProblemCenterModuleFT2 / problemCenterModel / useProblemCenter source.

import React from 'react';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProblemCenterModuleFT2, {
  type ProblemCenterModuleFT2Props,
  type ProblemTask,
} from '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2';
import { receiveUnitActions, taskToItem } from '../../../../modules/problem-center/src/ui/pages/problemCenterModel';

const mockGet = jest.fn();
jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: (...a: unknown[]) => mockGet(...a) } }));

import { useProblemCenter } from 'pages/problem-center/useProblemCenter';

const LSU = 'LSU-M1-0001';
const OPEN_STATUSES = ['pending', 'in_progress', 'inspection', 'barcode_assignment', 'stow_ready'];

const held = (over: Partial<ProblemTask> = {}): ProblemTask => ({
  problem_task_id: 'a1a1a1a1-0000-4000-8000-000000000001',
  lasyncro_variant_id: 'a1a1a1a1-0000-4000-8000-0000000000a1',
  exception_type: 'defect',
  source: 'receive',
  quantity: 1,
  prob_label: null,
  problem_bin_location: 'PROB-M1',
  status: 'open',
  created_at: '2026-11-02T06:00:00.000Z',
  variant_title: 'Default Title',
  sku: 'SKU-M1',
  product_title: 'Held kettle',
  lasyncro_unit_id: LSU,
  unit_status: 'held',
  unit_location_code: 'PROB-M1',
  receive_custody_verified: true,
  receive_job_id: 'b1b1b1b1-0000-4000-8000-000000000001',
  receive_job_status: 'closed',
  recovery_stow_task_id: null,
  recovery_stow_status: null,
  ...over,
});

function renderModule(tasks: ProblemTask[], over: Partial<ProblemCenterModuleFT2Props> = {}) {
  const props: ProblemCenterModuleFT2Props = {
    data: { tasks, total_unresolved: tasks.length },
    isLoading: false,
    isError: false,
    onResolve: jest.fn().mockResolvedValue({}),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onOpenStowTask: jest.fn(),
    canResolve: true,
    currentUserId: 7,
    ...over,
  };
  const view = render(<ProblemCenterModuleFT2 {...props} />);
  return { props, view };
}

const detail = () => screen.getByRole('region', { name: 'Exception detail' });
const detailButtons = () => within(detail()).queryAllByRole('button').map((b) => b.textContent?.trim() ?? '');
const DECISIONS = /Approve recovery|Discard|Write off/;
/** The single queue row (native <select> options share the "option" role). */
const queueRow = () => within(screen.getByRole('listbox', { name: 'Exceptions' })).getByRole('option');

describe('M1 — open Receive job with verified custody', () => {
  it.each(OPEN_STATUSES)('job %s: Awaiting Receive close, explained, and no decision', (status) => {
    const { props } = renderModule([held({ receive_job_status: status })]);

    expect(within(detail()).getAllByText('Awaiting Receive close').length).toBeGreaterThan(0);
    expect(detail()).toHaveTextContent(/Recovery decisions become available after the Receive closes/);
    expect(screen.queryByRole('button', { name: DECISIONS })).not.toBeInTheDocument();
    expect(detailButtons()).toEqual([]);
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('the queue row says what it is waiting for, and it counts as Awaiting action', () => {
    renderModule([held({ receive_job_status: 'inspection' })]);
    const row = queueRow();
    expect(row).toHaveTextContent('Awaiting Receive close');
    expect(row).toHaveTextContent('Waiting for the Receive to close');
    expect(screen.getByRole('button', { name: 'Awaiting action: 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs decision: 0' })).toBeInTheDocument();
  });

  it('the model offers nothing while the job is open', () => {
    for (const status of OPEN_STATUSES) {
      expect(receiveUnitActions(held({ receive_job_status: status }))).toEqual([]);
      const item = taskToItem(held({ receive_job_status: status }), { canResolve: true });
      expect(item.state).toBe('awaiting_receive_close');
      expect(item.actions).toEqual([]);
      expect(item.awaitingManager).toBe(false);
    }
  });
});

describe('M2 — closed Receive job with verified custody', () => {
  it('offers exactly Approve recovery, Discard and Write off; Approve submits re_stow once', async () => {
    const t = held();
    const { props } = renderModule([t]);
    expect(detailButtons()).toEqual(['Approve recovery', 'Discard', 'Write off']);

    fireEvent.click(within(detail()).getByRole('button', { name: /Approve recovery/ }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledTimes(1));
    expect(props.onResolve).toHaveBeenCalledWith(t.problem_task_id, 're_stow', '');
  });
});

describe('M3 — missing or unknown Receive job status fails closed', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['cancelled', 'cancelled'],
    ['unknown value', 'archived'],
  ] as const)('%s: no decision, and the reason is shown', (_name, status) => {
    const { props } = renderModule([held({ receive_job_status: status as string | null | undefined })]);
    expect(screen.queryByRole('button', { name: DECISIONS })).not.toBeInTheDocument();
    expect(within(detail()).getAllByText('Needs investigation').length).toBeGreaterThan(0);
    expect(detail()).toHaveTextContent(/Receive status could not be confirmed/);
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

describe('M4 — operators', () => {
  it('see the same waiting state, not an owner/admin hand-off, and no decision', () => {
    renderModule([held({ receive_job_status: 'in_progress' })], { canResolve: false });
    expect(within(detail()).getAllByText('Awaiting Receive close').length).toBeGreaterThan(0);
    expect(detail()).not.toHaveTextContent('An owner or admin decides');
    expect(queueRow()).not.toHaveTextContent('Waiting on owner/admin decision');
    expect(detailButtons()).toEqual([]);
  });

  it('after close an operator gets the owner/admin hand-off (unchanged GH-1222 behaviour)', () => {
    renderModule([held()], { canResolve: false });
    expect(queueRow()).toHaveTextContent('Waiting on owner/admin decision');
    expect(detailButtons()).toEqual([]);
  });
});

describe('M5 — state transitions', () => {
  it('open → closed → approved renders Awaiting Receive close → Needs decision → Awaiting Stow', () => {
    const { props, view } = renderModule([held({ receive_job_status: 'stow_ready' })]);
    expect(within(detail()).getAllByText('Awaiting Receive close').length).toBeGreaterThan(0);

    view.rerender(<ProblemCenterModuleFT2 {...props} data={{ tasks: [held()], total_unresolved: 1 }} />);
    expect(within(detail()).getAllByText('Needs decision').length).toBeGreaterThan(0);
    expect(detailButtons()).toEqual(['Approve recovery', 'Discard', 'Write off']);

    const approved = held({ recovery_stow_task_id: 'c1c1c1c1-0000-4000-8000-000000000001', recovery_stow_status: 'pending' });
    view.rerender(<ProblemCenterModuleFT2 {...props} data={{ tasks: [approved], total_unresolved: 1 }} />);
    expect(within(detail()).getAllByText('Awaiting Stow').length).toBeGreaterThan(0);
    expect(detailButtons()).toEqual(['Open Stow task']);
  });

  it('a decision under confirmation closes if the job is reported open again', () => {
    const { props, view } = renderModule([held()]);
    fireEvent.click(within(detail()).getByRole('button', { name: /Write off/ }));
    expect(within(detail()).getByRole('group', { name: 'Confirm action' })).toBeInTheDocument();

    view.rerender(<ProblemCenterModuleFT2 {...props} data={{ tasks: [held({ receive_job_status: 'in_progress' })], total_unresolved: 1 }} />);
    expect(screen.queryByRole('group', { name: 'Confirm action' })).not.toBeInTheDocument();
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

describe('M6 — existing eligibility still applies after close', () => {
  it('closed job but unverified custody: no decision, custody reason', () => {
    renderModule([held({ receive_custody_verified: false })]);
    expect(screen.queryByRole('button', { name: DECISIONS })).not.toBeInTheDocument();
    expect(detail()).toHaveTextContent(/placement is not verified/);
  });

  it('a live recovery Stow still wins over job status (no second decision)', () => {
    const live = held({ recovery_stow_task_id: 'c1c1c1c1-0000-4000-8000-000000000002', recovery_stow_status: 'in_progress' });
    renderModule([live]);
    expect(within(detail()).getAllByText('Stow in progress').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: DECISIONS })).not.toBeInTheDocument();
  });
});

describe('M7 — host hook mapping', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('passes receive_job_id / receive_job_status through and maps an absent status to null', async () => {
    mockGet.mockResolvedValue({
      data: {
        problem_tasks: [
          { ...held(), problem_task_id: 't-closed' },
          { ...held(), problem_task_id: 't-open', receive_job_status: 'inspection' },
          { ...held(), problem_task_id: 't-legacy', receive_job_id: undefined, receive_job_status: undefined },
        ],
      },
    });
    const { result } = renderHook(() => useProblemCenter(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const byId = Object.fromEntries(result.current.data!.tasks.map((t) => [t.problem_task_id, t]));
    expect(byId['t-closed']).toEqual(expect.objectContaining({ receive_job_status: 'closed', receive_job_id: held().receive_job_id }));
    expect(byId['t-open'].receive_job_status).toBe('inspection');
    expect(byId['t-legacy']).toEqual(expect.objectContaining({ receive_job_status: null, receive_job_id: null }));
  });
});
