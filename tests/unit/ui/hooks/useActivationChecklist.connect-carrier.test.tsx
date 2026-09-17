// tests/unit/ui/hooks/useActivationChecklist.connect-carrier.test.tsx
//
// DB-free coverage for the "Connect your shipping carrier" activation
// checklist item. Mirrors the renderHook + QueryClientProvider +
// mocked axiosInstance pattern used in
// tests/unit/ui/lifecycle/TopnavbarContent.alerts-ft2-gate.test.tsx.

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useActivationChecklist } from 'hooks/useActivationChecklist';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mockReadiness(wmsTasks: Array<{ id: string; complete: boolean }>) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/v1/onboarding/readiness') {
      return Promise.resolve({
        data: { modules: [{ moduleId: 'wms', tasks: wmsTasks }] },
      });
    }
    if (url === '/api/v1/user-state/activation-events') {
      return Promise.resolve({ data: { wave_released: false } });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('useActivationChecklist — connect-carrier item', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes "Connect your shipping carrier" routed to /settings/carriers, incomplete when connect-carrier is incomplete', async () => {
    mockReadiness([{ id: 'connect-carrier', complete: false }]);

    const { result } = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items.find((i) => i.key === 'connect-carrier');
    expect(item).toEqual({
      key: 'connect-carrier',
      label: 'Connect your shipping carrier',
      complete: false,
      actionRoute: '/settings/carriers',
    });
  });

  it('reflects findTask(modules, "wms", "connect-carrier") === true as complete', async () => {
    mockReadiness([{ id: 'connect-carrier', complete: true }]);

    const { result } = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items.find((i) => i.key === 'connect-carrier');
    expect(item?.complete).toBe(true);
  });

  it('places connect-carrier after print-barcodes and before wave-released', async () => {
    mockReadiness([
      { id: 'print-barcodes', complete: false },
      { id: 'connect-carrier', complete: false },
    ]);

    const { result } = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const keys = result.current.items.map((i) => i.key);
    const printIdx = keys.indexOf('print-barcodes');
    const carrierIdx = keys.indexOf('connect-carrier');
    const waveIdx = keys.indexOf('wave-released');

    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(carrierIdx).toBe(printIdx + 1);
    expect(waveIdx).toBe(carrierIdx + 1);
  });
});
