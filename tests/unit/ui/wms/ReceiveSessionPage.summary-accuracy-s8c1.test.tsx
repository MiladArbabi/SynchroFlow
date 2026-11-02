/**
 * WS-UX-RECEIVE-D4R S8-C1 — Review / Completion outcome classification.
 *
 * reported_problems are receive_exceptions rows. An accounting_role=overage row
 * is the persisted over-delivery approval, not a product problem. Later
 * delivery is never an exception: it is the line's quantity_deferred (the GET
 * reconciliation also echoes it as a synthetic 'deferred' allocation, which
 * must not be counted twice). Review and Completion use one classification.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import ReceiveSessionPage, {
  type ReceiveJobLine,
} from '../../../../modules/wms/src/ui/pages/ReceiveSessionPage';

function line(n: number, expected: number, overrides: Partial<ReceiveJobLine> = {}): ReceiveJobLine {
  return {
    receive_job_line_id: `line-c1-${n}`,
    lasyncro_variant_id: `variant-c1-${n}`,
    sku: `C1-SKU-${n}`,
    variant_title: 'Default Title',
    description: null,
    quantity_expected: expected,
    image_url: null,
    barcode: `60000000000${n}`,
    product_title: `C1 product ${n}`,
    ...overrides,
  };
}
const inspected = (n: number, expected: number, accepted: number, overrides: Partial<ReceiveJobLine> = {}) =>
  line(n, expected, { inspection_complete: true, count_state: 'inspected', quantity_accepted: accepted, ...overrides });

// Canonical GET shapes (receiveJob.controller / receiveLineReconciliationState).
const approvedOverage = inspected(1, 3, 5, {
  reported_problems: [{ receive_exception_id: 'ex-over', exception_type: 'extra_item', quantity_affected: 2, accounting_role: 'overage', counts_toward_shortfall: false }],
  reconciliation: { expected: 3, sellable: 5, accounted: 0, unaccounted: 0, allocations: [], overage_approved: true, sellable_basis: 'inspected' },
});
const laterDelivery = inspected(2, 2, 1, {
  quantity_deferred: 1,
  reported_problems: [],
  reconciliation: {
    expected: 2, sellable: 1, accounted: 1, unaccounted: 0, overage_approved: false, sellable_basis: 'inspected',
    allocations: [{ receive_exception_id: null as any, exception_type: 'deferred', quantity_affected: 1, accounting_role: null, counts_toward_shortfall: true }],
  },
});
const damaged = inspected(3, 5, 4, {
  quantity_rejected: 1,
  reported_problems: [{ receive_exception_id: 'ex-dmg', exception_type: 'defect', quantity_affected: 1, accounting_role: 'shortfall', counts_toward_shortfall: true }],
});
const mixed = [approvedOverage, laterDelivery, damaged];

function renderSession(receiveLines: ReceiveJobLine[], overrides: Record<string, unknown> = {}) {
  const props = {
    receiveJobId: 'job-c1',
    poId: 'po-c1',
    poNumber: 1009,
    supplierName: 'C1 Supplier',
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
  return render(<ReceiveSessionPage {...(props as any)} />);
}
const closed = { closedAt: '2026-10-25T14:32:00', actualDeliveryDate: '2026-10-24', jobStatus: 'closed' };

const rowOf = (name: string) => within(screen.getByRole('table', { name: /review lines/i })).getByText(name).closest('tr')!;
// Expected · Received · Extra · Problems (desktop columns).
const rowCells = (tr: HTMLElement) => within(tr).getAllByRole('cell').map((cell) => cell.textContent).slice(1, 5);
const pill = (label: RegExp) => screen.getByText(label).closest('span')!.parentElement!;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  jest.clearAllMocks();
});

it('S8-C1-1 — mixed outcomes: Review summary separates problems, later and approved extra without double counting', () => {
  renderSession(mixed);
  expect(screen.getByText('10 accepted · 1 problem · 1 later · +2 extra approved')).toBeTruthy();
  expect(rowCells(screen.getByText('Total').closest('tr')!)).toEqual(['10', '10', '2', '1']);
});

it('S8-C1-2 — Review line badges match each line\'s actual outcome', () => {
  renderSession(mixed);
  const over = rowOf('C1 product 1');
  expect(rowCells(over)).toEqual(['3', '5', '2', '0']);
  expect(within(over).getByText(/^Extra 2 · Problems 0 · Ready$/)).toBeTruthy();
  expect(within(over).queryByText(/problem$/)).toBeNull();

  const later = rowOf('C1 product 2');
  expect(rowCells(later)).toEqual(['2', '1', '0', '0']);
  expect(within(later).getByText(/^Extra 0 · Problems 0 · Later 1 · Ready$/)).toBeTruthy();
  expect(within(later).getByText('1 later')).toBeTruthy();

  const dmg = rowOf('C1 product 3');
  expect(rowCells(dmg)).toEqual(['5', '4', '0', '1']);
  expect(within(dmg).getByText(/^Extra 0 · Problems 1 · Ready$/)).toBeTruthy();
  expect(within(dmg).getByText('1 problem')).toBeTruthy();
});

it('S8-C1-3 — an approved overage alone never increases the problem total', () => {
  renderSession([approvedOverage, inspected(2, 2, 2)]);
  expect(screen.getByText('7 accepted · 0 problems · +2 extra approved')).toBeTruthy();
});

it('S8-C1-4 — Completion uses the same classification as Review', () => {
  renderSession(mixed, closed);
  expect(within(pill(/^accepted$/i)).getByText('10')).toBeTruthy();
  expect(within(pill(/^problems$/i)).getByText('1')).toBeTruthy();
  expect(within(pill(/^later$/i)).getByText('1')).toBeTruthy();
  expect(within(pill(/^extra$/i)).getByText('+2')).toBeTruthy();
});

it('S8-C1-5 — zero / untouched outcomes keep the existing summary and pills', () => {
  renderSession([inspected(1, 2, 2), inspected(2, 3, 3)]);
  expect(screen.getByText('5 accepted · 0 problems')).toBeTruthy();
  expect(screen.queryByText(/later/i)).toBeNull();
  cleanup();
  renderSession([inspected(1, 2, 0), inspected(2, 3, 0)], closed);
  expect(within(pill(/^problems$/i)).getByText('0')).toBeTruthy();
  expect(screen.queryByText(/^later$/i)).toBeNull();
  expect(screen.queryByText(/^extra$/i)).toBeNull();
});
