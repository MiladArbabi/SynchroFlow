/**
 * WS-UX-RECEIVE-D4R S3 — Shortfall reasons (owner decision O2) and
 * persistence-safe inline over-delivery decisions.
 *
 * Protects: exactly the six canonical shortfall reasons (no barcode
 * mismatch); Other needs notes; quantity validation; several allocations
 * reach zero with SELLABLE + ACCOUNTED = EXPECTED; an over-delivery decision
 * closes only after its count write is saved, stays open with a retryable
 * error on failure, restores the last saved count, and accepts one
 * submission at a time; approval still needs a confirmed count.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const LINE_ID = 'line-s3';
const VARIANT_ID = 'variant-s3';

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: VARIANT_ID,
    sku: 'S3-SKU',
    variant_title: 'Default Title',
    description: 'S3 receive line',
    quantity_expected: 3,
    image_url: null,
    barcode: null,
    product_title: 'S3 widget',
    ...overrides,
  };
}

function renderSession(lines: ReceiveJobLine[], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-s3',
    poId: 'po-s3',
    supplierName: 'S3 Supplier',
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

async function startCounting() {
  const start = screen.queryByRole('button', { name: /start receive/i });
  if (start) fireEvent.click(start);
  return screen.findByRole('textbox', { name: /sellable count/i }) as Promise<HTMLInputElement>;
}

const plus = () => fireEvent.click(screen.getByRole('button', { name: /^\+$/ }));
const decision = () => screen.queryByRole('region', { name: /extra unit detected/i });
const countValue = () => (screen.getByRole('textbox', { name: /sellable count/i }) as HTMLInputElement).value;

async function enterShortfall(sellable: number) {
  const input = await startCounting();
  if (sellable === 0) {
    fireEvent.change(input, { target: { value: '0' } });
  } else {
    for (let i = 0; i < sellable; i += 1) plus();
  }
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  await screen.findByText(/^to account for$/i);
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── S3-A — Shortfall ───────────────────────────────────────────────────────

it('S3-A1 — exactly the six canonical shortfall reasons; barcode mismatch is not one', async () => {
  renderSession([line()]);
  await enterShortfall(1);

  const choices = screen.getAllByTestId(/^reconciliation-choice-/).map((node) => node.getAttribute('data-testid'));
  expect(choices).toEqual([
    'reconciliation-choice-deferred',
    'reconciliation-choice-defect',
    'reconciliation-choice-wrong_item',
    'reconciliation-choice-wrong_variant',
    'reconciliation-choice-missing_item',
    'reconciliation-choice-other',
  ]);
  expect(within(screen.getByTestId('reconciliation-choice-deferred')).getByText('Later delivery')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /barcode/i })).toBeNull();
});

it('S3-A2 — Other cannot be added without notes; with notes it posts the canonical shortfall payload', async () => {
  const props = renderSession([line()]);
  await enterShortfall(1);

  fireEvent.click(screen.getByTestId('reconciliation-choice-other'));
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  expect(await screen.findByText(/add a note to continue/i)).toBeTruthy();
  expect(props.onReportException).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('textbox', { name: /notes/i }), { target: { value: 'Crushed pallet corner' } });
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  await waitFor(() => expect(props.onReportException).toHaveBeenCalledWith(expect.objectContaining({
    receive_job_line_id: LINE_ID,
    exception_type: 'other',
    quantity_affected: 1,
    accounting_role: 'shortfall',
    notes: 'Crushed pallet corner',
  })));
});

it('S3-A3 — a quantity above the remaining shortfall is refused without a write', async () => {
  const props = renderSession([line()]);
  await enterShortfall(1);

  fireEvent.click(screen.getByTestId('reconciliation-choice-defect'));
  fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));

  expect(await screen.findByText(/maximum is 2/i)).toBeTruthy();
  expect(props.onReportException).not.toHaveBeenCalled();
});

it('S3-A4 — several allocations reach zero and keep SELLABLE + ACCOUNTED = EXPECTED', async () => {
  const props = renderSession([line()]);
  await enterShortfall(0);

  for (const type of ['defect', 'deferred', 'missing_item']) {
    fireEvent.click(await screen.findByTestId(`reconciliation-choice-${type}`));
    fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /adding/i })).toBeNull());
  }

  expect(await screen.findByText(/accounted 3 \/ 3/i)).toBeTruthy();
  expect(screen.getByText(/sellable 0 \+ accounted 3 = expected 3/i)).toBeTruthy();
  expect(props.onPersistLineProgress).toHaveBeenCalledWith(LINE_ID, expect.objectContaining({ quantity_deferred: 1 }));
  expect(props.onReportException).toHaveBeenCalledTimes(2);

  const finish = screen.getByRole('button', { name: /finish line/i });
  expect(finish).toBeEnabled();
  fireEvent.click(finish);
  await waitFor(() => expect(props.onInspectLine).toHaveBeenCalledWith(expect.objectContaining({
    quantity_accepted: 0,
  })));
});

// ── S3-B / S3-C — Over-delivery ────────────────────────────────────────────

it('S3-B1 — Keep extra waits for the save; a failure keeps the decision open with the last saved count, and retry closes it', async () => {
  let failures = 2;
  const onPersistLineProgress = jest.fn(async (_id: string, params: { quantity_sellable_provisional: number }) => {
    if (params.quantity_sellable_provisional === 2 && failures > 0) {
      failures -= 1;
      throw new Error('network down');
    }
  });
  const props = renderSession([line({ quantity_expected: 1 })], { onPersistLineProgress });
  await startCounting();
  plus();
  plus();

  const region = await screen.findByRole('region', { name: /extra unit detected/i });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(region).getByRole('button', { name: /keep extra in count/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/count not saved/i);
  expect(decision()).not.toBeNull();
  expect(props.onApproveOverDelivery).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /keep extra in count/i }));
  await waitFor(() => expect(decision()).toBeNull());
  expect(countValue()).toBe('2');
  expect(props.onApproveOverDelivery).not.toHaveBeenCalled();
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
});

it('S3-B2 — a failed save restores the count the server last saved', async () => {
  const onPersistLineProgress = jest.fn(async (_id: string, params: { quantity_sellable_provisional: number }) => {
    if (params.quantity_sellable_provisional === 2) throw new Error('network down');
  });
  renderSession([line({ quantity_expected: 1 })], { onPersistLineProgress });
  await startCounting();
  plus();
  await waitFor(() => expect(onPersistLineProgress).toHaveBeenCalledWith(LINE_ID, { quantity_sellable_provisional: 1 }));
  plus();

  fireEvent.click(await screen.findByRole('button', { name: /keep extra in count/i }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /do not receive extra/i }));
  await waitFor(() => expect(decision()).toBeNull());
  expect(countValue()).toBe('1');
});

it('S3-B3 — one submission at a time: a pending save shows Saving and blocks repeat clicks', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let gate = false;
  const onPersistLineProgress = jest.fn(async () => {
    if (gate) await pending;
  });
  renderSession([line({ quantity_expected: 1 })], { onPersistLineProgress });
  await startCounting();
  plus();
  plus();
  await screen.findByRole('region', { name: /extra unit detected/i });
  await waitFor(() => expect(onPersistLineProgress).toHaveBeenCalledWith(LINE_ID, { quantity_sellable_provisional: 2 }));
  // Start Receive seeds a provisional 0 (R30); count only the decision's write.
  const before = onPersistLineProgress.mock.calls.length;

  gate = true;
  const keep = screen.getByRole('button', { name: /keep extra in count/i });
  fireEvent.click(keep);
  fireEvent.click(keep);
  fireEvent.click(screen.getByRole('button', { name: /do not receive extra/i }));

  expect(await screen.findByText(/saving…/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /keep extra in count/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /do not receive extra/i })).toBeDisabled();
  expect(onPersistLineProgress).toHaveBeenCalledTimes(before + 1);

  release();
  await waitFor(() => expect(decision()).toBeNull());
  expect(onPersistLineProgress).toHaveBeenCalledTimes(before + 1);
});

it('S3-B4 — approval stays behind Finish Count, and a failed approval keeps the inline decision open', async () => {
  const onApproveOverDelivery = jest.fn().mockRejectedValue(new Error('overage approval failed'));
  const props = renderSession([line({ quantity_expected: 1 })], { onApproveOverDelivery });
  await startCounting();
  plus();
  plus();

  expect(await screen.findByRole('region', { name: /extra unit detected/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /accept extra/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /keep extra in count/i }));
  await waitFor(() => expect(decision()).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  fireEvent.click(await screen.findByRole('button', { name: /accept extra unit/i }));

  expect(await screen.findByText(/overage approval failed/i)).toBeTruthy();
  expect(decision()).not.toBeNull();
  expect(props.onInspectLine).not.toHaveBeenCalled();
  expect((props.onConfirmLineCount as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan(onApproveOverDelivery.mock.invocationCallOrder[0]);
});

// ── S8-C5 — Recount after saved allocations ────────────────────────────────

async function allocateDefect(qty = 1) {
  fireEvent.click(screen.getByTestId('reconciliation-choice-defect'));
  fireEvent.change(screen.getByLabelText(/qty affected/i), { target: { value: String(qty) } });
  fireEvent.click(screen.getByRole('button', { name: /add to reconciliation/i }));
  await screen.findByText(new RegExp(`accounted ${qty} / 2`, 'i'));
}

it('U-R1 — with saved allocations, Recount confirms, calls the server once, returns to Count with the prior count, and the corrected count is re-confirmed', async () => {
  const onRecountLine = jest.fn().mockResolvedValue(undefined);
  const props = renderSession([line({ barcode: '5012345678900' })], { onRecountLine });
  await enterShortfall(1);
  await allocateDefect(1);

  // Keep leaves everything as it was.
  fireEvent.click(screen.getByRole('button', { name: /^recount$/i }));
  const sheet = await screen.findByRole('dialog', { name: /recount this product/i });
  expect(sheet).toHaveTextContent(/your 1 recorded problem for it will be cleared/i);
  expect(sheet).toHaveTextContent(/other products are not affected/i);
  fireEvent.click(within(sheet).getByRole('button', { name: /^keep$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /recount this product/i })).toBeNull());
  expect(onRecountLine).not.toHaveBeenCalled();
  expect(screen.getByText(/^to account for$/i)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /^recount$/i }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /recount this product/i })).getByRole('button', { name: /^recount$/i }));
  await waitFor(() => expect(onRecountLine).toHaveBeenCalledWith(LINE_ID));
  expect(onRecountLine).toHaveBeenCalledTimes(1);

  await waitFor(() => expect(screen.queryByText(/^to account for$/i)).toBeNull());
  expect(countValue()).toBe('1');
  expect(props.onInspectLine).not.toHaveBeenCalled();

  plus();
  plus();
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  await waitFor(() => expect(props.onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect((props.onConfirmLineCount as jest.Mock).mock.calls.map((call) => call[1].quantity_confirmed)).toEqual([1, 3]);
});

it('U-R1b — without a server Recount, saved allocations hide Recount (fails closed); with none it stays client-only', async () => {
  renderSession([line()]);
  await enterShortfall(1);
  expect(screen.getByRole('button', { name: /^recount$/i })).toBeTruthy();
  await allocateDefect(1);
  expect(screen.queryByRole('button', { name: /^recount$/i })).toBeNull();
});

it('U-R3 — a definitive refusal changes nothing; an unknown outcome blocks until the same Recount is retried', async () => {
  const refusal = Object.assign(new Error('refused'), { response: { status: 409, data: { code: 'RECEIVE_LINE_ALREADY_INSPECTED' } } });
  const onRecountLine = jest.fn()
    .mockRejectedValueOnce(refusal)
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce(undefined);
  renderSession([line({ barcode: '5012345678900' })], { onRecountLine });
  await enterShortfall(1);
  await allocateDefect(1);

  fireEvent.click(screen.getByRole('button', { name: /^recount$/i }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /recount this product/i })).getByRole('button', { name: /^recount$/i }));
  const refused = await screen.findByRole('dialog', { name: /recount not possible/i });
  expect(within(refused).getByRole('alert')).toHaveTextContent(/already finished.*nothing was changed/i);
  fireEvent.click(within(refused).getByRole('button', { name: /back to reconciliation/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText(/accounted 1 \/ 2/i)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /^recount$/i }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /recount this product/i })).getByRole('button', { name: /^recount$/i }));
  const unknown = await screen.findByRole('dialog', { name: /recount not confirmed/i });
  expect(within(unknown).getByRole('alert')).toHaveTextContent(/couldn't confirm whether the recount was applied/i);
  expect(within(unknown).queryByRole('button', { name: /keep|back/i })).toBeNull();
  expect(screen.getByText(/^to account for$/i)).toBeTruthy();

  fireEvent.click(within(unknown).getByRole('button', { name: /try again/i }));
  await waitFor(() => expect(screen.queryByText(/^to account for$/i)).toBeNull());
  expect(onRecountLine).toHaveBeenCalledTimes(3);
  expect(countValue()).toBe('1');
});

it('U-R4 — Recount never bypasses the label hold: a barcode-less corrected count still needs label acknowledgement', async () => {
  const onRecountLine = jest.fn().mockResolvedValue(undefined);
  const props = renderSession([line({ barcode: null })], { onRecountLine });
  await enterShortfall(1);
  await allocateDefect(1);
  fireEvent.click(screen.getByRole('button', { name: /^recount$/i }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /recount this product/i })).getByRole('button', { name: /^recount$/i }));
  await waitFor(() => expect(screen.queryByText(/^to account for$/i)).toBeNull());

  plus();
  plus();
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  await waitFor(() => expect(props.onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect(await screen.findByRole('button', { name: /all 3 labels are attached/i })).toBeTruthy();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
});
