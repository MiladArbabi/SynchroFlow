// STOW-UX-SCAN-RAIL-01
//
// Permanent contracts for the single LOCATION -> ITEM -> REGISTERED
// execution rail, duplicate-UI removal, the canonical current-bin activity
// trace, and the already-approved sticky-destination / wrong-location /
// next-task behaviors.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage, { type StowPlacement } from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import type { WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

function task(overrides: Partial<WmsStowTask>): WmsStowTask {
  return {
    stow_task_id: 'stow-a',
    status: 'pending',
    trigger: 'inbound_stock',
    lasyncro_variant_id: 'variant-a',
    quantity: 3,
    quantity_placed: 0,
    location_code: 'BIN-A',
    product_title: 'Rail Widget',
    variant_title: 'Rail Widget / Blue',
    sku: 'RAIL-1',
    image_url: null,
    unit_ids: [],
    assigned_operator_id: null,
    assigned_operator_name: null,
    claimed_by: null,
    claimed_at: null,
    created_at: '2026-09-17T00:00:00Z',
    ...overrides,
  } as WmsStowTask;
}

function placement(overrides: Partial<StowPlacement>): StowPlacement {
  return {
    lasyncro_unit_id: 'LSU-8F31AAAA',
    lasyncro_variant_id: 'variant-a',
    product_title: 'Rail Widget',
    variant_title: 'Rail Widget / Blue',
    sku: 'RAIL-1',
    location_code: 'BIN-A',
    operator_id: 7,
    operator_name: 'Operator Dev',
    occurred_at: '2026-09-17T15:41:19.000Z',
    ...overrides,
  };
}

function renderSession(options: {
  tasks: WmsStowTask[];
  initialTaskId?: string;
  initialStep?: 'location' | null;
  currentUserId?: number | null;
  confirmFullyPlaced?: boolean;
  confirmRejects?: boolean;
  placementsByTask?: Record<string, StowPlacement[]>;
  placementsError?: boolean;
}) {
  const focusTask = options.tasks.find((t) => t.stow_task_id === options.initialTaskId) ?? options.tasks[0];
  const onConfirmStow = options.confirmRejects
    ? jest.fn().mockRejectedValue(
        Object.assign(new Error('Confirm failed'), {
          response: { data: { error: 'Backend rejected this unit.' } },
        })
      )
    : jest.fn().mockResolvedValue({
        stow_task_id: focusTask.stow_task_id,
        quantity_total: focusTask.quantity,
        quantity_placed: options.confirmFullyPlaced ? focusTask.quantity : focusTask.quantity_placed + 1,
        is_fully_placed: Boolean(options.confirmFullyPlaced),
      });

  const onFetchPlacements = jest.fn().mockImplementation(async (taskId: string) => {
    if (options.placementsError) throw new Error('Placement fetch failed');
    return options.placementsByTask?.[taskId] ?? [];
  });

  const props = {
    initialTaskId: options.initialTaskId ?? focusTask.stow_task_id,
    initialStep: options.initialStep ?? null,
    currentUserId: options.currentUserId ?? 7,
    onComplete: jest.fn(),
    onActiveTaskChange: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue(options.tasks),
    onResolveLocation: jest.fn().mockImplementation(async (value: string) =>
      value.startsWith('BIN-') ? { location_code: value } : null
    ),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: focusTask.lasyncro_variant_id,
      lasyncro_unit_id: 'LSU-8F31AAAA',
    }),
    onConfirmStow,
    onFetchPlacements,
  };

  render(<StowSessionPage {...props} />);
  return props;
}

