/**
 * WS-UX-RECEIVE-D4R S2 / owner decision O1 — expected quantity is
 * informational, never a shortcut to assert an uncounted physical quantity.
 *
 * Protects: no ALL {expected} control; expected stays visible; a line starts
 * not counted and the count is never filled from expected; deliberate +,
 * typed and scanned counting remain; Finish Count is the canonical
 * confirmation; over-delivery still needs separate approval; label hold and
 * reconciliation still gate completion.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const LINE_ID = 'line-s2';
const VARIANT_ID = 'variant-s2';
const BARCODE = '5012345678900';

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: VARIANT_ID,
    sku: 'S2-SKU',
    variant_title: 'Default Title',
    description: 'S2 receive line',
    quantity_expected: 3,
    image_url: null,
    barcode: BARCODE,
    product_title: 'S2 widget',
    ...overrides,
  };
}

function renderSession(lines: ReceiveJobLine[] = [line()], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-s2',
    poId: 'po-s2',
    supplierName: 'S2 Supplier',
    lines,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmLineCount: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID }),
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
  const count = screen.queryByRole('button', { name: /^count$/i });
  if (count) fireEvent.click(count);
  return screen.findByRole('textbox', { name: /sellable count/i }) as Promise<HTMLInputElement>;
}

const plus = () => screen.getByRole('button', { name: /^\+$/ });
const minus = () => screen.getByRole('button', { name: /^−$/ });
const finishCount = () => screen.getByRole('button', { name: /finish count/i });
const provisionalWrites = (props: ReturnType<typeof renderSession>) =>
  (props.onPersistLineProgress as jest.Mock).mock.calls.map(([, params]) => params.quantity_sellable_provisional);

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

it('S2-1 — no ALL {expected} shortcut exists in Count or Scan', async () => {
  renderSession();
  await startCounting();
  expect(screen.queryByRole('button', { name: /^all\b/i })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
  await screen.findByPlaceholderText(/scan barcode/i);
  expect(screen.queryByRole('button', { name: /^all\b/i })).toBeNull();
});

it('S2-2 — expected quantity stays visible as information while counting', async () => {
  renderSession();
  await startCounting();
  expect(screen.getByText(/of 3 expected/i)).toBeTruthy();
});

it('S2-3 — a new line starts not counted and the count is never filled from expected', async () => {
  const props = renderSession();
  const value = await startCounting();

  expect(value.value).toBe('');
  expect(value).toHaveAttribute('placeholder', 'Not counted');
  expect(finishCount()).toBeDisabled();
  expect(provisionalWrites(props)).not.toContain(3);
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-3a — an untouched count cannot confirm even if the disabled control is invoked programmatically', async () => {
  const props = renderSession();
  await startCounting();

  const finish = finishCount();
  expect(finish).toBeDisabled();
  finish.removeAttribute('disabled');
  fireEvent.click(finish);

  await waitFor(() => expect(props.onConfirmLineCount).not.toHaveBeenCalled());
  expect(props.onPersistLineProgress).not.toHaveBeenCalledWith(
    LINE_ID,
    expect.objectContaining({ reconciliation_required: true })
  );
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-3b — typed zero is explicit and can be confirmed into canonical shortfall', async () => {
  const props = renderSession();
  const value = await startCounting();

  fireEvent.change(value, { target: { value: '0' } });
  expect(finishCount()).toBeEnabled();
  fireEvent.click(finishCount());

  expect(await screen.findByText(/account for the remaining 3 units/i)).toBeTruthy();
  expect(props.onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 0 });
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-3c — plus then minus establishes an explicit zero that can be confirmed', async () => {
  const props = renderSession();
  await startCounting();

  fireEvent.click(plus());
  fireEvent.click(minus());
  expect(finishCount()).toBeEnabled();
  fireEvent.click(finishCount());

  expect(await screen.findByText(/account for the remaining 3 units/i)).toBeTruthy();
  expect(props.onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 0 });
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-3d — an unconfirmed backend provisional zero remains not counted on re-entry', async () => {
  const props = renderSession([line({
    quantity_sellable_provisional: 0,
    quantity_count_confirmed: null,
  })]);
  const value = await startCounting();

  expect(value.value).toBe('');
  expect(value).toHaveAttribute('placeholder', 'Not counted');
  expect(finishCount()).toBeDisabled();
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
});

it('S2-4 — a deliberate count stays provisional until Finish Count', async () => {
  const props = renderSession();
  await startCounting();

  fireEvent.click(plus());
  fireEvent.click(plus());

  await waitFor(() => expect(provisionalWrites(props)).toContain(2));
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-5 — explicit physical counting remains available: +, typed quantity and scan', async () => {
  const props = renderSession();
  const value = await startCounting();

  fireEvent.click(plus());
  expect(value.value).toBe('1');

  fireEvent.change(value, { target: { value: '3' } });
  expect((screen.getByRole('textbox', { name: /sellable count/i }) as HTMLInputElement).value).toBe('3');
  await waitFor(() => expect(provisionalWrites(props)).toContain(3));

  cleanup();
  const scanProps = renderSession();
  await startCounting();
  fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
  const input = await screen.findByPlaceholderText(/scan barcode/i);
  fireEvent.change(input, { target: { value: BARCODE } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(provisionalWrites(scanProps)).toContain(1));
});

it('S2-6 — Finish Count confirms the physical count before inspection', async () => {
  const props = renderSession();
  const value = await startCounting();
  fireEvent.change(value, { target: { value: '3' } });

  fireEvent.click(finishCount());

  await waitFor(() => expect(props.onConfirmLineCount).toHaveBeenCalledWith(LINE_ID, { quantity_confirmed: 3 }));
  await waitFor(() => expect(props.onInspectLine).toHaveBeenCalledWith(expect.objectContaining({ quantity_accepted: 3 })));
  expect((props.onConfirmLineCount as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan((props.onInspectLine as jest.Mock).mock.invocationCallOrder[0]);
});

it('S2-7 — counting past expected still requires a separate over-delivery approval', async () => {
  const props = renderSession();
  const value = await startCounting();
  fireEvent.change(value, { target: { value: '4' } });

  expect(await screen.findByRole('region', { name: /extra unit detected/i })).toBeTruthy();
  expect(props.onApproveOverDelivery).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
});

it('S2-8a — a barcode-less line counted by hand still holds for LSU label acknowledgement', async () => {
  const props = renderSession([line({ barcode: null, quantity_expected: 2 })]);
  await startCounting();
  fireEvent.click(plus());
  fireEvent.click(plus());
  fireEvent.click(finishCount());

  expect(await screen.findByTestId('confirm-unit-labels-printed')).toBeTruthy();
  expect(props.onConfirmUnitLabelsPrinted).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^close receive$/i })).toBeNull();
});

it('S2-8b — a short physical count enters reconciliation and cannot finish the line', async () => {
  const props = renderSession();
  await startCounting();
  fireEvent.click(plus());
  fireEvent.click(finishCount());

  expect(await screen.findByText(/^to account for$/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /finish line/i })).toBeDisabled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
});
