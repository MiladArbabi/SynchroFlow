/**
 * WS-UX-RECEIVE-D4R S6 — Brief / Review paging (UX-14), canonical Close and
 * Completion.
 *
 * Paging is presentation only: totals and the Close gate use every line. The
 * actual delivery date is required and never defaulted. One close request at
 * a time; success shows Completion only after the canonical refresh; an
 * unknown outcome re-reads and stays safely retryable. Completion restores
 * from closed_at, never offers Close again and invents no Stow facts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

function line(n: number, overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: `line-s6-${n}`,
    lasyncro_variant_id: `variant-s6-${n}`,
    sku: `S6-SKU-${n}`,
    variant_title: 'Default Title',
    description: `S6 line ${n}`,
    quantity_expected: 2,
    image_url: null,
    barcode: `50000000000${String(n).padStart(2, '0')}`,
    product_title: `S6 product ${n}`,
    ...overrides,
  };
}
const done = (n: number, accepted = 2, overrides: Partial<ReceiveJobLine> = {}) =>
  line(n, { inspection_complete: true, quantity_accepted: accepted, count_state: 'inspected', ...overrides });
const lines = (count: number, make: (n: number) => ReceiveJobLine) => Array.from({ length: count }, (_, i) => make(i + 1));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderSession(receiveLines: ReceiveJobLine[], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-s6',
    poId: 'po-s6',
    poNumber: 1600,
    supplierName: 'S6 Supplier',
    lines: receiveLines,
    onInspectLine: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue(undefined),
    onApproveOverDelivery: jest.fn().mockResolvedValue(undefined),
    onPersistLineProgress: jest.fn().mockResolvedValue(undefined),
    onConfirmLineCount: jest.fn().mockResolvedValue(undefined),
    onCloseJob: jest.fn().mockResolvedValue(undefined),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onComplete: jest.fn(),
    onPrintUnitLabels: jest.fn().mockResolvedValue(undefined),
    onConfirmUnitLabelsPrinted: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<ReceiveSessionPage {...(props as any)} />);
  return { props, view };
}

const table = (name: RegExp) => screen.getByRole('table', { name });
const bodyRows = (name: RegExp) => within(table(name)).getAllByRole('row').slice(1);
const pager = (name: RegExp) => screen.queryByRole('navigation', { name });
const closeButton = () => screen.queryByRole('button', { name: /^close receive$/i });
const setDate = (value: string) => fireEvent.change(screen.getByLabelText(/actual delivery date/i), { target: { value } });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

// ── S6-A — Brief / Review paging ───────────────────────────────────────────

it.each([
  [1, false],
  [6, false],
  [7, true],
])('S6-A1 — a Brief with %i line(s) pages only after six lines', (count, paged) => {
  renderSession(lines(count, (n) => line(n)), { jobStatus: 'pending', assignedOperatorId: 4, currentUserId: 4 });
  expect(bodyRows(/products on this receive/i)).toHaveLength(Math.min(count, 6));
  expect(pager(/products on this receive pages/i) != null).toBe(paged);
});

it('S6-A2 — a long Brief reaches every line, page by page', () => {
  renderSession(lines(14, (n) => line(n)), { jobStatus: 'pending', assignedOperatorId: 4, currentUserId: 4 });
  const nav = pager(/products on this receive pages/i)!;
  expect(within(nav).getByRole('status')).toHaveTextContent('Lines 1–6 of 14');
  fireEvent.click(within(nav).getByRole('button', { name: /next lines/i }));
  expect(within(nav).getByRole('status')).toHaveTextContent('Lines 7–12 of 14');
  fireEvent.click(within(nav).getByRole('button', { name: /next lines/i }));
  expect(within(nav).getByRole('status')).toHaveTextContent('Lines 13–14 of 14');
  expect(bodyRows(/products on this receive/i)).toHaveLength(2);
  expect(within(table(/products on this receive/i)).getByText('S6 product 14')).toBeTruthy();
  expect(within(nav).getByRole('button', { name: /next lines/i })).toBeDisabled();
  // Every fact a collapsed mobile column carries stays on the row.
  expect(screen.getAllByText(/^Received 0 · Remaining 2$/)).toHaveLength(2);
});

it('S6-A3 — Review pages its lines but totals every line, including off-page problems and extras', () => {
  const extraProblemLine = done(8, 4, {
    quantity_expected: 2,
    reported_problems: [{ receive_exception_id: 'ex-8', exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall' }],
  });
  renderSession([...lines(7, (n) => done(n)), extraProblemLine]);

  expect(screen.getByText(/review receive/i)).toBeTruthy();
  expect(bodyRows(/review lines/i)).toHaveLength(7); // 6 lines + Total
  const total = screen.getByText('Total').closest('tr')!;
  const cells = within(total).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells.slice(1, 5)).toEqual(['16', '18', '2', '1']);

  fireEvent.click(screen.getByRole('button', { name: /next lines/i }));
  expect(within(table(/review lines/i)).getByText('S6 product 8')).toBeTruthy();
  expect(screen.getByText(/^Extra 2 · Problems 1 · Ready$/)).toBeTruthy();
  expect(within(screen.getByText('Total').closest('tr')!).getAllByRole('cell').map((cell) => cell.textContent).slice(1, 5))
    .toEqual(['16', '18', '2', '1']);
});

it('S6-A3a — Brief exposes the full product name and SKU through a keyboard/touch expansion', () => {
  const productName = 'The exceptionally long warehouse product name that must remain available to operators';
  const sku = 'S6-VERY-LONG-SKU-WITH-OPERATOR-SIGNIFICANT-SUFFIX';
  renderSession([line(1, { product_title: productName, sku })], {
    jobStatus: 'pending', assignedOperatorId: 4, currentUserId: 4,
  });

  const identity = screen.getByRole('button', { name: new RegExp(`show full product identity for ${productName}`, 'i') });
  expect(identity).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(identity);
  expect(identity).toHaveAttribute('aria-expanded', 'true');
  const detail = screen.getByRole('dialog', { name: /product identity/i });
  expect(within(detail).getByText(productName)).toHaveStyle({ whiteSpace: 'normal' });
  expect(within(detail).getByText(sku)).toHaveStyle({ whiteSpace: 'normal' });
});

it('S6-A3b — Review exposes the full product name and SKU through a keyboard/touch expansion', () => {
  const productName = 'The exceptionally long reviewed product name that must remain available to operators';
  const sku = 'S6-REVIEW-LONG-SKU-WITH-OPERATOR-SIGNIFICANT-SUFFIX';
  renderSession([done(1, 2, { product_title: productName, sku })]);

  const identity = screen.getByRole('button', { name: new RegExp(`show full product identity for ${productName}`, 'i') });
  expect(identity).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(identity, { key: 'Enter' });
  fireEvent.click(identity);
  expect(identity).toHaveAttribute('aria-expanded', 'true');
  const detail = screen.getByRole('dialog', { name: /product identity/i });
  expect(within(detail).getByText(productName)).toHaveStyle({ whiteSpace: 'normal' });
  expect(within(detail).getByText(sku)).toHaveStyle({ whiteSpace: 'normal' });
});

it('S6-A3c — PO-lines drawer rows wrap full product names and SKUs without hover', () => {
  const productName = 'The exceptionally long drawer product name that must remain available to operators';
  const sku = 'S6-DRAWER-LONG-SKU-WITH-OPERATOR-SIGNIFICANT-SUFFIX';
  renderSession([line(1, { product_title: productName, sku })], {
    jobStatus: 'in_progress', assignedOperatorId: 4, currentUserId: 4,
  });
  fireEvent.click(screen.getByRole('button', { name: /po lines/i }));
  const drawer = screen.getByRole('dialog');

  expect(within(drawer).getByText(productName)).toHaveStyle({ whiteSpace: 'normal' });
  expect(within(drawer).getByText(sku)).toHaveStyle({ whiteSpace: 'normal' });
});

it('S6-A4 — an off-page unacknowledged label hold keeps the session on that hold; Close is never offered', () => {
  renderSession([...lines(7, (n) => done(n)), done(8, 2, { barcode: null, awaiting_label_ack: true })], {
    jobStatus: 'in_progress', assignedOperatorId: 4, currentUserId: 4,
  });
  expect(screen.getByTestId('confirm-unit-labels-printed')).toHaveTextContent('All 2 labels are attached');
  expect(closeButton()).toBeNull();
  expect(screen.queryByText(/review receive/i)).toBeNull();
});

// ── S6-B — Canonical close ─────────────────────────────────────────────────

it('S6-B1 — the actual delivery date starts empty, is required, and Close stays disabled until it is set', () => {
  const { props } = renderSession(lines(2, (n) => done(n)));
  expect((screen.getByLabelText(/actual delivery date/i) as HTMLInputElement).value).toBe('');
  expect(closeButton()).toBeDisabled();
  expect(screen.getByText(/next · enter the actual delivery date/i)).toBeTruthy();
  fireEvent.click(closeButton()!);
  expect(props.onCloseJob).not.toHaveBeenCalled();

  setDate('2026-10-24');
  expect(closeButton()).toBeEnabled();
});

it('S6-B2 — a close in flight cannot be submitted twice and does not claim success early', async () => {
  const pending = deferred();
  const { props } = renderSession(lines(2, (n) => done(n)), { onCloseJob: jest.fn(() => pending.promise) });
  setDate('2026-10-24');

  const close = closeButton()!;
  fireEvent.click(close);
  fireEvent.click(close);
  expect(props.onCloseJob).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/closing… waiting for the server to confirm/i)).toBeTruthy();
  expect(screen.queryByText(/receive complete/i)).toBeNull();

  await act(async () => { pending.resolve(); });
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(props.onCloseJob).toHaveBeenCalledTimes(1);
  expect(props.onCloseJob).toHaveBeenCalledWith({ actual_delivery_date: '2026-10-24' });
  expect((props.onRefresh as jest.Mock).mock.invocationCallOrder[0])
    .toBeGreaterThan((props.onCloseJob as jest.Mock).mock.invocationCallOrder[0]);
});

// ── S6-B / C3 — Close outcome safety ───────────────────────────────────────
// A resolved void refresh proves nothing: only an applied canonical read
// decides closed vs open. Anything else leaves Close disabled behind Check status.

const OPEN = { applied: true, jobStatus: 'in_progress', closedAt: null };
const CLOSED = { applied: true, jobStatus: 'closed', closedAt: '2026-10-25T14:32:00' };
const STALE = { applied: false };
const httpError = (status: number, error: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error } } });
const checkStatus = () => screen.queryByRole('button', { name: /^check status$/i });
const UNKNOWN_COPY = /we couldn't confirm whether this receive closed\. check its latest status before trying again\./i;
const OPEN_COPY = /this receive is still open\. you can try closing it again\./i;

async function closeWith(overrides: Record<string, unknown>) {
  const rendered = renderSession(lines(2, (n) => done(n)), overrides);
  setDate('2026-10-24');
  fireEvent.click(closeButton()!);
  return rendered;
}

it('S6-B3 — a lost close response that reads canonical closed shows Completion, not a failure', async () => {
  await closeWith({ onCloseJob: jest.fn().mockRejectedValue(new Error('Network Error')), onRefresh: jest.fn().mockResolvedValue(CLOSED) });
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(closeButton()).toBeNull();
  expect(screen.queryByText(/network error|couldn't|failed/i)).toBeNull();
});

it('S6-B4 — a lost close response that reads canonical open offers only a deliberate retry', async () => {
  const onCloseJob = jest.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(undefined);
  await closeWith({ onCloseJob, onRefresh: jest.fn().mockResolvedValueOnce(OPEN).mockResolvedValue(CLOSED) });
  expect(await screen.findByText(OPEN_COPY)).toBeTruthy();
  expect(screen.queryByText(/network error/i)).toBeNull();
  expect(onCloseJob).toHaveBeenCalledTimes(1); // never retried automatically
  expect(closeButton()).toBeEnabled();
  fireEvent.click(closeButton()!);
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(onCloseJob).toHaveBeenCalledTimes(2);
});

it.each([
  ['the canonical read fails', jest.fn().mockRejectedValue(new Error('Network Error'))],
  ['the refresh resolves without a result', jest.fn().mockResolvedValue(undefined)],
  ['the refresh is superseded', jest.fn().mockResolvedValue(STALE)],
  ['the refresh authority is missing', undefined],
])('S6-B5 — when %s after a lost close, Close stays disabled behind Check status', async (_label, onRefresh) => {
  const onCloseJob = jest.fn().mockRejectedValue(new Error('Network Error'));
  await closeWith({ onCloseJob, onRefresh });
  expect(await screen.findByText(UNKNOWN_COPY)).toBeTruthy();
  expect(checkStatus()).toBeEnabled();
  expect(closeButton()).toBeDisabled();
  fireEvent.click(closeButton()!);
  expect(onCloseJob).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Receive complete')).toBeNull();
});

it('S6-B6 — a 5xx close response is not proof of failure; it reconciles first', async () => {
  await closeWith({
    onCloseJob: jest.fn().mockRejectedValue(httpError(500, 'Failed to close receive job: [RECEIVE_JOB_CLOSE] timeout')),
    onRefresh: jest.fn().mockResolvedValue(CLOSED),
  });
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(screen.queryByText(/RECEIVE_JOB_CLOSE/)).toBeNull();
});

it.each([
  ['closed', CLOSED],
  ['open', OPEN],
])('S6-B7 — Check status recovers an unknown outcome to %s', async (outcome, result) => {
  const onCloseJob = jest.fn().mockRejectedValue(new Error('Network Error'));
  const onRefresh = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result);
  await closeWith({ onCloseJob, onRefresh });
  fireEvent.click(await screen.findByRole('button', { name: /^check status$/i }));
  if (outcome === 'closed') {
    expect(await screen.findByText('Receive complete')).toBeTruthy();
  } else {
    expect(await screen.findByText(OPEN_COPY)).toBeTruthy();
    expect(closeButton()).toBeEnabled();
    expect(checkStatus()).toBeNull();
  }
  expect(onCloseJob).toHaveBeenCalledTimes(1);
});

it('S6-B8 — repeated Check status clicks read once at a time and never close', async () => {
  const read = deferred<unknown>();
  const onCloseJob = jest.fn().mockRejectedValue(new Error('Network Error'));
  const onRefresh = jest.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => read.promise);
  await closeWith({ onCloseJob, onRefresh });
  const check = await screen.findByRole('button', { name: /^check status$/i });
  fireEvent.click(check);
  fireEvent.click(check);
  fireEvent.click(check);
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(await screen.findByText(/checking whether this receive closed/i)).toBeTruthy();
  expect(closeButton()).toBeDisabled();
  await act(async () => { read.resolve(STALE); });
  expect(await screen.findByText(UNKNOWN_COPY)).toBeTruthy();
  expect(closeButton()).toBeDisabled();
  expect(onCloseJob).toHaveBeenCalledTimes(1);
});

it('S6-B9 — "Already closed" reconciles against the canonical read before anything else', async () => {
  const onRefresh = jest.fn().mockResolvedValue(CLOSED);
  await closeWith({ onCloseJob: jest.fn().mockRejectedValue(httpError(409, '[RECEIVE_JOB_CLOSE] Already closed: job-s6')), onRefresh });
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/already closed/i)).toBeNull();
});

it('S6-B10 — a definitive validation refusal shows an actionable message, no internals, and keeps the date', async () => {
  const onRefresh = jest.fn().mockResolvedValue(OPEN);
  const onCloseJob = jest.fn().mockRejectedValue(httpError(409, '[RECEIVE_JOB_CLOSE] 1 lines not yet inspected on job job-s6'));
  await closeWith({ onCloseJob, onRefresh });
  const refusal = await screen.findByRole('alert');
  expect(refusal).toHaveTextContent('Some products still need inspection. Finish those products before closing.');
  expect(refusal.textContent).not.toMatch(/RECEIVE_JOB_CLOSE|job-s6/);
  expect(screen.queryByText(/RECEIVE_JOB_CLOSE/)).toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
  expect((screen.getByLabelText(/actual delivery date/i) as HTMLInputElement).value).toBe('2026-10-24');
  expect(closeButton()).toBeEnabled();
});

it('S6-B10b — a label-readiness refusal says labels need confirmation, never the raw code', async () => {
  const onRefresh = jest.fn().mockResolvedValue(OPEN);
  const onCloseJob = jest.fn().mockRejectedValue(Object.assign(
    httpError(409, 'RECEIVE_BARCODE_READINESS_REQUIRED: accepted units on job job-s6 need labels'),
    { response: { status: 409, data: { error: 'RECEIVE_BARCODE_READINESS_REQUIRED: accepted units on job job-s6 need labels', code: 'RECEIVE_BARCODE_READINESS_REQUIRED' } } },
  ));
  await closeWith({ onCloseJob, onRefresh });
  const refusal = await screen.findByRole('alert');
  expect(refusal).toHaveTextContent('Some unit labels still need confirmation before this Receive can close.');
  expect(refusal.textContent).not.toMatch(/RECEIVE_BARCODE_READINESS_REQUIRED|job-s6/);
  expect(onRefresh).not.toHaveBeenCalled();
  expect(screen.queryByText('Receive complete')).toBeNull();
});

it('S6-B11 — the delivery date survives an unknown outcome and a recovered retry sends it unchanged', async () => {
  const onCloseJob = jest.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(undefined);
  const onRefresh = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(OPEN).mockResolvedValue(CLOSED);
  await closeWith({ onCloseJob, onRefresh });
  await screen.findByText(UNKNOWN_COPY);
  expect((screen.getByLabelText(/actual delivery date/i) as HTMLInputElement).value).toBe('2026-10-24');
  fireEvent.click(checkStatus()!);
  await screen.findByText(OPEN_COPY);
  expect((screen.getByLabelText(/actual delivery date/i) as HTMLInputElement).value).toBe('2026-10-24');
  fireEvent.click(closeButton()!);
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(onCloseJob).toHaveBeenNthCalledWith(2, { actual_delivery_date: '2026-10-24' });
});

it('S6-B12 — a confirmed close whose refresh fails still completes; no failure and no retry', async () => {
  const onCloseJob = jest.fn().mockResolvedValue(undefined);
  await closeWith({ onCloseJob, onRefresh: jest.fn().mockRejectedValue(new Error('Network Error')) });
  expect(await screen.findByText('Receive complete')).toBeTruthy();
  expect(closeButton()).toBeNull();
  expect(screen.queryByText(/network error|could not close|couldn't close/i)).toBeNull();
  expect(checkStatus()).toBeEnabled(); // final details can be re-read
  expect(onCloseJob).toHaveBeenCalledTimes(1);
});

// ── S6-C — Completion ──────────────────────────────────────────────────────

it('S6-C1 — a closed Receive restores straight into Completion with its canonical seal; no Review or Close', () => {
  renderSession(lines(8, (n) => done(n)), { closedAt: '2026-10-25T14:32:00', actualDeliveryDate: '2026-10-24', jobStatus: 'closed' });
  expect(screen.getByText('Receive complete')).toBeTruthy();
  expect(screen.getByText(/^status$/i)).toBeTruthy();
  expect(screen.getByText(/^closed$/i)).toBeTruthy();
  expect(screen.getByText(/14:32/)).toBeTruthy();
  expect(screen.getAllByText(/24 oct 2026/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/received units are now available for stow/i)).toBeTruthy();
  expect(within(screen.getByText(/^accepted$/i).closest('span')!.parentElement!).getByText('16')).toBeTruthy();
  expect(closeButton()).toBeNull();
  expect(screen.queryByText(/review receive/i)).toBeNull();
  expect(screen.queryByLabelText(/actual delivery date/i)).toBeNull();
});

it('S6-C2 — zero accepted units use the exact no-stow message', () => {
  renderSession([done(1, 0), done(2, 0)], { closedAt: '2026-10-25T14:32:00', actualDeliveryDate: '2026-10-24', jobStatus: 'closed' });
  expect(screen.getByText('No usable items received. Nothing to put away.')).toBeTruthy();
  expect(screen.queryByText(/available for stow/i)).toBeNull();
});

it('S6-C3 — Completion invents no downstream Stow facts and Back to WMS forwards no event', () => {
  const { props } = renderSession(lines(2, (n) => done(n)), { closedAt: '2026-10-25T14:32:00', actualDeliveryDate: '2026-10-24', jobStatus: 'closed' });
  for (const invented of [/stow task/i, /\bbin\b/i, /location/i, /assigned to/i, /stow ready/i, /ready at/i]) {
    expect(screen.queryByText(invented)).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Back to WMS' }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect((props.onComplete as jest.Mock).mock.calls[0]).toEqual([]);
});