describe('STOW-UX-SCAN-RAIL-01 — LOCATION -> ITEM -> REGISTERED rail', () => {
  it('(1) before destination: Location active, Item pending, Registered pending', async () => {
    renderSession({ tasks: [task({ status: 'pending' })] });

    fireEvent.click(await screen.findByRole('button', { name: 'Claim & start stowing' }));
    await screen.findByPlaceholderText('Scan bin barcode or type location code');

    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'pending');
  });

  it('(2) after valid destination: Location complete with exact bin, Item active', async () => {
    renderSession({ tasks: [task({ status: 'pending' })], initialStep: 'location' });

    const input = await screen.findByPlaceholderText('Scan bin barcode or type location code');
    fireEvent.change(input, { target: { value: 'BIN-A' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    });
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-A');
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');
  });

  it('(3) the standalone ACTIVE destination card is absent during execution', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
    });

    await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');

    expect(screen.queryByText('Scan a bin barcode to begin.')).not.toBeInTheDocument();
    expect(screen.queryByText('INACTIVE')).not.toBeInTheDocument();
    expect(screen.queryByText(/placed here/)).not.toBeInTheDocument();
  });

  it('(4) the standalone duplicate product/action card is absent — SKU appears once, not twice', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', sku: 'RAIL-UNIQUE-1' })],
    });

    await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');

    // identityBanner alone carries SKU now; the removed card used to repeat it.
    expect(screen.getAllByText('RAIL-UNIQUE-1')).toHaveLength(1);
  });

  it('(5) successful onConfirmStow: Item and Registered both show committed success', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 3, quantity_placed: 0 })],
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'complete');
    });
    expect(screen.getByTestId('stow-stage-items')).toHaveTextContent('LSU-8F31AAAA');
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-complete')).toHaveTextContent('BIN-A');
  });

  it('(6) failed onConfirmStow never shows Registered success', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
      confirmRejects: true,
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // getStowOperatorError translates unrecognised backend errors into a
    // stable generic operator message — assert that surfaced copy, not the
    // raw backend string.
    await waitFor(() => {
      expect(
        screen.getByText('That scan could not be completed. Check the unit label and try again.')
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('stow-stage-items')).not.toHaveAttribute('data-state', 'complete');
  });

  it('(7) after a committed unit, the next scanner action returns Item to active while Location stays sticky/complete', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 3, quantity_placed: 0 })],
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'complete');
    });

    // No extra click — the next scanner action itself is what advances the
    // rail, per the existing "clear feedback at the start of the next scan"
    // convention.
    fireEvent.change(input, { target: { value: 'unrecognised' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');
    });
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-A');
  });

  it('(8) STOW-ACTIVE-LOCATION-01: a different valid bin while in_progress switches the active destination — no re-claim, no confirm', async () => {
    const props = renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'BIN-B' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onAssignLocation).toHaveBeenCalledWith('stow-a', 'BIN-B');
    });

    // The switch itself never claims again or commits any unit.
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();

    // Rail/identity destination becomes BIN-B; phase remains item_scan.
    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-B');
    });
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');

    // quantity unchanged — no confirm occurred.
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'pending');
  });

  it('(8b) STOW-ACTIVE-LOCATION-01: after switching to BIN-B, an eligible LSU scan commits at BIN-B and the committed placement refresh reflects it', async () => {
    const props = renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 2, quantity_placed: 0 })],
      placementsByTask: {
        'stow-a': [placement({ location_code: 'BIN-B' })],
      },
    });

    const binInput = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(binInput, { target: { value: 'BIN-B' } });
    fireEvent.keyDown(binInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onAssignLocation).toHaveBeenCalledWith('stow-a', 'BIN-B');
    });

    const itemInput = screen.getByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(itemInput, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(itemInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onConfirmStow).toHaveBeenCalledWith('stow-a', 1, 'LSU-8F31AAAA');
    });

    // BIN-B remains active after the confirm.
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-B');

    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('registered in BIN-B');
    });
  });

  it('(8c) STOW-ACTIVE-LOCATION-01: re-scanning the already-active bin is a no-op — no assignment/claim/confirm calls', async () => {
    const props = renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'BIN-A' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Give the scanner action a tick to resolve, then assert nothing fired.
    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');
    });
    expect(props.onAssignLocation).not.toHaveBeenCalled();
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-A');
  });

  it('(9) a pending next task does not inherit the previous task\'s destination', async () => {
    renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 1, quantity_placed: 0 }),
        task({ stow_task_id: 'stow-b', status: 'pending', location_code: 'BIN-Z', assigned_operator_id: 7 }),
      ],
      initialTaskId: 'stow-a',
      confirmFullyPlaced: true,
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await screen.findByPlaceholderText('Scan bin barcode or type location code');
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'active');
    expect(screen.queryByText('BIN-A')).not.toBeInTheDocument();
  });
});

