import fs from 'fs';
import path from 'path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

// Page-level entry tests (UI-12) render WmsOperationsPage with the same stubs
// as WmsOperationsPage.openingInventoryCutover.test.tsx: @lasyncro/wms is
// stubbed to capture the props the page hands WmsModuleFT2. The UI-11 tests
// below import the real WmsModuleFT2 by path, which this stub does not touch.
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn().mockResolvedValue({ data: {} }), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'owner' } }),
}));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
let mockRecountTasks: unknown[] = [];
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

const ROOT = path.resolve(__dirname, '../../../..');

const moduleSource = fs.readFileSync(
  path.join(ROOT, 'modules/wms/src/ui/pages/WmsModuleFT2.tsx'),
  'utf8'
);

const operationsSource = fs.readFileSync(
  path.join(ROOT, 'apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx'),
  'utf8'
);

// #1164 — task entry is purpose-aware at the page boundary: only Opening
// Inventory begins a protected session (warehouseFocus=count) at entry.
// Ordinary cycle recounts keep the plain countTaskId entry, and an id the
// page cannot resolve never invents protected focus.
describe('CONTRACT-1164-UI-12 — count session entry route is purpose-aware', () => {
  let search = '';
  function LocationProbe() {
    search = useLocation().search;
    return null;
  }

  function enter(tasks: unknown[], id: string) {
    mockRecountTasks = tasks;
    mockModuleProps.current = null;
    render(
      <MemoryRouter initialEntries={['/wms']}>
        <WmsOperationsPage />
        <LocationProbe />
      </MemoryRouter>
    );
    act(() => { mockModuleProps.current!.onCountSessionEnter(id); });
    return new URLSearchParams(search);
  }

  afterEach(() => { mockRecountTasks = []; });

  it('Opening Inventory task entry writes countTaskId + warehouseFocus=count', () => {
    const params = enter([{ recount_task_id: 'oi-1', purpose: 'opening_inventory' }], 'oi-1');
    expect(params.get('countTaskId')).toBe('oi-1');
    expect(params.get('warehouseFocus')).toBe('count');
  });

  it('ordinary cycle recount entry writes countTaskId only — no warehouseFocus', () => {
    const params = enter([{ recount_task_id: 'cc-1', purpose: 'cycle_count' }], 'cc-1');
    expect(params.get('countTaskId')).toBe('cc-1');
    expect(params.get('warehouseFocus')).toBeNull();
  });

  it('an unresolvable task id at entry fails conservative: countTaskId only', () => {
    const params = enter([{ recount_task_id: 'oi-1', purpose: 'opening_inventory' }], 'ghost-1');
    expect(params.get('countTaskId')).toBe('ghost-1');
    expect(params.get('warehouseFocus')).toBeNull();
  });

  // GH-1188 — the module is router-free; the page hands it the URL's count
  // focus intent so the module can hold its ordinary body while resolving.
  it.each([
    ['/wms?countTaskId=x&warehouseFocus=count', true],
    ['/wms?countTaskId=x', false],
  ])('%s passes countFocusRequested=%s to the module', (url, expected) => {
    mockModuleProps.current = null;
    render(
      <MemoryRouter initialEntries={[url]}>
        <WmsOperationsPage />
      </MemoryRouter>
    );
    expect(mockModuleProps.current!.countFocusRequested).toBe(expected);
  });
});

