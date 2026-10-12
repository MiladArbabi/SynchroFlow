// GH-1241 / S3-A1 — UNCOUNTED INVENTORY SAFETY (UI) — regression gate.
//
// Ratified S3 contract: a Receive line is either not physically counted, or
// the operator explicitly confirmed a physical count (0 or N). The canonical
// GET projection for an untouched line reports sellable = expected − shortfall
// exceptions; that projection is NOT a physical count and must never become
// an accepted quantity on refresh/re-entry.
//
// Ratified evidence: the host's onConfirmLineCount persists the operator's
// count (POST …/lines/:lineId/confirm-count). Only the explicit operator
// action Finish Count confirms — never Accept extra — and every inspection's accepted
// quantity equals the count just confirmed. Start Receive, opening Count/Scan,
// mount/refresh and reconciliation projections never confirm.
//
// Renders the real ReceiveSessionPage with controlled props built from the
// legitimate API shape (receiveJob.controller httpGetReceiveJob), same
// precedent as receive-barcode-readiness-1085.test.tsx.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const RECEIVE_JOB_ID = 'job-s3a1';
const LINE_ID = 'line-s3a1';
const VARIANT_ID = 'variant-s3a1';
const EXTERNAL_BARCODE = '5012345678900';

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: VARIANT_ID,
    sku: 'S3A1-SKU',
    variant_title: 'Default Title',
    description: 'S3-A1 receive line',
    quantity_expected: 10,
    quantity_accepted: 0,
    quantity_rejected: 0,
    quantity_missing: null,
    quantity_deferred: null,
    quantity_sellable_provisional: null,
    reconciliation_started_at: null,
    quantity_count_confirmed: null,
    inspection_complete: false,
    image_url: null,
    barcode: EXTERNAL_BARCODE,
    product_title: 'S3-A1 widget',
    barcode_ready: false,
    barcode_readiness_reason: 'not_inspected',
    awaiting_label_ack: false,
    accepted_unit_count: 0,
    labelled_unit_count: 0,
    ...overrides,
  };
}

function renderSession(lines: ReceiveJobLine[], options: {
  onConfirmLineCount?: jest.Mock;
  onResolveBarcode?: jest.Mock;
} = {}) {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  const onApproveOverDelivery = jest.fn().mockResolvedValue(undefined);
  const onConfirmLineCount = options.onConfirmLineCount ?? jest.fn().mockResolvedValue(undefined);
  const props = {
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-s3a1',
    supplierName: 'S3-A1 Supplier',
    closedAt: null,
    actualDeliveryDate: null,
    lines,
    onInspectLine,
    onPersistLineProgress,
    onConfirmLineCount,
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery,
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: options.onResolveBarcode,
    onRefresh: jest.fn().mockResolvedValue(undefined),
  };
  render(<ReceiveSessionPage {...(props as any)} />);
  return { onInspectLine, onPersistLineProgress, onApproveOverDelivery, onConfirmLineCount };
}

async function startCount() {
  fireEvent.click(await screen.findByRole('button', { name: /start receive/i }));
  const countMode = screen.queryByRole('button', { name: /^count$/i });
  if (countMode) fireEvent.click(countMode);
}

async function plus(times: number) {
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(await screen.findByRole('button', { name: /^\+$/i }));
  }
}

async function finishCount() {
  fireEvent.click(await screen.findByRole('button', { name: /finish count/i }));
}

/** Every inspection must carry exactly the count confirmed immediately before it. */
function expectInspectedOnlyConfirmedCounts(onConfirmLineCount: jest.Mock, onInspectLine: jest.Mock) {
  for (let i = 0; i < onInspectLine.mock.calls.length; i += 1) {
    const inspectOrder = onInspectLine.mock.invocationCallOrder[i];
    const priorConfirms = onConfirmLineCount.mock.invocationCallOrder
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => order < inspectOrder);
    expect(priorConfirms.length).toBeGreaterThan(0);
    const last = priorConfirms[priorConfirms.length - 1].index;
    expect(onConfirmLineCount.mock.calls[last][1].quantity_confirmed)
      .toBe(onInspectLine.mock.calls[i][0].quantity_accepted);
  }
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

