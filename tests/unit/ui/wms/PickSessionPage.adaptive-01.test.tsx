import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';
jest.mock('@lasyncro/shared/ui', () => ({ ...jest.requireActual('@lasyncro/shared/ui'), IsometricCanvas: () => <div /> }));
const item = (over: Partial<LineItem> = {}): LineItem => ({
  lasyncro_line_item_id: 'line', lasyncro_variant_id: 'variant', lasyncro_order_id: 'order',
  reservation_allocation_id: 'allocation', sku: 'SKU', product_title: 'Beanie', variant_title: null,
  quantity: 3, location_code: 'WH-1-ROOT', location_pickable: true, location_scan_required: false,
  unit_scan_required: 0, image_url: null, barcode: 'EAN', unit_ids: null, ...over,
});
function setup(over: Partial<LineItem> = {}, callbacks: Record<string, unknown> = {}) {
  const props = {
    pickBatchId: 'batch', lineItems: [item(over)], resumePicking: true, floorZones: [],
    onComplete: jest.fn(), onResolveBarcode: jest.fn(async (value: string) => ({
      lasyncro_variant_id: 'variant', ...(value.startsWith('LSU-') ? { lasyncro_unit_id: value, resolution_method: 'unit_barcode' } : {}),
    })), onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exception' }),
    onPickComplete: jest.fn(), ...callbacks,
  };
  render(<PickSessionPage {...props} />);
  return props;
}
async function scan(value: string) {
  await act(async () => {
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}
const confirm = () => screen.getByRole('button', { name: /confirm .*picked/i });
const count = (value: string) => fireEvent.change(screen.getByRole('spinbutton', { name: /quantity picked/i }), { target: { value } });

test.each([0, 1])('single unit (%s required labels) advances only after server confirmation', async required => {
  let accept!: () => void;
  const props = setup({ quantity: 1, unit_scan_required: required }, { onConfirmScan: jest.fn(() => new Promise<void>(r => { accept = r; })) });
  await scan(required ? 'LSU-1' : 'EAN');
  expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('pick-done-facts')).not.toBeInTheDocument(); // FINALIZE-001: no success before the server answers
  await act(async () => accept());
  expect(await screen.findByTestId('pick-done-facts')).toBeInTheDocument(); // FINALIZE-001: auto-finalized → Pick complete
});
test('product count appears on the same card with scanner ready; explicit confirm awaits server', async () => {
  let accept!: () => void;
  const props = setup({}, { onConfirmScan: jest.fn(() => new Promise<void>(r => { accept = r; })) });
  const card = screen.getByTestId('pick-product-card');
  const scanner = screen.getByRole('textbox');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await scan('EAN');
  expect(screen.getByTestId('pick-product-card')).toBe(card);
  // SCAN-INPUT-VISIBILITY-001: the same card stays; the scanner input is hidden for the count step.
  void scanner;
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  count('3');
  fireEvent.click(confirm());
  expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({ quantity_confirmed: 3 }));
  expect(screen.queryByTestId('pick-done-facts')).not.toBeInTheDocument(); // FINALIZE-001: no success before the server answers
  await act(async () => accept());
  expect(await screen.findByTestId('pick-done-facts')).toBeInTheDocument(); // FINALIZE-001: auto-finalized → Pick complete
});
// SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — one LSU verifies; the quantity is counted.
test('one LSU verifies (a stale count of 3 is clamped); a second label is not taken; the counted quantity confirms with only the scanned label', async () => {
  const props = setup({ unit_scan_required: 3, unit_ids: ['LSU-SIBLING'] });
  await scan('LSU-1');
  expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toHaveValue(1);
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  // SCAN-INPUT-VISIBILITY-001: after the verifying scan (qty > 1) the scanner is hidden — no second label can be entered.
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  expect(screen.queryByTestId('scan-product-progress')).not.toBeInTheDocument();
  count('3');
  fireEvent.click(confirm());
  await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({ quantity_confirmed: 3, lasyncro_unit_ids: ['LSU-1'] })));
});
test('mixed stock counts only after required identities, with no sibling selection', async () => {
  const props = setup({ unit_scan_required: 1, unit_ids: ['LSU-SIBLING'] });
  await scan('EAN');
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await scan('LSU-1');
  count('0'); fireEvent.click(screen.getByRole('button', { name: /report 0 of 3/i }));
  expect(screen.getByRole('alert')).toHaveTextContent(/scanned labels/i);
  count('3'); fireEvent.click(confirm());
  await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({ quantity_confirmed: 3, lasyncro_unit_ids: ['LSU-1'] })));
});
test('unexpected LSU cannot enable bulk count on product-only stock', async () => {
  const props = setup();
  await scan('LSU-1');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(props.onConfirmScan).not.toHaveBeenCalled();
});
test('short count uses existing Short Pick and recovers scanner after cancellation', async () => {
  const props = setup();
  await scan('EAN'); count('1');
  fireEvent.click(screen.getByRole('button', { name: /report 1 of 3/i }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByText(/short pick/i));
  expect(within(dialog).getByRole('spinbutton')).toHaveValue(1);
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /cancel|back|recount/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // SCAN-INPUT-VISIBILITY-001: back on the count step (identity already verified) — the quantity field is usable, the scanner stays hidden.
  expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toBeEnabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
test('server identity refusal clears stale count and requires a fresh label scan before any resend', async () => {
  const error = Object.assign(new Error('Scan the unit label on one item.'), { response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_REQUIRED', units_required: 1, error: 'Scan the unit label on one item.' } } });
  const props = setup({}, { onConfirmScan: jest.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined) });
  await scan('EAN'); count('3'); fireEvent.click(confirm());
  expect(await screen.findByRole('alert')).toHaveTextContent('Scan the unit label on one item.');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await scan('EAN');                                   // a product barcode is not the label
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await scan('LSU-1');
  expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toHaveValue(1);
  expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
});

test('Difference: a reduced count opens Short Pick carrying the one verified label and the found quantity', async () => {
  const props = setup({ unit_scan_required: 3 });
  await scan('LSU-1');
  count('2');
  fireEvent.click(screen.getByRole('button', { name: /report 2 of 3/i }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByText(/short pick/i));
  expect(within(dialog).getByRole('spinbutton')).toHaveValue(2);
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /confirm exception/i }));
  await waitFor(() => expect(props.onReportException).toHaveBeenCalledTimes(1));
  expect(props.onReportException).toHaveBeenCalledWith(expect.objectContaining({ quantity_found: 2, lasyncro_unit_ids: ['LSU-1'] }));
});


describe('CORRECTIONS-001 — exact resolver provenance', () => {
  test.each(['barcode', 'sku', 'product_barcode', 'external_variant_id', undefined])('product-only Q1 never forwards a candidate from %s resolution', async method => {
    const props = setup({ quantity: 1 }, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: method, lasyncro_unit_id: 'LSU-SERVER-CHOSEN',
    }) });
    await scan('lsu-looking-sku');
    expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
    expect(props.onConfirmScan.mock.calls[0][0].lasyncro_unit_id).toBeUndefined();
    expect(props.onConfirmScan.mock.calls[0][0].lasyncro_unit_ids).toBeUndefined();
  });
  test.each(['barcode', 'sku', 'product_barcode', 'external_variant_id', undefined])('labelled stock refuses an LSU-looking fallback from %s resolution', async method => {
    const props = setup({ quantity: 1, unit_scan_required: 1 }, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: method, lasyncro_unit_id: 'LSU-SERVER-CHOSEN',
    }) });
    await scan('lsu-looking-sku');
    expect(props.onConfirmScan).not.toHaveBeenCalled();
    expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/scan the unit label/i);
  });
  test('uppercase LSU-looking SKU is also refused as unit identity', async () => {
    const props = setup({ unit_scan_required: 3 }, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: 'sku', lasyncro_unit_id: 'LSU-SERVER-CHOSEN',
    }) });
    await scan('LSU-LOOKING-SKU');
    expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });
  test('unit_barcode without an identity never falls back to the scanned text', async () => {
    const props = setup({ quantity: 1, unit_scan_required: 1 }, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: 'unit_barcode',
    }) });
    await scan('LSU-MISSING-ID');
    expect(props.onConfirmScan).not.toHaveBeenCalled();
    expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
  });
  test('resolver-confirmed unit identity is accepted independently of raw text', async () => {
    const props = setup({ quantity: 1, unit_scan_required: 1 }, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: 'unit_barcode', lasyncro_unit_id: 'LSU-EXACT',
    }) });
    await scan('resolver-confirmed-label');
    expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({ lasyncro_unit_ids: ['LSU-EXACT'] }));
  });
  test('stale zero label count cannot launder a candidate through a lowercase SKU', async () => {
    const refusal = Object.assign(new Error('Scan each label'), { response: { status: 409, data: {
      code: 'PICK_UNIT_IDENTITY_REQUIRED', units_required: 1, error: 'Scan each label',
    } } });
    const props = setup({ quantity: 1, unit_scan_required: 0 }, {
      onResolveBarcode: jest.fn(async (value: string) => ({ lasyncro_variant_id: 'variant',
        resolution_method: value === 'LSU-EXACT' ? 'unit_barcode' : 'sku',
        lasyncro_unit_id: value === 'LSU-EXACT' ? 'LSU-EXACT' : 'LSU-SERVER-CHOSEN',
      })), onConfirmScan: jest.fn().mockRejectedValueOnce(refusal).mockResolvedValue(undefined),
    });
    await scan('lsu-looking-sku');
    expect(props.onConfirmScan.mock.calls[0][0].lasyncro_unit_id).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Scan each label');
    await scan('lsu-looking-sku');
    expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
    await scan('LSU-EXACT');
    expect(props.onConfirmScan.mock.calls[1][0]).toMatchObject({ quantity_confirmed: 1, lasyncro_unit_ids: ['LSU-EXACT'] });
  });
  test('multi-unit product-only fallback still reveals count without selecting its candidate', async () => {
    const props = setup({}, { onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant', resolution_method: 'sku', lasyncro_unit_id: 'LSU-SERVER-CHOSEN',
    }) });
    await scan('lsu-looking-sku'); count('3'); fireEvent.click(confirm());
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({ quantity_confirmed: 3 });
    expect(props.onConfirmScan.mock.calls[0][0].lasyncro_unit_id).toBeUndefined();
    expect(props.onConfirmScan.mock.calls[0][0].lasyncro_unit_ids).toBeUndefined();
  });
});

