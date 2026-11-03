// tests/unit/ui/problem-center/ProblemCenterModuleFT2.recovery-sync-safety015.test.tsx
//
// SF-RECEIVE-PC-RELEASE-SAFETY-015 — Problem Center presentation of the
// recovery sync safety guard. The backend is authoritative (409
// RECEIVE_RECOVERY_SYNC_UNAVAILABLE); the module only explains and never
// pretends a refused or pending recovery succeeded.
//
//   T16 recovery unavailable (shop reason or unmapped variant): Approve
//       recovery is shown disabled with the reason, never submitted; Discard
//       and Write off stay available; the next step does not steer to Discard.
//   T17 a server 409 RECEIVE_RECOVERY_SYNC_UNAVAILABLE is surfaced with the
//       reason, the queue is refreshed and no success state appears.
//   T18 a recovered unit claims Shopify only when its I4 row proves it:
//       pending (or not yet discovered) → "Shopify update pending";
//       succeeded / skipped_included → "Shopify updated".
//
// Harness: REAL ProblemCenterModuleFT2 source (same as v2-recovery-i5).

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProblemCenterModuleFT2, {
  type ProblemCenterModuleFT2Props,
  type ProblemTask,
  type RecoverySync,
} from '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2';

const LSU = 'LSU-S015-HELD-0001';

const base = (over: Partial<ProblemTask>): ProblemTask => ({
  problem_task_id: '01501501-1515-4515-8515-151515151515',
  lasyncro_variant_id: 'bbbbbbbb-0150-4515-8515-151515151515',
  exception_type: 'defect',
  source: 'receive',
  quantity: 1,
  prob_label: null,
  problem_bin_location: 'PROB-BIN-01',
  status: 'open',
  created_at: '2026-11-03T06:00:00.000Z',
  variant_title: 'Default Title',
  sku: 'SKU-S015',
  product_title: 'Heavyweight tee',
  lasyncro_unit_id: LSU,
  unit_status: 'held',
  unit_location_code: 'PROB-BIN-01',
  receive_custody_verified: true,
  receive_job_id: 'cccccccc-0150-4515-8515-151515151515',
  receive_job_status: 'closed',
  recovery_stow_task_id: null,
  recovery_stow_status: null,
  variant_sync_mapped: true,
  recovery_sync_status: null,
  ...over,
});

const AVAILABLE: RecoverySync = { available: true, reason: null };

function renderModule(tasks: ProblemTask[], recoverySync: RecoverySync | null, over: Partial<ProblemCenterModuleFT2Props> = {}) {
  const props: ProblemCenterModuleFT2Props = {
    data: { tasks, total_unresolved: tasks.length, recovery_sync: recoverySync },
    isLoading: false,
    isError: false,
    onResolve: jest.fn().mockResolvedValue({}),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onOpenStowTask: jest.fn(),
    canResolve: true,
    currentUserId: 7,
    ...over,
  };
  render(<ProblemCenterModuleFT2 {...props} />);
  return props;
}

const detail = () => screen.getByRole('region', { name: 'Exception detail' });
const approve = () => within(detail()).getByRole('button', { name: /Approve recovery/ });

describe('T16 — unavailable recovery is explained, disabled and never submitted', () => {
  it.each([
    ['SYNC_DISABLED', /Shopify inventory sync for recovered items is active/],
    ['NO_CONVERGED_CUTOVER', /Shopify inventory sync for recovered items is active/],
    ['SHOPIFY_NOT_CONNECTED', /Reconnect Shopify/],
    ['SHOPIFY_DISCONNECTED', /Reconnect Shopify/],
  ])('shop reason %s', async (reason, text) => {
    const props = renderModule([base({})], { available: false, reason });

    expect(approve()).toBeDisabled();
    expect(within(detail()).getByTestId('pc-recovery-unavailable')).toHaveTextContent(text);
    fireEvent.click(approve());
    expect(props.onResolve).not.toHaveBeenCalled();

    // Disposal stays available; the next step does not steer to Discard.
    expect(within(detail()).getByRole('button', { name: 'Discard' })).toBeEnabled();
    expect(within(detail()).getByRole('button', { name: 'Write off' })).toBeEnabled();
    expect(screen.getAllByText('Return to stock unavailable · item stays held').length).toBeGreaterThan(0);
    expect(screen.queryByText('Next: Discard')).toBeNull();

    fireEvent.click(within(detail()).getByRole('button', { name: 'Discard' }));
    const group = within(detail()).getByRole('group', { name: 'Confirm action' });
    fireEvent.click(within(group).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledWith(base({}).problem_task_id, 'discard', ''));
  });

  it('an unmapped variant disables recovery even when the shop is eligible', () => {
    const props = renderModule([base({ variant_sync_mapped: false })], AVAILABLE);
    expect(approve()).toBeDisabled();
    expect(within(detail()).getByTestId('pc-recovery-unavailable')).toHaveTextContent(/isn't linked to a Shopify inventory item/);
    fireEvent.click(approve());
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('an eligible shop and mapped variant keep Approve recovery enabled with its hint', () => {
    renderModule([base({})], AVAILABLE);
    expect(approve()).toBeEnabled();
    expect(within(detail()).queryByTestId('pc-recovery-unavailable')).toBeNull();
  });
});

describe('T17 — server refusal is surfaced without a success state', () => {
  it('409 RECEIVE_RECOVERY_SYNC_UNAVAILABLE shows the reason, refreshes, and stays a decision', async () => {
    const onResolve = jest.fn().mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: 'Recovery to stock is unavailable until Shopify inventory sync is ready',
          code: 'RECEIVE_RECOVERY_SYNC_UNAVAILABLE',
          reason: 'SYNC_DISABLED',
        },
      },
    });
    const props = renderModule([base({})], AVAILABLE, { onResolve });

    fireEvent.click(approve());

    const alert = await within(detail()).findByRole('alert');
    expect(alert).toHaveTextContent(/Shopify inventory sync for recovered items is active/);
    expect(alert).toHaveTextContent('Nothing was approved. The queue has been refreshed.');
    expect(props.onRefresh).toHaveBeenCalled();
    expect(within(detail()).getAllByText('Needs decision').length).toBeGreaterThan(0);
    expect(within(detail()).queryByText(/Awaiting Stow|Recovered/)).toBeNull();
  });
});

describe('T18 — Shopify is claimed only when its I4 row proves it', () => {
  const recovered = (recovery_sync_status: string | null) => base({
    status: 'resolved', resolution_action: 're_stow', resolved_at: '2026-11-03T08:00:00.000Z',
    unit_status: 'stowed', unit_location_code: 'A-02-06',
    recovery_stow_task_id: 'aaaaaaaa-0150-4000-8000-0000000000a5', recovery_stow_status: 'completed',
    recovery_stow_location_code: 'A-02-06', recovery_sync_status,
  });

  it.each([
    [null, '+1 credited at A-02-06 · Shopify update pending'],
    ['pending', '+1 credited at A-02-06 · Shopify update pending'],
    ['ambiguous', '+1 credited at A-02-06 · Shopify update pending'],
    ['held_expired', '+1 credited at A-02-06 · Shopify update pending'],
    ['succeeded', '+1 credited at A-02-06 · Shopify updated'],
    ['skipped_included', '+1 credited at A-02-06 · Shopify updated'],
  ])('sync status %s', (status, text) => {
    renderModule([recovered(status)], AVAILABLE);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'resolved' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Exceptions' })).getAllByRole('option')[0]);
    expect(within(detail()).getByTestId('pc-inventory')).toHaveTextContent(text);
  });
});
