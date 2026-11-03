// tests/unit/ui/problem-center/ProblemCenterModuleFT2.data-consistency-i5-d1.test.tsx
//
// SF-PC-V2-I5-UI-CORRECT-005 — queue/detail consistency (browser finding D1)
// and unavailable-counter announcements (D3).
// ==========================================================================
// D1: Pack decisions load independently of the Problem Center projection.
// Before this correction, while the projection was loading or had failed
// without cached data, a pack decision was auto-selected into the detail
// panel with live Ship partial / Hold order controls although the queue
// showed no rows. Contracts:
//   C1  loading without data: loading state only; no rows, no selection, no actions.
//   C2  error without data: error + Retry; no orphaned pack actions.
//   C3  once the projection arrives, pack decisions join the queue normally.
//   C4  a valid selection stays stable across background refreshes.
//   C5  a failed background refresh with cached data keeps the queue (stale).
//   C6  no action is submitted for an item that is not visible in the queue.
//   C7  operators never get decision controls in any of these states.
// D3: counters announce "unavailable" when the projection failed to load and
//     "loading" while it is being fetched.
//
// Harness: REAL ProblemCenterModuleFT2 source; host callbacks are captured.

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProblemCenterModuleFT2, {
  type PackDecisionItem,
  type ProblemCenterModuleFT2Props,
  type ProblemTask,
} from '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2';

const TASK: ProblemTask = {
  problem_task_id: 'd1d1d1d1-0000-4000-8000-000000000001',
  lasyncro_variant_id: 'd1d1d1d1-0000-4000-8000-0000000000a1',
  exception_type: 'order_cancelled',
  source: 'pick',
  quantity: 1,
  prob_label: 'PROB-D1-0001',
  problem_bin_location: 'PROB-BIN-01',
  status: 'open',
  created_at: '2026-11-02T06:00:00.000Z',
  variant_title: 'Default Title',
  sku: 'SKU-D1-TASK',
  product_title: 'Cancelled kettle',
};

const DECISION: PackDecisionItem = {
  id: 'dec-d1', exception_type: 'missing_item', order_ref: '#20001', item_label: 'Copper kettle',
  sku: 'SKU-D1-PACK', batch_ref: 'BATCHD10', raised_at: '2026-11-02T05:00:00.000Z',
};

const PACK_COPY = {
  approveLabel: 'Ship partial',
  approveConfirm: (ref: string) => `Order ${ref} will ship without the missing item.`,
  holdLabel: 'Hold order',
  holdConfirm: (ref: string) => `Order ${ref} will remain on hold and will not move to packing.`,
};

function props(over: Partial<ProblemCenterModuleFT2Props> = {}): ProblemCenterModuleFT2Props {
  return {
    data: { tasks: [TASK], total_unresolved: 1 },
    isLoading: false,
    isError: false,
    onResolve: jest.fn().mockResolvedValue({}),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onPackDecision: jest.fn().mockResolvedValue(undefined),
    onOpenStowTask: jest.fn(),
    canResolve: true,
    currentUserId: 7,
    packDecisions: [DECISION],
    packDecisionCopy: PACK_COPY,
    ...over,
  };
}

const LOADING = { data: null, isLoading: true, isError: false } as const;
const FAILED = { data: null, isLoading: false, isError: true } as const;

const detail = () => screen.getByRole('region', { name: 'Exception detail' });
const queueOptions = (): HTMLElement[] => {
  const list = screen.queryByRole('listbox', { name: 'Exceptions' });
  return list ? within(list).queryAllByRole('option') : [];
};
const rowFor = (text: string) => queueOptions().find((r) => r.textContent?.includes(text)) ?? null;
const detailButtons = () => within(detail()).queryAllByRole('button').map((b) => b.textContent?.trim() ?? '');
const counterNames = () =>
  ['Needs decision', 'Awaiting action', 'In progress'].map(
    (label) => screen.getByRole('button', { name: new RegExp(`^${label}: `) }).getAttribute('aria-label'),
  );

