// tests/unit/ui/settings/ShopSettingsGeneralPage.fulfillment-sla.test.tsx
//
// SLA-SETTINGS-SAVE-FIX-01 — frontend regression contract.
//
// Fulfillment SLA must load/change/save/refresh/retain against the new
// neutral endpoint (/api/v1/settings/shop/fulfillment-sla), and a failed
// GET/PATCH must be visible rather than silently rendering the shared
// default (24) as if it were loaded/saved data.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopSettingsGeneralPage from 'pages/ft2-pages/ShopSettingsGeneralPage';

const SLA_URL = '/api/v1/settings/shop/fulfillment-sla';
const RETURNS_URL = '/api/v1/modules/returns/settings';

const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockShow = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

jest.mock('contexts/ToastContext', () => ({
  useToast: () => ({ show: mockShow }),
}));

function mockSlaAndReturns(slaGetter: () => number | Promise<never>) {
  mockGet.mockImplementation((url: string) => {
    if (url === SLA_URL) {
      const result = slaGetter();
      return result instanceof Promise ? result : Promise.resolve({ data: { fulfillment_sla_hours: result } });
    }
    if (url === RETURNS_URL) {
      return Promise.resolve({ data: { returns_aging_warning_hours: 48, returns_aging_critical_hours: 168 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ShopSettingsGeneralPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPatch.mockReset();
  mockShow.mockReset();
});

describe('ShopSettingsGeneralPage — Fulfillment SLA', () => {
  it('SLA-SETTINGS-SAVE-01 renders the canonical loaded SLA value from GET', async () => {
    mockSlaAndReturns(() => 12);
    renderPage();
    expect(await screen.findByDisplayValue('12')).toBeInTheDocument();
  });

  it('SLA-SETTINGS-SAVE-02 changing 24 -> 12 exposes Save, and clicking Save issues PATCH with fulfillment_sla_hours: 12', async () => {
    mockSlaAndReturns(() => 24);
    mockPatch.mockResolvedValue({ data: {} });
    renderPage();

    const input = await screen.findByDisplayValue('24');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(SLA_URL, { fulfillment_sla_hours: 12 });
    });
  });

  it('SLA-SETTINGS-SAVE-03 a successful save refetches canonical state, and a subsequent reopen retains 12', async () => {
    let persisted = 24;
    mockSlaAndReturns(() => persisted);
    mockPatch.mockImplementation((_url: string, body: { fulfillment_sla_hours: number }) => {
      persisted = body.fulfillment_sla_hours;
      return Promise.resolve({ data: {} });
    });

    const { unmount } = renderPage();
    const input = await screen.findByDisplayValue('24');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByDisplayValue('12')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    unmount();

    // Simulate reopening the page: a fresh query cache reading canonical
    // server state (persisted=12) must not fall back to the stale/default 24.
    renderPage();
    expect(await screen.findByDisplayValue('12')).toBeInTheDocument();
  });

  it('SLA-SETTINGS-SAVE-04 a GET failure is shown, not silently rendered as a loaded 24', async () => {
    mockSlaAndReturns(() => Promise.reject(new Error('network error')));
    renderPage();

    expect(await screen.findByTestId('sla-load-error')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('24')).toBeNull();
  });

  it('SLA-SETTINGS-SAVE-05 a PATCH failure surfaces failure feedback instead of pretending it saved', async () => {
    mockSlaAndReturns(() => 24);
    mockPatch.mockRejectedValue(new Error('save failed'));
    renderPage();

    const input = await screen.findByDisplayValue('24');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Failed to save settings. Please try again.', 'error');
    });
  });

  it('SLA-SETTINGS-SAVE-06 client-side validation blocks 0 and 721 without issuing a PATCH', async () => {
    mockSlaAndReturns(() => 24);
    renderPage();

    const input = await screen.findByDisplayValue('24');

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number between 1 and 720/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '721' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  // SLA-SETTINGS-SAVE-FEEDBACK-01
  it('SLA-SETTINGS-SAVE-07 a successful PATCH still fires with 12, temporarily renders "Saved ✓", then the feedback disappears', async () => {
    let persisted = 24;
    mockSlaAndReturns(() => persisted);
    mockPatch.mockImplementation((_url: string, body: { fulfillment_sla_hours: number }) => {
      persisted = body.fulfillment_sla_hours;
      return Promise.resolve({ data: {} });
    });
    renderPage();

    const input = await screen.findByDisplayValue('24');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    // 1) clicking Save still PATCHes 12
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(SLA_URL, { fulfillment_sla_hours: 12 });
    });

    // 2) successful PATCH temporarily renders "Saved ✓"
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();

    // 3) the feedback disappears after the short success interval (~750ms)
    await waitFor(
      () => expect(screen.queryByText('Saved ✓')).toBeNull(),
      { timeout: 2000 }
    );
    expect(screen.queryByTestId('sla-save-button')).toBeNull();
  });

  it('SLA-SETTINGS-SAVE-08 a failed PATCH never renders "Saved" and leaves Save available to retry', async () => {
    mockSlaAndReturns(() => 24);
    mockPatch.mockRejectedValue(new Error('save failed'));
    renderPage();

    const input = await screen.findByDisplayValue('24');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Failed to save settings. Please try again.', 'error');
    });

    // 4) failed PATCH never renders "Saved" — existing error feedback stands instead
    expect(screen.queryByText(/Saved/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
