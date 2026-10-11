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
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
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
  lines?: ReceiveJobLine[];
  mode?: 'count' | 'scan';
  onResolveBarcode?: jest.Mock;
  onReportException?: jest.Mock;
  onApproveOverDelivery?: jest.Mock;
  onPersistLineProgress?: jest.Mock;
  onCloseJob?: jest.Mock;
  onRefresh?: jest.Mock;
  closedAt?: string | null;
  actualDeliveryDate?: string | null;
  skipStoredMode?: boolean;
}) {
  const lines = overrides.lines ?? [line({ barcode: overrides.barcode })];

  const props = {
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-1085',
    supplierName: 'GH1085 Supplier',
    closedAt: overrides.closedAt ?? null,
    actualDeliveryDate: overrides.actualDeliveryDate ?? null,
    lines,
    onInspectLine: overrides.onInspectLine,
    onReportException: overrides.onReportException ?? jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: overrides.onApproveOverDelivery ?? jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: overrides.onPersistLineProgress,
    onCloseJob: overrides.onCloseJob ?? jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: overrides.onPrintUnitLabels,
    onConfirmUnitLabelsPrinted: overrides.onConfirmUnitLabelsPrinted,
    onResolveBarcode: overrides.onResolveBarcode,
    onRefresh: overrides.onRefresh,
  };

  // onConfirmUnitLabelsPrinted is not yet part of ReceiveSessionPageProps —
  // this contract is what requires it.
  return render(<ReceiveSessionPage {...(props as any)} />);
}

async function enterReceiveExecution(mode: 'count' | 'scan' = 'count') {
  const start = screen.queryByRole('button', { name: /start receive/i });
  if (start) fireEvent.click(start);

  if (mode === 'count') {
    const count = screen.queryByRole('button', { name: /^count$/i });
    if (count) fireEvent.click(count);
    return;
  }

  const scanMode = screen.queryByRole('button', { name: /^scan$/i });
  if (scanMode) fireEvent.click(scanMode);
  await screen.findByPlaceholderText(/scan barcode/i);
}

/** Accept every expected unit, then confirm the batch. */
async function completeCountInspection() {
  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm line/i }));
}

async function scan(value: string) {
  const input = await screen.findByPlaceholderText(/scan barcode/i);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  return input;
}

afterEach(() => {
  cleanup();
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

it('R1 — the receive brief exposes job, product, variant, barcode, and quantity context', () => {
  renderSession({
    barcode: '5012345678900',
    skipStoredMode: true,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({
        product_title: 'Context product',
        variant_title: 'Blue / Large',
        sku: 'CTX-SKU',
        barcode: '5012345678900',
        quantity_expected: 7,
      }),
    ],
  });

  expect(screen.getByText(/receive from gh1085 supplier/i)).toBeTruthy();
  expect(screen.getByText(/job-1085/i)).toBeTruthy();
  expect(screen.getAllByText(/context product/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/blue \/ large/i)).toBeTruthy();
  expect(screen.getAllByText(/5012345678900/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText('7').length).toBeGreaterThan(0);
});

it('R2 — barcode-less lines do not advertise scan treatment as available for that line', () => {
  renderSession({
    barcode: null,
    skipStoredMode: true,
    onResolveBarcode: jest.fn().mockResolvedValue(null),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({
        product_title: 'No barcode product',
        barcode: null,
      }),
    ],
  });

  const productRow = screen.getByText(/barcode-less: LSU labels after count/i).closest('tr');
  expect(productRow).toBeTruthy();
  expect(within(productRow as HTMLElement).queryByText(/scan/i)).toBeNull();
  expect(within(productRow as HTMLElement).getByText(/barcode-less/i)).toBeTruthy();
});

it('R3 — switching receive treatment is local to the current line', async () => {
  const scanLine = line({
    receive_job_line_id: 'line-scan',
    lasyncro_variant_id: 'variant-scan',
    product_title: 'Scannable product',
    barcode: '5012345678900',
    quantity_expected: 1,
  });
  const nextScanLine = line({
    receive_job_line_id: 'line-next-scan',
    lasyncro_variant_id: 'variant-next-scan',
    product_title: 'Next scannable product',
    barcode: '5099999999999',
    quantity_expected: 1,
  });
  const onInspectLine = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    lines: [scanLine, nextScanLine],
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: 'variant-scan' }),
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(screen.getByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm line/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledTimes(1));

  expect(await screen.findByPlaceholderText(/scan barcode/i)).toBeTruthy();
});

it('R4 — completed lines cannot reopen through scan or count transitions', async () => {
  const completed = line({
    receive_job_line_id: 'line-complete',
    lasyncro_variant_id: 'variant-complete',
    product_title: 'Already complete product',
    barcode: '5012345678900',
    quantity_expected: 1,
    quantity_accepted: 1,
    inspection_complete: true,
  });
  const open = line({
    receive_job_line_id: 'line-open',
    lasyncro_variant_id: 'variant-open',
    product_title: 'Open product',
    barcode: '5099999999999',
    quantity_expected: 1,
  });
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onResolveBarcode = jest
    .fn()
    .mockResolvedValueOnce({ lasyncro_variant_id: 'variant-complete' })
    .mockResolvedValueOnce({ lasyncro_variant_id: 'variant-open' });

  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    lines: [completed, open],
    onResolveBarcode,
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('scan');

  await scan('5012345678900');
  await waitFor(() => expect(screen.getByText(/different receive line/i)).toBeTruthy());
  expect(onInspectLine).not.toHaveBeenCalled();

  await scan('5099999999999');
  fireEvent.click(await screen.findByRole('button', { name: /confirm line/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledTimes(1));
  expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    receive_job_line_id: 'line-open',
  }));
});

