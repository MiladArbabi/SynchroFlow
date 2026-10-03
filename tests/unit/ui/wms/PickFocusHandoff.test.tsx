// WAREHOUSE-SESSION-FOCUS-02A — Pick focus is carried by the handoff URL.
//
// Pick is execution-focused from the Pick Brief onward. Canonical focused Pick
// URL: /wms?batchId=<id>&warehouseFocus=pick. Focus must never be added after
// first paint: the originating Pick handoff generates warehouseFocus=pick in
// the navigation URL itself, and the WMS page adapter must never strip it when
// the module (re-)reports Pick session entry. Handoff and Brief entry are
// navigation only — Start Picking stays the only pending-batch claim boundary.
//
// Two boundaries, each rendered with real react-router state (MemoryRouter +
// a location probe), no useNavigate mocking:
// - Batch Detail "Continue to Pick →" / "Resume Picking →" (BatchDetailModalBody)
// - WmsOperationsPage's Pick URL adapter (pendingPickBatchId /
//   onPickSessionEnter / onSessionExit). @lasyncro/wms is stubbed to capture
//   the props handed to WmsModuleFT2 — same precedent as
//   WmsOperationsPage.countFocus.test.tsx.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { BatchDetailModalBody } from 'pages/ft2-pages/BatchDetailModalBody';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';

const mockAxios = {
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};

jest.mock('api/axiosConfig', () => ({
  get axiosInstance() {
    return mockAxios;
  },
}));

// ── BatchDetailModalBody dependencies ──────────────────────────────────────
jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatchOrders: () => ({ data: { orders: [] }, isLoading: false, isError: false, error: null }),
  usePickBatchLineItems: () => ({ data: { line_items: [] }, isLoading: false, isError: false }),
}));
jest.mock('runtime/commercialContext', () => ({
  useCommercialAccess: () => ({
    isResolved: true,
    decide: () => ({ allowed: false, reason: 'DENIED' }),
  }),
}));
jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({ data: { zones: [] }, isLoading: false, isError: false }),
}));
jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: () => <div data-testid="isometric-canvas" />,
}));

// ── WmsOperationsPage dependencies ─────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'owner' } }),
}));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: [],
    recountLocked: false,
    recountTasksSettled: true,
    openingInventory: null,
    refetchOpeningInventory: jest.fn(),
  }),
}));
jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [] } }),
}));
jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }),
}));
const mockModuleProps: { current: Record<string, any> | null } = { current: null };
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: (props: Record<string, any>) => {
    mockModuleProps.current = props;
    return null;
  },
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

const BATCH_ID = 'abcd1234-focus-batch';

let currentLocation = { pathname: '', search: '' };
function LocationProbe() {
  const location = useLocation();
  currentLocation = { pathname: location.pathname, search: location.search };
  return null;
}

const currentParams = () => new URLSearchParams(currentLocation.search);

function expectNoWrites() {
  expect(mockAxios.post).not.toHaveBeenCalled();
  expect(mockAxios.put).not.toHaveBeenCalled();
  expect(mockAxios.patch).not.toHaveBeenCalled();
  expect(mockAxios.delete).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModuleProps.current = null;
  currentLocation = { pathname: '', search: '' };
});

type BatchFixture = React.ComponentProps<typeof BatchDetailModalBody>['batch'];

const batch: BatchFixture = {
  pick_batch_id: BATCH_ID,
  status: 'pending',
  release_trigger: 'manual',
  total_line_items: 1,
  total_units: 1,
  units_picked: 0,
  units_packed: 0,
  picked_by: null,
  packed_by: null,
  pick_claimed_at: null,
  pick_completed_at: null,
  pack_claimed_at: null,
  pack_completed_at: null,
  released_at: '2026-10-01T10:00:00.000Z',
  assigned_operator_id: null,
  assigned_packer_id: null,
  picker_name: null,
  packer_name: null,
};

const executionControl = (label: RegExp) =>
  [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')].find((element) =>
    label.test(element.getAttribute('aria-label') ?? element.textContent ?? ''),
  );

describe('WAREHOUSE-SESSION-FOCUS-02A — Batch Detail Pick handoff carries focus in the navigation URL', () => {
  function followHandoff(status: BatchFixture['status'], label: RegExp) {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <BatchDetailModalBody batch={{ ...batch, status }} onNavigateToOrder={jest.fn()} />
        <LocationProbe />
      </MemoryRouter>,
    );

    const control = executionControl(label);
    expect(control).toBeDefined();
    fireEvent.click(control!);
  }

  it.each([
    ['pending', /^continue to pick/i],
    ['picking', /^resume picking/i],
  ] as const)(
    '%s batch → the handoff navigates straight to the canonical focused Pick URL',
    (status, label) => {
      followHandoff(status, label);

      expect(currentLocation.pathname).toBe('/wms');
      expect(currentParams().get('batchId')).toBe(BATCH_ID);
      expect(currentParams().get('warehouseFocus')).toBe('pick');

      // Navigation only: the Pick Brief's Start Picking owns the claim.
      expectNoWrites();
    },
  );

  it.each([
    ['pick_complete', /^go to packing/i],
    ['packing', /^resume packing/i],
  ] as const)('%s batch → pack handoff never carries Pick focus', (status, label) => {
    followHandoff(status, label);

    expect(currentLocation.pathname).toBe('/wms');
    expect(currentParams().get('warehouseFocus')).toBeNull();
    expectNoWrites();
  });
});

describe('WAREHOUSE-SESSION-FOCUS-02A — WmsOperationsPage Pick URL adapter', () => {
  function renderPage(url: string) {
    render(
      <MemoryRouter initialEntries={[url]}>
        <WmsOperationsPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(mockModuleProps.current).not.toBeNull();
    return mockModuleProps.current!;
  }

  it('hard reload of the canonical focused Pick URL hands the module the exact batch, without any write', () => {
    const props = renderPage(`/wms?batchId=${BATCH_ID}&warehouseFocus=pick`);

    expect(props.pendingPickBatchId).toBe(BATCH_ID);
    expect(currentParams().get('warehouseFocus')).toBe('pick');
    expectNoWrites();
  });

  it('stale /wms?warehouseFocus=pick with no batchId requests no Pick session', () => {
    const props = renderPage('/wms?warehouseFocus=pick');

    expect(props.pendingPickBatchId).toBeNull();
  });

  it.each([
    ['Operations card origin (/wms)', '/wms'],
    ['canonical focused Pick restore', `/wms?batchId=${BATCH_ID}&warehouseFocus=pick`],
  ])(
    '%s: module Pick session entry leaves the URL on the canonical focused Pick URL',
    (_origin, url) => {
      const props = renderPage(url);

      act(() => {
        props.onPickSessionEnter(BATCH_ID);
      });

      expect(currentParams().get('batchId')).toBe(BATCH_ID);
      expect(currentParams().get('warehouseFocus')).toBe('pick');
      expectNoWrites();
    },
  );

  it('explicit session exit from a focused Pick clears batchId and warehouseFocus together', () => {
    renderPage(`/wms?batchId=${BATCH_ID}&warehouseFocus=pick`);

    act(() => {
      mockModuleProps.current!.onSessionExit();
    });

    expect(currentParams().get('batchId')).toBeNull();
    expect(currentParams().get('warehouseFocus')).toBeNull();
    expectNoWrites();
  });
});