describe('STOW-UX-SCAN-RAIL-01 — canonical current-bin activity', () => {
  it('(10) shows canonical LSU, operator, occurred_at, and destination', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
      placementsByTask: {
        'stow-a': [placement({})],
      },
    });

    await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');

    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toBeInTheDocument();
    });
    const activity = screen.getByTestId('stow-bin-activity');
    expect(activity).toHaveTextContent('registered in BIN-A');
    expect(activity).toHaveTextContent('Operator Dev');
    // Full LSU remains accessible even if visually shortened.
    expect(activity.querySelector('[title="LSU-8F31AAAA"]')).not.toBeNull();
  });

  it('(11) a failed placement fetch does not fabricate activity', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })],
      placementsError: true,
    });

    await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');

    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent(
      'Activity history is unavailable right now. Stow scanning is unaffected.'
    );
    expect(screen.queryByText(/registered in BIN-A/)).not.toBeInTheDocument();
    // Trace outage must not block scanning.
    expect(screen.getByPlaceholderText('Scan item barcode (LSU- or product barcode)')).not.toBeDisabled();
  });

  it('(12) a successful confirm triggers a canonical placement refresh', async () => {
    const props = renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 2, quantity_placed: 0 })],
    });

    await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    const callsBeforeConfirm = props.onFetchPlacements.mock.calls.length;

    const input = screen.getByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onFetchPlacements.mock.calls.length).toBeGreaterThan(callsBeforeConfirm);
    });
  });

  it('(13) refresh/re-entry into an in-progress task reconstructs activity from the fetched placements', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity_placed: 2 })],
      placementsByTask: {
        'stow-a': [
          placement({ lasyncro_unit_id: 'LSU-AAAA1111' }),
          placement({ lasyncro_unit_id: 'LSU-BBBB2222' }),
        ],
      },
    });

    // No scan performed — this proves the panel reconstructs purely from the
    // canonical read endpoint on mount, not from local scanner history.
    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('Stow activity · 2 registered');
    });
  });

  it('(14) task advancement switches the activity feed to the new task, never leaking the previous task\'s rows', async () => {
    renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 1, quantity_placed: 0 }),
        task({ stow_task_id: 'stow-b', status: 'in_progress', claimed_by: 7, location_code: 'BIN-Z', quantity: 1, quantity_placed: 0 }),
      ],
      initialTaskId: 'stow-a',
      confirmFullyPlaced: true,
      placementsByTask: {
        'stow-a': [placement({ lasyncro_unit_id: 'LSU-TASKA0001', location_code: 'BIN-A' })],
        'stow-b': [placement({ lasyncro_unit_id: 'LSU-TASKB0001', location_code: 'BIN-Z' })],
      },
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-8F31AAAA' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Wait for the actual row content to switch, not just the header count
    // (both tasks' placement lists happen to have length 1, so the header
    // text alone would match before the new task's fetch resolves).
    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('LSU-TASKB0001');
    });
    expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('Stow activity · 1 registered');
    expect(screen.getByTestId('stow-bin-activity')).not.toHaveTextContent('LSU-TASKA0001');
  });

  it('(15) STOW-ACTIVE-LOCATION-01: existing BIN-A rows remain visible in the activity panel after BIN-B becomes active', async () => {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 3, quantity_placed: 2 })],
      placementsByTask: {
        'stow-a': [
          placement({ lasyncro_unit_id: 'LSU-AAAA1111', location_code: 'BIN-A' }),
          placement({ lasyncro_unit_id: 'LSU-BBBB2222', location_code: 'BIN-A' }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('Stow activity · 2 registered');
    });

    const input = screen.getByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'BIN-B' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-B');
    });

    // The task-wide activity panel is not re-filtered by the newly active
    // bin — the two BIN-A rows already registered by this task must not
    // disappear merely because BIN-B is now active.
    expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('registered in BIN-A');
    expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('Stow activity · 2 registered');
  });
});
