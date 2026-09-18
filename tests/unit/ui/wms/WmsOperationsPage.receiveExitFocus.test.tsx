// RECEIVE-FOCUS-EXIT-02
//
// Live defect: after successful Receive completion and clicking "Back to
// WMS", the active session correctly exited (PO disappeared from Receiving,
// Stow handoff exists) — but the URL kept `?receiveJobId=...&
// warehouseFocus=receive`, so AppLayout/WmsFT2Page kept the topnav, sidenav,
// and module tab bar hidden even though nothing was executing any more.
//
// Root cause: WmsModuleFT2 passed ReceiveSessionPage a FRESH inline
// `onExecutionFocusChange` arrow function on every render. Because
// ReceiveSessionPage's focus effect depends on
// [sessionPhase, onExecutionFocusChange], that unstable identity could
// re-fire the effect (re-reporting focused=true for the session that had
// already been cleared) during the exit sequence's own cascading
// re-renders, racing with — and landing after — onSessionExit's URL
// cleanup and rewriting warehouseFocus/receiveJobId back in.
//
// This suite assembles a small, faithful harness from the REAL production
// pieces: WmsModuleFT2 (live source) and the REAL isWarehouseExecutionFocused
// predicate (apps/frontend/src/utils/warehouseFocus.ts), wired together the
// same way WmsOperationsPage wires them (onSessionExit, onReceiveSessionFocus
// Change, pendingReceiveSession), inside a real MemoryRouter/useSearchParams.
// The full, real WmsOperationsPage is not rendered directly — it requires a
// large API/hook fixture chain unrelated to this defect, and every existing
// test that renders it fully (WmsOperationsPage.receive-queue-handoff-1109
// .test.tsx) has to STUB '@lasyncro/wms' entirely, which would hide the
// exact bug under test here.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams, useLocation } from 'react-router-dom';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import { type ReceiveJobLine } from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';
import { isWarehouseExecutionFocused } from '../../../../apps/frontend/src/utils/warehouseFocus';

const RECEIVE_JOB_ID = 'job-exit-focus';
const CURRENT_USER_ID = 7;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: 'line-exit-focus',
    lasyncro_variant_id: 'variant-exit-focus',
    sku: 'EXIT-FOCUS-SKU',
    variant_title: 'Default Title',
    description: 'Exit-focus receive line',
    quantity_expected: 1,
    image_url: null,
    barcode: null,
    product_title: 'Exit focus widget',
    ...overrides,
  };
}

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

/** Reads the live URL search string into the DOM so assertions can inspect it. */
function UrlProbe() {
  const location = useLocation();
  return <div data-testid="url-probe">{location.search}</div>;
}

/**
 * Faithful reproduction of WmsOperationsPage's Receive URL wiring
 * (onSessionExit / onReceiveSessionFocusChange / pendingReceiveSession),
 * plus the same module-tab-bar focus gate WmsFT2Page applies
 * (WAREHOUSE-FOCUS-SHELL-01B) — using the real isWarehouseExecutionFocused
 * predicate against the SAME searchParams instance WmsModuleFT2 reads and
 * writes through.
 */
function ExitChainHarness() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isExecutionFocused = isWarehouseExecutionFocused(searchParams);
  const receiveJobId = searchParams.get('receiveJobId');

  const pendingReceiveSession = receiveJobId
    ? {
        receiveJobId,
        poId: 'po-exit-focus',
        poNumber: 1,
        supplierName: 'Exit Focus Supplier',
        jobStatus: 'closed',
        assignedOperatorId: CURRENT_USER_ID,
        closedAt: '2026-09-18T00:00:00.000Z',
        actualDeliveryDate: null,
        lines: [line()],
      }
    : null;

  return (
    <>
      <UrlProbe />
      {!isExecutionFocused && <div data-testid="module-tab-bar-stub" />}
      <WmsModuleFT2
        {...wmsModuleBaseProps({
          pendingReceiveSession,
          onSessionExit: () => setSearchParams({}, { replace: true }),
          onReceiveSessionFocusChange: (jobId: string, focused: boolean) =>
            setSearchParams(
              focused
                ? { receiveJobId: jobId, warehouseFocus: 'receive' }
                : { receiveJobId: jobId },
              { replace: true }
            ),
        })}
      />
    </>
  );
}

describe('RECEIVE-FOCUS-EXIT-02 — session exit atomically clears execution focus', () => {
  it('closed Receive handoff self-reports focused, then Back to WMS clears receiveJobId + warehouseFocus and restores module tabs — with no later effect restoring them', async () => {
    render(
      <MemoryRouter initialEntries={[`/wms?receiveJobId=${RECEIVE_JOB_ID}`]}>
        <ExitChainHarness />
      </MemoryRouter>
    );

    // 1. Closed Receive handoff mounts, its own execution-focus effect
    //    fires, and the real onReceiveSessionFocusChange handler adds
    //    warehouseFocus=receive next to the already-present receiveJobId.
    await waitFor(() => {
      const search = screen.getByTestId('url-probe').textContent ?? '';
      expect(search).toContain(`receiveJobId=${RECEIVE_JOB_ID}`);
      expect(search).toContain('warehouseFocus=receive');
    });
    expect(screen.queryByTestId('module-tab-bar-stub')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Back to WMS' })).toBeInTheDocument();

    // 2. Click Back to WMS.
    fireEvent.click(screen.getByRole('button', { name: 'Back to WMS' }));

    // 3. Assert the full exit contract.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Back to WMS' })).not.toBeInTheDocument();
    });
    const finalSearch = screen.getByTestId('url-probe').textContent ?? '';
    expect(finalSearch).not.toContain('receiveJobId');
    expect(finalSearch).not.toContain('warehouseFocus');
    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();

    // Top-level focus predicate resolves false against the final URL.
    const finalParams = new URLSearchParams(finalSearch);
    expect(isWarehouseExecutionFocused(finalParams)).toBe(false);

    // 4. Prove no later effect/tick restores the focus params — flush
    //    several macrotask/microtask cycles (no fixed sleep tied to a
    //    hypothesized race window; this is a settle-then-recheck, not a
    //    timing-dependent assertion) and re-check the URL is still clean.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const settledSearch = screen.getByTestId('url-probe').textContent ?? '';
    expect(settledSearch).not.toContain('receiveJobId');
    expect(settledSearch).not.toContain('warehouseFocus');
    expect(screen.getByTestId('module-tab-bar-stub')).toBeInTheDocument();
  });
});