test('CORRECTIONS-001 — definitive single-LSU rejection clears the rejected label and allows rescan', async () => {
  const rejection = Object.assign(new Error('Pick refused'), { response: { status: 409, data: { code: 'INSUFFICIENT_RESERVED', error: 'Pick refused' } } });
  const props = setup({ quantity: 1, unit_scan_required: 1 }, { onConfirmScan: jest.fn().mockRejectedValueOnce(rejection).mockResolvedValue(undefined) });
  await scan('LSU-REJECTED');
  expect(screen.getByRole('alert')).toHaveTextContent('Pick refused');
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /confirm .*picked/i })).not.toBeInTheDocument();
  await scan('LSU-RETRY');
  expect(props.onConfirmScan).toHaveBeenCalledTimes(2);
  expect(props.onConfirmScan.mock.calls[1][0]).toMatchObject({ lasyncro_unit_ids: ['LSU-RETRY'] });
  expect(await screen.findByTestId('pick-done-facts')).toBeInTheDocument(); // FINALIZE-001: auto-finalized → Pick complete
});
test('CORRECTIONS-001 — uncertain single-LSU outcome preserves pending identity and pauses rescanning', async () => {
  const lost = Object.assign(new Error('No response'), { code: 'PICK_CONNECTION_LOST' });
  const props = setup({ quantity: 1, unit_scan_required: 1 }, { onConfirmScan: jest.fn().mockRejectedValue(lost) });
  await scan('LSU-UNCERTAIN');
  expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent(/^✓ LSU-UNCERTAIN$/);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(/may already have been recorded/i);
  expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('pick-done-facts')).not.toBeInTheDocument(); // FINALIZE-001: no success before the server answers
});
