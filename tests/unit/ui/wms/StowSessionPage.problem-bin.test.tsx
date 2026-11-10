import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import type { WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

/** SF-PROBLEM-BIN Phase A — Stow uses the shared ProblemBinScanFlow (adapted from the S2 suite). */
const inProgressTask: WmsStowTask = {
  stow_task_id: 'stow-progress-1',
  status: 'in_progress',
  trigger: 'inbound_stock',
  lasyncro_variant_id: 'variant-1',
  quantity: 3,
  quantity_placed: 1,
  location_code: 'BIN-A',
  product_title: 'Progress Widget',
  variant_title: 'Progress Widget / Blue',
  sku: 'PROGRESS-1',
  image_url: null,
  unit_ids: [],
} as WmsStowTask;

function mount(enabled = true, q = jest.fn().mockResolvedValue({ quantity_total: 3, quantity_placed: 1, quantity_excepted: 1, is_fully_placed: false })) {
  const props = { initialTaskId: inProgressTask.stow_task_id, onComplete: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue([{ ...inProgressTask, quantity_excepted: 0, quarantine_enabled: enabled }]),
    onResolveLocation: jest.fn(), onAssignLocation: jest.fn(), onClaimTask: jest.fn(), onResolveBarcode: jest.fn(), onConfirmStow: jest.fn(),
    onQuarantineStow: q, onResolveProblemBin: jest.fn().mockResolvedValue({ location_code: 'PROBLEM' }) };
  render(<StowSessionPage {...props} />); return props;
}
async function scan(placeholder: string, value: string) {
  const field = await screen.findByPlaceholderText(placeholder);
  await waitFor(() => expect(field).not.toBeDisabled());
  fireEvent.change(field, { target: { value } }); fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
}
describe('Stow → shared Problem Bin flow', () => {
  it('hides the action when the server gate is off', async () => {
    mount(false); await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    expect(screen.queryByRole('button', { name: 'Problem Bin' })).not.toBeInTheDocument();
  });
  it('scans Problem Bin then exact LSU through the Stow adapter, without normal placement', async () => {
    const p = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Problem Bin' }));
    await scan('Scan Problem Bin barcode', 'BIN-BARCODE');
    expect(p.onResolveProblemBin).toHaveBeenCalledWith('BIN-BARCODE');
    await scan('Scan exact LSU label', 'PRODUCT-BARCODE');
    expect(await screen.findByText('Scan the exact LSU label on the unit.')).toBeInTheDocument(); expect(p.onQuarantineStow).not.toHaveBeenCalled();
    await scan('Scan exact LSU label', 'LSU-damaged'); await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    expect(p.onQuarantineStow).toHaveBeenCalledWith(inProgressTask.stow_task_id, 'LSU-damaged', 'PROBLEM', expect.any(String));
    expect(p.onConfirmStow).not.toHaveBeenCalled(); expect(p.onAssignLocation).not.toHaveBeenCalled();
    expect(await screen.findByText('Unit quarantined · LSU-damaged · PROBLEM')).toBeInTheDocument();
  });
  it('reuses the event identity after a network failure', async () => {
    const q = jest.fn().mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValue({ quantity_total: 3, quantity_placed: 1, quantity_excepted: 1, is_fully_placed: false });
    mount(true, q); fireEvent.click(await screen.findByRole('button', { name: 'Problem Bin' }));
    await scan('Scan Problem Bin barcode', 'PROBLEM'); await scan('Scan exact LSU label', 'LSU-damaged'); await screen.findByText('Network interrupted');
    await scan('Scan exact LSU label', 'LSU-damaged'); await waitFor(() => expect(q).toHaveBeenCalledTimes(2)); expect(q.mock.calls[0]).toEqual(q.mock.calls[1]);
  });
});
