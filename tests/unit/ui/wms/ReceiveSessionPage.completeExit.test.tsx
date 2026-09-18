// RECEIVE-COMPLETE-EXIT-01
//
// Live defect: after Close Receive, the Stow-handoff screen ("Receive
// complete" / "Back to WMS") rendered correctly, but clicking "Back to WMS"
// crashed with "Objects are not valid as a React child (found: object with
// keys {_reactName, _targetInst, type, nativeEvent, ...})", and the UI could
// then loop between that crash and the handoff screen.
//
// Root cause: ReceiveSessionPage's "Back to WMS" button used
// `onClick={onComplete}`. React always calls an onClick handler with the
// SyntheticEvent, regardless of the handler's declared arity — so this
// forwarded the click event as WmsModuleFT2's exitSession(finishedLabel?:
// string) FIRST argument. `if (finishedLabel)` treated that event object as
// truthy and forwarded it into onCountFinished -> WmsOperationsPage's
// setFinishedCountLabel -> `{finishedCountLabel} counted and submitted for
// review.`, which crashed trying to render the raw event object as a child.
//
// Fix has two layers, both exercised here:
//   1. ReceiveSessionPage: `onClick={() => onComplete()}` — the call site
//      that actually leaked the event.
//   2. WmsModuleFT2.exitSession: requires `typeof finishedLabel === 'string'`
//      before forwarding to onCountFinished — a defense-in-depth guard so
//      the same class of bug at any OTHER onComplete call site (Pick/Pack/
//      Stow/Return, all of which are also wired straight to exitSession)
//      can never again leak a non-string value into session-exit state.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const RECEIVE_JOB_ID = 'job-exit';
const CURRENT_USER_ID = 7;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-exit',
    lasyncro_variant_id: 'variant-exit',
    sku: 'EXIT-SKU',
    variant_title: 'Default Title',
    description: 'Complete-exit receive line',
    quantity_expected: 1,
    image_url: null,
    barcode: null,
    product_title: 'Exit widget',
    ...overrides,
  };
}

function renderClosedSession(overrides: {
  onComplete: jest.Mock;
  onRefresh?: jest.Mock;
}) {
  const props = {
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-exit',
    poNumber: 1,
    supplierName: 'Exit Supplier',
    closedAt: '2026-09-18T00:00:00.000Z',
    actualDeliveryDate: null,
    jobStatus: 'closed',
    assignedOperatorId: CURRENT_USER_ID,
    currentUserId: CURRENT_USER_ID,
    lines: [line()],
    onClaimJob: jest.fn(),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: overrides.onComplete,
    onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
    onResolveBarcode: jest.fn(),
    onRefresh: overrides.onRefresh ?? jest.fn(),
  };

  render(<ReceiveSessionPage {...(props as any)} />);
}

describe('RECEIVE-COMPLETE-EXIT-01 — ReceiveSessionPage "Back to WMS" calls onComplete cleanly', () => {
  it('renders the handoff screen for a closed job', () => {
    renderClosedSession({ onComplete: jest.fn() });

    expect(screen.getByText('Receive complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to WMS' })).toBeInTheDocument();
  });

  it('clicking "Back to WMS" calls onComplete with ZERO arguments — no SyntheticEvent forwarded', () => {
    const onComplete = jest.fn();
    renderClosedSession({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: 'Back to WMS' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    // The exact regression assertion: called with no arguments at all, not
    // with a MouseEvent/SyntheticEvent as an implicit first argument.
    expect(onComplete).toHaveBeenCalledWith();
    expect(onComplete.mock.calls[0]).toHaveLength(0);
  });
});

describe('RECEIVE-COMPLETE-EXIT-01 — WmsModuleFT2 exitSession never leaks the click event into session-exit state', () => {
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
      ...overrides,
    } as any;
  }

  it('"Back to WMS" exits cleanly: does not throw, never calls onCountFinished, fires onSessionExit exactly once, and the handoff screen is replaced by normal WMS Operations content', async () => {
    const onCountFinished = jest.fn();
    const onSessionExit = jest.fn();
    const props = wmsModuleBaseProps({
      pendingReceiveSession: {
        receiveJobId: RECEIVE_JOB_ID,
        poId: 'po-exit',
        poNumber: 1,
        supplierName: 'Exit Supplier',
        jobStatus: 'closed',
        assignedOperatorId: CURRENT_USER_ID,
        closedAt: '2026-09-18T00:00:00.000Z',
        actualDeliveryDate: null,
        lines: [line()],
      },
      onCountFinished,
      onSessionExit,
    });

    render(<WmsModuleFT2 {...props} />);

    expect(await screen.findByText('Receive complete')).toBeInTheDocument();

    // If the bug were present, this click would throw during the resulting
    // state update/render ("Objects are not valid as a React child") —
    // fireEvent/act surfaces that as a thrown error from this call.
    fireEvent.click(screen.getByRole('button', { name: 'Back to WMS' }));

    await waitFor(() => {
      expect(screen.queryByText('Receive complete')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Back to WMS' })).not.toBeInTheDocument();

    // The exact leak this regression guards against: a MouseEvent (or
    // anything else) reaching onCountFinished / downstream session-exit
    // state. For a Receive exit there is no legitimate finishedLabel at
    // all, so this must never fire.
    expect(onCountFinished).not.toHaveBeenCalled();
    expect(onSessionExit).toHaveBeenCalledTimes(1);
  });
});
