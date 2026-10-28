/**
 * WS-UX-RECEIVE-D4R S4 — LSU label hold.
 *
 * Contract: the hold exists before printing starts; printing (success,
 * failure or reprint) never acknowledges; only the operator's explicit
 * "All N labels are attached" calls onConfirmUnitLabelsPrinted, once, and the
 * session advances only after it succeeds; refresh restores an unresolved
 * hold; zero accepted units and externally barcoded units need no labels.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const LINE_ID = 'line-s4';
const ACK_TESTID = 'confirm-unit-labels-printed';

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: 'variant-s4',
    sku: 'S4-SKU',
    variant_title: 'Default Title',
    description: 'S4 receive line',
    quantity_expected: 2,
    image_url: null,
    barcode: null,
    product_title: 'S4 widget',
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderSession(lines: ReceiveJobLine[], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-s4',
    poId: 'po-s4',
    supplierName: 'S4 Supplier',
    lines,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmLineCount: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ReceiveSessionPage {...(props as any)} />);
  return props;
}

/** Count `units` physical units one by one, then Finish Count. */
async function countAndFinish(units: number) {
  const start = screen.queryByRole('button', { name: /start receive/i });
  if (start) fireEvent.click(start);
  const count = screen.queryByRole('button', { name: /^count$/i });
  if (count) fireEvent.click(count);
  const input = await screen.findByRole('textbox', { name: /sellable count/i });
  if (units === 0) {
    fireEvent.change(input, { target: { value: '0' } });
  } else {
    for (let i = 0; i < units; i += 1) fireEvent.click(screen.getByRole('button', { name: /^\+$/ }));
  }
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
}

const ack = () => screen.queryByTestId(ACK_TESTID) as HTMLButtonElement | null;
const inReview = () => screen.queryByRole('button', { name: /^close receive$/i });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

it('S4-A — the hold is established before printing starts and gates advancement while printing', async () => {
  const print = deferred();
  const props = renderSession([line()], { onPrintUnitLabels: jest.fn(() => print.promise) });
  await countAndFinish(2);

  await waitFor(() => expect(props.onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID));
  expect(ack()).not.toBeNull();
  expect(ack()).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(/sending labels to the printer/i);
  // S8-C4 — no redundant disabled print action while printing.
  expect(screen.queryByRole('button', { name: /print labels/i })).toBeNull();
  expect(inReview()).toBeNull();

  print.resolve();
  await waitFor(() => expect(ack()).toBeEnabled());
});

it('S4-B — print success never acknowledges', async () => {
  const props = renderSession([line()]);
  await countAndFinish(2);

  await waitFor(() => expect(screen.getByText(/2 labels printed/i)).toBeTruthy());
  expect(ack()).toHaveTextContent('All 2 labels are attached');
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(inReview()).toBeNull();
});

it('S4-C — print failure keeps the hold and offers Reprint', async () => {
  const props = renderSession([line()], { onPrintUnitLabels: jest.fn().mockRejectedValue(new Error('printer offline')) });
  await countAndFinish(2);

  expect(await screen.findByText(/labels could not be printed/i)).toBeTruthy();
  expect(screen.getByRole('alert')).toHaveTextContent(/print failed · reprint, then attach a label to every unit/i);
  expect(screen.getByText('The print request failed. Reprint, or continue only after all 2 labels are physically attached.')).toBeTruthy();
  expect(screen.queryByText(/status is unknown/i)).toBeNull();
  expect(screen.getByRole('button', { name: /^reprint labels$/i })).toBeTruthy();
  expect(ack()).toBeEnabled();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(inReview()).toBeNull();
});

it('S4-D — a successful reprint does not acknowledge, and a double click prints once', async () => {
  const reprint = deferred();
  const onPrintUnitLabels = jest.fn()
    .mockRejectedValueOnce(new Error('printer offline'))
    .mockImplementationOnce(() => reprint.promise);
  const props = renderSession([line()], { onPrintUnitLabels });
  await countAndFinish(2);

  const reprintButton = await screen.findByRole('button', { name: /^reprint labels$/i });
  fireEvent.click(reprintButton);
  fireEvent.click(reprintButton);
  await waitFor(() => expect(onPrintUnitLabels).toHaveBeenCalledTimes(2));
  expect(ack()).toBeDisabled();

  reprint.resolve();
  await waitFor(() => expect(screen.getByText(/2 labels printed/i)).toBeTruthy());
  expect(onPrintUnitLabels).toHaveBeenCalledTimes(2);
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(ack()).not.toBeNull();
});

