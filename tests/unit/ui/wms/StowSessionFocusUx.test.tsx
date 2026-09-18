import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import WmsModuleFT2, { type WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const moduleSource = fs.readFileSync(
  path.resolve(__dirname, '../../../../modules/wms/src/ui/pages/WmsModuleFT2.tsx'),
  'utf8',
);
const operationsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx'),
  'utf8',
);

function task(overrides: Partial<WmsStowTask>): WmsStowTask {
  return {
    stow_task_id: 'stow-a',
    status: 'pending',
    trigger: 'inbound_stock',
    lasyncro_variant_id: 'variant-a',
    quantity: 3,
    quantity_placed: 0,
    location_code: 'BIN-A',
    product_title: 'Focus Widget',
    variant_title: 'Focus Widget / Blue',
    sku: 'FOCUS-1',
    image_url: null,
    unit_ids: [],
    assigned_operator_id: null,
    assigned_operator_name: null,
    claimed_by: null,
    claimed_at: null,
    created_at: '2026-09-17T00:00:00Z',
    ...overrides,
  } as WmsStowTask;
}

function renderSession(options: {
  tasks: WmsStowTask[];
  initialTaskId?: string;
  initialStep?: 'location' | null;
  currentUserId?: number | null;
  confirmFullyPlaced?: boolean;
}): {
  onActiveTaskChange: jest.Mock;
  onClaimTask: jest.Mock;
  onAssignLocation: jest.Mock;
  onConfirmStow: jest.Mock;
} {
  const focusTask = options.tasks.find((t) => t.stow_task_id === options.initialTaskId) ?? options.tasks[0];
  const onConfirmStow = jest.fn().mockResolvedValue({
    stow_task_id: focusTask.stow_task_id,
    quantity_total: focusTask.quantity,
    quantity_placed: options.confirmFullyPlaced ? focusTask.quantity : focusTask.quantity_placed + 1,
    is_fully_placed: Boolean(options.confirmFullyPlaced),
  });
  const props = {
    initialTaskId: options.initialTaskId ?? focusTask.stow_task_id,
    initialStep: options.initialStep ?? null,
    currentUserId: options.currentUserId ?? 7,
    onComplete: jest.fn(),
    onActiveTaskChange: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue(options.tasks),
    onResolveLocation: jest.fn().mockImplementation(async (value: string) =>
      value.startsWith('BIN-') ? { location_code: value } : null
    ),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: focusTask.lasyncro_variant_id,
      lasyncro_unit_id: 'LSU-1',
    }),
    onConfirmStow,
  };

  render(<StowSessionPage {...props} />);
  return props;
}