it('R5 — continuous scan restores scanner focus after success and recoverable scan errors', async () => {
  const onResolveBarcode = jest
    .fn()
    .mockResolvedValueOnce({ lasyncro_variant_id: VARIANT_ID })
    .mockResolvedValueOnce(null);

  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    onResolveBarcode,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({ quantity_expected: 2, barcode: '5012345678900' }),
    ],
  });

  await enterReceiveExecution('scan');
  const input = await scan('5012345678900');
  await waitFor(() => expect(document.activeElement).toBe(input));

  await scan('unknown');
  await waitFor(() => expect(screen.getByText(/not recognised/i)).toBeTruthy());
  await waitFor(() => expect(document.activeElement).toBe(input));
});

it('R6 — human-decision states release scanner capture and do not autofocus consequential CTAs', async () => {
  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({ quantity_expected: 0, barcode: '5012345678900' }),
    ],
  });

  await enterReceiveExecution('scan');
  const input = await scan('5012345678900');

  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(document.activeElement).not.toBe(input);
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /accept extra/i }));
});

it('R7 — label hold preserves accepted quantity and removes conflicting inspection actions', async () => {
  renderSession({
    barcode: null,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await completeCountInspection();
  await screen.findByTestId(ACK_TESTID);

  expect(screen.getByText(/1\/1/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /confirm batch|confirm & finish|finish & review/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /report problem/i })).toBeNull();
});

it('R8 — the miscount path cannot bypass label acknowledgement', async () => {
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: null,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted,
    lines: [
      line({ barcode: null, quantity_expected: 2 }),
    ],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /confirm line/i }));
  fireEvent.click(await screen.findByText(/miscounted/i));

  expect(await screen.findByTestId(ACK_TESTID)).toBeTruthy();
  expect(screen.queryByText(/close receive session/i)).toBeNull();
  expect(onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
});

it('R9 — barcode-less lines are count-only and cannot reach Review before LSU label acknowledgement', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPrintUnitLabels = jest.fn().mockResolvedValue(undefined);
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: null,
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine,
    onPrintUnitLabels,
    onConfirmUnitLabelsPrinted,
  });

  expect(screen.queryByRole('button', { name: /^scan$/i })).toBeNull();
  expect(screen.getByText(/barcode-less: LSU labels after count/i)).toBeTruthy();

  await enterReceiveExecution('count');

  expect(screen.getByText(/count line/i)).toBeTruthy();
  expect(screen.queryByPlaceholderText(/scan barcode/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /^scan$/i })).toBeNull();

  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /confirm line/i }));

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    receive_job_line_id: LINE_ID,
    quantity_accepted: 1,
    quantity_rejected: 0,
  })));
  await waitFor(() => expect(onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID));

  expect(await screen.findByTestId(ACK_TESTID)).toBeTruthy();
  expect(screen.queryByText(/review receive/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /close receive/i })).toBeNull();
  expect(onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId(ACK_TESTID));

  await waitFor(() => expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledWith(LINE_ID));
  expect(await screen.findByText(/review receive/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /close receive/i })).toBeTruthy();
});

it('R10 — refresh/resume restores canonical label-hold state', () => {
  renderSession({
    barcode: null,
    mode: 'scan',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({
        barcode: null,
        quantity_expected: 1,
        quantity_accepted: 1,
        inspection_complete: true,
        awaiting_label_ack: true,
      }),
    ],
  });

  expect(screen.getByTestId(ACK_TESTID)).toBeTruthy();
  expect(screen.queryByText(/inspection complete/i)).toBeNull();
});

it('R11 — failed problem reporting keeps the dialog context and entered values', async () => {
  const onReportException = jest.fn().mockRejectedValue(new Error('problem center offline'));

  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onReportException,
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /report problem/i }));
  fireEvent.click(screen.getByRole('button', { name: /barcode problem/i }));
  fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText(/barcode value/i), { target: { value: 'BAD-CODE' } });
  fireEvent.click(screen.getByRole('button', { name: /^report problem$/i }));

  await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByLabelText(/qty affected/i)).toHaveValue(3);
  expect(screen.getByLabelText(/barcode value/i)).toHaveValue('BAD-CODE');
});

