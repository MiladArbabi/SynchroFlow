// tests/unit/ui/problem-center/ProblemCenterModuleFT2.v2-recovery-i5.test.tsx
//
// S4-5 I5 — Problem Center V2 workspace: Receive recovery wiring and the
// action/role contracts the redesign must keep.
// ==========================================================================
// Canonical Receive recovery (certified I1–I4, unchanged):
//   one held LSU in a verified problem bin → owner/admin approves → one
//   pending receive_recovery Stow → "Awaiting Stow", NO inventory credit →
//   operator opens the actual Stow task → exact LSU scan → credit once →
//   only then is the Problem Center task completed.
//
// Contracts protected here (presentation details are deliberately not frozen):
//   R1  held recoverable unit, owner/admin: Approve recovery / Discard / Write
//       off only; each submits exactly its own action; destructive needs a
//       second confirmation and "Keep open" submits nothing.
//   R2  operator: the same task offers no decision and never submits.
//   R3  no unsupported actions: unverified custody, unit not held,
//       unrecoverable classification, generic Receive (no LSU), reconciliation
//       and count tasks offer nothing.
//   R4  approval ≠ completion: a live recovery Stow reads Awaiting Stow,
//       uncredited, never completed; it offers navigation to the exact Stow
//       task and no further decision.
//   R5  completion only after the confirmed Stow: resolved re_stow with a
//       completed Stow reads Recovered / credited; disposals never claim credit.
//   R6  one-LSU identity: the exact LSU is shown and searchable.
//   R7  failure / stale: a 409 is surfaced and the queue refreshed (no
//       optimistic change); double activation submits once; a vanished
//       selection is announced; a failed background refresh keeps data and
//       says it may be out of date.
//   R8  existing Pack decisions: owner/admin approve (partial) / hold through
//       the existing request contract after confirmation; operators cannot.
//   R9  keyboard / accessibility: listbox arrow navigation, Escape cancels a
//       confirmation, filters are labelled controls, indicators expose state.
//   R10 responsive: split 58/42 workspace at desktop widths, stacked below.
//
// Harness: REAL ProblemCenterModuleFT2 source. onResolve / onPackDecision /
// onRefresh / onOpenStowTask are the captured host boundaries.

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProblemCenterModuleFT2, {
  type ProblemCenterModuleFT2Props,
  type ProblemTask,
} from '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2';

const LSU = 'LSU-I5-HELD-0001';
const STOW_ID = 'aaaaaaaa-0000-4000-8000-0000000000a5';

const base = (over: Partial<ProblemTask>): ProblemTask => ({
  problem_task_id: '15151515-1515-4515-8515-151515151515',
  lasyncro_variant_id: 'bbbbbbbb-1515-4515-8515-151515151515',
  exception_type: 'defect',
  source: 'receive',
  quantity: 1,
  prob_label: null,
  problem_bin_location: 'PROB-BIN-01',
  status: 'open',
  created_at: '2026-11-02T06:00:00.000Z',
  variant_title: 'Default Title',
  sku: 'SKU-I5',
  product_title: 'Heavyweight tee',
  lasyncro_unit_id: LSU,
  unit_status: 'held',
  unit_location_code: 'PROB-BIN-01',
  receive_custody_verified: true,
  recovery_stow_task_id: null,
  recovery_stow_status: null,
  ...over,
});

const heldRecoverable = base({});
const awaitingStow = base({
  recovery_stow_task_id: STOW_ID,
  recovery_stow_status: 'pending',
  recovery_stow_created_at: '2026-11-02T07:00:00.000Z',
});

type Overrides = Partial<ProblemCenterModuleFT2Props>;

