// tests/unit/ui/hooks/useActivationChecklist.print-barcodes.test.tsx
//
// Focused regression coverage for GitHub #1129.
// The barcode SETUP item must deep-link to the canonical Barcodes tab while
// preserving completion state from the existing WMS readiness task.

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

describe('useActivationChecklist — print-barcodes item', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deep-links "Print your first location barcode" to the canonical Barcodes tab', async () => {
    mockReadiness(false);

    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items.find(
      (candidate) => candidate.key === 'print-barcodes'
    );

    expect(item).toEqual({
      key: 'print-barcodes',
      label: 'Print your first location barcode',
      complete: false,
      actionRoute: '/floor-planning?tab=barcodes',
    });
  });

  it('continues to derive completion from wms / print-barcodes readiness', async () => {
    mockReadiness(true);

    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = result.current.items.find(
      (candidate) => candidate.key === 'print-barcodes'
    );

    expect(item?.complete).toBe(true);
  });
});
