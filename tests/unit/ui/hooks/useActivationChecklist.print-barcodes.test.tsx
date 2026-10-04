// tests/unit/ui/hooks/useActivationChecklist.print-barcodes.test.tsx
//
// #1207 — print-barcodes is excluded from mature Ops Console SETUP.
// This protects SETUP membership only; backend barcode readiness remains
// a separate capability regardless of its completion state.

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    );
  };
}

function mockReadiness(complete: boolean) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/v1/onboarding/readiness') {
      return Promise.resolve({
        data: {
          modules: [
            {
              moduleId: 'wms',
              tasks: [{ id: 'print-barcodes', complete }],
            },
          ],
        },
      });
    }

    if (url === '/api/v1/user-state/activation-events') {
      return Promise.resolve({ data: { wave_released: false } });
    }

    return Promise.resolve({ data: {} });
  });
}

describe('useActivationChecklist — #1207 print-barcodes exclusion from mature Ops Console SETUP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('excludes print-barcodes from mature SETUP when readiness reports incomplete', async () => {
    mockReadiness(false);

    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((item) => item.key)).not.toContain('print-barcodes');
  });

  it('excludes print-barcodes from mature SETUP when readiness reports complete', async () => {
    mockReadiness(true);

    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((item) => item.key)).not.toContain('print-barcodes');
  });
});
