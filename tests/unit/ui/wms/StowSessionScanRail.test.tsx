// STOW-UX-SCAN-RAIL-01
//
// Permanent contracts for the single LOCATION -> ITEM -> REGISTERED
// execution rail, duplicate-UI removal, the canonical current-bin activity
// trace, and the already-approved sticky-destination / wrong-location /
// next-task behaviors.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StowSessionPage, { STOW_REGISTERED_ACK_MS, type StowPlacement } from '../../../../modules/wms/src/ui/pages/StowSessionPage';
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
  resolveResult?: Record<string, unknown>;
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
      ...options.resolveResult,
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
    // Fake clock: the 1.5 s acknowledgement cannot lapse mid-assertion under load.
    jest.useFakeTimers();
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
    jest.useFakeTimers();
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

afterEach(() => {
  jest.useRealTimers();
});

describe('SF-STOW-UX-REFINEMENT-01 — connected progress indicator', () => {
  const ITEM_HINT = 'Scan item barcode (LSU- or product barcode)';

  function scanItem(value: string) {
    const input = screen.getByPlaceholderText(ITEM_HINT);
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    return input;
  }

  it('is one ordered indicator: Location → Scan Item → Registered, active step pulses', async () => {
    renderSession({ tasks: [task({ status: 'pending', location_code: 'BIN-A' })], initialStep: 'location' });
    await screen.findByPlaceholderText('Scan bin barcode or type location code');

    const rail = screen.getByRole('list', { name: 'Stow progress' });
    const steps = within(rail).getAllByRole('listitem');
    expect(steps.map((step) => step.getAttribute('data-testid'))).toEqual([
      'stow-stage-location',
      'stow-stage-items',
      'stow-stage-complete',
    ]);
    expect(steps[1]).toHaveTextContent('Scan Item');
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('stow-stage-location-node')).toHaveAttribute('data-pulse', 'true');
    expect(screen.getByTestId('stow-stage-items-node')).toHaveAttribute('data-pulse', 'false');
    expect(screen.getByTestId('stow-stage-complete-node')).toHaveAttribute('data-pulse', 'false');
  });

  it('completed Location is green and still; Scan Item takes the pulse', async () => {
    renderSession({ tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })] });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-location-node')).toHaveAttribute('data-pulse', 'false');
    expect(screen.getByTestId('stow-stage-location-node')).toHaveTextContent('✓');
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('stow-stage-items-node')).toHaveAttribute('data-pulse', 'true');
  });

  it('after Registered, returns to Scan Item on its own; destination and scanner focus are kept', async () => {
    jest.useFakeTimers();
    expect(STOW_REGISTERED_ACK_MS).toBe(1500);
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 3, quantity_placed: 0 })],
    });
    await screen.findByPlaceholderText(ITEM_HINT);
    const input = scanItem('LSU-8F31AAAA');

    // Settle the confirm without moving the clock, so time is exact from here.
    for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'complete');

    act(() => { jest.advanceTimersByTime(STOW_REGISTERED_ACK_MS - 1); });
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'complete');

    // No operator action: the acknowledgement lapses back to Scan Item.
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-A');
    expect(screen.getByPlaceholderText(ITEM_HINT)).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('Back to the brief and Resume keeps an already-scanned destination green, never orange', async () => {
    renderSession({ tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })] });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');

    fireEvent.click(screen.getByRole('button', { name: 'Back to stow session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume stowing' }));

    // The existing resume contract still lands on the bin screen.
    await screen.findByPlaceholderText('Scan bin barcode or type location code');
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-location')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('stow-stage-location-node')).toHaveAttribute('data-pulse', 'false');
    expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-A');
  });

  it('location switching lives in a quiet hint beside the completed Location step only', async () => {
    renderSession({ tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A' })] });
    await screen.findByPlaceholderText(ITEM_HINT);

    const location = screen.getByTestId('stow-stage-location');
    const hint = within(location).getByTestId('stow-location-switch-hint');
    // Not focusable, so a hardware scan can never land on it.
    expect(hint).not.toHaveAttribute('tabindex');
    expect(hint.tagName).toBe('SPAN');
    expect(location).toHaveTextContent('To switch destination, scan another bin.');
    expect(screen.getByTestId('stow-directions')).not.toHaveTextContent(/switch destination/i);

    fireEvent.mouseOver(hint);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('To switch destination, scan another bin.');
  });

  it('shows no switch hint while the destination is still unscanned', async () => {
    renderSession({ tasks: [task({ status: 'pending', location_code: 'BIN-A' })], initialStep: 'location' });
    await screen.findByPlaceholderText('Scan bin barcode or type location code');
    expect(screen.queryByTestId('stow-location-switch-hint')).not.toBeInTheDocument();
  });
});

