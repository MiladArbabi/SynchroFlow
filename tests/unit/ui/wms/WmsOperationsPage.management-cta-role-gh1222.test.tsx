// tests/unit/ui/wms/WmsOperationsPage.management-cta-role-gh1222.test.tsx
//
// GH-1222 / TIER-07 — TEST STRATEGY / RED — WMS management CTA parity.
// ====================================================================
// Ratified: an operator must not receive the management CTAs
//   - "Reconcile inventory" (recount creation — backend wms:recount:create, O/A)
//   - "Set up bins"         (Floor Planning management — floor-planning:write, O/A)
// and must never be shown a commercial upsell for those role-forbidden
// management actions. Owner/admin retain both CTAs. Operator recount
// EXECUTION (claim/count — wms:recount:claim / wms:recount:count) is untouched.
//
// Harness: REAL WmsOperationsPage + REAL WmsModuleFT2 source (the
// @lasyncro/wms package entry is pointed at module source, so the role reaches
// the module however the implementation wires it — no prop name is frozen).
// Mock surface mirrors WmsOperationsPage.floorPlanningNav.test.tsx /
// WmsOperationsPage.recountCreateEntry.test.tsx: useWms, ready-to-pack, the
// warehouse grid (one root, zero bins → 'no_bins_configured'), spotlight,
// the HTTP boundary and UpgradePrompt rendering.

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

type Role = 'owner' | 'admin' | 'operator';
let mockRole: Role = 'owner';
let mockRecountLocked = false;
let mockRecountTasks: Record<string, unknown>[] = [];

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: mockRole } }),
}));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: { open?: boolean; featureName?: string }) => (props.open
    ? <div data-testid="upgrade-prompt" data-feature={props.featureName ?? ''} />
    : null),
}));
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: mockRecountTasks,
    recountLocked: mockRecountLocked,
    recountTasksSettled: true,
    openingInventory: null,
    refetchOpeningInventory: jest.fn(),
  }),
}));
jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));
// One warehouse root, zero bin locations → classifyRecountBinAvailability()
// resolves 'no_bins_configured', the state that surfaces "Set up bins".
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({
    data: {
      locations: [
        { location_code: 'WH-1222-ROOT', type: 'warehouse', parent_location_code: null, active: true },
      ],
    },
  }),
}));
jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }),
}));
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: jest.requireActual('../../../../modules/wms/src/ui/pages/WmsModuleFT2').default,
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

const get = axiosInstance.get as jest.Mock;

beforeEach(() => {
  mockRecountLocked = false;
  mockRecountTasks = [];
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/api/v1/wms/recount-tasks/preview') return Promise.resolve({ data: { bins: [] } });
    if (url === '/api/v1/operators/team') return Promise.resolve({ data: { operators: [] } });
    return Promise.resolve({ data: {} });
  });
  (axiosInstance.post as jest.Mock).mockReset();
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: {} });
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderOperations(role: Role, path = '/wms') {
  mockRole = role;
  render(
    <MemoryRouter initialEntries={[path]}>
      <WmsOperationsPage />
    </MemoryRouter>,
  );
  await settle();
}

const reconcileButton = () => screen.queryByRole('button', { name: /Reconcile inventory/ });
const isUsable = (el: HTMLElement | null) => el !== null && !(el as HTMLButtonElement).disabled;

/** Open the Reconcile dialog when (and only when) the CTA is usable. */
async function openReconcileIfUsable() {
  const btn = reconcileButton();
  if (isUsable(btn)) {
    fireEvent.click(btn as HTMLElement);
    await settle();
  }
}

describe('GH-1222 G — OPERATOR receives no management CTAs', () => {
  it('G1 EXPECTED RED: operator has no usable "Reconcile inventory" management CTA', async () => {
    await renderOperations('operator');
    expect(isUsable(reconcileButton())).toBe(false);
  });

  it('G2 EXPECTED RED: operator cannot reach the "Set up bins" management CTA', async () => {
    await renderOperations('operator');
    await openReconcileIfUsable();
    expect(screen.queryByRole('button', { name: 'Set up bins' })).toBeNull();
  });

  it('G3 EXPECTED RED: operator sees no commercial upsell for the role-forbidden recount management action', async () => {
    mockRecountLocked = true;
    await renderOperations('operator');

    const btn = reconcileButton();
    if (btn) {
      // A Core paygate badge must not be presented next to a role-forbidden CTA.
      expect(btn.parentElement?.textContent ?? '').not.toMatch(/Core/);
    }
    await openReconcileIfUsable();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});

describe('GH-1222 G — OWNER / ADMIN retain management CTAs', () => {
  it.each(['owner', 'admin'] as const)(
    'G4 GREEN CONTROL: %s has a usable "Reconcile inventory" CTA that reaches "Set up bins"',
    async (role) => {
      await renderOperations(role);
      expect(isUsable(reconcileButton())).toBe(true);

      await openReconcileIfUsable();
      expect(await screen.findByRole('button', { name: 'Set up bins' })).toBeInTheDocument();
    },
  );

  it('G5 GREEN CONTROL: owner on a recount-locked plan still gets the existing Core upsell', async () => {
    mockRecountLocked = true;
    await renderOperations('owner');

    fireEvent.click(reconcileButton() as HTMLElement);
    await settle();
    expect(screen.getByTestId('upgrade-prompt')).toHaveAttribute('data-feature', 'Reconcile inventory');
  });
});

describe('GH-1222 G — operator recount EXECUTION is untouched', () => {
  it('G6 GREEN CONTROL: operator named on an unassigned dispatched recount still gets the Brief with Claim & Start Count', async () => {
    mockRecountTasks = [{
      recount_task_id: 'task-1222-exec',
      label: 'CNT-1222-0001',
      status: 'dispatched',
      scope: 'locations',
      blind: true,
      assigned_to: null,
      claimed_by: null,
      created_at: '2026-10-07T00:00:00.000Z',
      claimed_at: null,
      claim_generation: null,
      line_count: 1,
      counted_count: 0,
      purpose: 'cycle_count',
      scope_location_code: null,
    }];
    await renderOperations('operator', '/wms?countTaskId=task-1222-exec');

    expect(await screen.findByRole('button', { name: 'Claim & Start Count' })).toBeInTheDocument();
  });
});