it('R11b — canonical reported problems render without changing receive quantities', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({
        barcode: '5012345678900',
        quantity_expected: 3,
        quantity_accepted: 1,
        reported_problems: [
          {
            receive_exception_id: 'rex-1085',
            exception_type: 'wrong_item',
            quantity_affected: 1,
            notes: 'Wrong product in supplier carton',
            resolved: false,
            raised_at: '2026-09-13T10:00:00.000Z',
          },
        ],
      }),
    ],
  });

  await enterReceiveExecution('count');
  expect(screen.getAllByText(/1 problem reported/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/^wrong product$/i)).toBeTruthy();
  expect(screen.getByText(/^1 unit$/i)).toBeTruthy();
  expect(screen.getByText(/^problem center$/i)).toBeTruthy();
  expect(screen.getByText(/1 \/ 3/i)).toBeTruthy();
  expect(screen.getByText(/remaining 2/i)).toBeTruthy();
});

it('R11c — successful problem reporting refreshes from canonical receive-job state', async () => {
  const onReportException = jest.fn().mockResolvedValue(undefined);
  const onRefresh = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onReportException,
    onRefresh,
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /report problem/i }));
  fireEvent.click(screen.getByRole('button', { name: /wrong product/i }));
  await screen.findByLabelText(/qty affected/i);
  fireEvent.click(screen.getByRole('button', { name: /^report problem$/i }));

  await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('R12 — expected plus one over-delivery persists canonical overage approval before inspection in count and scan paths', async () => {
  // GH-1108 / RECEIVE-OVERCOUNT-01 — "Accept extra" must persist the
  // canonical overage evidence (extra_item / accounting_role=overage) BEFORE
  // ever attempting the inspection, in both call order and outcome: the
  // backend fails closed on an over-expected inspection without that
  // evidence already existing.
  const countInspect = jest.fn().mockResolvedValue(undefined);
  const countApprove = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine: countInspect,
    onApproveOverDelivery: countApprove,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  expect(countApprove).toHaveBeenCalledWith(expect.objectContaining({
    lasyncro_variant_id: VARIANT_ID,
    receive_job_line_id: LINE_ID,
    quantity_affected: 1,
  }));
  await waitFor(() => expect(countInspect).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 2,
    quantity_rejected: 0,
  })));
  expect(countApprove.mock.invocationCallOrder[0])
    .toBeLessThan(countInspect.mock.invocationCallOrder[0]);

  cleanup();
  sessionStorage.clear();
  const scanInspect = jest.fn().mockResolvedValue(undefined);
  const scanApprove = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: scanInspect,
    onApproveOverDelivery: scanApprove,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [
      line({ barcode: '5012345678900', quantity_expected: 1 }),
    ],
  });

  await enterReceiveExecution('scan');
  await scan('5012345678900');
  await waitFor(() => expect(screen.getByText(/1\/1/)).toBeTruthy());
  await scan('5012345678900');
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  expect(scanApprove).toHaveBeenCalledWith(expect.objectContaining({
    lasyncro_variant_id: VARIANT_ID,
    receive_job_line_id: LINE_ID,
    quantity_affected: 1,
  }));
  await waitFor(() => expect(scanInspect).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 2,
    quantity_rejected: 0,
  })));
  expect(scanApprove.mock.invocationCallOrder[0])
    .toBeLessThan(scanInspect.mock.invocationCallOrder[0]);
});

it('R12b — a rejected overage approval keeps the decision open, preserves the counted quantity, and never inspects', async () => {
  const inspect = jest.fn().mockResolvedValue(undefined);
  const approve = jest.fn().mockRejectedValue(new Error('overage approval failed'));
  renderSession({
    barcode: '5012345678900',
    onInspectLine: inspect,
    onApproveOverDelivery: approve,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));

  await screen.findByText(/overage approval failed/i);

  // No optimistic completion: the decision dialog stays open with the
  // counted quantity intact, and inspect was never attempted.
  const dialog = screen.getByRole('dialog', { name: /extra unit detected/i });
  expect(within(dialog).getByText('2')).toBeTruthy();
  expect(inspect).not.toHaveBeenCalled();

  // Retryable: the same action can be invoked again.
  expect(screen.getByRole('button', { name: /accept extra/i })).not.toBeDisabled();
});

it('R12c — "Do not receive extra" restores provisional quantity to expected and never approves or inspects the overage', async () => {
  const inspect = jest.fn().mockResolvedValue(undefined);
  const approve = jest.fn().mockResolvedValue(undefined);
  const persistProgress = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine: inspect,
    onApproveOverDelivery: approve,
    onPersistLineProgress: persistProgress,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  await screen.findByRole('dialog', { name: /extra unit detected/i });

  fireEvent.click(screen.getByRole('button', { name: /do not receive extra/i }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(persistProgress).toHaveBeenCalledWith(
    LINE_ID,
    expect.objectContaining({ quantity_sellable_provisional: 1 }),
  ));
  expect(approve).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
});

it('R12d — "Report problem" opens the explicit Problem Center report and never silently approves or inspects the overage', async () => {
  const inspect = jest.fn().mockResolvedValue(undefined);
  const approve = jest.fn().mockResolvedValue(undefined);
  const reportException = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine: inspect,
    onApproveOverDelivery: approve,
    onReportException: reportException,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  await screen.findByRole('dialog', { name: /extra unit detected/i });

  fireEvent.click(screen.getByRole('button', { name: /report problem/i }));

  await waitFor(() => expect(screen.queryByRole('dialog', { name: /extra unit detected/i })).toBeNull());
  expect(approve).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /report problem/i }));

  await waitFor(() => expect(reportException).toHaveBeenCalledWith(expect.objectContaining({
    receive_job_line_id: LINE_ID,
    exception_type: 'extra_item',
    quantity_affected: 1,
  })));
  expect(approve).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
});

