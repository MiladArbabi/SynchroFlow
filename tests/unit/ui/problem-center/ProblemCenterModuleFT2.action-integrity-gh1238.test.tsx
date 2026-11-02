// tests/unit/ui/problem-center/ProblemCenterModuleFT2.action-integrity-gh1238.test.tsx
//
// GH-1238 / PC-SAFE-01 — TEST STRATEGY / RED — Problem Center resolution
// dialog action integrity (brief section E).
// ==========================================================================
// Ratified (issue #1238 W1 / item 7):
//   - The dialog never submits an action that is not visibly offered.
//   - Types without a verified safe resolution action (unknown,
//     reconciliation, count) get a non-destructive investigation/handoff
//     state, never an actionable generic Resolve control.
//   - No false "No inventory change" claim for Quarantine.
//
// Harness: REAL ProblemCenterModuleFT2 source with canResolve (owner/admin
// presentation, GH-1222). onResolve is the captured submission boundary.
//
// S4-5 I5 (Problem Center V2): the Resolve → dialog was replaced by explicit
// per-action buttons in the detail panel (destructive ones confirm inline).
// Only the presentation helpers changed; every safety contract above is kept:
// default-deny action sets, no submission of an unoffered action, no false
// inventory claim, no ordinary Pick disposition.

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProblemCenterModuleFT2 from '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2';

const ACTION_BY_LABEL: Record<string, string> = {
  'Re-stow': 're_stow',
  'Find replacement': 'find_replacement',
  Discard: 'discard',
  'Write off': 'write_off',
  Quarantine: 'quarantine',
};

type Case = { source: string; exceptionType: string };

/** Types with no verified safe generic resolution action. */
const NO_SAFE_ACTION: Case[] = [
  { source: 'pick', exceptionType: 'gh1238_unknown_type' },
  { source: 'reconciliation', exceptionType: 'fulfillment_location_not_found' },
  { source: 'reconciliation', exceptionType: 'fulfillment_location_ambiguous' },
  { source: 'count', exceptionType: 'recount_variance' },
];

/** Every type the dialog can meet, including the no-safe-action ones. */
const ALL_TYPES: Case[] = [
  ...NO_SAFE_ACTION,
  { source: 'stow', exceptionType: 'bin_over_capacity' },
  { source: 'returns', exceptionType: 'return_shortfall' },
  { source: 'returns', exceptionType: 'repackaging_required' },
  { source: 'pick', exceptionType: 'order_cancelled' },
  { source: 'pick', exceptionType: 'item_missing' },
  { source: 'pick', exceptionType: 'short_pick' },
  { source: 'pick', exceptionType: 'product_defect' },
  { source: 'pick', exceptionType: 'packaging_defect' },
  { source: 'pick', exceptionType: 'wrong_item' },
  { source: 'receive', exceptionType: 'receive_rejection' },
];

const PROB_LABEL = 'PROB-1238-0001';

function renderTask({ source, exceptionType }: Case) {
  const onResolve = jest.fn().mockResolvedValue(undefined);
  const { unmount } = render(
    <ProblemCenterModuleFT2
      data={{
        tasks: [
          {
            problem_task_id: '12381238-1238-4238-8238-123812381238',
            lasyncro_variant_id: 'aaaaaaaa-1238-4238-8238-123812381238',
            exception_type: exceptionType,
            source: source as any,
            quantity: 1,
            prob_label: PROB_LABEL,
            problem_bin_location: 'GH1238-PROB',
            status: 'open',
            created_at: '2026-10-10T08:00:00.000Z',
            variant_title: 'GH1238 Widget',
            sku: 'SKU-GH1238',
          },
        ],
        total_unresolved: 1,
      }}
      isLoading={false}
      isError={false}
      onResolve={onResolve}
      onRefresh={jest.fn()}
      canResolve
    />,
  );
  return { onResolve, unmount };
}

