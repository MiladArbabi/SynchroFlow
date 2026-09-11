// GH-1085 / BARCODE-LIFECYCLE-01 — Slice B, contract B8.
//
// The Receive UX contract for physical barcode readiness:
//
//   barcode-less accepted stock
//     inspect/count → LSU records → print labels → EXPLICIT operator
//     acknowledgement ("printed / attached") → backend ack → stow_ready
//
//   BYO external barcode
//     inspect → LSU records for traceability → NO forced print,
//     NO acknowledgement requirement → stow_ready
//
// Today ReceiveSessionPage's inspectAndPrint() fires onPrintUnitLabels after
// EVERY accepted inspection regardless of whether the variant already carries a
// scannable external barcode, which forces relabelling on BYO merchants and
// contradicts B6. And there is no acknowledgement affordance at all, so the PDF
// request succeeding is the only "evidence" the flow ever produces — which is
// exactly the thing that must not count.
//
// Renders the page directly with controlled props: every side effect is an
// injected callback and the component only uses MUI's useTheme(), which
// resolves without a <ThemeProvider>. Same precedent as
// tests/unit/ui/wms/RecountLeaveSemantics.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const RECEIVE_JOB_ID = 'job-1085';
const LINE_ID = 'line-1085';
const VARIANT_ID = 'variant-1085';

/**
 * The acknowledgement affordance is addressed by a stable test id rather than
 * by its visible wording — the copy is the implementer's choice, the existence
 * of an explicit operator action is the contract.
 */
const ACK_TESTID = 'confirm-unit-labels-printed';

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: VARIANT_ID,
    sku: 'GH1085-SKU',
    variant_title: 'Default Title',
    description: 'GH1085 receive line',
    quantity_expected: 1,
    image_url: null,
    barcode: null,
    product_title: 'GH1085 widget',
    ...overrides,
  };
}

function renderSession(overrides: {
  barcode: string | null;
  onInspectLine: jest.Mock;
  onPrintUnitLabels: jest.Mock;
  onConfirmUnitLabelsPrinted: jest.Mock;
}) {
  // Pre-seeding the mode skips the brief screen and lands directly in
  // count mode — the same key ReceiveSessionPage reads on mount.
  sessionStorage.setItem(`receive-mode-${RECEIVE_JOB_ID}`, 'count');

  const props = {
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-1085',
    supplierName: 'GH1085 Supplier',
    lines: [line({ barcode: overrides.barcode })],
    onInspectLine: overrides.onInspectLine,
    onReportException: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: overrides.onPrintUnitLabels,
    onConfirmUnitLabelsPrinted: overrides.onConfirmUnitLabelsPrinted,
  };

  // onConfirmUnitLabelsPrinted is not yet part of ReceiveSessionPageProps —
  // this contract is what requires it.
  return render(<ReceiveSessionPage {...(props as any)} />);
}

/** Accept every expected unit, then confirm the batch. */
async function completeCountInspection() {
  fireEvent.click(await screen.findByRole('button', { name: /set all/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
}

afterEach(() => {
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── Contract A — BYO barcode ────────────────────────────────────────────────

it('B8a — a variant with a real external barcode is never forced through LSU- relabelling', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPrintUnitLabels = jest.fn().mockResolvedValue(undefined);
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPrintUnitLabels,
    onConfirmUnitLabelsPrinted,
  });

  await completeCountInspection();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledTimes(1));
  expect(onInspectLine).toHaveBeenCalledWith(
    expect.objectContaining({
      receive_job_line_id: LINE_ID,
      quantity_accepted: 1,
      quantity_rejected: 0,
    })
  );

  // The units already carry a scannable GTIN. Printing LSU- labels for them is
  // busywork the merchant never asked for.
  expect(onPrintUnitLabels).not.toHaveBeenCalled();

  // And nothing may demand an acknowledgement that was never needed.
  expect(onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(screen.queryByTestId(ACK_TESTID)).toBeNull();
});

// ── Contract B — barcode-less ───────────────────────────────────────────────

it('B8b — barcode-less stock prints LSU- labels and requires an explicit operator acknowledgement', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPrintUnitLabels = jest.fn().mockResolvedValue(undefined);
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: null,
    onInspectLine,
    onPrintUnitLabels,
    onConfirmUnitLabelsPrinted,
  });

  await completeCountInspection();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledTimes(1));

  // Nothing is scannable yet, so labels are produced.
  await waitFor(() => expect(onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID));

  /**
   * The PDF request resolved. That is NOT evidence the labels reached the box,
   * so readiness must not be claimed on its behalf.
   */
  expect(onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();

  // The operator is given an explicit action to confirm printed / attached.
  const acknowledge = await screen.findByTestId(ACK_TESTID);
  fireEvent.click(acknowledge);

  await waitFor(() => expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledWith(LINE_ID));
  expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(1);
});

