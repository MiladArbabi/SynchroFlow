// GH-1201 / RECOUNT-BRIEF-ENTRY-01 — post-create routing for ordinary recount.
//
// An Owner/Admin who creates a recount that they may count (unassigned, or
// assigned to themselves) enters the new task's Brief immediately at
// /wms?countTaskId=<id> — never warehouseFocus=count, which stays Opening
// Inventory protected focus. Assignment and creation are not claim: no claim
// request is made. A task dispatched to another operator keeps the creator on
// ordinary Operations.
//
// Page-level routing is the boundary: @lasyncro/wms is stubbed to capture the
// props WmsOperationsPage hands WmsModuleFT2 (same precedent as
// WmsOperationsPage.countFocus.test.tsx CONTRACT-1164-UI-12), and the create
// callback is driven directly — dialog selection is already covered elsewhere.
// The POST response mirrors the real create endpoint: 201 { task } where task
// is createRecountTask's return value { recount_task_id, label, line_count }.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { axiosInstance } from 'api/axiosConfig';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// WMS-OPS-NEEDS-ATTENTION-01 — WmsOperationsPage passively reads the canonical
// alerts inbox (useAlerts); runtime owns QueryClientProvider. Each render gets a
// fresh, isolated client with the inbox seeded fresh, so no alerts request fires.
function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ME = 3;
const OTHER_USER_ID = 11;
const NEW_TASK_ID = 'task-1201-new';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'owner' } }),
}));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
const mockRefetch = jest.fn();
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
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

const post = axiosInstance.post as jest.Mock;
const get = axiosInstance.get as jest.Mock;

const claimCalls = () =>
  post.mock.calls.filter(([url]) => /\/recount-tasks\/[^/]+\/claim$/.test(String(url)));

let search = '';
function LocationProbe() {
  search = useLocation().search;
  return null;
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  get.mockResolvedValue({ data: {} });
  mockRefetch.mockReset();
  mockModuleProps.current = null;
  search = '';
  post.mockImplementation(async (url: string) =>
    url === '/api/v1/wms/recount-tasks'
      ? { status: 201, data: { task: { recount_task_id: NEW_TASK_ID, label: 'CNT-47-0002', line_count: 1 } } }
      : { data: {} }
  );
});

async function createFromOperations(assignedTo: number | null) {
  render(
    <MemoryRouter initialEntries={['/wms']}>
      <WmsOperationsPage />
      <LocationProbe />
    </MemoryRouter>, { wrapper: alertsQueryWrapper() });
  await act(async () => {
    await mockModuleProps.current!.onCreateCountingTask({
      scope: 'locations',
      location_codes: ['PICK-01'],
      assigned_to: assignedTo,
    });
  });
  expect(post).toHaveBeenCalledWith('/api/v1/wms/recount-tasks', {
    scope: 'locations',
    location_codes: ['PICK-01'],
    assigned_to: assignedTo,
  });
  return new URLSearchParams(search);
}

describe('GH-1201 — post-create entry routing', () => {
  it('RED-1 unassigned: creator enters the new task Brief at countTaskId only, without claiming', async () => {
    const params = await createFromOperations(null);

    expect(params.get('countTaskId')).toBe(NEW_TASK_ID);
    expect(params.get('warehouseFocus')).toBeNull();
    expect(claimCalls()).toHaveLength(0);
  });

  it('RED-2 assigned to me: creator enters the new task Brief at countTaskId only, without claiming', async () => {
    const params = await createFromOperations(ME);

    expect(params.get('countTaskId')).toBe(NEW_TASK_ID);
    expect(params.get('warehouseFocus')).toBeNull();
    expect(claimCalls()).toHaveLength(0);
  });

  it('RED-3 assigned to another operator: creator stays on ordinary Operations', async () => {
    const params = await createFromOperations(OTHER_USER_ID);

    expect(params.get('countTaskId')).toBeNull();
    expect(params.get('warehouseFocus')).toBeNull();
    expect(search).toBe('');
    expect(claimCalls()).toHaveLength(0);
  });
});

