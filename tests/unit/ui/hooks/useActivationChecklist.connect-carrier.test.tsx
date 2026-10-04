// tests/unit/ui/hooks/useActivationChecklist.connect-carrier.test.tsx
//
// #1207 — connect-carrier is excluded from mature Ops Console SETUP.
// This protects SETUP membership only; backend carrier readiness remains
// a separate optional capability regardless of its completion state.

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

describe('useActivationChecklist — #1207 connect-carrier exclusion from mature Ops Console SETUP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not emit a mature SETUP row when connect-carrier readiness is false', async () => {
    mockReadiness([{ id: 'connect-carrier', complete: false }]);

    const { result } = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((item) => item.key)).not.toContain('connect-carrier');
  });

  it('does not re-enter mature SETUP when connect-carrier readiness is true', async () => {
    mockReadiness([{ id: 'connect-carrier', complete: true }]);

    const { result } = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((item) => item.key)).not.toContain('connect-carrier');
  });
});
