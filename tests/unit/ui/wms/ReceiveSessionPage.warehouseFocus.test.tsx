// WAREHOUSE-FOCUS-SHELL-01A
//
// ReceiveSessionPage reports execution-focus (sessionPhase !== 'brief') to
// the parent via onExecutionFocusChange, driven by a single effect over
// sessionPhase — never called ad hoc from individual handlers. This proves
// every path that changes sessionPhase reports focus consistently:
//   - brief (pending, unclaimed-by-me or not yet started)      -> false
//   - a successful claim/start transitioning to inspect/review -> true
//   - a FAILED claim, which never calls setSessionPhase         -> stays false
//   - a canonical in_progress job initializing straight into
//     'inspect' on mount (refresh recovery)                     -> true
//   - handoff (closed job)                                      -> true
//
// Renders the page directly with controlled props — same precedent as
// tests/unit/ui/wms/receive-barcode-readiness-1085.test.tsx: only MUI's
// useTheme() is used internally, which resolves without a ThemeProvider.
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const operationsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx'),
  'utf8',
);

const RECEIVE_JOB_ID = 'job-focus';
const CURRENT_USER_ID = 7;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-focus',
    lasyncro_variant_id: 'variant-focus',
    sku: 'FOCUS-SKU',
    variant_title: 'Default Title',
    description: 'Warehouse focus receive line',
    quantity_expected: 1,
    image_url: null,
    barcode: null,
    product_title: 'Focus widget',
    ...overrides,
  };
}

function renderSession(overrides: {
  jobStatus?: string;
  assignedOperatorId?: number | null;
  closedAt?: string | null;
  onClaimJob?: jest.Mock;
  onExecutionFocusChange?: jest.Mock;
  lines?: ReceiveJobLine[];
}) {
  const onExecutionFocusChange = overrides.onExecutionFocusChange ?? jest.fn();
  const props = {
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-focus',
    poNumber: 1,
    supplierName: 'Focus Supplier',
    closedAt: overrides.closedAt ?? null,
    actualDeliveryDate: null,
    jobStatus: overrides.jobStatus,
    assignedOperatorId: overrides.assignedOperatorId,
    currentUserId: CURRENT_USER_ID,
    lines: overrides.lines ?? [line()],
    onClaimJob: overrides.onClaimJob,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
    onResolveBarcode: jest.fn(),
    onRefresh: jest.fn(),
    onExecutionFocusChange,
  };

  render(<ReceiveSessionPage {...(props as any)} />);
  return { onExecutionFocusChange, onClaimJob: overrides.onClaimJob };
}

describe('WAREHOUSE-FOCUS-SHELL-01A — ReceiveSessionPage execution focus', () => {
  it('Brief (pending job) reports unfocused on mount, never focused', async () => {
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'pending',
      assignedOperatorId: CURRENT_USER_ID,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(false);
    });
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(true);
  });

  it('a successful claim/start reports focused', async () => {
    const onClaimJob = jest.fn().mockResolvedValue(undefined);
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'pending',
      assignedOperatorId: CURRENT_USER_ID,
      onClaimJob,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(false);
    });

    fireEvent.click(await screen.findByRole('button', { name: /claim & start receive/i }));

    await waitFor(() => {
      expect(onClaimJob).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true);
    });
  });

  it('a FAILED claim never reports focused — sessionPhase stays brief', async () => {
    const onClaimJob = jest.fn().mockRejectedValue(new Error('JOB_CLAIMED_BY_OTHER'));
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'pending',
      assignedOperatorId: CURRENT_USER_ID,
      onClaimJob,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(false);
    });

    fireEvent.click(await screen.findByRole('button', { name: /claim & start receive/i }));

    await waitFor(() => {
      expect(onClaimJob).toHaveBeenCalled();
    });
    // Claim error surfaced, still on Brief, CTA still present.
    expect(await screen.findByRole('button', { name: /claim & start receive/i })).toBeInTheDocument();
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(true);
  });

  it('a canonical in_progress job initializes straight into inspect on refresh — reports focused on mount', async () => {
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'in_progress',
      assignedOperatorId: CURRENT_USER_ID,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true);
    });
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(false);
  });

  it('a pending job with no operator assignment (brief, unassigned) reports unfocused', async () => {
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'pending',
      assignedOperatorId: null,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(false);
    });
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(true);
  });

  it('handoff (closed job) remains focused', async () => {
    const { onExecutionFocusChange } = renderSession({
      jobStatus: 'closed',
      closedAt: '2026-09-18T00:00:00.000Z',
      assignedOperatorId: CURRENT_USER_ID,
    });

    await waitFor(() => {
      expect(onExecutionFocusChange).toHaveBeenCalledWith(true);
    });
    expect(onExecutionFocusChange).not.toHaveBeenCalledWith(false);
  });
});

describe('WAREHOUSE-FOCUS-SHELL-01A — WmsModuleFT2 wires the actual receiveJobId through', () => {
  function wmsModuleBaseProps(overrides: Record<string, unknown> = {}) {
    return {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: CURRENT_USER_ID,
      openReceiveJobs: [],
      onReceiveSessionEnter: jest.fn(),
      onCreateReceiveJob: jest.fn(),
      onFetchReceiveJob: jest.fn(),
      onClaimReceiveJob: jest.fn().mockResolvedValue(undefined),
      onInspectReceiveLine: jest.fn(),
      onPersistReceiveLineProgress: jest.fn(),
      onReportReceiveException: jest.fn(),
      onCloseReceiveJob: jest.fn(),
      onPrintUnitLabels: jest.fn(),
      onConfirmUnitLabelsPrinted: jest.fn(),
      onClaimBatch: jest.fn(),
      onFetchLineItems: jest.fn(),
      onResolveBarcode: jest.fn(),
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
      onReceiveSessionFocusChange: jest.fn(),
      ...overrides,
    } as any;
  }

  it('claiming/starting a pending Receive session reports the exact receiveJobId as focused', async () => {
    const props = wmsModuleBaseProps({
      pendingReceiveSession: {
        receiveJobId: RECEIVE_JOB_ID,
        poId: 'po-focus',
        poNumber: 1,
        supplierName: 'Focus Supplier',
        jobStatus: 'pending',
        assignedOperatorId: CURRENT_USER_ID,
        closedAt: null,
        actualDeliveryDate: null,
        lines: [line()],
      },
    });

    render(<WmsModuleFT2 {...props} />);

    expect(props.onReceiveSessionFocusChange).not.toHaveBeenCalledWith(RECEIVE_JOB_ID, true);
    await waitFor(() => {
      expect(props.onReceiveSessionFocusChange).toHaveBeenCalledWith(RECEIVE_JOB_ID, false);
    });

    fireEvent.click(await screen.findByRole('button', { name: /claim & start receive/i }));

    await waitFor(() => {
      expect(props.onReceiveSessionFocusChange).toHaveBeenCalledWith(RECEIVE_JOB_ID, true);
    });
  });

  it('WmsOperationsPage adapter: focused=true adds warehouseFocus=receive, focused=false keeps only receiveJobId, receiveJobId is never removed except by explicit exit', () => {
    expect(operationsSource).toMatch(/onReceiveSessionFocusChange=\{\(jobId, focused\) =>/);
    expect(operationsSource).toMatch(
      /\{ receiveJobId: jobId, warehouseFocus: 'receive' \}/
    );
    expect(operationsSource).toMatch(/: \{ receiveJobId: jobId \}/);
    expect(operationsSource).toMatch(
      /onSessionExit=\{\(\) => setSearchParams\(\{\}, \{ replace: true \}\)\}/
    );
  });
});