describe('C1 — initial loading with pack decisions already resolved', () => {
  it.each([true, false])('canResolve=%s: no rows, no selection and no actions', (canResolve) => {
    const p = props({ ...LOADING, canResolve });
    render(<ProblemCenterModuleFT2 {...p} />);

    expect(queueOptions()).toHaveLength(0);
    expect(detail()).toHaveTextContent('Select an exception to see what to do next.');
    expect(within(detail()).queryByText('Copper kettle')).not.toBeInTheDocument();
    expect(detailButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Ship partial|Hold order/ })).not.toBeInTheDocument();
    expect(p.onPackDecision).not.toHaveBeenCalled();
  });

  it('counters announce loading (D3)', () => {
    render(<ProblemCenterModuleFT2 {...props(LOADING)} />);
    expect(counterNames()).toEqual(['Needs decision: loading', 'Awaiting action: loading', 'In progress: loading']);
  });
});

describe('C2 — initial error without cached data', () => {
  it('shows the error with Retry and no orphaned pack actions', () => {
    const p = props(FAILED);
    render(<ProblemCenterModuleFT2 {...p} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Problem Center could not load.');
    expect(queueOptions()).toHaveLength(0);
    expect(detailButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Ship partial|Hold order/ })).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
    expect(p.onPackDecision).not.toHaveBeenCalled();
  });

  it('counters announce unavailable, and loading again while a retry is in flight (D3)', () => {
    const { rerender } = render(<ProblemCenterModuleFT2 {...props(FAILED)} />);
    expect(counterNames()).toEqual(['Needs decision: unavailable', 'Awaiting action: unavailable', 'In progress: unavailable']);

    rerender(<ProblemCenterModuleFT2 {...props({ ...FAILED, isRefreshing: true })} />);
    expect(counterNames()).toEqual(['Needs decision: loading', 'Awaiting action: loading', 'In progress: loading']);
  });
});

describe('C3 — recovery from loading / error', () => {
  it.each([['loading', LOADING], ['error', FAILED]] as const)(
    'from %s: tasks and pack decisions join the queue and the most urgent is selected',
    async (_name, initial) => {
      const p = props(initial);
      const { rerender } = render(<ProblemCenterModuleFT2 {...p} />);
      expect(queueOptions()).toHaveLength(0);

      rerender(<ProblemCenterModuleFT2 {...{ ...p, data: { tasks: [TASK], total_unresolved: 1 }, isLoading: false, isError: false }} />);

      await waitFor(() => expect(queueOptions()).toHaveLength(2));
      expect(rowFor('Copper kettle')).not.toBeNull();
      expect(rowFor('Cancelled kettle')).not.toBeNull();
      // Both are "decision" bucket; the older pack decision sorts first and is selected.
      expect(queueOptions()[0]).toHaveAttribute('aria-selected', 'true');
      expect(detailButtons()).toEqual(['Ship partial', 'Hold order']);
      expect(screen.getByRole('button', { name: 'Needs decision: 2' })).toBeInTheDocument();
    },
  );

  it('the pack decision is actionable once its row is visible', async () => {
    const p = props(LOADING);
    const { rerender } = render(<ProblemCenterModuleFT2 {...p} />);
    rerender(<ProblemCenterModuleFT2 {...p} data={{ tasks: [TASK], total_unresolved: 1 }} isLoading={false} />);

    fireEvent.click(rowFor('Copper kettle') as HTMLElement);
    fireEvent.click(within(detail()).getByRole('button', { name: /Hold order/ }));
    const group = within(detail()).getByRole('group', { name: 'Confirm action' });
    fireEvent.click(within(group).getByRole('button', { name: 'Hold order' }));

    await waitFor(() => expect(p.onPackDecision).toHaveBeenCalledTimes(1));
    expect(p.onPackDecision).toHaveBeenCalledWith('dec-d1', 'rejected', '');
  });
});

describe('C4 — selection stability during background refresh', () => {
  it('keeps the chosen item selected when refreshed data and new decisions arrive', () => {
    const p = props();
    const { rerender } = render(<ProblemCenterModuleFT2 {...p} />);
    fireEvent.click(rowFor('Cancelled kettle') as HTMLElement);
    expect(rowFor('Cancelled kettle')).toHaveAttribute('aria-selected', 'true');

    const newer: PackDecisionItem = { ...DECISION, id: 'dec-d1-older', item_label: 'Older kettle', raised_at: '2026-11-02T01:00:00.000Z' };
    rerender(
      <ProblemCenterModuleFT2
        {...p}
        isRefreshing
        data={{ tasks: [{ ...TASK }], total_unresolved: 1 }}
        packDecisions={[newer, { ...DECISION }]}
      />,
    );

    expect(queueOptions()[0]).toHaveTextContent('Older kettle');
    expect(rowFor('Cancelled kettle')).toHaveAttribute('aria-selected', 'true');
    expect(within(detail()).getByRole('heading', { level: 2 })).toHaveTextContent('Cancelled kettle');
  });
});