it('R12f — refresh/re-entry with a persisted overage approval reconstructs the approved over-delivery decision instead of relying on local UI state', async () => {
  // GH-1108 / RECEIVE-OVERCOUNT-01 — acceptance: "Refresh/re-entry after
  // persisted overage approval reconstructs the canonical over-delivery
  // state rather than relying on local UI state." Simulates a fresh mount
  // (the only way overDeliveryDecision's local state can exist at all) with
  // exactly the canonical server shape a refresh would deliver: an
  // uninspected line whose provisional count already exceeds expected and
  // whose reconciliation carries the persisted overage_approved evidence.
  const inspect = jest.fn().mockResolvedValue(undefined);
  const approve = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine: inspect,
    onApproveOverDelivery: approve,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      barcode: '5012345678900',
      quantity_expected: 1,
      quantity_accepted: 0,
      quantity_sellable_provisional: 2,
      inspection_complete: false,
      reconciliation: {
        expected: 1,
        sellable: 2,
        accounted: 0,
        unaccounted: 0,
        allocations: [],
        overage_approved: true,
      },
    })],
  });

  // The approved over-delivery decision is restored on render, not left
  // null awaiting a fresh over-count in this session.
  const dialog = await screen.findByRole('dialog', { name: /extra unit detected/i });
  expect(within(dialog).getByText('2')).toBeTruthy();

  fireEvent.click(within(dialog).getByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  // Already-persisted approval must not be persisted again.
  expect(approve).not.toHaveBeenCalled();
  // The operator finishes the already-approved overage against the actual
  // provisional quantity (expected 1 + 1).
  await waitFor(() => expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
    receive_job_line_id: LINE_ID,
    quantity_accepted: 2,
    quantity_rejected: 0,
  })));
});

it('R12e — Review truthfully reports expected, accepted, and extra for an approved over-delivery', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  expect(await screen.findByText(/review receive/i)).toBeTruthy();

  const lineRow = screen
    .getAllByText('GH1085 widget')
    .map((node) => node.closest('tr'))
    .find((row): row is HTMLTableRowElement => row !== null);
  expect(lineRow).toBeTruthy();
  // Line / Expected / Received / Extra / Problems / Status
  expect(lineRow?.querySelectorAll('td')[1]?.textContent).toBe('1');
  expect(lineRow?.querySelectorAll('td')[2]?.textContent).toBe('2');
  expect(lineRow?.querySelectorAll('td')[3]?.textContent).toBe('1');
});

it('R13 — count and scan converge on equivalent review semantics', async () => {
  const countClose = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onCloseJob: countClose,
  });
  await completeCountInspection();
  expect(await screen.findByText(/review receive/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /close receive/i })).toBeTruthy();

  cleanup();
  sessionStorage.clear();
  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });
  await enterReceiveExecution('scan');
  await scan('5012345678900');
  fireEvent.click(await screen.findByRole('button', { name: /confirm line/i }));
  expect(await screen.findByText(/review receive/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /close receive/i })).toBeTruthy();
});


it('R13b — Review reports canonical problem records instead of legacy quantity_rejected', async () => {
  const problems = [
    {
      receive_exception_id: 'problem-1',
      exception_type: 'defect',
      quantity_affected: 1,
      accounting_role: 'shortfall',
      counts_toward_shortfall: true,
      resolved: false,
    },
    {
      receive_exception_id: 'problem-2',
      exception_type: 'wrong_item',
      quantity_affected: 1,
      accounting_role: 'shortfall',
      counts_toward_shortfall: true,
      resolved: false,
    },
    {
      receive_exception_id: 'problem-3',
      exception_type: 'missing_item',
      quantity_affected: 1,
      accounting_role: 'shortfall',
      counts_toward_shortfall: true,
      resolved: false,
    },
  ];

  renderSession({
    barcode: '5012345678900',
    lines: [line({
      barcode: '5012345678900',
      quantity_expected: 10,
      quantity_accepted: 7,
      quantity_rejected: 0,
      inspection_complete: true,
      barcode_ready: true,
      reported_problems: problems,
      reconciliation: {
        expected: 10,
        sellable: 7,
        accounted: 3,
        unaccounted: 0,
        allocations: problems,
      },
    })],
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  expect(await screen.findByText(/review receive/i)).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: /^problems$/i })).toBeTruthy();

  const lineRow = screen
    .getAllByText('GH1085 widget')
    .map((node) => node.closest('tr'))
    .find((row): row is HTMLTableRowElement => row !== null);

  expect(lineRow).toBeTruthy();
  expect(lineRow?.querySelectorAll('td')[1]?.textContent).toBe('10');
  expect(lineRow?.querySelectorAll('td')[2]?.textContent).toBe('7');
  expect(lineRow?.querySelectorAll('td')[4]?.textContent).toBe('3');

  const totalRow = screen.getByText('Total').closest('tr');
  expect(totalRow).toBeTruthy();
  expect(totalRow?.querySelectorAll('td')[2]?.textContent).toBe('7');
  expect(totalRow?.querySelectorAll('td')[4]?.textContent).toBe('3');
});


