// tests/unit/ui/hooks/useActivationChecklist.setup-contract.test.tsx
//
// Architectural contract: Ops Console SETUP contains only the five
// in-app setup tasks. Shopify connection (connect-store) and initial
// sync (complete-sync) belong to PRE-APP onboarding and must never be
// emitted by useActivationChecklist.

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

function mockReadiness() {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/v1/onboarding/readiness') {
      return Promise.resolve({
        data: {
          modules: [
            {
              moduleId: 'platform',
              tasks: [
                { id: 'connect-store', complete: true },
                { id: 'complete-sync', complete: true },
              ],
            },
            {
              moduleId: 'order-nexus',
              tasks: [
                { id: 'orderNexus.resolveMissingCosts', complete: false },
              ],
            },
            {
              moduleId: 'wms',
              tasks: [
                { id: 'map-zones', complete: false },
                { id: 'print-barcodes', complete: false },
                { id: 'connect-carrier', complete: false },
              ],
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

describe('useActivationChecklist — SETUP contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits exactly the five in-app Ops Console SETUP tasks and excludes pre-app onboarding', async () => {
    mockReadiness();

    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const keys = result.current.items.map((item) => item.key);

    expect(keys).toEqual([
      'fix-costs',
      'map-zones',
      'print-barcodes',
      'connect-carrier',
      'wave-released',
    ]);

    expect(result.current.items).toHaveLength(5);
    expect(keys).not.toContain('connect-store');
    expect(keys).not.toContain('complete-sync');

    const routeByKey = Object.fromEntries(
      result.current.items.map((item) => [item.key, item.actionRoute])
    );

    expect(routeByKey['fix-costs']).toBe('/inventory/catalog');
    expect(routeByKey['map-zones']).toBe('/floor-planning');
    expect(routeByKey['print-barcodes']).toBe('/floor-planning?tab=barcodes');
    expect(routeByKey['connect-carrier']).toBe('/settings/carriers');
    expect(routeByKey['wave-released']).toBe('/orders/flow');
  });
});
