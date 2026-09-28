// tests/unit/ui/hooks/useActivationChecklist.map-zones.test.tsx
//
// GH1176 — the frontend SETUP projection of "Map your warehouse zones" must
// deep-link to the same serialized route as the backend readiness manifest
// (Floor Planning Setup > Canvas), while completion keeps deriving from the
// wms / map-zones readiness task (wms.zonesConfigured).

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useActivationChecklist } from 'hooks/useActivationChecklist';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const GH1176_MAP_ZONES_ROUTE = '/floor-planning?tab=setup&view=canvas';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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
              tasks: [{ id: 'map-zones', complete }],
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

async function mapZonesItem(complete: boolean) {
  mockReadiness(complete);
  const { result } = renderHook(() => useActivationChecklist(), {
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result.current.items.find((candidate) => candidate.key === 'map-zones');
}

describe('useActivationChecklist — map-zones item', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GH1176: deep-links "Map your warehouse zones" to Floor Planning Setup > Canvas', async () => {
    expect(await mapZonesItem(false)).toEqual({
      key: 'map-zones',
      label: 'Map your warehouse zones',
      complete: false,
      actionRoute: GH1176_MAP_ZONES_ROUTE,
    });
  });

  it('GH1176 invariant: completion derives from wms / map-zones readiness', async () => {
    expect((await mapZonesItem(true))?.complete).toBe(true);
  });
});