function renderModule(tasks: ProblemTask[], over: Overrides = {}) {
  const props: ProblemCenterModuleFT2Props = {
    data: { tasks, total_unresolved: tasks.length },
    isLoading: false,
    isError: false,
    onResolve: jest.fn().mockResolvedValue({}),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onPackDecision: jest.fn().mockResolvedValue(undefined),
    onOpenStowTask: jest.fn(),
    canResolve: true,
    currentUserId: 7,
    ...over,
  };
  const view = render(<ProblemCenterModuleFT2 {...props} />);
  return { props, view };
}

const detail = () => screen.getByRole('region', { name: 'Exception detail' });
/** Queue rows only — native <select> options share the "option" role. */
const queueOptions = (): HTMLElement[] => {
  const list = screen.queryByRole('listbox', { name: 'Exceptions' });
  return list ? within(list).queryAllByRole('option') : [];
};
const actionButtons = () =>
  within(detail()).queryAllByRole('button').map((b) => b.textContent?.trim() ?? '');

function setViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches, media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(),
      addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    }),
  });
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

// ── R1 / R2 ────────────────────────────────────────────────────────────────

describe('R1 — owner/admin decisions on one held recoverable Receive unit', () => {
  it('offers exactly Approve recovery, Discard and Write off', () => {
    renderModule([heldRecoverable]);
    expect(actionButtons()).toEqual(['Approve recovery', 'Discard', 'Write off']);
  });

  it('Approve recovery submits re_stow once, without inventory claims of credit', async () => {
    const { props } = renderModule([heldRecoverable]);

    fireEvent.click(within(detail()).getByRole('button', { name: /Approve recovery/ }));

    await waitFor(() => expect(props.onResolve).toHaveBeenCalledTimes(1));
    expect(props.onResolve).toHaveBeenCalledWith(heldRecoverable.problem_task_id, 're_stow', '');
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalled());
    expect(within(detail()).getByTestId('pc-inventory')).not.toHaveTextContent(/credited at/i);
  });

  it.each([
    ['Discard', 'discard'],
    ['Write off', 'write_off'],
  ])('%s requires a second confirmation, then submits only %s', async (label, action) => {
    const { props } = renderModule([heldRecoverable]);

    fireEvent.click(within(detail()).getByRole('button', { name: label }));
    expect(props.onResolve).not.toHaveBeenCalled();
    const group = within(detail()).getByRole('group', { name: 'Confirm action' });

    fireEvent.click(within(group).getByRole('button', { name: label }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledTimes(1));
    expect((props.onResolve as jest.Mock).mock.calls[0][1]).toBe(action);
  });

  it('Keep open cancels the confirmation and submits nothing', () => {
    const { props } = renderModule([heldRecoverable]);

    fireEvent.click(within(detail()).getByRole('button', { name: 'Write off' }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Keep open' }));

    expect(within(detail()).queryByRole('group', { name: 'Confirm action' })).toBeNull();
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

describe('R2 — operator sees the task but cannot decide', () => {
  it('no decision controls; the wait states the owner/admin decides; nothing is submitted', () => {
    const { props } = renderModule([heldRecoverable], { canResolve: false });

    expect(actionButtons()).toEqual([]);
    expect(within(detail()).getByText(/owner or admin decides/i)).toBeInTheDocument();
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

// ── R3 ─────────────────────────────────────────────────────────────────────

describe('R3 — no unsupported resolution actions', () => {
  it.each<[string, Partial<ProblemTask>]>([
    ['custody not verified', { receive_custody_verified: false }],
    ['unit no longer held', { unit_status: 'stowed' }],
    ['unrecoverable classification', { exception_type: 'wrong_item' }],
    ['generic Receive incident without an LSU', { lasyncro_unit_id: null, exception_type: 'product_defect' }],
    ['reconciliation', { source: 'reconciliation', lasyncro_unit_id: null, exception_type: 'fulfillment_location_not_found' }],
    ['count', { source: 'count', lasyncro_unit_id: null, exception_type: 'recount_variance' }],
    ['stow over capacity', { source: 'stow', lasyncro_unit_id: null, exception_type: 'bin_over_capacity' }],
  ])('%s → owner sees no decision action', (_label, over) => {
    const { props } = renderModule([base(over)]);

    expect(actionButtons()).toEqual([]);
    expect(within(detail()).getAllByText('Needs investigation').length).toBeGreaterThan(0);
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

// ── R4 / R5 / R6 ───────────────────────────────────────────────────────────

describe('R4 — recovery approval is not completion', () => {
  it.each([true, false])('Awaiting Stow, uncredited, opens the exact Stow task (canResolve=%s)', (canResolve) => {
    const { props } = renderModule([awaitingStow], { canResolve });

    expect(within(detail()).getAllByText('Awaiting Stow').length).toBeGreaterThan(0);
    expect(within(detail()).queryByText('Recovered')).toBeNull();
    expect(within(detail()).getByTestId('pc-inventory')).toHaveTextContent(/Not credited/);
    // A live recovery Stow leaves no further decision (backend: one live Stow).
    expect(actionButtons()).toEqual(['Open Stow task']);

    fireEvent.click(within(detail()).getByRole('button', { name: /Open Stow task/ }));
    expect(props.onOpenStowTask).toHaveBeenCalledWith(STOW_ID);
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('a claimed recovery Stow is in progress, still uncredited', () => {
    renderModule([base({ ...awaitingStow, recovery_stow_status: 'in_progress' })]);

    expect(within(detail()).getAllByText('Stow in progress').length).toBeGreaterThan(0);
    expect(within(detail()).getByTestId('pc-inventory')).toHaveTextContent(/Not credited/);
  });
});

describe('R5 — completed only after the confirmed recovery Stow', () => {
  it('resolved re_stow with a completed Stow reads Recovered and credited at its destination', () => {
    renderModule([base({
      status: 'resolved', resolution_action: 're_stow', resolved_at: '2026-11-02T08:00:00.000Z',
      unit_status: 'stowed', unit_location_code: 'A-02-06',
      recovery_stow_task_id: STOW_ID, recovery_stow_status: 'completed', recovery_stow_location_code: 'A-02-06',
    })]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'resolved' } });
    fireEvent.click(queueOptions()[0]);

    expect(within(detail()).getAllByText('Recovered').length).toBeGreaterThan(0);
    expect(within(detail()).getByTestId('pc-inventory')).toHaveTextContent('+1 credited at A-02-06');
    expect(actionButtons()).toEqual([]);
  });

  it('a discarded unit is completed without any credit claim', () => {
    renderModule([base({ status: 'resolved', resolution_action: 'discard', resolved_at: '2026-11-02T08:00:00.000Z', unit_status: 'discarded' })]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'resolved' } });
    fireEvent.click(queueOptions()[0]);

    expect(within(detail()).getByTestId('pc-inventory')).toHaveTextContent(/never added to inventory/);
    expect(within(detail()).getByTestId('pc-inventory')).not.toHaveTextContent(/credited at/);
  });

  it('completed tasks stay out of the default open queue and indicators', () => {
    renderModule([base({ status: 'resolved', resolution_action: 'discard', resolved_at: '2026-11-02T08:00:00.000Z' })]);

    expect(queueOptions()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Needs decision: 0' })).toBeInTheDocument();
  });
});

describe('R6 — one-LSU recovery identity', () => {
  it('the detail shows the exact LSU and search finds the task by it', () => {
    renderModule([awaitingStow, base({ problem_task_id: '25252525-2525-4525-8525-252525252525', lasyncro_unit_id: 'LSU-OTHER-0002', product_title: 'Other tee' })]);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exceptions' }), { target: { value: LSU.toLowerCase() } });

    expect(queueOptions()).toHaveLength(1);
    fireEvent.click(queueOptions()[0]);
    expect(within(detail()).getByText(LSU)).toBeInTheDocument();
    expect(within(detail()).getByText(new RegExp(`scan ${LSU}`))).toBeInTheDocument();
  });
});

// ── R7 ─────────────────────────────────────────────────────────────────────

describe('R7 — failed actions and stale responses', () => {
  it('a 409 is surfaced, the queue is refreshed, and nothing changes optimistically', async () => {
    const onResolve = jest.fn().mockRejectedValue({
      response: { status: 409, data: { error: 'This resolution is not supported for this incident', code: 'RECEIVE_RECOVERY_NOT_ELIGIBLE', reason: 'receive_not_closed' } },
    });
    const { props } = renderModule([heldRecoverable], { onResolve });

    fireEvent.click(within(detail()).getByRole('button', { name: /Approve recovery/ }));

    expect(await within(detail()).findByRole('alert')).toHaveTextContent('The Receive job must be closed before this unit can be recovered.');
    expect(props.onRefresh).toHaveBeenCalled();
    expect(within(detail()).getAllByText('Needs decision').length).toBeGreaterThan(0);
    await waitFor(() => expect(within(detail()).getByRole('button', { name: /Approve recovery/ })).toBeEnabled());
  });

  it('activating Approve twice while in flight submits once', async () => {
    let release!: () => void;
    const onResolve = jest.fn(() => new Promise<void>((r) => { release = r; }));
    renderModule([heldRecoverable], { onResolve });

    const approve = within(detail()).getByRole('button', { name: /Approve recovery/ });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();

    await act(async () => { release(); });
  });

  it('an action is never submitted once the refreshed projection no longer offers it', async () => {
    const { props, view } = renderModule([heldRecoverable]);
    fireEvent.click(within(detail()).getByRole('button', { name: 'Discard' }));

    // A concurrent approval lands first: the refreshed row now has a live Stow.
    view.rerender(<ProblemCenterModuleFT2 {...props} data={{ tasks: [awaitingStow], total_unresolved: 1 }} />);
    const group = within(detail()).queryByRole('group', { name: 'Confirm action' });
    if (group) fireEvent.click(within(group).getByRole('button', { name: 'Discard' }));

    await act(async () => { await Promise.resolve(); });
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('a selection that disappears after refresh is announced, not silently replaced', () => {
    const { props, view } = renderModule([heldRecoverable]);
    view.rerender(<ProblemCenterModuleFT2 {...props} data={{ tasks: [], total_unresolved: 0 }} />);

    expect(within(detail()).getByRole('status')).toHaveTextContent(/no longer in your queue/);
  });

  it('a failed background refresh keeps the queue and marks it possibly out of date', () => {
    const { props } = renderModule([heldRecoverable], { isError: true, updatedAt: Date.parse('2026-11-02T09:30:00.000Z') });

    expect(queueOptions()).toHaveLength(1);
    const notice = screen.getByText(/Couldn.t refresh/);
    expect(notice).toHaveTextContent(/may be out of date/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('loading and first-load failure states', () => {
    const { view } = renderModule([], { data: null, isLoading: true });
    expect(queueOptions()).toHaveLength(0);
    view.unmount();

    const onRefresh = jest.fn();
    renderModule([], { data: null, isError: true, onRefresh });
    expect(screen.getByRole('alert')).toHaveTextContent('Problem Center could not load.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalled();
  });
});

// ── R8 ─────────────────────────────────────────────────────────────────────

const DECISION = {
  id: 'dec-1', exception_type: 'missing_item', order_ref: '#10469', item_label: 'Heavyweight tee — Black / M',
  sku: 'LS-TEE-BLK-M', batch_ref: 'ABCDEF12', raised_at: '2026-11-02T08:00:00.000Z',
};

const PACK_COPY = {
  approveLabel: 'Ship partial',
  approveConfirm: (ref: string) => `Order ${ref} will ship without the missing item.`,
  holdLabel: 'Hold order',
  holdConfirm: (ref: string) => `Order ${ref} will remain on hold and will not move to packing.`,
};

describe('R8 — existing Pack decisions', () => {
  it.each([
    ['Ship partial', 'approved'],
    ['Hold order', 'rejected'],
  ] as const)('%s → confirmation → existing decision request (%s) with the note', async (label, status) => {
    const { props } = renderModule([], { packDecisions: [DECISION], packDecisionCopy: PACK_COPY });

    expect(within(detail()).getAllByText('Awaiting pack decision').length).toBeGreaterThan(0);
    fireEvent.click(within(detail()).getByRole('button', { name: new RegExp(label) }));
    expect(props.onPackDecision).not.toHaveBeenCalled();

    fireEvent.change(within(detail()).getByRole('textbox', { name: 'Note (optional)' }), { target: { value: 'customer told' } });
    const group = within(detail()).getByRole('group', { name: 'Confirm action' });
    fireEvent.click(within(group).getByRole('button', { name: label }));

    await waitFor(() => expect(props.onPackDecision).toHaveBeenCalledWith('dec-1', status, 'customer told'));
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('operators get no pack decision controls', () => {
    const { props } = renderModule([], { packDecisions: [DECISION], packDecisionCopy: PACK_COPY, canResolve: false });
    expect(actionButtons()).toEqual([]);
    expect(props.onPackDecision).not.toHaveBeenCalled();
  });

  it('without the host\'s contractual copy no pack decision is offered (fail closed)', () => {
    renderModule([], { packDecisions: [DECISION] });
    expect(actionButtons()).toEqual([]);
  });
});

// ── R9 ─────────────────────────────────────────────────────────────────────

describe('R9 — keyboard and accessible controls', () => {
  const second = base({ problem_task_id: '35353535-3535-4535-8535-353535353535', product_title: 'Second tee', created_at: '2026-11-02T07:30:00.000Z' });

  it('arrow keys move selection and focus through the queue; Enter selects', () => {
    renderModule([heldRecoverable, second]);
    const [first, next] = queueOptions();
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(next).toHaveAttribute('tabindex', '-1');

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(next).toHaveAttribute('aria-selected', 'true');
    expect(next).toHaveFocus();
    expect(within(detail()).getByRole('heading', { level: 2 })).toHaveTextContent('Second tee');

    fireEvent.keyDown(next, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(next, { key: 'Enter' });
    expect(next).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape cancels a confirmation and focus starts on the safe choice', () => {
    const { props } = renderModule([heldRecoverable]);
    fireEvent.click(within(detail()).getByRole('button', { name: 'Write off' }));

    expect(within(detail()).getByRole('button', { name: 'Keep open' })).toHaveFocus();
    fireEvent.keyDown(within(detail()).getByRole('group', { name: 'Confirm action' }), { key: 'Escape' });
    expect(within(detail()).queryByRole('group', { name: 'Confirm action' })).toBeNull();
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('filters are labelled; indicators expose and toggle their filter state', () => {
    renderModule([heldRecoverable, awaitingStow]);

    expect(screen.getByRole('combobox', { name: 'Stage' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Assigned to me/ })).toHaveAttribute('aria-checked', 'false');
    const awaiting = screen.getByRole('button', { name: 'Awaiting action: 1' });
    expect(awaiting).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(awaiting);
    expect(awaiting).toHaveAttribute('aria-pressed', 'true');
    expect(queueOptions()).toHaveLength(1);
  });
});

// ── R10 ────────────────────────────────────────────────────────────────────

describe('R10 — responsive layout mode', () => {
  it('desktop widths use the split queue/detail workspace', () => {
    setViewport(true);
    renderModule([heldRecoverable]);
    expect(screen.getByTestId('problem-center-v2')).toHaveAttribute('data-layout', 'split');
  });

  it('narrow widths stack queue above detail', () => {
    setViewport(false);
    renderModule([heldRecoverable]);
    expect(screen.getByTestId('problem-center-v2')).toHaveAttribute('data-layout', 'stacked');
  });
});