// ── Contract B, fail-closed ─────────────────────────────────────────────────

it('B8c — a failed acknowledgement keeps the line pending and does not advance the session', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPrintUnitLabels = jest.fn().mockResolvedValue(undefined);
  // The backend refuses the first acknowledgement, then accepts a retry.
  const onConfirmUnitLabelsPrinted = jest
    .fn()
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValueOnce(undefined);

  renderSession({
    barcode: null,
    onInspectLine,
    onPrintUnitLabels,
    onConfirmUnitLabelsPrinted,
  });

  await completeCountInspection();
  await waitFor(() => expect(onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID));

  fireEvent.click(await screen.findByTestId(ACK_TESTID));
  await waitFor(() => expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(1));

  /**
   * The backend never recorded the acknowledgement, so the UI must not behave
   * as though it had. The action stays on screen — which is also the proof the
   * line is still pending and the session has not moved on.
   */
  expect(await screen.findByTestId(ACK_TESTID)).toBeTruthy();

  // Recoverable: the same action retries, and success clears it.
  fireEvent.click(screen.getByTestId(ACK_TESTID));
  await waitFor(() => expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByTestId(ACK_TESTID)).toBeNull());

  // Retrying acknowledgement must never re-inspect the line.
  expect(onInspectLine).toHaveBeenCalledTimes(1);
});

// ── B9 — the real module seam ───────────────────────────────────────────────

/**
 * B8 proves ReceiveSessionPage's behaviour when the callback is supplied.
 * B9 proves the production wiring actually supplies it.
 *
 * WmsOperationsPage → WmsModuleFT2 → ReceiveSessionPage. The middle link is a
 * pure pass-through, and a dropped prop there fails OPEN: the acknowledgement
 * silently no-ops and stock is treated as ready without any backend record.
 * ReceiveSessionPage is stubbed so this asserts the seam only, with none of
 * B8's interaction semantics repeated.
 */
const RECEIVE_SESSION_MODULE = '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';
const WMS_MODULE = '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

it('B9 — WmsModuleFT2 forwards the label acknowledgement callback into ReceiveSessionPage', () => {
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);
  const receivedProps: Record<string, unknown>[] = [];

  /**
   * doMock, not the hoisted jest.mock, so the tests above keep the real page —
   * and deliberately NOT inside jest.isolateModules: an isolated registry
   * re-loads React, which leaves the hook dispatcher null under
   * @testing-library/react. WmsModuleFT2 has not been required by this file
   * yet, so a plain doMock before the first require is enough.
   */
  jest.doMock(RECEIVE_SESSION_MODULE, () => ({
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      receivedProps.push(props);
      return null;
    },
  }));

  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WmsModuleFT2 = require(WMS_MODULE).default;

    const moduleProps = {
      data: { batches: [], readyToPackCount: 0, readyToPackOrders: [] },
      isLoading: false,
      isError: false,
      isOnline: true,
      queuedCount: 0,
      // Hands the module straight into an active receive session, the same way
      // the Suppliers-portal handoff does.
      pendingReceiveSession: {
        receiveJobId: RECEIVE_JOB_ID,
        poId: 'po-1085',
        supplierName: 'GH1085 Supplier',
        lines: [line({ barcode: null })],
      },
      onInspectReceiveLine: jest.fn().mockResolvedValue(undefined),
      onReportReceiveException: jest.fn().mockResolvedValue(undefined),
      onCloseReceiveJob: jest.fn().mockResolvedValue(undefined),
      onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
      onConfirmUnitLabelsPrinted,
      onRefresh: jest.fn(),
    };

    render(<WmsModuleFT2 {...(moduleProps as any)} />);
  }

  // Render count is an implementation detail; the latest props are the seam.
  expect(receivedProps.length).toBeGreaterThan(0);
  const forwarded = receivedProps[receivedProps.length - 1];

  // The exact callback, not merely something truthy — a wrapper that swallows
  // the call would satisfy a looser assertion.
  expect(forwarded.onConfirmUnitLabelsPrinted).toBe(onConfirmUnitLabelsPrinted);
});
