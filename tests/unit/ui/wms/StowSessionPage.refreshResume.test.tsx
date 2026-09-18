import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import type { WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const pendingTask: WmsStowTask = {
  stow_task_id: 'stow-pending-1',
  status: 'pending',
  trigger: 'inbound_stock',
  lasyncro_variant_id: 'variant-1',
  quantity: 3,
  quantity_placed: 0,
  location_code: null,
  product_title: 'Pending Widget',
  variant_title: 'Pending Widget / Blue',
  sku: 'PENDING-1',
  image_url: null,
  unit_ids: [],
} as WmsStowTask;

const inProgressTask: WmsStowTask = {
  ...pendingTask,
  stow_task_id: 'stow-progress-1',
  status: 'in_progress',
  quantity: 3,
  quantity_placed: 1,
  location_code: 'BIN-A',
  product_title: 'Progress Widget',
  variant_title: 'Progress Widget / Blue',
  sku: 'PROGRESS-1',
} as WmsStowTask;

function renderSession(task: WmsStowTask) {
  const props = {
    initialTaskId: task.stow_task_id,
    onComplete: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue([task]),
    onResolveLocation: jest.fn().mockResolvedValue(null),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: task.lasyncro_variant_id,
      lasyncro_unit_id: 'LSU-1',
    }),
    onConfirmStow: jest.fn().mockResolvedValue({
      stow_task_id: task.stow_task_id,
      quantity_total: task.quantity,
      quantity_placed: task.quantity_placed + 1,
      is_fully_placed: false,
    }),
  };

  render(<StowSessionPage {...props} />);
  return props;
}

describe('STOW-LIFECYCLE-03 — StowSessionPage refresh-safe claimed sessions', () => {
  it('keeps pending initial tasks on the brief with claim-forward CTA and no bootstrap claim', async () => {
    const props = renderSession(pendingTask);

    expect(await screen.findByText('Stow Session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim & start stowing' })).toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('enters location scan from the pending CTA without claiming before a valid location', async () => {
    const props = renderSession(pendingTask);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim & start stowing' }));

    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Scan bin barcode or type location code'), {
      target: { value: 'ITEM-BARCODE' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Scan bin barcode or type location code'), {
      key: 'Enter',
      code: 'Enter',
    });

    await waitFor(() => {
      expect(screen.getByText('Bin not recognised. Scan the bin label again.')).toBeInTheDocument();
    });
    expect(props.onClaimTask).not.toHaveBeenCalled();
  });

  it('restores an in-progress initial task directly into item scan with persisted destination and remaining work', async () => {
    const props = renderSession(inProgressTask);

    expect(await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)')).toBeInTheDocument();
    expect(screen.queryByText('Stow Session')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume stowing' })).not.toBeInTheDocument();
    expect(screen.getAllByText('BIN-A').length).toBeGreaterThan(0);
    // STOW-UX-SCAN-RAIL-01 — the standalone active-bin card (and its
    // "placed here · remaining" copy) was removed as duplicated UI; the
    // same committed progress now lives on the rail's Registered stage.
    expect(screen.getByText('1 / 3 placed')).toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('uses restored location when scanning a unit after refresh instead of failing no-active-location', async () => {
    const props = renderSession(inProgressTask);

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onConfirmStow).toHaveBeenCalledWith('stow-progress-1', 1, 'LSU-1');
    });
    expect(screen.queryByText('Scan a bin barcode first, then scan the unit.')).not.toBeInTheDocument();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
  });
});

describe('STOW-SESSION-TRANSITION-01 — refresh reconstructs the newly persisted Task B directly, no Brief fallback', () => {
  it('a persisted pending Task B with stowStep=location restores directly into location scan', async () => {
    const taskB: WmsStowTask = {
      ...pendingTask,
      stow_task_id: 'stow-task-b',
      status: 'pending',
      location_code: null,
      product_title: 'Task B Widget',
    } as WmsStowTask;

    const props = {
      initialTaskId: taskB.stow_task_id,
      initialStep: 'location' as const,
      onComplete: jest.fn(),
      onFetchTasks: jest.fn().mockResolvedValue([taskB]),
      onResolveLocation: jest.fn().mockResolvedValue(null),
      onAssignLocation: jest.fn().mockResolvedValue(undefined),
      onClaimTask: jest.fn().mockResolvedValue(undefined),
      onResolveBarcode: jest.fn().mockResolvedValue({
        lasyncro_variant_id: taskB.lasyncro_variant_id,
        lasyncro_unit_id: 'LSU-1',
      }),
      onConfirmStow: jest.fn(),
    };

    render(<StowSessionPage {...props} />);

    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(screen.queryByText('Stow Session')).not.toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();
  });

  it('a persisted in_progress Task B with a destination restores directly into item scan with committed progress, no Brief fallback', async () => {
    const taskB: WmsStowTask = {
      ...inProgressTask,
      stow_task_id: 'stow-task-b',
      quantity: 4,
      quantity_placed: 2,
      location_code: 'B-4',
      product_title: 'Task B Widget',
    } as WmsStowTask;

    const props = renderSession(taskB);

    expect(await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)')).toBeInTheDocument();
    expect(screen.queryByText('Stow Session')).not.toBeInTheDocument();
    expect(screen.getAllByText('B-4').length).toBeGreaterThan(0);
    expect(screen.getByText('2 / 4 placed')).toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
  });
});