describe('CONTRACT-1164-UI-09 — Opening Inventory count focus adapter', () => {
  it('WmsModule exposes a count-session focus callback carrying task identity', () => {
    expect(moduleSource).toMatch(
      /onCountSessionFocusChange\?:\s*\(taskId:\s*string,\s*focused:\s*boolean\)\s*=>\s*void/
    );
  });

  it('WmsModule forwards CountingSessionPage execution focus through the active count task', () => {
    expect(moduleSource).toMatch(
      /<CountingSessionPage[\s\S]*?onExecutionFocusChange=\{handleCountExecutionFocusChange\}[\s\S]*?\/>/
    );

    expect(moduleSource).toMatch(
      /onCountSessionFocusChangeRef/
    );

    expect(moduleSource).toMatch(
      /activeSessionRef/
    );
  });

  it('WmsOperationsPage maps count focus to warehouseFocus=count and unfocus to countTaskId only', () => {
    expect(operationsSource).toMatch(
      /onCountSessionFocusChange=\{\(taskId,\s*focused\)\s*=>/
    );

    expect(operationsSource).toMatch(
      /\{ countTaskId: taskId,\s*warehouseFocus:\s*['"]count['"] \}/
    );

    expect(operationsSource).toMatch(
      /:\s*\{ countTaskId: taskId \}/
    );
  });

  it('explicit session exit remains the only adapter path that clears count identity and focus together', () => {
    expect(operationsSource).toMatch(
      /onSessionExit=\{\(\)\s*=>\s*setSearchParams\(\{\},\s*\{ replace: true \}\)\}/
    );
  });
});

// #1164 — fail open. A focused count URL (countTaskId + warehouseFocus=count)
// hides app chrome, so once count-task state has settled WmsModuleFT2 must
// report an unresolvable task unfocused through the existing count-focus
// boundary. Loading alone never removes focus; a valid task keeps it.
describe('CONTRACT-1164-UI-11 — invalid focused count URL fails open', () => {
  const TASK_ID = 'task-1164-focus';
  const ME = 7;

  const openingTask = (over: Record<string, unknown> = {}) => ({
    recount_task_id: TASK_ID,
    label: 'CNT-1-1164',
    status: 'dispatched',
    scope: 'location',
    blind: true,
    assigned_to: ME,
    claimed_by: null,
    created_at: '2026-09-26T00:00:00.000Z',
    claimed_at: null,
    claim_generation: null,
    line_count: 0,
    counted_count: 0,
    purpose: 'opening_inventory',
    scope_location_code: 'PICK-01',
    ...over,
  });

  function props(over: Record<string, unknown> = {}) {
    return {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: ME,
      openReceiveJobs: [],
      stowTasks: [],
      onRefresh: jest.fn(),
      recountLocked: false,
      recountTasks: [],
      recountTasksSettled: true,
      pendingCountTaskId: TASK_ID,
      onCountSessionEnter: jest.fn(),
      onCountSessionFocusChange: jest.fn(),
      onSessionExit: jest.fn(),
      onFetchCountingPreview: jest.fn().mockResolvedValue([]),
      onFetchCountingAssignees: jest.fn().mockResolvedValue([]),
      onCreateCountingTask: jest.fn(),
      onFetchCountingLines: jest.fn().mockResolvedValue([]),
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
      ...over,
    } as any;
  }

  const settle = async () => {
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it.each([
    ['dispatched to me (Brief)', openingTask()],
    ['claimed by me (execution)', openingTask({ status: 'claimed', claimed_by: ME, claimed_at: '2026-09-26T00:00:00.000Z', claim_generation: 'gen-1' })],
  ])('valid task %s from a countTaskId-only entry: the session opens and acquires focus', async (_label, task) => {
    const p = props({ recountTasks: [task] });
    render(<WmsModuleFT2 {...p} />);

    expect(await screen.findByRole('button', { name: 'Leave count' })).toBeInTheDocument();
    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, true));
    await settle();
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, false);
  });

  it.each([
    ['missing from settled tasks', { recountTasks: [] }],
    ['dispatched to another operator', { recountTasks: [openingTask({ assigned_to: 99 })] }],
    ['claimed by another user', { recountTasks: [openingTask({ status: 'claimed', claimed_by: 99, assigned_to: 99 })] }],
    ['recount locked', { recountLocked: true, recountTasks: [openingTask()] }],
  ])('%s: focus is removed through the count-focus boundary, keeping the task id', async (_label, over) => {
    const p = props(over);
    render(<WmsModuleFT2 {...p} />);

    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, false));
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, true);
    expect(screen.queryByRole('button', { name: /claim.*start.*count/i })).not.toBeInTheDocument();
  });

  it.each([
    ['task read still loading', { recountTasks: [] }],
    ['entitlements still resolving (locked by default tier)', { recountLocked: true, recountTasks: [] }],
  ])('%s: loading alone does not remove focus', async (_label, over) => {
    const p = props({ ...over, recountTasksSettled: false });
    render(<WmsModuleFT2 {...p} />);

    await settle();
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, false);
  });

  it('ordinary cycle recount resolved from its URL never receives a protected focus report', async () => {
    const p = props({ recountTasks: [openingTask({ purpose: 'cycle_count', scope_location_code: null })] });
    render(<WmsModuleFT2 {...p} />);

    // The session is established (CountingSessionPage mounted and reading lines).
    await waitFor(() => expect(p.onFetchCountingLines).toHaveBeenCalled());
    await settle();
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, true);
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, false);
  });

  it('fail-open then recovery: an unresolved task drops focus, and the same task reacquires it once usable', async () => {
    const p = props({ recountTasks: [openingTask({ assigned_to: 99 })] });
    const { rerender } = render(<WmsModuleFT2 {...p} />);

    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, false));
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, true);

    rerender(<WmsModuleFT2 {...p} recountTasks={[openingTask()]} />);

    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenLastCalledWith(TASK_ID, true));
  });

  it('loading then resolved: no premature unfocus, then focus once the valid task resolves', async () => {
    const p = props({ recountTasks: [], recountTasksSettled: false });
    const { rerender } = render(<WmsModuleFT2 {...p} />);

    await settle();
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalled();

    rerender(<WmsModuleFT2 {...p} recountTasks={[openingTask()]} recountTasksSettled />);

    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, true));
    expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, false);
  });

  // GH-1188 — protected mode begins at the Brief, so a focused count URL must
  // never paint the ordinary Warehouse body while the task is resolving. The
  // URL hint only covers the unresolved transition; settlement still decides.
  describe('GH-1188 — focused count URL never paints the ordinary Warehouse body', () => {
    // GH-1222: "Reconcile inventory" is this block's ordinary-body marker and is
    // an owner/admin management CTA (canManageRecount, fail-closed by default).
    // The file's persona is owner (useAuth mock above), so the module receives
    // canManageRecount explicitly — otherwise the marker's absence would be
    // vacuous evidence of a hold.
    const mgmtProps = (over: Record<string, unknown>) => props({ canManageRecount: true, ...over });
    const hold = () => screen.queryByRole('status', { name: 'Loading count session' });
    const ordinaryControl = (root: HTMLElement) =>
      within(root).queryByRole('button', { name: 'Reconcile inventory', hidden: true });

    // RTL's render() flushes passive effects before returning, so the first
    // committed frame is captured from the DOM mutations it produced.
    function renderRecordingCommits(p: Record<string, unknown>) {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const observer = new MutationObserver(() => {});
      observer.observe(container, { childList: true, subtree: true });
      const result = render(<WmsModuleFT2 {...p} />, { container });
      const inserted = observer
        .takeRecords()
        .flatMap((record) => Array.from(record.addedNodes))
        .filter((node): node is HTMLElement => node instanceof HTMLElement);
      observer.disconnect();
      return { ...result, inserted };
    }

    it('pending resolution: protected hold, no ordinary body, no Brief, no fail-open', async () => {
      const p = mgmtProps({ countFocusRequested: true, recountTasks: [], recountTasksSettled: false });
      const { inserted } = renderRecordingCommits(p);

      expect(inserted.some((node) => ordinaryControl(node))).toBe(false);
      expect(screen.queryByRole('button', { name: 'Reconcile inventory' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Leave count' })).not.toBeInTheDocument();
      expect(hold()).toBeInTheDocument();
      await settle();
      expect(p.onCountSessionFocusChange).not.toHaveBeenCalledWith(TASK_ID, false);
    });

    it('settled usable task on first render: the first committed frame is protected', async () => {
      const p = mgmtProps({ countFocusRequested: true, recountTasks: [openingTask()], recountTasksSettled: true });
      const { inserted } = renderRecordingCommits(p);

      expect(inserted.length).toBeGreaterThan(0);
      const firstFrame = inserted[0];
      expect(ordinaryControl(firstFrame)).toBeNull();
      const firstFrameIsLoadingHold =
        firstFrame.getAttribute('role') === 'status' &&
        firstFrame.getAttribute('aria-label') === 'Loading count session';
      const firstFrameContainsBrief =
        within(firstFrame).queryByRole('button', {
          name: 'Leave count',
          hidden: true,
        }) !== null;
      expect(firstFrameIsLoadingHold || firstFrameContainsBrief).toBe(true);
      expect(inserted.some((node) => ordinaryControl(node))).toBe(false);

      expect(await screen.findByRole('button', { name: 'Leave count' })).toBeInTheDocument();
      expect(hold()).not.toBeInTheDocument();
    });

    it('pending then resolved: the hold hands off to the Brief without the ordinary body', async () => {
      const p = mgmtProps({ countFocusRequested: true, recountTasks: [], recountTasksSettled: false });
      const { rerender } = render(<WmsModuleFT2 {...p} />);
      expect(hold()).toBeInTheDocument();

      rerender(<WmsModuleFT2 {...p} recountTasks={[openingTask()]} recountTasksSettled />);

      expect(screen.queryByRole('button', { name: 'Reconcile inventory' })).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Leave count' })).toBeInTheDocument();
      await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, true));
      expect(hold()).not.toBeInTheDocument();
    });

    it.each([
      ['missing from settled tasks', { recountTasks: [] }],
      ['dispatched to another operator', { recountTasks: [openingTask({ assigned_to: 99 })] }],
      ['claimed by another operator', { recountTasks: [openingTask({ status: 'claimed', claimed_by: 99, assigned_to: 99 })] }],
      // useWms maps a failed task read to recountLocked=true, so this row also
      // covers the read-error state at the module boundary.
      ['recount locked', { recountLocked: true, recountTasks: [openingTask()] }],
    ])('settled unusable (%s): no hold, fail-open preserved, ordinary body available', async (_label, over) => {
      const p = mgmtProps({ countFocusRequested: true, recountTasksSettled: true, ...over });
      render(<WmsModuleFT2 {...p} />);

      await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, false));
      expect(hold()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconcile inventory' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Leave count' })).not.toBeInTheDocument();
    });

    it('ordinary cycle recount entry (countTaskId only): no hold while resolving', () => {
      const p = mgmtProps({ countFocusRequested: false, recountTasks: [], recountTasksSettled: false });
      render(<WmsModuleFT2 {...p} />);

      expect(hold()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconcile inventory' })).toBeInTheDocument();
    });
  });
});
