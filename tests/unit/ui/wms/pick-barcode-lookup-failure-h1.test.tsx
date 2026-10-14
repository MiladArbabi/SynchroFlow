// GH-1241 S3C-M2 (H1) — the shared host scan lookup now rejects on network and
// server failures (an answered 404 alone resolves null). Pick consumes the
// same resolver: a failed lookup must surface as a failure, never as a
// "wrong item" verdict, and must never record a pick.
//
// Renders PickSessionPage directly with controlled props — same harness as
// tests/unit/ui/wms/pick-barcode-evidence-1085.test.tsx. Pack does not consume
// onResolveBarcode (it uses onPackFreeScan), so it has no H1 surface.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, {
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

const LOCATION_CODE = 'BIN-H1';
const VARIANT_ID = 'variant-h1';

function lineItem(): LineItem {
  return {
    lasyncro_line_item_id: 'line-h1',
    lasyncro_variant_id: VARIANT_ID,
    lasyncro_order_id: 'order-h1',
    reservation_allocation_id: 'alloc-h1',
    sku: 'H1-SKU',
    product_title: 'H1 widget',
    variant_title: 'Default Title',
    quantity: 1,
    location_code: LOCATION_CODE,
    image_url: null,
    unit_ids: null,
  };
}

function renderPick(onResolveBarcode: jest.Mock) {
  const onConfirmScan = jest.fn().mockResolvedValue(undefined);
  const onReportException = jest.fn().mockResolvedValue({ pick_exception_id: 'exc-h1' });
  const onPickComplete = jest.fn().mockResolvedValue(undefined);
  render(
    <PickSessionPage
      pickBatchId="batch-h1"
      lineItems={[lineItem()]}
      onComplete={jest.fn()}
      onResolveBarcode={onResolveBarcode}
      onConfirmScan={onConfirmScan}
      onReportException={onReportException}
      onPickComplete={onPickComplete}
    />
  );
  return { onConfirmScan, onReportException, onPickComplete };
}

async function scanProduct(value: string) {
  fireEvent.click(await screen.findByRole('button', { name: /start picking/i }));
  const locationInput = await screen.findByPlaceholderText(/scan bin barcode/i);
  fireEvent.change(locationInput, { target: { value: LOCATION_CODE } });
  fireEvent.keyDown(locationInput, { key: 'Enter', code: 'Enter' });
  const productInput = await screen.findByPlaceholderText(/scan product barcode/i);
  fireEvent.change(productInput, { target: { value } });
  fireEvent.keyDown(productInput, { key: 'Enter', code: 'Enter' });
}

afterEach(() => jest.clearAllMocks());

it('H1-P1 — a network lookup failure is reported as a failure, not a wrong item, and records no pick', async () => {
  const onResolveBarcode = jest.fn().mockRejectedValue(
    Object.assign(new Error('Network Error'), { request: {}, response: undefined })
  );
  const writes = renderPick(onResolveBarcode);

  await scanProduct('5000000000080');

  await waitFor(() => expect(onResolveBarcode).toHaveBeenCalledWith('5000000000080'));
  expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  expect(screen.queryByText(/wrong item/i)).not.toBeInTheDocument();
  expect(writes.onConfirmScan).not.toHaveBeenCalled();
  expect(writes.onReportException).not.toHaveBeenCalled();
  expect(writes.onPickComplete).not.toHaveBeenCalled();
});

it('H1-P2 — a server lookup failure surfaces the server reason and records no pick', async () => {
  const onResolveBarcode = jest.fn().mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500, data: { error: 'Barcode resolution failed: database unavailable' } },
  }));
  const writes = renderPick(onResolveBarcode);

  await scanProduct('5000000000097');

  expect(await screen.findByText(/barcode resolution failed/i)).toBeInTheDocument();
  expect(screen.queryByText(/wrong item/i)).not.toBeInTheDocument();
  expect(writes.onConfirmScan).not.toHaveBeenCalled();
  expect(writes.onReportException).not.toHaveBeenCalled();
});

it('H1-P3 — an unknown barcode (null) is still a mismatch and records no pick (control)', async () => {
  const onResolveBarcode = jest.fn().mockResolvedValue(null);
  const writes = renderPick(onResolveBarcode);

  await scanProduct('0000000000000');

  expect(await screen.findByText(/wrong item/i)).toBeInTheDocument();
  expect(writes.onConfirmScan).not.toHaveBeenCalled();
});

it('H1-P4 — a valid barcode still confirms the pick (control)', async () => {
  const onResolveBarcode = jest.fn().mockResolvedValue({ lasyncro_variant_id: VARIANT_ID });
  const writes = renderPick(onResolveBarcode);

  await scanProduct('5000000000103');

  await waitFor(() => expect(writes.onConfirmScan).toHaveBeenCalledTimes(1));
  expect(writes.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({
    lasyncro_variant_id: VARIANT_ID,
    location_code: LOCATION_CODE,
    quantity_confirmed: 1,
  }));
});
