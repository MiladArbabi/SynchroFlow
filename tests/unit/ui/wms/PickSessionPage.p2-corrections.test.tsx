/**
 * SF-PICK-P2-CORRECTION-01 — regression coverage for SF-PICK-P2-REVIEW-01
 * findings G1–G4 (C2 resume accuracy, C3 duplicate protection).
 *
 * Navigation uses cheap placeholder / label / text queries; role queries are
 * kept only where the role itself is asserted.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, {
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return {
    ...actual,
    IsometricCanvas: () => <div data-testid="isometric-canvas-stub" />,
  };
});

const BATCH_ID = 'c4f7be77-0000-4000-8000-0000000corr';

function line(id: string, quantity: number, location: string): LineItem {
  return {
    lasyncro_line_item_id: `line-${id}`,
    lasyncro_variant_id: `variant-${id}`,
    lasyncro_order_id: 'order-corr',
    reservation_allocation_id: `alloc-${id}`,
    sku: `SKU-${id}`,
    product_title: `Product ${id}`,
    variant_title: null,
    quantity,
    location_code: location,
    image_url: null,
    unit_ids: null,
  };
}

const SINGLE = line('1', 1, 'A-1');
const MULTI = line('2', 3, 'B-2');
const NEXT = line('3', 1, 'C-3');

function baseProps(lineItems: LineItem[], overrides: Record<string, unknown> = {}) {
  return {
    pickBatchId: BATCH_ID,
    lineItems,
    onComplete: jest.fn(),
    onResolveBarcode: jest.fn(async (value: string) => {
      if (value.startsWith('LSU-')) return { lasyncro_variant_id: 'variant-2', lasyncro_unit_id: value };
      const match = lineItems.find((li) => `EAN-${li.lasyncro_variant_id}` === value);
      return match ? { lasyncro_variant_id: match.lasyncro_variant_id } : { lasyncro_variant_id: 'variant-other' };
    }),
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exc-corr' }),
    onPickComplete: jest.fn().mockResolvedValue(undefined),
    onStartPacking: jest.fn(),
    onStartPicking: jest.fn().mockResolvedValue(undefined),
    resumePicking: true,
    floorZones: [],
    ...overrides,
  };
}

function setup(lineItems: LineItem[], overrides: Record<string, unknown> = {}) {
  const props = baseProps(lineItems, overrides);
  const utils = render(<PickSessionPage {...(props as any)} />);
  return { props, ...utils };
}

const locationInput = () => screen.queryByPlaceholderText(/scan bin barcode/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i) as HTMLInputElement | null;
const addUnit = () => screen.getByLabelText(/add one unit/i);

function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}

async function reachItem(li: LineItem) {
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), li.location_code);
  await waitFor(() => expect(productInput()).not.toBeNull());
}

/** Opens the existing exception dialog from the stepper with `count` units counted. */
async function reportShortFromStepper(count: number) {
  await reachItem(MULTI);
  scan(productInput(), 'EAN-variant-2');
  await waitFor(() => expect(screen.queryByLabelText(/add one unit/i)).not.toBeNull());
  for (let i = 0; i < count; i += 1) fireEvent.click(addUnit());
  fireEvent.click(screen.getByText(new RegExp(`report ${count} of 3`, 'i')));
  // Exact, case-sensitive: the dialog title, not the footer button.
  await waitFor(() => expect(screen.queryByText('Report Problem')).not.toBeNull());
  fireEvent.click(screen.getByText(/short pick/i));
}

const confirmException = () => screen.getByText(/confirm exception/i).closest('button') as HTMLButtonElement;
const confirmComplete = () => screen.getByText(/confirm pick complete/i).closest('button') as HTMLButtonElement;

describe('G1 — multi-unit LSU evidence', () => {
  it('an LSU- scan on a multi-unit line carries lasyncro_unit_id into the full-quantity confirm', async () => {
    const { props } = setup([MULTI]);
    await reachItem(MULTI);
    scan(productInput(), 'LSU-cccc3333');
    await waitFor(() => expect(screen.queryByLabelText(/add one unit/i)).not.toBeNull());
    for (let i = 0; i < 3; i += 1) fireEvent.click(addUnit());
    fireEvent.click(screen.getByText(/confirm 3 picked/i));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({
      lasyncro_line_item_id: 'line-2',
      reservation_allocation_id: 'alloc-2',
      quantity_confirmed: 3,
      lasyncro_unit_id: 'LSU-cccc3333',
    }));
  });
});

