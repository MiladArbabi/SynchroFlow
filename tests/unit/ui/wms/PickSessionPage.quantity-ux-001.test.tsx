/**
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-UX-001 — unified scan + quantity step (web).
 * - After the verifying scan, keyboard input targets the quantity field, never the scanner.
 * - [ − ] [ n  out of N ] [ + ] on one row; "out of N" is fixed inside the field, outside its value.
 * - No separate "1 of 2" progress text. Accepted scan shows a green ✓ (not a commitment).
 * - The map is drawn only for the current allocation's real bin; root stops get a text fallback.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';

const mockCanvasProps: any[] = [];
jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: (p: any) => { mockCanvasProps.push(p); return <div data-testid="isometric-canvas-stub" />; } };
});

const ROOT = 'WH-1-ROOT';
const ZONES = [
  { location_code: ROOT, type: 'warehouse', position_x: null, position_y: null, width: 20, depth: 20 },
  { location_code: 'PICK-A1', type: 'bin', position_x: 2, position_y: 2, width: 1, depth: 1 },
];
const item = (over: Partial<LineItem> = {}): LineItem => ({
  lasyncro_line_item_id: 'line', lasyncro_variant_id: 'variant', lasyncro_order_id: 'order',
  reservation_allocation_id: 'allocation', sku: 'CWB-002', product_title: 'Canvas Weekender Bag', variant_title: null,
  quantity: 2, location_code: ROOT, location_pickable: true, location_scan_required: false,
  unit_scan_required: 1, scan_unit_id: 'LSU-0f8bc0d6', image_url: null, barcode: '501234567892', unit_ids: null, ...over,
});
function setup(items: LineItem[], callbacks: Record<string, unknown> = {}) {
  const props = {
    pickBatchId: 'batch', lineItems: items, resumePicking: true, floorZones: ZONES,
    onComplete: jest.fn(), onResolveBarcode: jest.fn(async (value: string) => ({
      lasyncro_variant_id: 'variant', ...(value.startsWith('LSU-') ? { lasyncro_unit_id: value, resolution_method: 'unit_barcode' } : {}),
    })), onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exception' }),
    onPickComplete: jest.fn(), onVerifyLocation: jest.fn().mockResolvedValue({ location_code: 'PICK-A1' }), ...callbacks,
  };
  render(<PickSessionPage {...(props as any)} />);
  return props;
}
async function scanInto(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}
const scanner = () => screen.getByRole('textbox');
const qty = () => screen.getByRole('spinbutton', { name: /quantity picked/i }) as HTMLInputElement;

beforeEach(() => { mockCanvasProps.length = 0; });

test('QX-01 R2 root: no location step; after one LSU scan the quantity field owns the keyboard; typing 2 sets the quantity, not the scanner; one Confirm', async () => {
  const props = setup([item()]);
  expect(screen.queryByPlaceholderText(/^scan location$/i)).not.toBeInTheDocument();
  expect(screen.getByTestId('scan-product-accepted-identifier')).toHaveTextContent(/^Unit label: LSU-0f8bc0d6$/);
  await scanInto(scanner(), 'LSU-0f8bc0d6');
  await waitFor(() => expect(document.activeElement).toBe(qty()));
  // Keyboard entry of "2" lands in the quantity field.
  fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: '2' } });
  expect(qty()).toHaveValue(2);
  // SCAN-INPUT-VISIBILITY-001: the scanner input is gone for the count step, so it cannot receive the digits.
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  // Enter inside the quantity field never confirms on its own.
  fireEvent.keyDown(qty(), { key: 'Enter' });
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  // Accepted identifier: green ✓ of what was actually scanned; nothing claims the Pick yet.
  expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent(/^✓ LSU-0f8bc0d6$/);
  expect(screen.queryByText(/units? picked$/i)).not.toBeInTheDocument(); // no "· n units picked" acknowledgement yet
  const confirm = screen.getByRole('button', { name: /confirm 2 picked/i });
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
  expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({ quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-0f8bc0d6'] });
});

test('QX-02 quantity row: one height, "out of N" inside the field and outside its value, no separate progress text; stepper and limits', async () => {
  setup([item({ quantity: 5 })]);
  await scanInto(scanner(), 'LSU-0f8bc0d6');
  const field = qty();
  const suffix = screen.getByTestId('pick-qty-out-of');
  expect(suffix).toHaveTextContent(/^out of 5$/);
  // Inside the same input root as the field, and not part of its value.
  expect(field.closest('.MuiInputBase-root')).toContainElement(suffix);
  expect(field.value).toBe('1');
  expect(field).toHaveAttribute('aria-describedby', 'pick-qty-out-of');
  expect(field).toHaveAttribute('min', '1');
  expect(field).toHaveAttribute('max', '5');
  expect(field).toHaveAttribute('step', '1');
  // No floating label lifting the field; no duplicate "n of N" / "Units counted" text.
  expect(field.closest('.MuiFormControl-root')?.querySelector('label')).toBeNull();
  expect(screen.queryByLabelText(/units counted/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/^\d+ of 5$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^of 5$/)).not.toBeInTheDocument();
  // Stepper and caps.
  const plus = screen.getByRole('button', { name: /add one unit/i });
  const minus = screen.getByRole('button', { name: /remove one unit/i });
  expect(minus).toBeDisabled(); // cannot go below the scanned label
  for (let i = 0; i < 6; i++) fireEvent.click(plus);
  expect(qty()).toHaveValue(5);
  expect(plus).toBeDisabled();
  fireEvent.click(minus);
  expect(qty()).toHaveValue(4);
  // Same row: the three controls share one grid row container.
  const row = plus.parentElement!;
  expect(row).toContainElement(minus);
  expect(row).toContainElement(field);
});

test('QX-03 invalid quantities are rejected and never sent', async () => {
  const props = setup([item({ quantity: 3 })]);
  await scanInto(scanner(), 'LSU-0f8bc0d6');
  for (const bad of ['4', '0', '1.5', '']) {
    fireEvent.change(qty(), { target: { value: bad } });
    const button = screen.getByRole('button', { name: /^(confirm 3 picked|report [0-9.]+ of 3)$/i });
    fireEvent.click(button);
  }
  expect(props.onConfirmScan).not.toHaveBeenCalled();
});

test('QX-04 reduced quantity opens Short Pick (Difference) with the count; never a full confirm', async () => {
  const props = setup([item({ quantity: 3 })]);
  await scanInto(scanner(), 'LSU-0f8bc0d6');
  fireEvent.change(qty(), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: /report 2 of 3/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByText(/short pick/i));
  expect(within(dialog).getByRole('spinbutton')).toHaveValue(2);
  expect(props.onConfirmScan).not.toHaveBeenCalled();
});

test('QX-05 single unit: the scan is sent once and advances only after the server confirms; no quantity controls', async () => {
  let accept!: () => void;
  const props = setup([item({ quantity: 1 }), item({ lasyncro_line_item_id: 'line-2', reservation_allocation_id: 'allocation-2', quantity: 1, unit_scan_required: 0, scan_unit_id: null })],
    { onConfirmScan: jest.fn(() => new Promise<void>((r) => { accept = r; })) });
  await scanInto(scanner(), 'LSU-0f8bc0d6');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('pick-product-card')).toHaveTextContent('Canvas Weekender Bag');
  expect(screen.queryByTestId('scan-product-barcode')).not.toBeInTheDocument(); // still on the first (labelled) item
  await act(async () => accept());
  await waitFor(() => expect(screen.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: 501234567892$/));
});

test('QX-06 product-only multi-unit: the accepted EAN shows a green ✓ and the quantity field takes focus', async () => {
  setup([item({ unit_scan_required: 0, scan_unit_id: null })]);
  expect(screen.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: 501234567892$/);
  expect(screen.queryByText(/LSU-/)).not.toBeInTheDocument();
  await scanInto(scanner(), '501234567892');
  await waitFor(() => expect(document.activeElement).toBe(qty()));
  expect(screen.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: ✓ 501234567892$/);
  expect(screen.getByTestId('scan-product-barcode')).toHaveAttribute('data-accepted', 'true');
});

test('QX-07 map truth: root stop draws no map (text fallback, no bin shown as destination); a bin stop draws it with only that bin lit', async () => {
  setup([item()]);
  expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();
  expect(screen.getByText('Not in a bin — no map position. Scan the product.')).toBeInTheDocument();
  expect(mockCanvasProps.every((p) => p.destinationHighlight == null)).toBe(true);
});

test('QX-08 R3 bin: the location scan is required before product scanning; the map lights exactly PICK-A1', async () => {
  const props = setup([item({ location_code: 'PICK-A1', location_scan_required: true, scan_unit_id: 'LSU-499b3966' })]);
  const location = screen.getByPlaceholderText(/^scan location$/i);
  expect(screen.queryByPlaceholderText(/scan unit label/i)).not.toBeInTheDocument();
  const last = mockCanvasProps[mockCanvasProps.length - 1];
  expect(last.destinationHighlight).toEqual({ locationCode: 'PICK-A1', tone: 'suggested' });
  expect(last.selectedLocationCode).toBe('PICK-A1');
  await scanInto(location, 'PICK-A1');
  await waitFor(() => expect(screen.getByPlaceholderText(/scan unit label/i)).toBeInTheDocument());
  expect(props.onVerifyLocation).toHaveBeenCalledTimes(1);
  expect(mockCanvasProps[mockCanvasProps.length - 1].destinationHighlight).toEqual({ locationCode: 'PICK-A1', tone: 'confirmed' });
  await scanInto(scanner(), 'LSU-3ee19b18'); // another eligible LSU, not the displayed one
  await waitFor(() => expect(document.activeElement).toBe(qty()));
  fireEvent.change(qty(), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i }));
  await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
  expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({ location_code: 'PICK-A1', quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-3ee19b18'] });
});