it('U1 — re-entry with an untouched line and canonical missing 2 never inspects the projected 8 as accepted', async () => {
  // Exactly what GET returns for: expected 10, accepted 0, provisional NULL,
  // reconciliation never started, one canonical missing_item exception of 2.
  const missing = {
    receive_exception_id: 'rx-s3a1-missing',
    exception_type: 'missing_item',
    quantity_affected: 2,
    notes: '2 missing item during receive',
    resolved: false,
    raised_at: '2026-10-12T12:00:00.000Z',
    counts_toward_shortfall: true,
  };
  const { onInspectLine, onConfirmLineCount } = renderSession([line({
    reported_problems: [missing],
    reconciliation: {
      expected: 10,
      sellable: 8,
      accounted: 2,
      unaccounted: 0,
      allocations: [missing],
      overage_approved: false,
    },
  })]);

  // Exercise every completion action the re-entered page offers.
  const completionActions = await screen
    .findAllByRole('button', { name: /finish line|finish count|confirm line/i })
    .catch(() => [] as HTMLElement[]);
  const enabled = completionActions.filter((button) => !(button as HTMLButtonElement).disabled);
  for (const button of enabled) fireEvent.click(button);
  await waitFor(() => expect(screen.queryAllByRole('button').length).toBeGreaterThan(0));

  expect(onInspectLine).not.toHaveBeenCalled();
  expect(enabled.map((button) => button.textContent)).toEqual([]);
  // Mount/refresh never confirms a count.
  expect(onConfirmLineCount).not.toHaveBeenCalled();
});

it('U2 — an explicitly confirmed zero count enters reconciliation without inspecting (control)', async () => {
  const { onInspectLine, onPersistLineProgress, onConfirmLineCount } = renderSession([line({
    reconciliation: {
      expected: 10,
      sellable: 10,
      accounted: 0,
      unaccounted: 0,
      allocations: [],
      overage_approved: false,
    },
  })]);

  await startCount();
  // Start Receive and opening Count never confirm.
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  await finishCount();

  expect(await screen.findByText(/account for the remaining 10 units/i)).toBeTruthy();
  expect(onConfirmLineCount).toHaveBeenCalledTimes(1);
  expect(onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 0 });
  await waitFor(() => expect(onPersistLineProgress).toHaveBeenLastCalledWith(LINE_ID, {
    quantity_sellable_provisional: 0,
    reconciliation_required: true,
  }));
  expect(onInspectLine).not.toHaveBeenCalled();
});

it('U3 — a normal full count confirms the counted quantity, then inspects exactly it (control)', async () => {
  const { onInspectLine, onConfirmLineCount } = renderSession([line({ quantity_expected: 2 })]);

  await startCount();
  await plus(2);
  await finishCount();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 2, quantity_rejected: 0,
  })));
  expect(onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 2 });
  expectInspectedOnlyConfirmedCounts(onConfirmLineCount, onInspectLine);
});

it('U4 — a partial count confirms the counted quantity and enters reconciliation without inspecting', async () => {
  const { onInspectLine, onConfirmLineCount } = renderSession([line({ quantity_expected: 10 })]);

  await startCount();
  await plus(7);
  await finishCount();

  expect(await screen.findByText(/account for the remaining 3 units/i)).toBeTruthy();
  expect(onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 7 });
  expect(onInspectLine).not.toHaveBeenCalled();
});

it('U5 — Scan → Finish Count confirms the scanned quantity before inspecting', async () => {
  const { onInspectLine, onConfirmLineCount } = renderSession(
    [line({ quantity_expected: 2 })],
    { onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }) },
  );

  fireEvent.click(await screen.findByRole('button', { name: /start receive/i }));
  const scanMode = screen.queryByRole('button', { name: /^scan$/i });
  if (scanMode) fireEvent.click(scanMode);
  for (let i = 0; i < 2; i += 1) {
    const input = await screen.findByPlaceholderText(/scan barcode/i);
    fireEvent.change(input, { target: { value: EXTERNAL_BARCODE } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(screen.getByText(new RegExp(`${i + 1}/2`))).toBeTruthy());
  }
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  await finishCount();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 2 })));
  expect(onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 2 });
  expectInspectedOnlyConfirmedCounts(onConfirmLineCount, onInspectLine);
});

