// tests/unit/ui/ops-console/ops-console-map-zones-navigation.test.tsx
//
// GH1176 — Ops Console navigation for "Map your warehouse zones" follows the
// serialized onboarding route (Floor Planning Setup > Canvas).
//
// Unlike ops-console-model / ops-console-surface (which feed hand-written
// checklist fixtures), this file drives the REAL useActivationChecklist
// projection from a mocked readiness transport, so the model row and the
// rendered surface prove the route the merchant actually reaches.

import React from 'react';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: () => null,
  SpotlightCoachMark: () => null,
}));

jest.mock('components/OpsConsole/useGlobalSearch', () => ({
  useGlobalSearch: () => ({ results: [], isFetching: false, isError: false }),
}));

jest.mock('pages/operations/useHistory', () => ({
  useHistory: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/operations/useWaiting', () => ({
  useWaiting: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({ OrderDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({ BatchDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/VariantDetailModalHost', () => ({ VariantDetailModalHost: () => null }));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: () => ({ data: { batches: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn() }),
}));

import { axiosInstance } from 'api/axiosConfig';
import { useActivationChecklist } from 'hooks/useActivationChecklist';
import { buildSetupRows } from 'components/OpsConsole/opsConsoleModel';
import { OpsConsolePanel } from 'components/OpsConsole';
import { ConfigProvider } from 'contexts/ConfigContext';

const mockedGet = axiosInstance.get as jest.Mock;

const GH1176_MAP_ZONES_ROUTE = '/floor-planning?tab=setup&view=canvas';

/** Mature (non-first-entry) readiness with map-zones incomplete. */
function mockReadiness() {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/v1/onboarding/readiness') {
      return Promise.resolve({
        data: {
          modules: [
            {
              moduleId: 'wms',
              tasks: [
                { id: 'map-zones', complete: false },
                { id: 'reconcile-inventory', complete: true },
              ],
              signals: [
                { name: 'wms.zonesConfigured', value: false },
                { name: 'wms.openingInventoryReconciliationRequired', value: false },
                { name: 'wms.openingInventoryReconciled', value: true },
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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadiness();
});

describe('GH1176 — Ops Console map-zones navigation', () => {
  it('GH1176: model row built from the real checklist projection navigates to Setup > Canvas', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useActivationChecklist(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = buildSetupRows(result.current.items).find((r) => r.id === 'setup:map-zones');
    expect(row?.action).toEqual({ kind: 'navigate', label: 'Open', route: GH1176_MAP_ZONES_ROUTE });
  });

  it('GH1176: clicking the rendered SETUP row navigates to Setup > Canvas', async () => {
    render(
      <ConfigProvider>
        <QueryClientProvider client={makeClient()}>
          <OpsConsolePanel alerts={[]} open onClose={jest.fn()} />
        </QueryClientProvider>
      </ConfigProvider>,
    );

    fireEvent.click(await screen.findByTestId('ops-setup-toggle'));
    const row = await screen.findByTestId('ops-row-setup:map-zones');
    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));

    expect(mockNavigate).toHaveBeenCalledWith(GH1176_MAP_ZONES_ROUTE);
  });
});