it('S4-E — after a print failure the operator can still acknowledge physically attached labels', async () => {
  const props = renderSession([line()], { onPrintUnitLabels: jest.fn().mockRejectedValue(new Error('printer offline')) });
  await countAndFinish(2);
  await screen.findByText(/labels could not be printed/i);

  fireEvent.click(ack()!);

  await waitFor(() => expect(props.onConfirmUnitLabelsPrinted).toHaveBeenCalledWith(LINE_ID));
  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
});

it('S4-F — a failed acknowledgement keeps the hold with a retryable error; retry advances without re-inspecting', async () => {
  const onConfirmUnitLabelsPrinted = jest.fn()
    .mockRejectedValueOnce(new Error('ack service down'))
    .mockResolvedValueOnce(undefined);
  const props = renderSession([line()], { onConfirmUnitLabelsPrinted });
  await countAndFinish(2);
  await waitFor(() => expect(ack()).toBeEnabled());

  fireEvent.click(ack()!);
  expect(await screen.findByRole('alert')).toHaveTextContent(/ack service down/i);
  expect(ack()).toBeEnabled();
  expect(inReview()).toBeNull();

  fireEvent.click(ack()!);
  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
  expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(2);
  expect(props.onInspectLine).toHaveBeenCalledTimes(1);
  expect(props.onPrintUnitLabels).toHaveBeenCalledTimes(1);
});

it('S4-G — a double submission sends one acknowledgement', async () => {
  const pending = deferred();
  const onConfirmUnitLabelsPrinted = jest.fn(() => pending.promise);
  renderSession([line()], { onConfirmUnitLabelsPrinted });
  await countAndFinish(2);
  await waitFor(() => expect(ack()).toBeEnabled());

  const button = ack()!;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(1);

  pending.resolve();
  await screen.findByRole('button', { name: /^close receive$/i });
  expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(1);
});

it('S4-H — refresh restores an unresolved hold with its accepted quantity and never completes or prints by itself', async () => {
  const props = renderSession([line({
    inspection_complete: true,
    awaiting_label_ack: true,
    quantity_accepted: 2,
    count_state: 'inspected',
  })], { jobStatus: 'in_progress', assignedOperatorId: 7, currentUserId: 7 });

  expect(await screen.findByTestId(ACK_TESTID)).toHaveTextContent('All 2 labels are attached');
  expect(inReview()).toBeNull();
  expect(screen.queryByText(/receive complete/i)).toBeNull();
  expect(props.onPrintUnitLabels).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
});

it('S4-I — zero accepted units need no labels', async () => {
  const props = renderSession([line({ quantity_expected: 1 })]);
  await countAndFinish(0);

  fireEvent.click(await screen.findByTestId('reconciliation-choice-missing_item'));
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  const finish = await screen.findByRole('button', { name: /finish line/i });
  await waitFor(() => expect(finish).toBeEnabled());
  fireEvent.click(finish);

  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
  expect(props.onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 0 }));
  expect(props.onPrintUnitLabels).not.toHaveBeenCalled();
  expect(ack()).toBeNull();
});

// ── S8-C2 — print status unknown after refresh / re-entry ─────────────────
// Local print status does not survive a refresh. A restored hold must not
// claim labels were printed; Print labels leads, physical acknowledgement
// stays available as the secondary action, and printing never acknowledges.

const restoredLine = () => line({ inspection_complete: true, awaiting_label_ack: true, quantity_accepted: 2, count_state: 'inspected' });
const renderRestored = (overrides: Record<string, unknown> = {}) =>
  renderSession([restoredLine()], { jobStatus: 'in_progress', assignedOperatorId: 7, currentUserId: 7, ...overrides });
const printButton = () => screen.queryByRole('button', { name: /^print labels$/i });
const isPrimary = (el: Element | null) => !!el && el.classList.contains('MuiButton-contained');
const UNKNOWN = 'Label printing status is unknown. Print labels if needed, or continue only after all 2 labels are physically attached.';

it('S4-K1 — a restored hold shows print status as unknown, never as printed, and does nothing by itself', async () => {
  const props = renderRestored();
  expect(await screen.findByRole('heading', { name: 'Confirm 2 unit labels.' })).toBeTruthy();
  expect(screen.getByText(UNKNOWN)).toBeTruthy();
  // S8-C4 — the status line names the same next step as the primary action.
  expect(screen.getByText(/· Next · print labels$/)).toBeTruthy();
  expect(screen.queryByText(/labels are printed|labels printed|were created/i)).toBeNull();
  expect(props.onPrintUnitLabels).not.toHaveBeenCalled();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(inReview()).toBeNull();
});