const detail = () => screen.getByRole('region', { name: 'Exception detail' });

/** Every button in the detail panel (V2 decision controls). */
const detailButtons = () => within(detail()).queryAllByRole('button');

/** Offered resolution actions, in their visible order. Fails on an unknown control. */
function offeredActions(): string[] {
  return detailButtons().map((b) => {
    const label = (b.textContent ?? '').trim();
    expect(Object.keys(ACTION_BY_LABEL)).toContain(label);
    return ACTION_BY_LABEL[label];
  });
}

/** Click an offered action and, if it asks for confirmation, confirm it. */
async function submitOffered(label: string) {
  fireEvent.click(within(detail()).getByRole('button', { name: label }));
  const group = within(detail()).queryByRole('group', { name: 'Confirm action' });
  if (group) fireEvent.click(within(group).getByRole('button', { name: label }));
}

describe('GH-1238 E1 — no actionable generic Resolve for types without a verified safe action', () => {
  it.each(NO_SAFE_ACTION.map((c) => [`${c.source}/${c.exceptionType}`, c] as const))(
    'E1 EXPECTED RED: %s — task stays visible in a non-destructive state with no Resolve CTA',
    (_label, c) => {
      renderTask(c);

      expect(within(detail()).getByText(PROB_LABEL)).toBeInTheDocument();
      expect(detailButtons()).toHaveLength(0);
    },
  );
});

describe('GH-1238 E2 — the dialog never submits an action that is not visibly offered', () => {
  it.each(ALL_TYPES.map((c) => [`${c.source}/${c.exceptionType}`, c] as const))(
    'E2 %s — each offered control submits exactly its own offered action',
    async (_label, c) => {
      const probe = renderTask(c);
      const offered = offeredActions();
      probe.unmount();

      for (const action of offered) {
        const { onResolve, unmount } = renderTask(c);
        const label = Object.keys(ACTION_BY_LABEL).find((l) => ACTION_BY_LABEL[l] === action)!;
        await submitOffered(label);
        await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));

        const submitted = onResolve.mock.calls[0][1];
        expect({ submitted, offered: offered.includes(submitted) }).toEqual({ submitted: action, offered: true });
        unmount();
      }
    },
  );

  it('E2 GREEN CONTROL: pick/item_missing — an explicitly selected offered action is the one submitted', async () => {
    const { onResolve } = renderTask({ source: 'pick', exceptionType: 'item_missing' });

    await submitOffered('Find replacement');

    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve.mock.calls[0][1]).toBe('find_replacement');
  });
});

describe('GH-1238 E3 — no false inventory claim for Quarantine', () => {
  it('E3 EXPECTED RED: pick/item_missing — the detail does not claim Quarantine makes "No inventory change"', async () => {
    renderTask({ source: 'pick', exceptionType: 'item_missing' });

    expect(within(detail()).queryByText(/No inventory change/i)).toBeNull();
  });
});

// GH-1238 correction: an ordinary Pick incident's missing/defective units stay
// RESERVED at the allocation location and no path settles that reservation
// yet (GH-1240). Write Off / Discard are therefore not offered for them.
describe('GH-1238 E4 — no ordinary Pick disposition while the residual reservation is unsettled', () => {
  it.each(['item_missing', 'short_pick'])(
    'E4 pick/%s — only Find replacement (investigation) is offered, never Write off or Discard',
    async (exceptionType) => {
      renderTask({ source: 'pick', exceptionType });

      expect(offeredActions()).toEqual(['find_replacement']);
    },
  );

  it.each(['product_defect', 'packaging_defect'])(
    'E4 pick/%s — no Resolve CTA; a truthful investigation state instead',
    (exceptionType) => {
      renderTask({ source: 'pick', exceptionType });

      expect(detailButtons()).toHaveLength(0);
      expect(within(detail()).getAllByText('Needs investigation').length).toBeGreaterThan(0);
    },
  );
});
