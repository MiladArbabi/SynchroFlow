/**
 * SF-PICK-ASSIGN-01 — per-warehouse Pick recovery threshold editor.
 * Real section against a mocked HTTP boundary: effective value per warehouse,
 * 30-minute default, 5–480 validation, saving / success / failure states, and
 * copy that keeps it distinct from idle alerts.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PickRecoverySection } from 'pages/ft2-pages/ShopSettingsWarehousePage';

const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...a: unknown[]) => mockGet(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
  },
}));
jest.mock('contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));

const MAIN = '11111111-1111-4111-8111-111111111111';
const NORTH = '22222222-2222-4222-8222-222222222222';

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PickRecoverySection /></QueryClientProvider>);
}
const row = (id: string) => screen.getByTestId(`pick-recovery-row-${id}`);

beforeEach(() => {
  mockGet.mockReset();
  mockPatch.mockReset();
  mockGet.mockResolvedValue({
    data: {
      warehouses: [
        { warehouse_id: MAIN, name: 'Main', is_default: true, active: true, pick_recovery_threshold_minutes: 30 },
        { warehouse_id: NORTH, name: 'North', is_default: false, active: true, pick_recovery_threshold_minutes: 45 },
      ],
    },
  });
});

test('PR-01 shows each warehouse\'s effective threshold and keeps recovery distinct from idle alerts', async () => {
  renderSection();
  expect(await screen.findByText('Pick recovery time')).toBeInTheDocument();
  await screen.findByTestId(`pick-recovery-row-${MAIN}`);
  expect(mockGet).toHaveBeenCalledWith('/api/v1/settings/shop/warehouses/pick-recovery');
  expect(within(row(MAIN)).getByText('Current: 30 min')).toBeInTheDocument();
  expect(within(row(NORTH)).getByText('Current: 45 min')).toBeInTheDocument();
  expect(screen.getByText(/separate from idle alerts/i)).toBeInTheDocument();
  expect(screen.getByText(/default 30 minutes/i)).toBeInTheDocument();
});

test('PR-02 out-of-range and non-integer values are refused before any save', async () => {
  renderSection();
  const input = await screen.findByLabelText('Pick recovery minutes for North');
  const save = within(row(NORTH)).getByRole('button', { name: 'Save' });
  for (const bad of ['4', '481', '12.5', '']) {
    fireEvent.change(input, { target: { value: bad } });
    expect(save).toBeDisabled();
  }
  fireEvent.change(input, { target: { value: '4' } });
  expect(within(row(NORTH)).getByText('Must be between 5 and 480 minutes.')).toBeInTheDocument();
  expect(mockPatch).not.toHaveBeenCalled();
});

test('PR-03 a valid change saves through the warehouse route with saving and success states', async () => {
  let release!: () => void;
  mockPatch.mockImplementation(() => new Promise<void>((r) => { release = () => r(); }));
  renderSection();
  const input = await screen.findByLabelText('Pick recovery minutes for North');
  fireEvent.change(input, { target: { value: '60' } });
  fireEvent.click(within(row(NORTH)).getByRole('button', { name: 'Save' }));
  expect(await within(row(NORTH)).findByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(mockPatch).toHaveBeenCalledWith(
    `/api/v1/settings/shop/warehouses/${NORTH}/pick-recovery`,
    { pick_recovery_threshold_minutes: 60 },
  );
  release();
  expect(await within(row(NORTH)).findByText('Saved.')).toBeInTheDocument();
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2)); // refreshed from the server
});

test('PR-04 a refused save shows the server reason and keeps the entered value', async () => {
  mockPatch.mockRejectedValue(Object.assign(new Error('400'), {
    response: { status: 400, data: { error: 'pick_recovery_threshold_minutes must be an integer 5–480' } },
  }));
  renderSection();
  const input = await screen.findByLabelText('Pick recovery minutes for Main');
  fireEvent.change(input, { target: { value: '90' } });
  fireEvent.click(within(row(MAIN)).getByRole('button', { name: 'Save' }));
  expect(await within(row(MAIN)).findByText('pick_recovery_threshold_minutes must be an integer 5–480')).toBeInTheDocument();
  expect((input as HTMLInputElement).value).toBe('90');
  expect(within(row(MAIN)).getByText('Current: 30 min')).toBeInTheDocument();
});

test('PR-05 a warehouse without a stored value shows the 30-minute default', async () => {
  mockGet.mockResolvedValue({ data: { warehouses: [
    { warehouse_id: MAIN, name: 'Main', is_default: true, active: true, pick_recovery_threshold_minutes: null },
  ] } });
  renderSection();
  expect(await screen.findByText('Current: 30 min (default)')).toBeInTheDocument();
});
