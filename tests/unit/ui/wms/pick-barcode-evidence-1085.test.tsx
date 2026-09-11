// GH-1085 / BARCODE-LIFECYCLE-01 — Slice C, contract C8.
//
// Pick records what the operator actually proved, and no more.
//
//   LSU-  exact-unit evidence. The operator scanned one physical unit, so the
//         confirmed scan carries that unit's identity.
//   LSP-  product evidence. The LaSyncro catalog identity is one value shared
//         by every unit of the SKU. A resolver may well hand back a candidate
//         unit for context, but Pick must not launder that candidate into
//         "the operator scanned this unit" — nobody did.
//   EAN   product evidence too, for the same reason.
//
// This is a boundary contract, not a redesign: product-level Pick evidence
// stays fully supported and Pick is NOT being turned into per-unit scanning.
// Resolver namespace behaviour itself is already owned by Slice A
// (tests/integration/wms/barcode-resolution-lsp-1085.test.ts).
//
// Renders PickSessionPage directly with controlled props — every side effect is
// an injected callback and the component only uses MUI useTheme(), which
// resolves without a <ThemeProvider>. Same precedent as
// tests/unit/ui/wms/RecountLeaveSemantics.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, {
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

const BATCH_ID = 'batch-1085c';
const LINE_ITEM_ID = 'line-1085c';
const VARIANT_ID = 'variant-1085c';
const LOCATION_CODE = 'BIN-C1';

/** The unit a resolver might return as context for a product-level scan. */
const CANDIDATE_UNIT_ID = 'LSU-aaaa1111';

function lineItem(): LineItem {
  return {
    lasyncro_line_item_id: LINE_ITEM_ID,
    lasyncro_variant_id: VARIANT_ID,
    lasyncro_order_id: 'order-1085c',
    reservation_allocation_id: 'alloc-1085c',
    sku: 'GH1085C-SKU',
    product_title: 'GH1085C widget',
    variant_title: 'Default Title',
    quantity: 1,
    location_code: LOCATION_CODE,
    image_url: null,
    unit_ids: null,
  };
}

/**
 * Drives brief → location scan → product scan for a single-quantity line,
 * which confirms directly without the quantity step.
 */
async function pickThrough(scannedValue: string) {
  fireEvent.click(await screen.findByRole('button', { name: /start picking/i }));

  const locationInput = await screen.findByPlaceholderText(/scan bin barcode/i);
  fireEvent.change(locationInput, { target: { value: LOCATION_CODE } });
  fireEvent.keyDown(locationInput, { key: 'Enter', code: 'Enter' });

  const productInput = await screen.findByPlaceholderText(/scan product barcode/i);
  fireEvent.change(productInput, { target: { value: scannedValue } });
  fireEvent.keyDown(productInput, { key: 'Enter', code: 'Enter' });
}

function renderPick(onResolveBarcode: jest.Mock, onConfirmScan: jest.Mock) {
  return render(
    <PickSessionPage
      pickBatchId={BATCH_ID}
      lineItems={[lineItem()]}
      onComplete={jest.fn()}
      onResolveBarcode={onResolveBarcode}
      onConfirmScan={onConfirmScan}
      onReportException={jest.fn().mockResolvedValue({ pick_exception_id: 'exc-1' })}
      onPickComplete={jest.fn().mockResolvedValue(undefined)}
    />
  );
}

afterEach(() => jest.clearAllMocks());

// ── Case A — exact-unit evidence ───────────────────────────────────────────

it('C8a — an LSU- scan records that exact unit as operator evidence', async () => {
  const scannedUnitId = 'LSU-bbbb2222';
  const onResolveBarcode = jest.fn().mockResolvedValue({
    lasyncro_variant_id: VARIANT_ID,
    lasyncro_unit_id: scannedUnitId,
  });
  const onConfirmScan = jest.fn().mockResolvedValue(undefined);

  renderPick(onResolveBarcode, onConfirmScan);
  await pickThrough(scannedUnitId);

  await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
  expect(onConfirmScan).toHaveBeenCalledWith(
    expect.objectContaining({
      lasyncro_line_item_id: LINE_ITEM_ID,
      lasyncro_variant_id: VARIANT_ID,
      quantity_confirmed: 1,
      lasyncro_unit_id: scannedUnitId,
    })
  );
});

// ── Case B — product evidence stays product-level ──────────────────────────

it('C8b — an LSP- scan never claims a resolver candidate as exact-unit evidence', async () => {
  // The resolver legitimately returns a candidate unit for context.
  const onResolveBarcode = jest.fn().mockResolvedValue({
    lasyncro_variant_id: VARIANT_ID,
    lasyncro_unit_id: CANDIDATE_UNIT_ID,
  });
  const onConfirmScan = jest.fn().mockResolvedValue(undefined);

  renderPick(onResolveBarcode, onConfirmScan);
  await pickThrough('LSP-ABCD2345');

  await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));

  // The pick is confirmed — product-level evidence remains fully supported …
  const params = onConfirmScan.mock.calls[0][0];
  expect(params).toMatchObject({
    lasyncro_line_item_id: LINE_ITEM_ID,
    lasyncro_variant_id: VARIANT_ID,
    quantity_confirmed: 1,
  });

  // … but nobody scanned a unit, so no unit identity may be recorded.
  expect(params.lasyncro_unit_id).toBeUndefined();
});

it('C8c — an external EAN scan is product evidence too', async () => {
  const onResolveBarcode = jest.fn().mockResolvedValue({
    lasyncro_variant_id: VARIANT_ID,
    lasyncro_unit_id: CANDIDATE_UNIT_ID,
  });
  const onConfirmScan = jest.fn().mockResolvedValue(undefined);

  renderPick(onResolveBarcode, onConfirmScan);
  await pickThrough('5012345678900');

  await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
  expect(onConfirmScan.mock.calls[0][0].lasyncro_unit_id).toBeUndefined();
});