it('R13c — Review requires an actual delivery date before Receive can close', async () => {
  const onCloseJob = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onCloseJob,
  });

  await completeCountInspection();

  const closeButton = await screen.findByRole('button', { name: /^close receive$/i });
  expect((closeButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText(/actual delivery date/i), {
    target: { value: '2026-09-14' },
  });

  expect((closeButton as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(closeButton);

  await waitFor(() => {
    expect(onCloseJob).toHaveBeenCalledWith({
      actual_delivery_date: '2026-09-14',
    });
  });
});

it('R14 — receive close produces the approved handoff without fabricated Stow facts', async () => {
  const onCloseJob = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onCloseJob,
  });

  await completeCountInspection();

  fireEvent.change(await screen.findByLabelText(/actual delivery date/i), {
    target: { value: '2026-09-14' },
  });

  fireEvent.click(await screen.findByRole('button', { name: /^close receive$/i }));

  await waitFor(() => expect(onCloseJob).toHaveBeenCalledWith({
    actual_delivery_date: '2026-09-14',
  }));
  expect(screen.queryByText(/stow ready/i)).toBeNull();
  expect(screen.queryByText(/bin/i)).toBeNull();
  expect(screen.queryByText(/location/i)).toBeNull();

  expect(
    await screen.findByText(/received units are now available for stow/i)
  ).toBeTruthy();

  expect(
    screen.queryByText(/api only confirms|this api|api limitation/i)
  ).toBeNull();
});

it('R14b — handoff Work Note exposes canonical close seal and actual delivery evidence', async () => {
  renderSession({
    barcode: '5012345678900',
    closedAt: '2026-09-14T13:37:00',
    actualDeliveryDate: '2026-09-14',
    lines: [
      line({
        barcode: '5012345678900',
        inspection_complete: true,
        quantity_accepted: 1,
      }),
    ],
  });

  expect(await screen.findByText(/receive complete/i)).toBeTruthy();

  expect(screen.getByText(/^status$/i)).toBeTruthy();
  expect(screen.getByText(/^closed$/i)).toBeTruthy();
  expect(screen.getByText(/^closed at$/i)).toBeTruthy();
  expect(screen.getByText(/13:37/)).toBeTruthy();
  expect(screen.getByText(/^actual delivery$/i)).toBeTruthy();
  expect(screen.getAllByText(/14 sep 2026/i).length).toBeGreaterThan(0);
});

it('R14c — canonical closed receive restores directly into completion handoff', async () => {
  renderSession({
    barcode: '5012345678900',
    closedAt: '2026-09-14T13:37:00',
    actualDeliveryDate: '2026-09-14',
    lines: [
      line({
        barcode: '5012345678900',
        inspection_complete: true,
        quantity_accepted: 1,
      }),
    ],
  });

  expect(await screen.findByText(/receive complete/i)).toBeTruthy();
  expect(screen.getByText(/^closed$/i)).toBeTruthy();
  expect(screen.getByText(/^actual delivery$/i)).toBeTruthy();

  expect(
    screen.queryByRole('button', { name: /^close receive$/i })
  ).toBeNull();
});

// ── Receive reconciliation accounting model ────────────────────────────────

async function finishCount() {
  fireEvent.click(await screen.findByRole('button', { name: /finish count/i }));
}

it('R15 — active Count mode does not expose a general Report Problem action', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');

  expect(screen.queryByRole('button', { name: /report problem/i })).toBeNull();
});

it('R16 — active Scan mode does not expose a general Report Problem action', async () => {
  renderSession({
    barcode: '5012345678900',
    mode: 'scan',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('scan');

  expect(screen.queryByRole('button', { name: /report problem/i })).toBeNull();
});

it('R17 — active Count and Scan expose a primary Finish count action', async () => {
  renderSession({
    barcode: '5012345678900',
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  expect(screen.getByRole('button', { name: /finish count/i })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
  expect(screen.getByRole('button', { name: /finish count/i })).toBeTruthy();
});

it('R18 — Finish count with sellable equal to expected follows normal completion behavior', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  await finishCount();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 1,
    quantity_rejected: 0,
  })));
  expect(await screen.findByText(/review receive/i)).toBeTruthy();
});

it('R19 — Finish count with sellable below expected enters reconciliation instead of completing the line', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 3, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  expect(await screen.findByText(/account for the remaining 2 units/i)).toBeTruthy();
  expect(onInspectLine).not.toHaveBeenCalled();
});

it('R20 — reconciliation visibly shows Expected, Sellable, and To account for', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 3, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  expect(await screen.findByText(/^expected$/i)).toBeTruthy();
  expect(screen.getByText(/^sellable$/i)).toBeTruthy();
  expect(screen.getByText(/^to account for$/i)).toBeTruthy();
});

it('R21 — Missing item is not available before reconciliation', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');

  expect(screen.queryByRole('button', { name: /missing item/i })).toBeNull();
});