describe('STOW-UX-FOCUS-01 — Stow focused session UX', () => {
  it('shows exact pending task identity, current-task progress, and claim-forward CTA', async () => {
    renderSession({
      tasks: [
        task({ stow_task_id: 'stow-other', product_title: 'Other Widget', sku: 'OTHER-1', quantity: 9 }),
        task({ stow_task_id: 'stow-focus', product_title: 'Focus Widget', sku: 'FOCUS-1', quantity: 3 }),
      ],
      initialTaskId: 'stow-focus',
    });

    await waitFor(() => {
      expect(screen.getAllByText('Focus Widget').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('FOCUS-1')).toBeInTheDocument();
    expect(screen.getByText('Inbound receive')).toBeInTheDocument();
    expect(screen.getByText('0 / 3')).toBeInTheDocument();
    expect(screen.getByText('Review task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim & start stowing' })).toBeInTheDocument();
    expect(screen.queryByText('Other Widget')).not.toBeInTheDocument();

    // STOW-BRIEF-DECLUTTER-01 — Brief is pre-execution only: no
    // Location/Item/Registered execution rail, no scanner input, no
    // activity panel pretending execution is active.
    expect(screen.queryByTestId('stow-stage-location')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stow-stage-items')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stow-stage-complete')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Scan bin barcode or type location code')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Scan item barcode (LSU- or product barcode)')).not.toBeInTheDocument();
    expect(screen.queryByText('Stow activity', { exact: false })).not.toBeInTheDocument();
  });

  it('clicking the CTA persists the URL/session location step without claiming', async () => {
    const props = renderSession({ tasks: [task({})] });

    // STOW-BRIEF-DECLUTTER-01 — before the click, still pre-execution: no
    // rail yet.
    expect(screen.queryByTestId('stow-stage-location')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Claim & start stowing' }));

    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(props.onActiveTaskChange).toHaveBeenCalledWith('stow-a', 'location');
    expect(props.onClaimTask).not.toHaveBeenCalled();

    // The execution rail now appears, task identity is preserved.
    expect(screen.getByTestId('stow-stage-location')).toBeInTheDocument();
    expect(screen.getAllByText('Focus Widget').length + screen.getAllByText('FOCUS-1').length).toBeGreaterThan(0);
  });

  it('an in_progress resumable task landing on Brief shows Resume stowing with no execution rail, then transitions on resume', async () => {
    const props = renderSession({
      tasks: [
        task({
          stow_task_id: 'stow-resume',
          product_title: 'Resume Widget',
          sku: 'RESUME-1',
          quantity: 3,
          quantity_placed: 1,
          status: 'in_progress',
          claimed_by: 7,
          location_code: 'BIN-A',
        }),
      ],
      // initialTaskId matches nothing in the list, so `tapped` is undefined
      // and bootstrap falls to Brief with tasks[0] as currentTask — the
      // existing (unchanged) path an in_progress task can land on Brief
      // through. See the CTA label logic, which already branches on
      // currentTask.status === 'in_progress'.
      initialTaskId: 'stow-does-not-exist',
    });

    await waitFor(() => {
      expect(screen.getAllByText('Resume Widget').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'Resume stowing' })).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getAllByText('BIN-A').length).toBeGreaterThan(0);

    // STOW-BRIEF-DECLUTTER-01 — no execution rail or scanner input until
    // the operator actually resumes.
    expect(screen.queryByTestId('stow-stage-location')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stow-stage-items')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stow-stage-complete')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Scan bin barcode or type location code')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Scan item barcode (LSU- or product barcode)')).not.toBeInTheDocument();
    expect(props.onClaimTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Resume stowing' }));

    // Resuming transitions into the execution phase: rail appears, task
    // identity/destination/progress preserved.
    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(screen.getByTestId('stow-stage-location')).toBeInTheDocument();
    expect(screen.getAllByText('Resume Widget').length).toBeGreaterThan(0);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getAllByText('BIN-A').length).toBeGreaterThan(0);
  });

  it('restores pending stowStep=location directly into destination scan without bootstrap mutation', async () => {
    const props = renderSession({
      tasks: [task({ status: 'pending', location_code: 'BIN-A' })],
      initialStep: 'location',
    });

    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(screen.queryByText('Stow Session')).not.toBeInTheDocument();
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'active');
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('after destination scan the rail marks Location complete, Items active, and clears stowStep', async () => {
    const props = renderSession({
      tasks: [task({ status: 'pending', location_code: 'BIN-A' })],
      initialStep: 'location',
    });

    const input = await screen.findByPlaceholderText('Scan bin barcode or type location code');
    fireEvent.change(input, { target: { value: 'BIN-A' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(props.onClaimTask).toHaveBeenCalledWith('stow-a');
    });
    expect(props.onActiveTaskChange).toHaveBeenLastCalledWith('stow-a', null);
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'complete');
    expect(screen.getByTestId('stow-stage-items')).toHaveAttribute('data-state', 'active');
  });

  it('advancing to a queued task updates identity instead of showing aggregate task identity', async () => {
    const props = renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', sku: 'FIRST-1', quantity: 1, quantity_placed: 0, status: 'in_progress', claimed_by: 7, location_code: 'B-4' }),
        task({ stow_task_id: 'stow-b', product_title: 'Second Widget', sku: 'SECOND-1', quantity: 2, quantity_placed: 0, status: 'pending', assigned_operator_id: 7, location_code: null }),
      ],
      initialTaskId: 'stow-a',
      confirmFullyPlaced: true,
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getAllByText('Second Widget').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('SECOND-1').length).toBeGreaterThan(0);
    // STOW-UX-SCAN-RAIL-01 — the standalone active-bin card (and its
    // "remaining" copy) was removed as duplicated UI; the same committed
    // progress now lives on the rail's Registered stage as "placed".
    expect(screen.getByText('0 / 2 placed')).toBeInTheDocument();

    // STOW-SESSION-TRANSITION-01 — the auto-advance callback reports Task
    // B's exact ID and phase, never Task A's completed ID.
    expect(props.onActiveTaskChange).toHaveBeenCalledWith('stow-b', 'location');
    expect(props.onActiveTaskChange).not.toHaveBeenCalledWith('stow-a', expect.anything());

    // Rendered task identity is Task B, in the location phase — Task A's
    // sticky B-4 destination must not leak onto the newly active pending
    // task, which owns no destination yet.
    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
    expect(screen.getByTestId('stow-stage-location')).toHaveAttribute('data-state', 'active');
    expect(screen.queryByText('B-4')).not.toBeInTheDocument();
  });

  it('auto-advancing into an already in_progress, already-owned Task B reports step=null and resumes its own destination/progress', async () => {
    const props = renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', sku: 'FIRST-1', quantity: 1, quantity_placed: 0, status: 'in_progress', claimed_by: 7, location_code: 'B-4' }),
        task({ stow_task_id: 'stow-b', product_title: 'Second Widget', sku: 'SECOND-1', quantity: 3, quantity_placed: 1, status: 'in_progress', claimed_by: 7, location_code: 'A-1' }),
      ],
      initialTaskId: 'stow-a',
      confirmFullyPlaced: true,
    });

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getAllByText('Second Widget').length).toBeGreaterThan(0);
    });

    // STOW-SESSION-TRANSITION-01 — Task B is already owned/in_progress with
    // a persisted destination, so the callback reports step=null (no
    // location scan needed) and the UI resumes item_scan directly at A-1
    // with the already-committed progress, not B-4 or a reset count.
    expect(props.onActiveTaskChange).toHaveBeenCalledWith('stow-b', null);
    expect(props.onActiveTaskChange).not.toHaveBeenCalledWith('stow-a', expect.anything());
    expect(screen.queryByPlaceholderText('Scan bin barcode or type location code')).not.toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)')).toBeInTheDocument();
    expect(screen.getAllByText('A-1').length).toBeGreaterThan(0);
    expect(screen.getByText('1 / 3 placed')).toBeInTheDocument();
  });

  it('STOW-LEGACY-LINEAGE-01: auto-advance skips a legacy task purely because the API omits it — valid Task A -> Task B still transitions', async () => {
    // GET /stow-tasks is the execution boundary: a legacy inbound row
    // without Receive lineage never appears in what onFetchTasks resolves.
    // This session never even hears about 'stow-legacy' — there is
    // intentionally no frontend-side lineage filter to test, only that the
    // absence of the row from the API response is sufficient.
    const props = renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', sku: 'FIRST-1', quantity: 1, quantity_placed: 0, status: 'in_progress', claimed_by: 7, location_code: 'B-4' }),
        task({ stow_task_id: 'stow-b', product_title: 'Second Widget', sku: 'SECOND-1', quantity: 2, quantity_placed: 0, status: 'pending', assigned_operator_id: 7, location_code: null }),
      ],
      initialTaskId: 'stow-a',
      confirmFullyPlaced: true,
    });

    // No card, brief, or identity for a legacy task ever renders, because
    // the session was never given one to begin with.
    expect(screen.queryByText('stow-legacy')).not.toBeInTheDocument();

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getAllByText('Second Widget').length).toBeGreaterThan(0);
    });

    // Auto-advance lands on the next VALID task (Task B) — never a legacy
    // row, because none was ever present to select.
    expect(props.onActiveTaskChange).toHaveBeenCalledWith('stow-b', 'location');
    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
  });

  it('does not pull another operator assigned task into the queued active session', async () => {
    renderSession({
      tasks: [
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', status: 'in_progress', claimed_by: 7 }),
        task({ stow_task_id: 'stow-other', product_title: 'Assigned Elsewhere', assigned_operator_id: 22 }),
      ],
      initialTaskId: 'stow-a',
      currentUserId: 7,
    });

    expect(await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)')).toBeInTheDocument();
    expect(screen.queryByText('Assigned Elsewhere')).not.toBeInTheDocument();
  });

  it('uses the existing active-session shell return path and WmsOperations URL step adapter', () => {
    expect(moduleSource).toMatch(/if \(activeSession\?\.type === 'receive'\) \{/);
    expect(moduleSource).toMatch(/if \(activeSession\?\.type === 'stow'\) \{/);
    expect(moduleSource).toMatch(/<StowSessionPage/);
    expect(moduleSource).toMatch(/initialStep=\{pendingStowStep\}/);
    // STOW-SESSION-TRANSITION-01 — the adapter now forwards the CHILD's
    // reported taskId to onStowSessionStepChange, never a taskId read off
    // the activeSession closure (that was the root cause of the stale-URL
    // defect: activeSession.taskId still pointed at a just-completed task
    // after StowSessionPage silently advanced to the next one).
    expect(moduleSource).toMatch(/onActiveTaskChange=\{\(taskId, step\) => \{/);
    expect(moduleSource).toMatch(/onStowSessionStepChange\?\.\(taskId, step\)/);
    expect(moduleSource).not.toMatch(/onStowSessionStepChange\?\.\(activeSession\.taskId, step\)/);
    expect(operationsSource).toMatch(/pendingStowStep=\{searchParams\.get\('stowStep'\) === 'location' \? 'location' : null\}/);
    expect(operationsSource).toMatch(/stowStep: 'location'/);
  });

  it('WAREHOUSE-FOCUS-SHELL-01A: opening a task writes stowTaskId only; every execution step report adds warehouseFocus=stow; exit clears everything', () => {
    // onStowSessionEnter (Brief entry) must NOT add warehouseFocus.
    expect(operationsSource).toMatch(
      /onStowSessionEnter=\{\(id\) => setSearchParams\(\{ stowTaskId: id \}, \{ replace: true \}\)\}/
    );

    // onStowSessionStepChange (any execution phase report, including the
    // transition INTO execution and Task A -> Task B auto-advance) must add
    // warehouseFocus=stow on BOTH branches — location step and item step —
    // so focus stays continuous across an advance, not just on first entry.
    expect(operationsSource).toMatch(/onStowSessionStepChange=\{\(id, step\) =>/);
    expect(operationsSource).toMatch(
      /stowTaskId: id, stowStep: 'location', warehouseFocus: 'stow'/
    );
    expect(operationsSource).toMatch(/: \{ stowTaskId: id, warehouseFocus: 'stow' \}/);

    // Explicit session exit clears every param, including warehouseFocus —
    // normal shell restored.
    expect(operationsSource).toMatch(
      /onSessionExit=\{\(\) => setSearchParams\(\{\}, \{ replace: true \}\)\}/
    );
  });
});

describe('STOW-SESSION-TRANSITION-01 — parent adapter persists the auto-advanced task identity', () => {
  function wmsModuleBaseProps(overrides: Record<string, unknown> = {}) {
    return {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: 7,
      openReceiveJobs: [],
      onReceiveSessionEnter: jest.fn(),
      onCreateReceiveJob: jest.fn(),
      onFetchReceiveJob: jest.fn(),
      onClaimReceiveJob: jest.fn(),
      onInspectReceiveLine: jest.fn(),
      onPersistReceiveLineProgress: jest.fn(),
      onReportReceiveException: jest.fn(),
      onCloseReceiveJob: jest.fn(),
      onPrintUnitLabels: jest.fn(),
      onConfirmUnitLabelsPrinted: jest.fn(),
      onClaimBatch: jest.fn(),
      onFetchLineItems: jest.fn(),
      onResolveBarcode: jest.fn().mockResolvedValue({
        lasyncro_variant_id: 'variant-a',
        lasyncro_unit_id: 'LSU-1',
      }),
      onConfirmScan: jest.fn(),
      onReportException: jest.fn(),
      onCreateProblemTask: jest.fn(),
      onPickComplete: jest.fn(),
      onClaimPack: jest.fn(),
      onFetchPackOrders: jest.fn(),
      onPackFreeScan: jest.fn(),
      onConfirmPackScan: jest.fn(),
      onReportPackException: jest.fn(),
      onPrintLabel: jest.fn(),
      onPrintInvoice: jest.fn(),
      onPackComplete: jest.fn(),
      onConfirmShipment: jest.fn(),
      onRaisePackDecision: jest.fn(),
      onPollPackDecision: jest.fn(),
      onRefresh: jest.fn(),
      stowTasks: [],
      recountLocked: false,
      recountTasks: [],
      onFetchCountingPreview: jest.fn(),
      onFetchCountingAssignees: jest.fn(),
      onCreateCountingTask: jest.fn(),
      onFetchCountingLines: jest.fn(),
      onFetchCountingFindings: jest.fn(),
      onCreateCountingFinding: jest.fn(),
      onClaimCountingTask: jest.fn(),
      onReassignCountingTask: jest.fn(),
      onRecordCountingLine: jest.fn(),
      onSkipCountingLine: jest.fn(),
      onCloseCountingTask: jest.fn(),
      isOnline: true,
      queuedCount: 0,
      onFetchStowTasks: jest.fn().mockResolvedValue([
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', sku: 'FIRST-1', quantity: 1, quantity_placed: 0, status: 'in_progress', claimed_by: 7, location_code: 'B-4' }),
        task({ stow_task_id: 'stow-b', product_title: 'Second Widget', sku: 'SECOND-1', quantity: 2, quantity_placed: 0, status: 'pending', assigned_operator_id: 7, location_code: null }),
      ]),
      onResolveLocation: jest.fn().mockImplementation(async (value: string) =>
        value.startsWith('BIN-') ? { location_code: value } : null
      ),
      onAssignStowLocation: jest.fn().mockResolvedValue(undefined),
      onClaimStowTask: jest.fn().mockResolvedValue(undefined),
      onConfirmStow: jest.fn().mockResolvedValue({
        stow_task_id: 'stow-a',
        quantity_total: 1,
        quantity_placed: 1,
        is_fully_placed: true,
      }),
      onFetchStowPlacements: jest.fn().mockResolvedValue([]),
      pendingStowTaskId: 'stow-a',
      pendingStowStep: null,
      onStowSessionEnter: jest.fn(),
      onStowSessionStepChange: jest.fn(),
      ...overrides,
    } as any;
  }

  it('advancing from completed Task A to Task B updates activeSession.taskId and reports onStowSessionStepChange with the NEW task ID only', async () => {
    const props = wmsModuleBaseProps();

    render(<WmsModuleFT2 {...props} />);

    const input = await screen.findByPlaceholderText('Scan item barcode (LSU- or product barcode)');
    fireEvent.change(input, { target: { value: 'LSU-1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getAllByText('Second Widget').length).toBeGreaterThan(0);
    });

    // The parent adapter must forward Task B's ID to the URL-persistence
    // callback, and must never emit the just-completed Task A ID.
    expect(props.onStowSessionStepChange).toHaveBeenCalledWith('stow-b', 'location');
    expect(props.onStowSessionStepChange).not.toHaveBeenCalledWith('stow-a', expect.anything());

    // The child session, now re-rendered under the parent's updated
    // activeSession.taskId, still shows Task B — proving the local parent
    // state (not just the URL callback) actually moved to Task B.
    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
  });

  it('WAREHOUSE-FOCUS-SHELL-01A: opening a pending task on Brief reports no step change; starting execution reports the location step', async () => {
    const props = wmsModuleBaseProps({
      onFetchStowTasks: jest.fn().mockResolvedValue([
        task({ stow_task_id: 'stow-a', product_title: 'First Widget', sku: 'FIRST-1', quantity: 3, quantity_placed: 0, status: 'pending', location_code: null }),
      ]),
      pendingStowTaskId: 'stow-a',
      pendingStowStep: null,
    });

    render(<WmsModuleFT2 {...props} />);

    // Brief phase: task summary shown, CTA present, no execution reported.
    expect(await screen.findByRole('button', { name: 'Claim & start stowing' })).toBeInTheDocument();
    expect(props.onStowSessionStepChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Claim & start stowing' }));

    // Starting execution reports the exact task ID and the location step —
    // this is what WmsOperationsPage's adapter turns into
    // { stowTaskId, stowStep: 'location', warehouseFocus: 'stow' }.
    await waitFor(() => {
      expect(props.onStowSessionStepChange).toHaveBeenCalledWith('stow-a', 'location');
    });
    expect(await screen.findByPlaceholderText('Scan bin barcode or type location code')).toBeInTheDocument();
  });
});
