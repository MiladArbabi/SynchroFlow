import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProblemBinScanFlow from '../../../../modules/wms/src/ui/components/ProblemBinScanFlow';

/** SF-PROBLEM-BIN Phase A — Free Scan flow: no task, no reason form. */
async function scan(placeholder: string, value: string) {
  const field = await screen.findByPlaceholderText(placeholder);
  await waitFor(() => expect(field).not.toBeDisabled());
  fireEvent.change(field, { target: { value } }); fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
}
const ok = { problem_task_id: 'incident-1', lasyncro_unit_id: 'LSU-a', problem_bin_location: 'PROBLEM', source_location: 'BIN-1', replayed: false };
function mount(onQuarantine = jest.fn().mockResolvedValue(ok)) {
  const props = { onResolveBin: jest.fn().mockResolvedValue({ location_code: 'PROBLEM' }), onQuarantine, onQuarantined: jest.fn(), onExit: jest.fn() };
  render(<ProblemBinScanFlow {...props} exitLabel="Return to Operations" />); return props;
}

describe('ProblemBinScanFlow (Free Scan)', () => {
  it('scans bin then exact LSU, then is ready for the next bin', async () => {
    const p = mount();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); // no reason selection
    await scan('Scan Problem Bin barcode', 'PB-BARCODE');
    expect(p.onResolveBin).toHaveBeenCalledWith('PB-BARCODE');
    await scan('Scan exact LSU label', 'LSU-a');
    await waitFor(() => expect(p.onQuarantined).toHaveBeenCalledWith(ok, 'LSU-a', 'PROBLEM'));
    expect(p.onQuarantine).toHaveBeenCalledWith('LSU-a', 'PROBLEM', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(await screen.findByText('Unit quarantined · LSU-a · PROBLEM')).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Scan Problem Bin barcode')).toBeInTheDocument();
  });
  it('refuses non-LSU scans without calling the server', async () => {
    const p = mount();
    await scan('Scan Problem Bin barcode', 'PB'); await scan('Scan exact LSU label', '0123456789012');
    expect(await screen.findByText('Scan the exact LSU label on the unit.')).toBeInTheDocument();
    expect(p.onQuarantine).not.toHaveBeenCalled();
  });
  it('keeps the event id across a network failure and blocks a different LSU until resolved', async () => {
    const q = jest.fn().mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValue(ok);
    const p = mount(q);
    await scan('Scan Problem Bin barcode', 'PB'); await scan('Scan exact LSU label', 'LSU-a');
    await screen.findByText('Network interrupted');
    expect(screen.getByRole('button', { name: 'Return to Operations' })).toBeDisabled();
    await scan('Scan exact LSU label', 'LSU-b');
    expect(await screen.findByText('Retry the previous LSU scan to confirm its saved result before continuing.')).toBeInTheDocument();
    await scan('Scan exact LSU label', 'LSU-a');
    await waitFor(() => expect(q).toHaveBeenCalledTimes(2)); expect(q.mock.calls[0]).toEqual(q.mock.calls[1]);
    await waitFor(() => expect(p.onQuarantined).toHaveBeenCalledTimes(1));
  });
  it('a definitive 4xx refusal clears the event id so a new scan gets a new one', async () => {
    const refusal = Object.assign(new Error('refused'), { response: { status: 409, data: { error: 'LSU belongs to an active Stow task — quarantine it from Stow' } } });
    const q = jest.fn().mockRejectedValueOnce(refusal).mockResolvedValue(ok);
    mount(q);
    await scan('Scan Problem Bin barcode', 'PB'); await scan('Scan exact LSU label', 'LSU-a');
    await screen.findByText('LSU belongs to an active Stow task — quarantine it from Stow');
    await scan('Scan exact LSU label', 'LSU-b');
    await waitFor(() => expect(q).toHaveBeenCalledTimes(2));
    expect(q.mock.calls[1][0]).toBe('LSU-b'); expect(q.mock.calls[1][2]).not.toBe(q.mock.calls[0][2]);
  });
});