it('R22 — reconciliation exposes Missing item only after a shortfall has been established', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 3, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  expect(screen.queryByRole('button', { name: /missing item/i })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  expect(await screen.findByRole('button', { name: /missing item/i })).toBeTruthy();
});

it('R22a — reconciliation choices use neutral semantic selection without default primary styling', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 3, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  const damagedUnit = await screen.findByTestId('reconciliation-choice-defect');
  const missingItem = screen.getByTestId('reconciliation-choice-missing_item');
  const other = screen.getByTestId('reconciliation-choice-other');

  expect(damagedUnit).toHaveAttribute('aria-pressed', 'false');
  expect(missingItem).toHaveAttribute('aria-pressed', 'false');
  expect(damagedUnit.className).not.toContain('Primary');
  expect(missingItem.className).not.toContain('Primary');
  expect(other).toHaveStyle({ gridColumn: '1 / -1' });

  fireEvent.click(missingItem);

  expect(missingItem).toHaveAttribute('aria-pressed', 'true');
  expect(damagedUnit).toHaveAttribute('aria-pressed', 'false');
});

it('R22b — reconciliation quantity stepper stays neutral and allocation CTA is Tier-1', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 3, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /missing item/i }));

  const addToReconciliation = screen.getByRole('button', { name: /add to reconciliation/i });
  expect(screen.queryByRole('button', { name: /save allocation/i })).toBeNull();
  expect(addToReconciliation).toBeTruthy();
  expect(addToReconciliation.className).not.toContain('Primary');
  expect(addToReconciliation).toHaveStyle({ backgroundColor: 'var(--accent)' });

  const qty = screen.getByLabelText(/qty affected/i);
  expect(qty).toHaveValue(1);
  fireEvent.click(screen.getByRole('button', { name: /^\+$/i }));
  expect(qty).toHaveValue(2);
});

it('R22c — canonical shortfall projection restores reconciliation on initial render', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_accepted: 0,
      reconciliation_started_at: '2026-09-13T12:00:00.000Z',
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 9,
        accounted: 0,
        unaccounted: 1,
        allocations: [],
      },
    })],
  });

  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
  expect(await screen.findByText(/account for the remaining 1 units/i)).toBeTruthy();
  expect(screen.getByText(/^expected$/i)).toBeTruthy();
  expect(screen.getByText(/^sellable$/i)).toBeTruthy();
  expect(screen.getByText(/^to account for$/i)).toBeTruthy();
  expect(screen.getByText(/to account for\s+1/i)).toBeTruthy();
});

it('R22d — canonical reconciliation allocations survive re-entry and reconstruct unaccounted quantity', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_accepted: 0,
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 7,
        accounted: 2,
        unaccounted: 1,
        allocations: [{
          receive_exception_id: 'rx-1',
          exception_type: 'missing_item',
          quantity_affected: 2,
          resolved: false,
          raised_at: '2026-09-13T12:00:00.000Z',
          counts_toward_shortfall: true,
        }],
      },
    })],
  });

  expect((await screen.findAllByText(/missing item/i)).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/2 units/i)).toBeTruthy();
  expect(screen.getByText(/accounted 2 \/ 3/i)).toBeTruthy();
  expect(screen.getByText(/to account for\s+1/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
});

it('R22e — fully accounted canonical reconciliation restores final completion state', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_accepted: 0,
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 8,
        accounted: 2,
        unaccounted: 0,
        allocations: [{
          receive_exception_id: 'rx-2',
          exception_type: 'defect',
          quantity_affected: 2,
          resolved: false,
          raised_at: '2026-09-13T12:00:00.000Z',
          counts_toward_shortfall: true,
        }],
      },
    })],
  });

  const finishLine = await screen.findByRole('button', { name: /finish line/i });
  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
  await waitFor(() => expect(finishLine).not.toBeDisabled());
  fireEvent.click(finishLine);

  // GH-1245 disposition: the 2 damaged units were physically delivered and rejected.
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 8,
    quantity_rejected: 2,
    quantity_missing: 0,
    quantity_deferred: 0,
  })));
});

it('R22f — active Count progress restores provisional sellable 7 without entering Brief', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_sellable_provisional: 7,
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 7,
        accounted: 0,
        unaccounted: 3,
        allocations: [],
      },
    })],
  });

  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
  expect(screen.getByDisplayValue('7')).toBeTruthy();
  expect(screen.queryByText(/account for the remaining/i)).toBeNull();
});

it('R22g — active Count progress restores provisional sellable 0 without falling back to expected', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_sellable_provisional: 0,
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 0,
        accounted: 0,
        unaccounted: 10,
        allocations: [],
      },
    })],
  });

  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
  expect(screen.getByDisplayValue('0')).toBeTruthy();
  expect(screen.queryByText(/account for the remaining/i)).toBeNull();
});

