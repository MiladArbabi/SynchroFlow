/**
 * WS-UX-RECEIVE-D4R S7 — save-aware Exit (V3.1 "Leave receiving" sheet).
 *
 * Exit never writes, confirms, finalizes, closes or releases the claim. It
 * waits for queued count writes and in-flight confirmations, says "saved"
 * only after the server accepted the write, offers Save again / Leave
 * without saving when a write failed, names unsubmitted choices before they
 * are discarded, and calls onComplete() with no arguments.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

const LINE_ID = 'line-s7';
const OPERATOR = 9;

function line(overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: 'variant-s7',
    sku: 'S7-SKU',
    variant_title: 'Default Title',
    description: 'S7 receive line',
    quantity_expected: 3,
    image_url: null,
    barcode: null,
    product_title: 'S7 widget',
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderSession(lines: ReceiveJobLine[] = [line()], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-s7',
    poId: 'po-s7',
    supplierName: 'S7 Supplier',
    jobStatus: 'in_progress',
    assignedOperatorId: OPERATOR,
    currentUserId: OPERATOR,
    lines,
    onClaimJob: jest.fn().mockResolvedValue(undefined),
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmLineCount: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    onSaveReconciliationDraft: jest.fn().mockResolvedValue({ revision_id: 'rev-1', revision_number: 1 }),
    onFinalizeReconciliation: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<ReceiveSessionPage {...(props as any)} />);
  return { props, view };
}

// The open sheet is modal: the page behind it is aria-hidden, so reach it with { hidden: true }.
const exitButton = () => screen.getByRole('button', { name: /^exit$/i, hidden: true });
const sheet = () => screen.queryByRole('dialog', { name: /./ });
const countValue = () => (screen.getByRole('textbox', { name: /sellable count/i, hidden: true }) as HTMLInputElement).value;
const plus = () => fireEvent.click(screen.getByRole('button', { name: /^\+$/ }));
const writtenCounts = (mock: jest.Mock) => mock.mock.calls.map(([, params]) => params.quantity_sellable_provisional);

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── Per-line ───────────────────────────────────────────────────────────────

it('S7-1/16 — nothing unsaved: Exit confirms "saved" without a write, and Back to WMS calls onComplete() with no arguments', async () => {
  const { props } = renderSession();
  await screen.findByRole('textbox', { name: /sellable count/i });
  const writesBefore = (props.onPersistLineProgress as jest.Mock).mock.calls.length;

  fireEvent.click(exitButton());
  const dialog = await screen.findByRole('dialog', { name: /leave this receive/i });
  expect(dialog).toHaveTextContent(/your counts are saved/i);
  expect((props.onPersistLineProgress as jest.Mock).mock.calls.length).toBe(writesBefore);
  expect(props.onComplete).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Back to WMS' }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
  expect(props.onCloseJob).not.toHaveBeenCalled();
});

it('S7-2/3 — a pending count write shows Saving with Back to WMS disabled; once it succeeds the sheet says saved', async () => {
  const write = deferred();
  const onPersistLineProgress = jest.fn((_id: string, params: { quantity_sellable_provisional: number }) => (
    params.quantity_sellable_provisional === 1 ? write.promise : Promise.resolve()
  ));
  const { props } = renderSession([line()], { onPersistLineProgress });
  await screen.findByRole('textbox', { name: /sellable count/i });
  plus();

  fireEvent.click(exitButton());
  const saving = await screen.findByRole('dialog', { name: /saving your count/i });
  expect(within(saving).getByRole('button', { name: 'Back to WMS' })).toBeDisabled();
  expect(props.onComplete).not.toHaveBeenCalled();

  await act(async () => { write.resolve(); });
  expect(await screen.findByRole('dialog', { name: /leave this receive/i })).toHaveTextContent(/your counts are saved/i);
});

it('S7-4/5 — a failed write is explained with Save again (T1); a successful retry re-sends the visible count and then says saved', async () => {
  const onPersistLineProgress = jest.fn()
    .mockResolvedValueOnce(undefined) // nothing else; start counts happen elsewhere
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValue(undefined);
  const { props } = renderSession([line({ quantity_sellable_provisional: 0 })], { onPersistLineProgress });
  await screen.findByRole('textbox', { name: /sellable count/i });
  onPersistLineProgress.mockReset()
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValue(undefined);
  plus();

  fireEvent.click(exitButton());
  const failed = await screen.findByRole('dialog', { name: /count not saved/i });
  expect(within(failed).getByRole('alert')).toHaveTextContent(/S7 widget wasn't saved \(network down\)/i);
  expect(within(failed).getByRole('button', { name: /save again/i }).className).toMatch(/contained/);
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(countValue()).toBe('1');

  fireEvent.click(within(failed).getByRole('button', { name: /save again/i }));
  expect(await screen.findByRole('dialog', { name: /leave this receive/i })).toBeTruthy();
  expect(writtenCounts(onPersistLineProgress)).toEqual([1, 1]);
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7-6/7 — Save again can fail again; Leave without saving is an explicit, argument-free exit', async () => {
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  const { props } = renderSession([line({ quantity_sellable_provisional: 0 })], { onPersistLineProgress });
  await screen.findByRole('textbox', { name: /sellable count/i });
  onPersistLineProgress.mockReset().mockRejectedValue(new Error('still offline'));
  plus();

  fireEvent.click(exitButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: /count not saved/i })).getByRole('button', { name: /save again/i }));
  const again = await screen.findByRole('dialog', { name: /count not saved/i });
  await waitFor(() => expect(within(again).getByRole('alert')).toHaveTextContent(/still offline/i));
  expect(props.onComplete).not.toHaveBeenCalled();

  fireEvent.click(within(again).getByRole('button', { name: /leave without saving/i }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
});

it('S7-8 — Keep receiving (or Escape) closes the sheet and keeps the exact work state', async () => {
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  const { props } = renderSession([line({ quantity_sellable_provisional: 0 })], { onPersistLineProgress });
  await screen.findByRole('textbox', { name: /sellable count/i });
  onPersistLineProgress.mockReset().mockRejectedValue(new Error('network down'));
  plus();
  plus();

  fireEvent.click(exitButton());
  const failed = await screen.findByRole('dialog', { name: /count not saved/i });
  fireEvent.keyDown(failed, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(sheet()).toBeNull());
  expect(countValue()).toBe('2');
  expect(props.onComplete).not.toHaveBeenCalled();

  onPersistLineProgress.mockReset().mockResolvedValue(undefined);
  fireEvent.click(exitButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: /count not saved/i })).getByRole('button', { name: /save again/i }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /leave this receive/i })).getByRole('button', { name: /keep receiving/i }));
  await waitFor(() => expect(sheet()).toBeNull());
  expect(countValue()).toBe('2');
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7-9 — an unsubmitted shortfall reason is named before leaving; going back keeps the selection', async () => {
  const { props } = renderSession();
  await screen.findByRole('textbox', { name: /sellable count/i });
  plus();
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  fireEvent.click(await screen.findByTestId('reconciliation-choice-defect'));

  fireEvent.click(exitButton());
  const review = await screen.findByRole('dialog', { name: /choices not saved/i });
  expect(within(review).getByRole('alert')).toHaveTextContent(/the shortfall reason for S7 widget/i);
  expect(within(review).getByRole('alert')).not.toHaveTextContent(/your counts are saved/i);

  fireEvent.click(within(review).getByRole('button', { name: /back to receiving/i }));
  await waitFor(() => expect(sheet()).toBeNull());
  expect(screen.getByTestId('reconciliation-choice-defect')).toHaveAttribute('aria-pressed', 'true');
  expect(props.onReportException).not.toHaveBeenCalled();
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7-10 — an in-flight Finish Count confirmation cannot be escaped; Exit waits for it', async () => {
  const confirm = deferred();
  const { props } = renderSession([line({ quantity_expected: 1, barcode: '5012345678900' }), line({ receive_job_line_id: 'line-s7-b', product_title: 'Second' })], {
    onConfirmLineCount: jest.fn(() => confirm.promise),
  });
  await screen.findByRole('textbox', { name: /sellable count/i });
  plus();
  fireEvent.click(screen.getByRole('button', { name: /finish count/i }));
  await waitFor(() => expect(props.onConfirmLineCount).toHaveBeenCalledTimes(1));

  fireEvent.click(exitButton());
  expect(await screen.findByRole('dialog', { name: /saving your count/i })).toBeTruthy();
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(screen.queryByRole('dialog', { name: /leave this receive/i })).toBeNull();

  await act(async () => { confirm.resolve(); });
  expect(await screen.findByRole('dialog', { name: /leave this receive/i })).toBeTruthy();
  expect(props.onInspectLine).toHaveBeenCalledTimes(1);
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7-11 — a repeated Exit does not repeat the flush or open a second sheet', async () => {
  const write = deferred();
  const onPersistLineProgress = jest.fn().mockResolvedValue(undefined);
  renderSession([line({ quantity_sellable_provisional: 0 })], { onPersistLineProgress });
  await screen.findByRole('textbox', { name: /sellable count/i });
  onPersistLineProgress.mockReset().mockImplementation(() => write.promise);
  plus();

  const exit = exitButton();
  fireEvent.click(exit);
  fireEvent.click(exit);
  await screen.findByRole('dialog', { name: /saving your count/i });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(exitButton()).toBeDisabled();
  expect(onPersistLineProgress).toHaveBeenCalledTimes(1);
  await act(async () => { write.resolve(); });
  expect(onPersistLineProgress).toHaveBeenCalledTimes(1);
});

it('S7-14 — leaving and resuming keeps a provisional count provisional; Exit confirms nothing', async () => {
  const { props, view } = renderSession([line({ quantity_sellable_provisional: 2 })]);
  expect(await screen.findByRole('textbox', { name: /sellable count/i })).toHaveValue('2');
  fireEvent.click(exitButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: /leave this receive/i })).getByRole('button', { name: 'Back to WMS' }));
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
  expect(props.onInspectLine).not.toHaveBeenCalled();
  view.unmount();

  const resumed = renderSession([line({ quantity_sellable_provisional: 2 })]);
  expect(await screen.findByRole('textbox', { name: /sellable count/i })).toHaveValue('2');
  expect(screen.getByRole('button', { name: /finish count/i })).toBeEnabled();
  expect(resumed.props.onConfirmLineCount).not.toHaveBeenCalled();
});

// ── Grouped ────────────────────────────────────────────────────────────────

const grouped = (lines: ReceiveJobLine[], overrides: Record<string, unknown> = {}) =>
  renderSession(lines, { sessionMode: 'grouped', ...overrides });
const countLine = (id: string, expected: number, confirmed: number | null) => line({
  receive_job_line_id: id,
  product_title: `Grouped ${id}`,
  quantity_expected: expected,
  barcode: `50000000${id.slice(-5).padStart(5, '0')}`,
  quantity_count_confirmed: confirmed,
  quantity_sellable_provisional: confirmed,
  count_state: confirmed == null ? 'not_counted' : 'confirmed',
});

it('S7-13 — grouped: a failed count save opens the exit sheet with Save again; a successful retry closes it', async () => {
  const onPersistLineProgress = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const { props } = grouped([countLine('g-00001', 2, null)], { onPersistLineProgress });
  const counted = await screen.findByRole('spinbutton', { name: /counted/i });
  fireEvent.change(counted, { target: { value: '1' } });
  await waitFor(() => expect(onPersistLineProgress).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  const failed = await screen.findByRole('dialog', { name: /count not saved/i });
  expect(within(failed).getByRole('alert')).toHaveTextContent(/wasn't saved/i);
  expect(props.onComplete).not.toHaveBeenCalled();

  fireEvent.click(within(failed).getByRole('button', { name: /save again/i }));
  await waitFor(() => expect(sheet()).toBeNull());
  expect(onPersistLineProgress).toHaveBeenLastCalledWith('g-00001', { quantity_sellable_provisional: 1 });
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
});

it('S7-12 — grouped: unsaved review choices are named in the sheet; Back to review keeps them, Leave exits with no write', async () => {
  const { props } = grouped([countLine('g-00001', 3, 1), countLine('g-00002', 2, 2)]);
  fireEvent.click(await screen.findByRole('button', { name: /review and finish/i }));
  fireEvent.change(await screen.findByRole('spinbutton', { name: /missing/i }), { target: { value: '2' } });

  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  const review = await screen.findByRole('dialog', { name: /review choices not saved/i });
  expect(within(review).getByRole('alert')).toHaveTextContent(/review choices aren't saved yet/i);
  fireEvent.click(within(review).getByRole('button', { name: /back to review/i }));
  await waitFor(() => expect(sheet()).toBeNull());
  expect((screen.getByRole('spinbutton', { name: /missing/i }) as HTMLInputElement).value).toBe('2');

  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: /review choices not saved/i })).getByRole('button', { name: /leave without saving/i }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
  expect(props.onSaveReconciliationDraft).not.toHaveBeenCalled();
  expect(props.onFinalizeReconciliation).not.toHaveBeenCalled();
});

// ── S7-CORRECT-002 — line-accurate save failures ──────────────────────────

const LINE_A = 'line-s7-a';
const LINE_B = 'line-s7-b';
const twoLines = () => [
  line({ receive_job_line_id: LINE_A, lasyncro_variant_id: 'variant-a', product_title: 'Product Alpha', sku: 'ALPHA', quantity_expected: 3 }),
  line({ receive_job_line_id: LINE_B, lasyncro_variant_id: 'variant-b', product_title: 'Product Bravo', sku: 'BRAVO', quantity_expected: 2 }),
];

/** Count one unit on the current product, then switch to `name` through the PO-lines drawer. */
async function countOneThenOpen(name: RegExp) {
  await screen.findByRole('textbox', { name: /sellable count/i });
  plus();
  fireEvent.click(screen.getByRole('button', { name: /po lines/i }));
  fireEvent.click(await screen.findByRole('button', { name }));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name));
}