// The entry above lands on /wms?countTaskId=<id>. The newly created ordinary
// task, once resolved from that URL, must show its Brief and must not claim.
describe('GH-1201 — ordinary dispatched task named by countTaskId resolves to its Brief', () => {
  const ordinaryLine = {
    recount_line_id: 'line-1201',
    lasyncro_variant_id: 'variant-1201',
    location_code: 'PICK-01',
    counted_quantity: null,
    count_method: null,
    scan_count: null,
    counted_at: null,
    skip_reason: null,
    skipped_at: null,
    product_title: 'Ordinary product',
    variant_title: null,
    sku: 'SKU-1201',
    image_url: null,
  };

  function renderOrdinaryEntry() {
    const p = {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: ME,
      openReceiveJobs: [],
      stowTasks: [],
      onRefresh: jest.fn(),
      recountLocked: false,
      recountTasks: [{
        recount_task_id: NEW_TASK_ID,
        label: 'CNT-47-0002',
        status: 'dispatched',
        scope: 'locations',
        blind: true,
        assigned_to: null,
        claimed_by: null,
        created_at: '2026-10-01T00:00:00.000Z',
        claimed_at: null,
        claim_generation: null,
        line_count: 1,
        counted_count: 0,
        purpose: 'cycle_count',
        scope_location_code: null,
      }],
      recountTasksSettled: true,
      pendingCountTaskId: NEW_TASK_ID,
      countFocusRequested: false,
      onCountSessionEnter: jest.fn(),
      onCountSessionFocusChange: jest.fn(),
      onSessionExit: jest.fn(),
      onFetchCountingPreview: jest.fn().mockResolvedValue([]),
      onFetchCountingAssignees: jest.fn().mockResolvedValue([]),
      onCreateCountingTask: jest.fn(),
      onFetchCountingLines: jest.fn().mockResolvedValue([ordinaryLine]),
      onFetchCountingFindings: jest.fn().mockResolvedValue([]),
      onCreateCountingFinding: jest.fn(),
      onClaimCountingTask: jest.fn().mockResolvedValue(undefined),
      onReassignCountingTask: jest.fn(),
      onRecordCountingLine: jest.fn(),
      onSkipCountingLine: jest.fn(),
      onCloseCountingTask: jest.fn(),
      onCreateOpeningLine: jest.fn(),
      onCompleteOpening: jest.fn(),
      onResolveBarcode: jest.fn(),
      onSetupBinsClick: jest.fn(),
    } as any;
    render(<WmsModuleFT2 {...p} />);
    return p;
  }

  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it('RED-4 unassigned ordinary task: Brief with explicit Claim & Start Count, no claim on entry', async () => {
    const { onClaimCountingTask } = renderOrdinaryEntry();
    await settle();

    expect({
      claimRequested: onClaimCountingTask.mock.calls.length > 0,
      briefShown: screen.queryByRole('button', { name: 'Claim & Start Count' }) !== null,
    }).toEqual({ claimRequested: false, briefShown: true });
    expect(screen.queryByText(/Shopify stock is a reference only/)).not.toBeInTheDocument();
  });

  it('RED-5 Claim & Start Count claims exactly once and advances into execution', async () => {
    const { onClaimCountingTask } = renderOrdinaryEntry();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Claim & Start Count' }));

    expect(await screen.findByPlaceholderText('Scan bin barcode')).toBeInTheDocument();
    expect(onClaimCountingTask).toHaveBeenCalledTimes(1);
    expect(onClaimCountingTask).toHaveBeenCalledWith(NEW_TASK_ID);
    expect(screen.queryByRole('button', { name: 'Claim & Start Count' })).not.toBeInTheDocument();
  });

  it('Leave count from the ordinary Brief exits without claiming', async () => {
    const p = renderOrdinaryEntry();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Leave count' }));
    await settle();

    expect(p.onSessionExit).toHaveBeenCalledTimes(1);
    expect(p.onClaimCountingTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Claim & Start Count' })).not.toBeInTheDocument();
  });
});