it('R22h — short post-Finish count restores reconciliation from canonical 9 / 1 state', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({
      quantity_expected: 10,
      quantity_sellable_provisional: 9,
      reconciliation_started_at: '2026-09-13T12:00:00.000Z',
      barcode: '5012345678900',
      reconciliation: {
        expected: 10,
        sellable: 9,
        accounted: 0,
        unaccounted: 1,
        allocations: [],
      },
    })],
  });

  expect(screen.queryByRole('button', { name: /start receive/i })).toBeNull();
  expect(await screen.findByText(/account for the remaining 1 units/i)).toBeTruthy();
  expect(screen.getByText(/9\/10, 1 unaccounted/i)).toBeTruthy();
  expect(screen.getByText(/to account for\s+1/i)).toBeTruthy();
});

it('R22i — Start Count at zero and Finish Count persist ordered draft progress', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPersistLineProgress,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 2, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 2,
    quantity_rejected: 0,
  })));
  expect(onPersistLineProgress).toHaveBeenNthCalledWith(1, LINE_ID, {
    quantity_sellable_provisional: 0,
  });
  expect(onPersistLineProgress).toHaveBeenLastCalledWith(LINE_ID, {
    quantity_sellable_provisional: 2,
  });
  expect(onPersistLineProgress.mock.invocationCallOrder.at(-1)).toBeLessThan(
    onInspectLine.mock.invocationCallOrder[0]
  );
});

it('R23 — partial reconciliation allocation keeps completion blocked while To account for remains', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onReportException = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onReportException,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 5, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /damaged unit/i }));
  fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));

  await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(1));
  expect(onInspectLine).not.toHaveBeenCalled();
  expect(screen.getByText(/to account for\s+3/i)).toBeTruthy();
});

it('R24 — multiple allocations can account for one shortfall', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onReportException = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onReportException,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 10, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  for (let i = 0; i < 7; i++) fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  for (const label of [/damaged unit/i, /wrong product/i, /missing item/i]) {
    fireEvent.click(await screen.findByRole('button', { name: label }));
    fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  }

  await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(3));
  const finishLine = await screen.findByRole('button', { name: /finish line/i });
  await waitFor(() => expect(finishLine).not.toBeDisabled());
  fireEvent.click(finishLine);
  // GH-1245 disposition: damaged + wrong product are physically rejected (2);
  // the missing item is supplier shortage (1). 7 + 2 + 1 + 0 = 10 expected.
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 7,
    quantity_rejected: 2,
    quantity_missing: 1,
    quantity_deferred: 0,
  })));
});

it('R25 — line completion remains blocked until accounted shortfall reaches zero', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 4, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  expect(screen.queryByText(/review receive/i)).toBeNull();
  expect(onInspectLine).not.toHaveBeenCalled();
});

it('R26 — fully accounted reconciliation completes using sellable quantity only', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onReportException: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 2, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /missing item/i }));
  fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  const finishLine = await screen.findByRole('button', { name: /finish line/i });
  await waitFor(() => expect(finishLine).not.toBeDisabled());
  fireEvent.click(finishLine);

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 1,
    quantity_rejected: 0,
  })));
});