/** A writer that refuses the listed (line, quantity) attempts once each, in order. */
function flakyWriter(refusals: Array<[string, number, string]>) {
  const pending = [...refusals];
  return jest.fn(async (lineId: string, params: { quantity_sellable_provisional: number }) => {
    const index = pending.findIndex(([id, qty]) => id === lineId && qty === params.quantity_sellable_provisional);
    if (index >= 0) {
      const [, , message] = pending.splice(index, 1)[0];
      throw new Error(message);
    }
  });
}

it('S7C-1 — Product A fails while Product B is on screen and B saves: the sheet names A (not B); B\'s success does not clear it', async () => {
  const writer = flakyWriter([[LINE_A, 1, 'A refused']]);
  const { props } = renderSession(twoLines(), { onPersistLineProgress: writer });
  await countOneThenOpen(/product bravo/i);
  plus();
  await waitFor(() => expect(writer).toHaveBeenCalledWith(LINE_B, { quantity_sellable_provisional: 1 }));

  fireEvent.click(exitButton());
  const failed = await screen.findByRole('dialog', { name: /count not saved/i });
  expect(within(failed).getByRole('alert')).toHaveTextContent(/the count of 1 for Product Alpha wasn't saved \(A refused\)/i);
  expect(within(failed).getByRole('alert')).not.toHaveTextContent(/bravo/i);
  expect(screen.queryByRole('dialog', { name: /leave this receive/i })).toBeNull();
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7C-2 — Save again retries Product A with A\'s quantity, leaves B\'s count on screen, then allows a safe exit', async () => {
  const writer = flakyWriter([[LINE_A, 1, 'A refused']]);
  const { props } = renderSession(twoLines(), { onPersistLineProgress: writer });
  await countOneThenOpen(/product bravo/i);
  plus();
  plus();

  fireEvent.click(exitButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: /count not saved/i })).getByRole('button', { name: /save again/i }));
  const saved = await screen.findByRole('dialog', { name: /leave this receive/i });
  const aWrites = writer.mock.calls.filter(([id]) => id === LINE_A).map(([, p]) => p.quantity_sellable_provisional);
  expect(aWrites).toEqual([1, 1]);
  expect(countValue()).toBe('2');

  fireEvent.click(within(saved).getByRole('button', { name: 'Back to WMS' }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
});

it('S7C-3 — two failed products stay individually recoverable; a retry that fails again stays visibly failed', async () => {
  const writer = flakyWriter([
    [LINE_A, 1, 'A refused'],
    [LINE_B, 1, 'B refused'],
    [LINE_B, 1, 'B refused again'],
  ]);
  const { props } = renderSession(twoLines(), { onPersistLineProgress: writer });
  await countOneThenOpen(/product bravo/i);
  plus();

  fireEvent.click(exitButton());
  const both = await screen.findByRole('dialog', { name: /counts not saved/i });
  expect(within(both).getByRole('alert')).toHaveTextContent(/2 counts weren't saved/i);
  expect(within(both).getByRole('alert')).toHaveTextContent(/Product Alpha \(1\) — A refused/);
  expect(within(both).getByRole('alert')).toHaveTextContent(/Product Bravo \(1\) — B refused/);

  fireEvent.click(within(both).getByRole('button', { name: /save again/i }));
  const onlyB = await screen.findByRole('dialog', { name: /^count not saved/i });
  await waitFor(() => expect(within(onlyB).getByRole('alert')).toHaveTextContent(/the count of 1 for Product Bravo wasn't saved \(B refused again\)/i));
  expect(within(onlyB).getByRole('alert')).not.toHaveTextContent(/alpha/i);

  fireEvent.click(within(onlyB).getByRole('button', { name: /save again/i }));
  expect(await screen.findByRole('dialog', { name: /leave this receive/i })).toBeTruthy();
  expect(writer.mock.calls.filter(([id]) => id === LINE_B).map(([, p]) => p.quantity_sellable_provisional)).toEqual([1, 1, 1]);
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('S7C-4 — without a progress writer, a local count is never reported as saved', async () => {
  const { props } = renderSession([line()], { onPersistLineProgress: undefined });
  await screen.findByRole('textbox', { name: /sellable count/i });
  plus();

  fireEvent.click(exitButton());
  const review = await screen.findByRole('dialog', { name: /choices not saved/i });
  expect(within(review).getByRole('alert')).toHaveTextContent(/the count of 1 for S7 widget \(this screen cannot save counts\)/i);
  expect(screen.queryByText(/your counts are saved/i)).toBeNull();
  expect(props.onComplete).not.toHaveBeenCalled();
});

// ── S7-CORRECT-002 — grouped clean exit (V3.1 Saved sheet) ─────────────────

it('S7C-5 — grouped clean exit asks first: Keep receiving returns to the session; a double confirm exits once; nothing is written', async () => {
  const { props } = grouped([countLine('g-00001', 2, 2), countLine('g-00002', 1, null)]);
  await screen.findByRole('spinbutton', { name: /counted/i });

  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  const saved = await screen.findByRole('dialog', { name: /leave this receive/i });
  expect(saved).toHaveTextContent(/your counts are saved/i);
  expect(props.onComplete).not.toHaveBeenCalled();

  fireEvent.click(within(saved).getByRole('button', { name: /keep receiving/i }));
  await waitFor(() => expect(sheet()).toBeNull());
  expect(screen.getByTestId('receive-count-current')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Exit' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  const again = await screen.findByRole('dialog', { name: /leave this receive/i });
  const back = within(again).getByRole('button', { name: 'Back to WMS' });
  fireEvent.click(back);
  fireEvent.click(back);
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
  expect(props.onPersistLineProgress).not.toHaveBeenCalled();
  expect(props.onConfirmLineCount).not.toHaveBeenCalled();
  expect(props.onSaveReconciliationDraft).not.toHaveBeenCalled();
  expect(props.onFinalizeReconciliation).not.toHaveBeenCalled();
});
