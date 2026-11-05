// tests/unit/ui/commercial-access/stow-floor-commercial-access.test.tsx
//
// STOW-UX-01 — Stow floor-data commercial boundary
// ================================================
// Stow's only geometry is GET /floor-planning/grid, which GH-1222 binds to
// warehouse.operations + wms:read. These tests prove the acquisition boundary
// through the real route gate and the real hook, and that no Stow path reaches
// the warehouse.floor_planning endpoints (/layout, /grid/occupancy).
//
// The decision source is mocked at its public boundary, as in the live-map
// commercial-access files, never by re-implementing policy.

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockGet = jest.fn();
jest.mock('api/axiosConfig', () => ({
  __esModule: true,
  axiosInstance: { get: (...args: unknown[]) => mockGet(...args) },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

let mockDecide: (capabilityId: string) => { allowed: boolean; reason: string; requiredTier?: string };
let mockResolved = true;
jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'core', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: mockResolved,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  }),
}));
jest.mock('../../../../apps/frontend/src/runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'core', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: mockResolved,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  }),
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => <div data-testid="upgrade-prompt" />,
}));
jest.mock('../../../../apps/frontend/src/components/UpgradePrompt', () => ({
  UpgradePrompt: () => <div data-testid="upgrade-prompt" />,
}));
jest.mock('../../../../apps/frontend/src/components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

// The real hook runs at the boundary; only the page around it is replaced.
jest.mock('../../../../apps/frontend/src/pages/ft2-pages/WmsOperationsPage', () => {
  const { useWarehouseGrid } = jest.requireActual('pages/floor-planning/useWarehouseGrid');
  return {
    __esModule: true,
    default: () => {
      const { data } = useWarehouseGrid();
      return <div data-testid="wms-operations">{data?.locations?.length ?? 'none'}</div>;
    },
  };
});
jest.mock('../../../../apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage', () => ({
  __esModule: true,
  default: () => null,
}));

import WmsFT2Page from '../../../../apps/frontend/src/pages/ft2-pages/WmsFT2Page';

const ALLOW = { allowed: true, reason: 'ALLOWED' };
const DENY = { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' };

function renderWms() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/wms?stowTaskId=stow-a']}>
        <Routes>
          <Route path="/wms/*" element={<WmsFT2Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const requestedUrls = () => mockGet.mock.calls.map(([url]) => url as string);

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({ data: { locations: [{ location_code: 'BIN-A' }] } });
  mockResolved = true;
  mockDecide = () => ALLOW;
});

describe('STOW-UX-01 — floor data is acquired only with entitlement', () => {
  it('warehouse.operations denied: the page never mounts and no floor data is requested', async () => {
    mockDecide = (id) => (id === 'warehouse.operations' ? DENY : ALLOW);
    renderWms();

    expect(await screen.findByTestId('upgrade-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('wms-operations')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('commercial truth unresolved: not treated as allowed, no floor data is requested', async () => {
    mockResolved = false;
    renderWms();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('wms-operations')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('operations allowed but floor_planning denied: only operational /grid is requested', async () => {
    mockDecide = (id) => (id === 'warehouse.floor_planning' ? DENY : ALLOW);
    renderWms();

    await waitFor(() => expect(screen.getByTestId('wms-operations')).toHaveTextContent('1'));
    expect(requestedUrls()).toEqual(['/api/v1/floor-planning/grid']);
  });

  it('a backend denial of /grid leaves geometry undefined, never an invented floor', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('denied'), { response: { status: 403 } }));
    renderWms();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('wms-operations')).toHaveTextContent('none');
  });
});

describe('STOW-UX-01 — no Stow path reaches restricted floor endpoints', () => {
  const root = path.resolve(__dirname, '../../../..');
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

  it('the session page acquires nothing and hardcodes no geometry', () => {
    const source = read('modules/wms/src/ui/pages/StowSessionPage.tsx');
    expect(source).not.toMatch(/axios|fetch\(|useQuery|\/api\/v1|floor-planning\//);
    expect(source).not.toMatch(/position_[xy]\s*:/);
  });

  it('the WMS host takes geometry only from the operational grid hook', () => {
    const source = read('apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx');
    expect(source).toMatch(/const \{ data: gridData \} = useWarehouseGrid\(\);/);
    expect(source).toMatch(/gridLocations=\{gridData\?\.locations\}/);
    expect(source).not.toMatch(/useFloorPlanning|useWarehouseGridOccupancy|grid\/occupancy|floor-planning\/layout/);
  });

  it('the backend contract this relies on is still warehouse.operations + wms:read on /grid only', () => {
    const routes = read('apps/backend/src/api/floor-planning/floor-planning.routes.ts');
    const grid = routes.match(/'\/grid',[\s\S]*?httpGetGrid\n/)?.[0] ?? '';
    expect(grid).toMatch(/requireCapability\('warehouse\.operations'\)/);
    expect(grid).toMatch(/requireAction\('wms:read'\)/);
    const occupancy = routes.match(/'\/grid\/occupancy',[\s\S]*?httpGetBinOccupancy\n/)?.[0] ?? '';
    expect(occupancy).toMatch(/requireCapability\('warehouse\.floor_planning'\)/);
    const layout = routes.match(/'\/layout',[\s\S]*?httpGetLayout\n/)?.[0] ?? '';
    expect(layout).toMatch(/requireCapability\('warehouse\.floor_planning'\)/);
  });
});