it('R27 — barcode problem is not a shortfall-consuming reconciliation choice', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  renderSession({
    barcode: '5012345678900',
    onInspectLine,
    onReportException: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    lines: [line({ quantity_expected: 2, barcode: '5012345678900' })],
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  await finishCount();

  expect(screen.queryByRole('button', { name: /barcode problem/i })).toBeNull();
  expect(onInspectLine).not.toHaveBeenCalled();
  expect(await screen.findByText(/to account for\s+1/i)).toBeTruthy();
});

it('R28 — existing overdelivery UI still activates when sellable exceeds expected', async () => {
  renderSession({
    barcode: '5012345678900',
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');
  fireEvent.click(await screen.findByRole('button', { name: /^all \d+$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));

  expect(await screen.findByRole('dialog', { name: /extra unit detected/i })).toBeTruthy();
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

it('B9 — WmsModuleFT2 forwards the required Receive callbacks into ReceiveSessionPage', () => {
  const onInspectReceiveLine = jest.fn().mockResolvedValue(undefined);
  const onReportReceiveException = jest.fn().mockResolvedValue(undefined);
  const onApproveOverDelivery = jest.fn().mockResolvedValue(undefined);
  const onCloseReceiveJob = jest.fn().mockResolvedValue(undefined);
  const onResolveBarcode = jest.fn().mockResolvedValue(null);
  const onPrintUnitLabels = jest.fn().mockResolvedValue(undefined);
  const onConfirmUnitLabelsPrinted = jest.fn().mockResolvedValue(undefined);
  const onFetchReceiveJob = jest.fn().mockResolvedValue({
    job: { po_id: 'po-1085', supplier_name: 'GH1085 Supplier' },
    lines: [line({ barcode: null })],
  });
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
        closedAt: '2026-09-14T13:37:00',
        actualDeliveryDate: '2026-09-14',
        lines: [line({ barcode: null })],
      },
      onInspectReceiveLine,
      onReportReceiveException,
      onApproveOverDelivery,
      onCloseReceiveJob,
      onResolveBarcode,
      onPrintUnitLabels,
      onConfirmUnitLabelsPrinted,
      onFetchReceiveJob,
      onRefresh: jest.fn(),
    };

    render(<WmsModuleFT2 {...(moduleProps as any)} />);
  }

  // Render count is an implementation detail; the latest props are the seam.
  expect(receivedProps.length).toBeGreaterThan(0);
  const forwarded = receivedProps[receivedProps.length - 1];

  expect(forwarded.onResolveBarcode).toBe(onResolveBarcode);
  expect(forwarded.onPrintUnitLabels).toBe(onPrintUnitLabels);
  expect(forwarded.closedAt).toBe('2026-09-14T13:37:00');
  expect(forwarded.actualDeliveryDate).toBe('2026-09-14');

  // Wrapped job-scoped callbacks must call the exact module callbacks with the
  // active receive job id; a silent no-op would make the receive page look
  // interactive while dropping the business event.
  void (forwarded.onInspectLine as Function)({ receive_job_line_id: LINE_ID });
  void (forwarded.onReportException as Function)({ receive_job_line_id: LINE_ID });
  void (forwarded.onApproveOverDelivery as Function)({ receive_job_line_id: LINE_ID, quantity_affected: 1, notes: 'n' });
  void (forwarded.onCloseJob as Function)({ actual_delivery_date: '2026-09-12' });
  void (forwarded.onRefresh as Function)();

  expect(onInspectReceiveLine).toHaveBeenCalledWith(RECEIVE_JOB_ID, { receive_job_line_id: LINE_ID });
  expect(onReportReceiveException).toHaveBeenCalledWith(RECEIVE_JOB_ID, { receive_job_line_id: LINE_ID });
  // GH-1108 / RECEIVE-OVERCOUNT-01 — a dropped wire here would silently no-op
  // "Accept extra" and let the backend's fail-closed guard become the only
  // thing standing in the way, rather than persisting real evidence.
  expect(onApproveOverDelivery).toHaveBeenCalledWith(RECEIVE_JOB_ID, { receive_job_line_id: LINE_ID, quantity_affected: 1, notes: 'n' });
  expect(onCloseReceiveJob).toHaveBeenCalledWith(RECEIVE_JOB_ID, { actual_delivery_date: '2026-09-12' });
  expect(onFetchReceiveJob).toHaveBeenCalledWith(RECEIVE_JOB_ID);

  // The exact callback, not merely something truthy — a wrapper that swallows
  // the call would satisfy a looser assertion.
  expect(forwarded.onConfirmUnitLabelsPrinted).toBe(onConfirmUnitLabelsPrinted);
});

it('R29 — untouched Receive brief shows canonical accepted quantity, not projected sellable', async () => {
  renderSession({
    barcode: null,
    lines: [line({
      quantity_expected: 1,
      quantity_accepted: 0,
      quantity_sellable_provisional: null,
      inspection_complete: false,
      reconciliation: {
        expected: 1,
        sellable: 1,
        accounted: 0,
        unaccounted: 0,
        allocations: [],
      },
    })],
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  });

  expect(await screen.findByText(/receive from gh1085 supplier/i)).toBeTruthy();

  const row = screen
    .getAllByText('GH1085 widget')
    .map((node) => node.closest('tr'))
    .find((candidate): candidate is HTMLTableRowElement => candidate !== null);

  expect(row).toBeTruthy();

  const cells = row!.querySelectorAll('td');

  expect(cells[1]?.textContent).toBe('1'); // Expected
  expect(cells[2]?.textContent).toBe('0'); // Already received
  expect(cells[3]?.textContent).toBe('1'); // Remaining
});

it('R30 — Start Receive seeds draft progress from canonical accepted state, not projected sellable', async () => {
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);

  renderSession({
    barcode: null,
    lines: [line({
      quantity_expected: 1,
      quantity_accepted: 0,
      quantity_sellable_provisional: null,
      inspection_complete: false,
      reconciliation: {
        expected: 1,
        sellable: 1,
        accounted: 0,
        unaccounted: 0,
        allocations: [],
      },
    })],
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress,
  });

  fireEvent.click(await screen.findByRole('button', { name: /start receive/i }));

  await waitFor(() => {
    expect(onPersistLineProgress).toHaveBeenCalledWith(
      LINE_ID,
      { quantity_sellable_provisional: 0 }
    );
  });
});

it('R31 — asynchronous LSU label generation cannot advance to Review before attachment acknowledgement', async () => {
  let releasePrint!: () => void;

  const printGate = new Promise<void>((resolve) => {
    releasePrint = resolve;
  });

  const onPrintUnitLabels = jest.fn().mockReturnValue(printGate);

  renderSession({
    barcode: null,
    lines: [line({
      quantity_expected: 1,
      quantity_accepted: 0,
      quantity_sellable_provisional: null,
      inspection_complete: false,
    })],
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onPrintUnitLabels,
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
  });

  await enterReceiveExecution('count');

  fireEvent.click(await screen.findByRole('button', { name: /^all 1$/i }));
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));

  await waitFor(() => {
    expect(onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID);
  });

  releasePrint();

  await waitFor(() => {
    expect(screen.getByTestId(ACK_TESTID)).toBeTruthy();
  });

  expect(screen.queryByText(/review receive/i)).toBeNull();
  expect(screen.getAllByText(/label hold/i).length).toBeGreaterThan(0);
});