describe('G2 — exception retry identity', () => {
  it('a failed exception report retried from the same dialog reuses the same device_event_id', async () => {
    const onReportException = jest.fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ pick_exception_id: 'exc-retry' });
    setup([MULTI], { onReportException });
    await reportShortFromStepper(2);

    fireEvent.click(confirmException());
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(onReportException).toHaveBeenCalledTimes(1);

    fireEvent.click(confirmException());
    await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(2));
    const [first] = onReportException.mock.calls[0];
    const [second] = onReportException.mock.calls[1];
    expect(first.device_event_id).toEqual(expect.any(String));
    expect(second.device_event_id).toBe(first.device_event_id);
    expect(second.quantity_found).toBe(2);
  });
});

describe('G3 — duplicate submissions', () => {
  it('two Confirm Exception clicks in one batched update send one report and advance exactly one line', async () => {
    let settle!: (v: { pick_exception_id: string }) => void;
    const onReportException = jest.fn(() => new Promise<{ pick_exception_id: string }>((resolve) => { settle = resolve; }));
    const { props } = setup([MULTI, NEXT], { onReportException });
    await reportShortFromStepper(2);

    const button = confirmException();
    act(() => {
      button.click();
      button.click();
    });
    expect(onReportException).toHaveBeenCalledTimes(1);
    await act(async () => { settle({ pick_exception_id: 'exc-once' }); });

    // Advanced exactly one reservation: the next line (C-3) is current, not skipped.
    await waitFor(() => expect(screen.getByText(/item\s+2\s+of\s+2/i)).toBeInTheDocument());
    expect(locationInput()).not.toBeNull();
    expect(screen.queryByText(/confirm pick complete/i)).toBeNull();
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });

  it('a failed exception report releases the guard so a retry is possible', async () => {
    const onReportException = jest.fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ pick_exception_id: 'exc-retry' });
    setup([MULTI], { onReportException });
    await reportShortFromStepper(1);
    fireEvent.click(confirmException());
    await screen.findByText(/network error/i);
    fireEvent.click(confirmException());
    await waitFor(() => expect(onReportException).toHaveBeenCalledTimes(2));
  });

  it('two Confirm pick complete clicks in one batched update call pick-complete once', async () => {
    let finish!: () => void;
    const onPickComplete = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    setup([SINGLE], { onPickComplete });
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());

    const button = confirmComplete();
    act(() => {
      button.click();
      button.click();
    });
    expect(onPickComplete).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(await screen.findByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
  });

  it('a failed pick-complete releases the guard so a retry is possible', async () => {
    const onPickComplete = jest.fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(undefined);
    setup([SINGLE], { onPickComplete });
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());
    fireEvent.click(confirmComplete());
    await screen.findByText(/network error/i);
    fireEvent.click(confirmComplete());
    await waitFor(() => expect(onPickComplete).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
  });
});

describe('G4 — late resume truthfulness (C2)', () => {
  it('resume state arriving after first render still labels Done totals as this session only', async () => {
    const props = baseProps([SINGLE], { resumePicking: false });
    const { rerender } = render(<PickSessionPage {...(props as any)} />);
    // Canonical status still unresolved: Brief.
    expect(screen.getByText('Start Picking')).toBeInTheDocument();

    // Canonical status resolves to `picking` after mount.
    rerender(<PickSessionPage {...(props as any)} resumePicking />);
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());
    fireEvent.click(confirmComplete());
    await waitFor(() => expect(screen.queryByText(/totals cover this session/i)).not.toBeNull());
    expect(screen.queryByText(/items? processed/i)).toBeNull();
  });

  it('a fresh (non-resumed) session started from the Brief does not claim to be resumed', async () => {
    setup([SINGLE], { resumePicking: false });
    fireEvent.click(screen.getByText('Start Picking'));
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());
    fireEvent.click(confirmComplete());
    await waitFor(() => expect(screen.queryByText(/1 item processed/i)).not.toBeNull());
    expect(screen.queryByText(/totals cover this session/i)).toBeNull();
  });
});