describe('C5 — failed background refresh with cached data (stale)', () => {
  it('keeps tasks, pack decisions and their actions, and says the queue may be out of date', () => {
    render(<ProblemCenterModuleFT2 {...props({ isError: true, updatedAt: Date.now() })} />);

    expect(screen.getByText(/Couldn.t refresh/)).toBeInTheDocument();
    expect(queueOptions()).toHaveLength(2);
    expect(detailButtons()).toEqual(['Ship partial', 'Hold order']);
    expect(screen.getByRole('button', { name: 'Needs decision: 2' })).toBeInTheDocument();
  });
});

describe('C6 — actions belong to a visible queue item', () => {
  it('a confirmation closes when a filter hides its item, and nothing is submitted', () => {
    const p = props();
    render(<ProblemCenterModuleFT2 {...p} />);
    fireEvent.click(rowFor('Copper kettle') as HTMLElement);
    fireEvent.click(within(detail()).getByRole('button', { name: /Ship partial/ }));
    expect(within(detail()).getByRole('group', { name: 'Confirm action' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Stage' }), { target: { value: 'pick' } });
    expect(rowFor('Copper kettle')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Confirm action' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Stage' }), { target: { value: 'all' } });
    fireEvent.click(rowFor('Copper kettle') as HTMLElement);
    expect(screen.queryByRole('group', { name: 'Confirm action' })).not.toBeInTheDocument();
    expect(p.onPackDecision).not.toHaveBeenCalled();
  });

  it('a pack decision whose projection disappears (data → null) is withdrawn with its controls', () => {
    const p = props();
    const { rerender } = render(<ProblemCenterModuleFT2 {...p} />);
    fireEvent.click(rowFor('Copper kettle') as HTMLElement);
    fireEvent.click(within(detail()).getByRole('button', { name: /Ship partial/ }));

    rerender(<ProblemCenterModuleFT2 {...p} data={null} isLoading />);

    expect(queueOptions()).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Confirm action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ship partial|Hold order/ })).not.toBeInTheDocument();
    expect(p.onPackDecision).not.toHaveBeenCalled();
  });
});

describe('C7 — operators', () => {
  it.each([['loading', LOADING], ['error', FAILED], ['loaded', {}]] as const)(
    '%s: no decision controls are ever offered',
    (_name, state) => {
      const p = props({ ...state, canResolve: false });
      render(<ProblemCenterModuleFT2 {...p} />);
      for (const row of queueOptions()) {
        fireEvent.click(row);
        expect(detailButtons()).toEqual([]);
      }
      expect(screen.queryByRole('button', { name: /Ship partial|Hold order|Re-stow|Discard|Write off/ })).not.toBeInTheDocument();
      expect(p.onPackDecision).not.toHaveBeenCalled();
      expect(p.onResolve).not.toHaveBeenCalled();
    },
  );
});

describe('D2 — narrow-width queue readability', () => {
  it('SKU and next action are their own elements with full text on hover; a name equal to its SKU is not repeated', () => {
    const skuOnly: PackDecisionItem = { ...DECISION, id: 'dec-sku', item_label: 'SKU-ONLY-01', sku: 'SKU-ONLY-01' };
    render(<ProblemCenterModuleFT2 {...props({ packDecisions: [DECISION, skuOnly] })} />);

    const row = rowFor('Copper kettle') as HTMLElement;
    expect(within(row).getByTitle('SKU-D1-PACK')).toHaveTextContent('SKU-D1-PACK');
    expect(within(row).getByTitle('Next: Ship partial or hold order')).toBeInTheDocument();
    expect(within(rowFor('SKU-ONLY-01') as HTMLElement).getAllByText('SKU-ONLY-01')).toHaveLength(1);
  });
});
