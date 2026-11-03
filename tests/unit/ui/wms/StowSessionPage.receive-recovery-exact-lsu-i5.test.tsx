// tests/unit/ui/wms/StowSessionPage.receive-recovery-exact-lsu-i5.test.tsx
//
// S4-5 I5 — the receive_recovery Stow accepts only the exact held LSU.
// ==========================================================================
// Contract (canonical Receive recovery, step 7): the operator scans an
// eligible destination bin and the EXACT required LSU. A generic product
// barcode, or a sibling LSU of the same variant, never substitutes for it, and
// nothing is confirmed (no inventory credit) on a rejected scan. The backend
// confirmStow guard stays authoritative; this proves the scanner fails fast
// and shows the operator which unit is required.
//
// Harness: REAL StowSessionPage; the confirm boundary is a jest.fn().

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import type { WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const REQUIRED_LSU = 'LSU-HELD-0001';

const recoveryTask = (unitIds: string[] | null = [REQUIRED_LSU]): WmsStowTask => ({
  stow_task_id: 'stow-recovery-i5',
  status: 'in_progress',
  trigger: 'receive_recovery',
  lasyncro_variant_id: 'variant-i5',
  quantity: 1,
  quantity_placed: 0,
  location_code: 'BIN-STORAGE-1',
  assigned_operator_id: null,
  assigned_operator_name: null,
  claimed_by: 7,
  claimed_at: '2026-11-02T08:00:00.000Z',
  created_at: '2026-11-02T07:00:00.000Z',
  product_title: 'Recovery Widget',
  variant_title: 'Default Title',
  sku: 'SKU-I5',
  image_url: null,
  unit_ids: unitIds,
});

function renderSession(task: WmsStowTask, resolved: { lasyncro_variant_id: string; lasyncro_unit_id?: string } | null) {
  const props = {
    initialTaskId: task.stow_task_id,
    onComplete: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue([task]),
    onResolveLocation: jest.fn().mockResolvedValue(null),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue(resolved),
    onConfirmStow: jest.fn().mockResolvedValue({
      stow_task_id: task.stow_task_id,
      status: 'completed',
      quantity_total: 1,
      quantity_placed: 1,
      is_fully_placed: true,
    }),
  };
  render(<StowSessionPage {...props} />);
  return props;
}

async function scan(value: string) {
  const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

describe('S4-5 I5 — receive_recovery Stow exact-LSU scan', () => {
  it('shows the recovery source and the exact required LSU', async () => {
    renderSession(recoveryTask(), null);

    const guidance = await screen.findByTestId('stow-recovery-guidance');
    expect(guidance).toHaveTextContent(REQUIRED_LSU);
    expect(guidance).toHaveTextContent(/product barcode is not accepted/i);
    expect(screen.getByText('Receive recovery')).toBeInTheDocument();
  });

  it('rejects a generic product barcode that resolves to a sibling LSU — nothing is confirmed', async () => {
    const props = renderSession(recoveryTask(), { lasyncro_variant_id: 'variant-i5', lasyncro_unit_id: 'LSU-SIBLING-0002' });

    await scan('5012345678900');

    expect(await screen.findByText('Wrong unit. Scan the LSU shown for this stow task.')).toBeInTheDocument();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('rejects a product barcode that resolves no physical unit — nothing is confirmed', async () => {
    const props = renderSession(recoveryTask(), { lasyncro_variant_id: 'variant-i5' });

    await scan('5012345678900');

    expect(await screen.findByText('Wrong unit. Scan the LSU shown for this stow task.')).toBeInTheDocument();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('fails closed when the task declares no recoverable LSU', async () => {
    const props = renderSession(recoveryTask([]), { lasyncro_variant_id: 'variant-i5', lasyncro_unit_id: REQUIRED_LSU });

    await scan(REQUIRED_LSU);

    expect(await screen.findByText('Wrong unit. Scan the LSU shown for this stow task.')).toBeInTheDocument();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('accepts the exact LSU and confirms exactly that one unit once', async () => {
    const props = renderSession(recoveryTask(), { lasyncro_variant_id: 'variant-i5', lasyncro_unit_id: REQUIRED_LSU });

    await scan(REQUIRED_LSU);

    await waitFor(() => expect(props.onConfirmStow).toHaveBeenCalledTimes(1));
    expect(props.onConfirmStow).toHaveBeenCalledWith('stow-recovery-i5', 1, REQUIRED_LSU);
  });
});