describe('SF-STOW-UX-REFINEMENT-01 — product barcode', () => {
  const ITEM_HINT = 'Scan item barcode (LSU- or product barcode)';
  const EAN = '7350012345678';

  async function placeWith(taskOverrides: Partial<WmsStowTask>, scanned: string, resolveResult: Record<string, unknown> = {}) {
    renderSession({
      tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', quantity: 3, quantity_placed: 0, ...taskOverrides })],
      resolveResult,
    });
    const input = await screen.findByPlaceholderText(ITEM_HINT);
    fireEvent.change(input, { target: { value: scanned } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    return screen.findByText(/^Unit placed · LSU-8F31AAAA/);
  }

  describe('before scanning (item line: LSUs → barcode → SKU)', () => {
    async function itemLine(taskOverrides: Partial<WmsStowTask>) {
      renderSession({ tasks: [task({ status: 'in_progress', claimed_by: 7, location_code: 'BIN-A', ...taskOverrides })] });
      await screen.findByPlaceholderText(ITEM_HINT);
    }
    const lsus = () => Array.from(screen.queryByTestId('stow-item-lsus')?.querySelectorAll('li') ?? []).map((li) => li.textContent);

    it('ordinary Stow shows its LSUs, then the eligible product barcode, then the SKU apart', async () => {
      await itemLine({ barcode: EAN, sku: 'RAIL-1', unit_ids: ['LSU-AAA00001'] });
      expect(lsus()).toEqual(['LSU-AAA00001']);
      expect(screen.getByTestId('stow-item-barcode')).toHaveTextContent(new RegExp(`^Barcode ${EAN}$`));
      expect(screen.getByTestId('stow-item-sku')).toHaveTextContent(/^SKU RAIL-1$/);
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['blank', '   '],
    ])('with the barcode %s, shows no barcode line and never substitutes the SKU', async (_label, barcode) => {
      await itemLine({ barcode: barcode as string | null | undefined, sku: 'RAIL-1', unit_ids: ['LSU-AAA00001'] });
      expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
      expect(lsus()).toEqual(['LSU-AAA00001']);
      expect(screen.getByTestId('stow-item-lsus')).not.toHaveTextContent('RAIL-1');
      expect(document.body.textContent).not.toMatch(/SKU unavailable|No product barcode/);
    });

    it('with no barcode and no SKU, still names no identity it does not have', async () => {
      await itemLine({ barcode: null, sku: null, unit_ids: ['LSU-AAA00001'] });
      expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stow-item-sku')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/SKU unavailable/);
    });

    it.each(['receive_recovery'])(
      'exact-LSU recovery (%s) shows only the required LSU, never the product barcode',
      async (trigger) => {
        await itemLine({ trigger, barcode: EAN, unit_ids: ['LSU-REQ00001'] });
        expect(lsus()).toEqual(['LSU-REQ00001']);
        expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain(EAN);
      },
    );

    it('cancellation recovery with a declared unit is exact-LSU too', async () => {
      await itemLine({ trigger: 'order_cancelled_mid_pick', barcode: EAN, unit_ids: ['LSU-CXL00001'] });
      expect(lsus()).toEqual(['LSU-CXL00001']);
      expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(EAN);
    });
  });

  describe('after a committed scan', () => {
    it('names the barcode only when the scan exactly matched the task barcode', async () => {
      expect(await placeWith({ barcode: EAN }, EAN, { resolution_method: 'barcode' })).toHaveTextContent(
        new RegExp(`^Unit placed · LSU-8F31AAAA · Barcode ${EAN}$`),
      );
    });

    it.each([
      ['an LSU scan of a task that has a barcode', { barcode: EAN }, 'LSU-8F31AAAA', { resolution_method: 'unit_barcode' }],
      ['a resolver "barcode" match on an SKU-like value (identity map)', { barcode: null }, 'RAIL-1', { resolution_method: 'barcode' }],
      ['a resolver "barcode" match that differs from the task barcode', { barcode: EAN }, '0000000000000', { resolution_method: 'barcode' }],
      ['an LSP- product identity', { barcode: null }, 'LSP-RAIL0001', { resolution_method: 'product_barcode' }],
    ])('never names a barcode for %s', async (_label, taskOverrides, scanned, resolveResult) => {
      const line = await placeWith(taskOverrides as Partial<WmsStowTask>, scanned, resolveResult);
      expect(line).toHaveTextContent(/^Unit placed · LSU-8F31AAAA$/);
    });

    it('an exact-LSU recovery never names a product barcode, even with one on the task', async () => {
      const line = await placeWith(
        { trigger: 'receive_recovery', barcode: EAN, unit_ids: ['LSU-8F31AAAA'] },
        'LSU-8F31AAAA',
        { resolution_method: 'unit_barcode' },
      );
      expect(line).toHaveTextContent(/^Unit placed · LSU-8F31AAAA$/);
    });
  });
});