// GH-1241 S3-A1 G2 — required order: physical count → Finish Count (the
// confirmation) → approve overage → inspect. A live +/typed/scan count past
// expected only warns; "Accept extra" exists only for a confirmed count and
// never confirms anything itself.
async function keepExtraInCount() {
  fireEvent.click(await screen.findByRole('button', { name: /keep extra in count/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function expectConfirmApproveInspectOrder(onConfirmLineCount: jest.Mock, onApproveOverDelivery: jest.Mock, onInspectLine: jest.Mock) {
  expect(onConfirmLineCount.mock.invocationCallOrder.at(-1))
    .toBeLessThan(onApproveOverDelivery.mock.invocationCallOrder[0]);
  expect(onApproveOverDelivery.mock.invocationCallOrder[0])
    .toBeLessThan(onInspectLine.mock.invocationCallOrder[0]);
}

it('U6 — manual count past expected: the live warning never approves or confirms; Finish Count confirms, then approval, then inspection', async () => {
  const { onInspectLine, onConfirmLineCount, onApproveOverDelivery } = renderSession([line({ quantity_expected: 2 })]);

  await startCount();
  await plus(3);
  const warning = await screen.findByRole('dialog', { name: /extra unit detected/i });
  expect(warning).toBeTruthy();
  // An unconfirmed live count offers no approval.
  expect(screen.queryByRole('button', { name: /accept extra/i })).toBeNull();
  await keepExtraInCount();
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  expect(onApproveOverDelivery).not.toHaveBeenCalled();
  expect(onInspectLine).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('3')).toBeTruthy();

  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect(onConfirmLineCount.mock.calls).toEqual([[LINE_ID, { quantity_confirmed: 3 }]]);
  expect(onApproveOverDelivery).toHaveBeenCalledWith(expect.objectContaining({ quantity_affected: 1 }));
  expectConfirmApproveInspectOrder(onConfirmLineCount, onApproveOverDelivery, onInspectLine);
  expectInspectedOnlyConfirmedCounts(onConfirmLineCount, onInspectLine);
});

it('U11 — scan count past expected: the scanned extra is kept as a draft, confirmed by Finish Count, then approved and inspected', async () => {
  const { onInspectLine, onConfirmLineCount, onApproveOverDelivery, onPersistLineProgress } = renderSession(
    [line({ quantity_expected: 1 })],
    { onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }) },
  );

  fireEvent.click(await screen.findByRole('button', { name: /start receive/i }));
  const scanMode = screen.queryByRole('button', { name: /^scan$/i });
  if (scanMode) fireEvent.click(scanMode);
  for (let i = 0; i < 2; i += 1) {
    const input = await screen.findByPlaceholderText(/scan barcode/i);
    fireEvent.change(input, { target: { value: EXTERNAL_BARCODE } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    if (i === 0) await waitFor(() => expect(screen.getByText(/1\/1/)).toBeTruthy());
  }
  await screen.findByRole('dialog', { name: /extra unit detected/i });
  expect(screen.queryByRole('button', { name: /accept extra/i })).toBeNull();
  await keepExtraInCount();
  await waitFor(() => expect(onPersistLineProgress).toHaveBeenCalledWith(LINE_ID, { quantity_sellable_provisional: 2 }));
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  expect(onApproveOverDelivery).not.toHaveBeenCalled();
  expect(onInspectLine).not.toHaveBeenCalled();

  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 2 })));
  expect(onConfirmLineCount.mock.calls).toEqual([[LINE_ID, { quantity_confirmed: 2 }]]);
  expectConfirmApproveInspectOrder(onConfirmLineCount, onApproveOverDelivery, onInspectLine);
});

it('U12 — a failed over-expected confirmation offers no approval; the retry confirms, then approves once and inspects', async () => {
  const onConfirmLineCount = jest.fn()
    .mockRejectedValueOnce(new Error('RECEIVE_COUNT_CONFIRM_FAILED'))
    .mockResolvedValue(undefined);
  const { onInspectLine, onApproveOverDelivery } = renderSession([line({ quantity_expected: 2 })], { onConfirmLineCount });

  await startCount();
  await plus(3);
  await keepExtraInCount();
  await finishCount();

  expect(await screen.findByText(/RECEIVE_COUNT_CONFIRM_FAILED/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /accept extra/i })).toBeNull();
  expect(onApproveOverDelivery).not.toHaveBeenCalled();
  expect(onInspectLine).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('3')).toBeTruthy();

  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect(onConfirmLineCount.mock.calls.map((call) => call[1].quantity_confirmed)).toEqual([3, 3]);
  expect(onApproveOverDelivery).toHaveBeenCalledTimes(1);
  expectConfirmApproveInspectOrder(onConfirmLineCount, onApproveOverDelivery, onInspectLine);
});