it('S4-K2 — Print labels is the sole primary action; physical acknowledgement stays available as secondary', async () => {
  renderRestored();
  await screen.findByText(UNKNOWN);
  expect(isPrimary(printButton())).toBe(true);
  expect(printButton()).toBeEnabled();
  expect(ack()).toHaveTextContent('All 2 labels are attached');
  expect(ack()).toBeEnabled();
  expect(isPrimary(ack())).toBe(false);
  expect(document.querySelectorAll('button.MuiButton-contained:not([disabled])')).toHaveLength(1);
});

it('S4-K3 — a resolved print request does not acknowledge or claim the labels were printed', async () => {
  const print = deferred();
  const props = renderRestored({ onPrintUnitLabels: jest.fn(() => print.promise) });
  fireEvent.click(await screen.findByRole('button', { name: /^print labels$/i }));
  await waitFor(() => expect(props.onPrintUnitLabels).toHaveBeenCalledWith(LINE_ID));
  expect(ack()).toBeDisabled();

  print.resolve();
  await waitFor(() => expect(ack()).toBeEnabled());
  expect(screen.getByText(/print request sent · check all 2 labels printed, then attach them/i)).toBeTruthy();
  expect(screen.getByText('Print request sent to the printer or opened as a PDF. Check every label, attach one to each unit, then confirm.')).toBeTruthy();
  expect(screen.queryByText(/labels are printed|sent for printing/i)).toBeNull();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(inReview()).toBeNull();
  expect(isPrimary(ack())).toBe(true);
});

it('S4-K4 — a failed print from a restored hold keeps Reprint and physical acknowledgement, without retrying by itself', async () => {
  const props = renderRestored({ onPrintUnitLabels: jest.fn().mockRejectedValue(new Error('printer offline')) });
  fireEvent.click(await screen.findByRole('button', { name: /^print labels$/i }));
  expect(await screen.findByText(/labels could not be printed/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^reprint labels$/i })).toBeEnabled();
  expect(ack()).toBeEnabled();
  expect(props.onPrintUnitLabels).toHaveBeenCalledTimes(1);
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
});

it('S4-K5 — a pending or rejected acknowledgement keeps the restored hold; success advances only after the callback resolves', async () => {
  const pending = deferred();
  const onConfirmUnitLabelsPrinted = jest.fn()
    .mockRejectedValueOnce(new Error('ack service down'))
    .mockImplementationOnce(() => pending.promise);
  renderRestored({ onConfirmUnitLabelsPrinted });
  await screen.findByText(UNKNOWN);

  fireEvent.click(ack()!);
  expect(await screen.findByRole('alert')).toHaveTextContent(/ack service down/i);
  expect(inReview()).toBeNull();

  fireEvent.click(ack()!);
  fireEvent.click(ack()!);
  await waitFor(() => expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(2));
  expect(inReview()).toBeNull();

  pending.resolve();
  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
  expect(onConfirmUnitLabelsPrinted).toHaveBeenCalledTimes(2);
});

it('S4-K6 — without onPrintUnitLabels there is no Print labels action and acknowledgement stays usable', async () => {
  const props = renderRestored({ onPrintUnitLabels: undefined });
  expect(await screen.findByRole('heading', { name: 'Confirm 2 unit labels.' })).toBeTruthy();
  expect(screen.getByText('Label printing status is unknown. Continue only after all 2 labels are physically attached.')).toBeTruthy();
  expect(printButton()).toBeNull();
  expect(screen.queryByRole('button', { name: /reprint labels/i })).toBeNull();
  expect(screen.getByText(/· Next · attach a label to each of the 2 units$/)).toBeTruthy();
  expect(ack()).toBeEnabled();

  fireEvent.click(ack()!);
  await waitFor(() => expect(props.onConfirmUnitLabelsPrinted).toHaveBeenCalledWith(LINE_ID));
  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
});

it('S4-J — externally barcoded units get no LSU label hold', async () => {
  const props = renderSession([line({ barcode: '5012345678900' })], {
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: 'variant-s4' }),
  });
  await countAndFinish(2);

  expect(await screen.findByRole('button', { name: /^close receive$/i })).toBeTruthy();
  expect(props.onPrintUnitLabels).not.toHaveBeenCalled();
  expect(ack()).toBeNull();
});