it('U13 — a confirmed over-expected count with a failed approval keeps the decision, never inspects, and the retry does not reconfirm', async () => {
  const { onInspectLine, onConfirmLineCount, onApproveOverDelivery } = renderSession([line({ quantity_expected: 2 })]);
  onApproveOverDelivery.mockRejectedValueOnce(new Error('overage approval failed'));

  await startCount();
  await plus(3);
  await keepExtraInCount();
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  expect(await screen.findByText(/overage approval failed/i)).toBeTruthy();
  expect(onInspectLine).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect(onConfirmLineCount.mock.calls).toEqual([[LINE_ID, { quantity_confirmed: 3 }]]);
  expect(onApproveOverDelivery).toHaveBeenCalledTimes(2);
});

it('U7 — "I miscounted" returns to counting; the corrected count is re-confirmed before inspection', async () => {
  const { onInspectLine, onConfirmLineCount, onPersistLineProgress } = renderSession([line({ quantity_expected: 2 })]);

  await startCount();
  await plus(1);
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /i miscounted/i }));

  expect(onInspectLine).not.toHaveBeenCalled();
  await plus(1);
  await finishCount();

  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 2 })));
  expect(onConfirmLineCount.mock.calls.map((call) => call[1].quantity_confirmed)).toEqual([1, 2]);
  // The count edit was persisted as a draft (which voids the stale confirmation server-side).
  expect(onPersistLineProgress).toHaveBeenCalledWith(LINE_ID, { quantity_sellable_provisional: 2 });
  expectInspectedOnlyConfirmedCounts(onConfirmLineCount, onInspectLine);
});

it('U8 — a failed confirmation keeps the count, never inspects or reconciles, and a retry succeeds', async () => {
  const onConfirmLineCount = jest.fn()
    .mockRejectedValueOnce(new Error('RECEIVE_COUNT_CONFIRM_FAILED'))
    .mockResolvedValue(undefined);
  const { onInspectLine } = renderSession([line({ quantity_expected: 2 })], { onConfirmLineCount });

  await startCount();
  await plus(2);
  await finishCount();

  expect(await screen.findByText(/RECEIVE_COUNT_CONFIRM_FAILED/)).toBeTruthy();
  expect(onInspectLine).not.toHaveBeenCalled();
  expect(screen.queryByText(/account for the remaining/i)).toBeNull();
  expect(screen.getByDisplayValue('2')).toBeTruthy();

  await finishCount();
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 2 })));
  expect(onConfirmLineCount).toHaveBeenCalledTimes(2);
});

it('U9 — a host without count confirmation fails closed: Finish Count never inspects', async () => {
  const onInspectLine = jest.fn().mockResolvedValue(undefined);
  render(<ReceiveSessionPage {...({
    receiveJobId: RECEIVE_JOB_ID,
    poId: 'po-s3a1',
    supplierName: 'S3-A1 Supplier',
    lines: [line({ quantity_expected: 2 })],
    onInspectLine,
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
  } as any)} />);

  await startCount();
  await plus(2);
  await finishCount();

  expect(await screen.findByText(/count confirmation is unavailable/i)).toBeTruthy();
  expect(onInspectLine).not.toHaveBeenCalled();
});

it('U10 — refresh with an overage draft and approval but no confirmed count never manufactures evidence; Finish Count reconfirms', async () => {
  const { onInspectLine, onConfirmLineCount, onApproveOverDelivery } = renderSession([line({
    quantity_expected: 2,
    quantity_sellable_provisional: 3,
    quantity_count_confirmed: null,
    reconciliation: {
      expected: 2,
      sellable: 3,
      accounted: 0,
      unaccounted: 0,
      allocations: [],
      overage_approved: true,
    },
  })]);

  // No reconstructed Accept extra decision: the operator is back at counting with the draft.
  expect(await screen.findByDisplayValue('3')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /accept extra/i })).toBeNull();
  expect(onConfirmLineCount).not.toHaveBeenCalled();
  expect(onInspectLine).not.toHaveBeenCalled();

  // Explicit Finish Count is the reconfirmation; the persisted approval is not posted twice.
  await finishCount();
  fireEvent.click(await screen.findByRole('button', { name: /accept extra/i }));
  await waitFor(() => expect(onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect(onConfirmLineCount.mock.calls).toEqual([[LINE_ID, { quantity_confirmed: 3 }]]);
  expect(onApproveOverDelivery).not.toHaveBeenCalled();
  expectInspectedOnlyConfirmedCounts(onConfirmLineCount, onInspectLine);
});
