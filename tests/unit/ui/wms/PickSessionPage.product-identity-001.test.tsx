/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — the Pick product card always
 * identifies the product (name · variant, SKU when present, the server's
 * product barcode when present, required quantity) in every scan mode and stage.
 *
 * - LSU mode (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001): the accepted
 *   identifier "Scan: Unit label (LSU-…)" is shown; no reference barcode, no
 *   "required" instruction, no scanned-progress counter. One label verifies;
 *   the quantity is counted. A product-barcode scan is not a unit identity.
 * - The facts persist through EAN, LSU, quantity-confirm and retry.
 * - Missing optional identifiers are never invented.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const ROOT = 'WH-1-ROOT';
const ZONES = [{ location_code: ROOT, type: 'warehouse', position_x: null, position_y: null, width: 20, depth: 20 }];
const EAN = '501234567892';

/**
 * Shape of the R2 acceptance task as /line-items serves it (Canvas Weekender Bag,
 * 2 labelled units at the root): the order-line SKU snapshot is null, the
 * variant's current SKU is CWB-002.
 */
function line(over: Partial<LineItem> = {}): LineItem {
  return {
    lasyncro_line_item_id: 'line-cwb',
    lasyncro_variant_id: 'variant-cwb',
    lasyncro_order_id: 'order-cwb',
    reservation_allocation_id: 'alloc-cwb',
    sku: null,
    variant_sku: 'CWB-002',
    product_title: 'Canvas Weekender Bag',
    variant_title: 'Default Title',
    quantity: 2,
    location_code: ROOT,
    location_pickable: true,
    location_scan_required: false,
    unit_scan_required: 1,
    scan_unit_id: 'LSU-e1161b1e', // ACTIONABLE-ID-001: one eligible LSU projected by /line-items
    image_url: null,
    unit_ids: ['LSU-PAYLOAD01', 'LSU-PAYLOAD02'],
    barcode: EAN,
    ...over,
  };
}

const resolver = () => jest.fn(async (v: string) => (v.startsWith('LSU-')
  ? { lasyncro_variant_id: 'variant-cwb', lasyncro_unit_id: v, resolution_method: 'unit_barcode' }
  : v === EAN ? { lasyncro_variant_id: 'variant-cwb', lasyncro_unit_id: 'LSU-SERVERPICKED', resolution_method: 'product_barcode' } : null));

function setup(items: LineItem[], over: Record<string, unknown> = {}) {
  const props = {
    pickBatchId: 'b4ee6e63-0000-4000-8000-0000000000bb',
    lineItems: items,
    onComplete: jest.fn(),
    onResolveBarcode: resolver(),
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exc' }),
    onPickComplete: jest.fn().mockResolvedValue(undefined),
    resumePicking: true,
    floorZones: ZONES,
    ...over,
  };
  render(<PickSessionPage {...(props as any)} />);
  return props;
}

async function scan(value: string) {
  await act(async () => {
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  });
}

const card = () => screen.getByTestId('pick-product-card');
function expectIdentity(opts: { reference: boolean }) {
  const c = within(card());
  expect(c.getByTestId('scan-product-name')).toHaveTextContent(/^Canvas Weekender Bag$/);
  expect(c.getByTestId('scan-product-sku')).toHaveTextContent(/^SKU: CWB-002$/);
  expect(c.getByTestId('scan-product-quantity')).toHaveTextContent(/^Quantity: 2$/);
  // Removed presentation never returns (QUANTITY-CUSTODY-001).
  expect(card()).not.toHaveTextContent(/Product barcode \(reference\)|Scan individual unit labels|scanned$/);
  expect(c.queryByTestId('scan-product-progress')).not.toBeInTheDocument();
  if (opts.reference) {
    // `reference` = labelled stock. ACTIONABLE-ID-001: the complete server LSU is
    // shown until a label is scanned, then the verified LSU replaces it.
    if (scannedLabels()) expect(c.queryByTestId('scan-product-accepted-identifier')).not.toBeInTheDocument();
    else expect(c.getByTestId('scan-product-accepted-identifier')).toHaveTextContent(/^Unit label: LSU-e1161b1e$/);
    expect(card()).not.toHaveTextContent(/LSU-…|Scan: Unit label|Scan unit label/i);
    expect(c.queryByTestId('scan-stage-instruction')).not.toBeInTheDocument();
    expect(c.queryByTestId('scan-product-barcode')).not.toBeInTheDocument();
  } else {
    // QUANTITY-UX-001: once the barcode scan is accepted it shows a green ✓ (not a commitment).
    expect(c.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: (✓ )?501234567892$/);
    expect(c.queryByTestId('scan-product-accepted-identifier')).not.toBeInTheDocument();
  }
}
const scannedLabels = () => screen.queryByTestId('scan-product-scanned-lsus');

afterEach(() => { jest.clearAllMocks(); delete (window as any).matchMedia; });

describe('LSU mode (R2 shape)', () => {
  it('shows name, SKU, the accepted identifier and quantity; no reference barcode, instruction or progress', async () => {
    setup([line()]);
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'units'));
    expectIdentity({ reference: true });
    expect(scannedLabels()).not.toBeInTheDocument();
    // Order: name → SKU → accepted identifier → quantity.
    const html = card().innerHTML;
    const order = ['name', 'sku', 'accepted-identifier', 'quantity'].map(s => html.indexOf(`data-testid="scan-product-${s}"`));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Payload unit ids are never shown or preselected.
    expect(screen.queryByText(/LSU-PAYLOAD0/)).not.toBeInTheDocument();
  });

  it('a product-barcode scan is not a unit identity; facts stay visible through a refused second label, the counted quantity and confirm', async () => {
    const props = setup([line()]);
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'units'));

    await scan(EAN);                                   // product barcode, not a label
    expect(await screen.findByText('Scan the unit label on the item.')).toBeInTheDocument();
    expect(scannedLabels()).not.toBeInTheDocument();
    expect(screen.queryByText(/LSU-SERVERPICKED/)).not.toBeInTheDocument();
    expectIdentity({ reference: true });

    await scan('LSU-bf1b13e9');                        // one label verifies
    expect(scannedLabels()).toHaveTextContent(/^✓ LSU-bf1b13e9$/);
    // SCAN-INPUT-VISIBILITY-001: after the verifying scan (qty > 1) the scanner is hidden — no second label can be entered.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(scannedLabels()).toHaveTextContent(/^✓ LSU-bf1b13e9$/);
    expectIdentity({ reference: true });
    expect(props.onConfirmScan).not.toHaveBeenCalled();  // no optimistic movement

    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i })); });
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({ quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-bf1b13e9'] });
    expect(props.onConfirmScan.mock.calls[0][0]).not.toHaveProperty('lasyncro_unit_id');
  });

  it('a definitive label refusal keeps the product identity on screen for the retry with the scanned label cleared', async () => {
    const onConfirmScan = jest.fn().mockRejectedValue({ response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_NOT_ELIGIBLE', error: 'Label LSU-b0c38aef is not eligible here.' } } });
    setup([line()], { onConfirmScan });
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'units'));
    await scan('LSU-b0c38aef');
    fireEvent.click(await screen.findByRole('button', { name: /add one unit/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i })); });
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/not eligible here/i)).toBeInTheDocument();
    expect(card()).toHaveAttribute('data-stage', 'units');
    expectIdentity({ reference: true });
    expect(scannedLabels()).not.toBeInTheDocument();
  });
});

describe('EAN-only stock (no labelled units)', () => {
  it('shows the barcode as the scan target and keeps every fact through quantity confirm and a refused confirm', async () => {
    const onConfirmScan = jest.fn().mockRejectedValueOnce({ response: { status: 409, data: { error: 'Allocation changed. Try again.' } } }).mockResolvedValue(undefined);
    setup([line({ unit_scan_required: 0, unit_ids: null })], { onConfirmScan });
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'product'));
    expectIdentity({ reference: false });
    expect(screen.queryByTestId('scan-product-progress')).not.toBeInTheDocument();

    await scan(EAN);                                    // quantity 2 → quantity confirm
    expect(await screen.findByRole('button', { name: /add one unit/i })).toBeInTheDocument();
    expectIdentity({ reference: false });
    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    expectIdentity({ reference: false });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i })); });
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/allocation changed/i)).toBeInTheDocument();
    expectIdentity({ reference: false });
    expect(onConfirmScan.mock.calls[0][0]).toMatchObject({ quantity_confirmed: 2 });
    expect(onConfirmScan.mock.calls[0][0].lasyncro_unit_ids).toBeUndefined();
  });
});

describe('missing optional identifiers are never invented', () => {
  it.each([
    ['null SKUs, null barcode', { sku: null, variant_sku: null, barcode: null }, 'Not assigned'],
    ['blank SKUs, barcode and variant SKU fields absent', { sku: '   ', variant_sku: undefined, barcode: undefined }, null],
  ] as const)('%s (LSU mode)', async (_l, over, reference) => {
    const item = line(over as Partial<LineItem>);
    if (over.barcode === undefined) delete (item as any).barcode;
    if (over.variant_sku === undefined) delete (item as any).variant_sku;
    setup([item]);
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'units'));
    const c = within(card());
    expect(c.queryByTestId('scan-product-sku')).not.toBeInTheDocument();
    // Labelled stock: the accepted identifier is the unit label whatever the product barcode state.
    void reference;
    expect(c.queryByTestId('scan-product-barcode')).not.toBeInTheDocument();
    expect(c.getByTestId('scan-product-accepted-identifier')).toHaveTextContent(/^Unit label: LSU-e1161b1e$/);
    expect(c.getByTestId('scan-product-quantity')).toHaveTextContent(/^Quantity: 2$/);
    expect(card()).not.toHaveTextContent(/CWB-002|LSU-PAYLOAD|SERVERPICKED/);
  });

  it.each([
    ['order snapshot populated → snapshot (variant SKU not used)', { sku: 'ORDER-SNAP-1', variant_sku: 'CWB-002' }, 'ORDER-SNAP-1'],
    ['order snapshot null → current variant SKU', { sku: null, variant_sku: 'CWB-002' }, 'CWB-002'],
    ['order snapshot blank → current variant SKU (trimmed)', { sku: '  ', variant_sku: ' CWB-002 ' }, 'CWB-002'],
    ['both unavailable → no SKU line', { sku: null, variant_sku: '' }, null],
  ] as const)('SKU precedence: %s', async (_l, over, shown) => {
    setup([line({ ...over, unit_scan_required: 0 })]);
    await waitFor(() => expect(card()).toBeInTheDocument());
    if (shown) expect(screen.getByTestId('scan-product-sku')).toHaveTextContent(new RegExp(`^SKU: ${shown}$`));
    else expect(screen.queryByTestId('scan-product-sku')).not.toBeInTheDocument();
    if (shown === 'ORDER-SNAP-1') expect(card()).not.toHaveTextContent(/CWB-002/);
  });

  it('variant is shown when present and the Shopify "Default Title" placeholder is not', async () => {
    setup([line({ variant_title: 'Olive', unit_scan_required: 0 })]);
    await waitFor(() => expect(card()).toBeInTheDocument());
    expect(screen.getByTestId('scan-product-name')).toHaveTextContent(/^Canvas Weekender Bag · Olive$/);
  });
});

describe('responsive layouts', () => {
  it.each([['phone', false], ['desktop', true]] as const)('%s: the same identity facts render in the single-screen card', async (_l, desktop) => {
    (window as any).matchMedia = (query: string) => ({
      matches: desktop && /min-width/.test(query), media: query, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    });
    setup([line()]);
    await waitFor(() => expect(card()).toHaveAttribute('data-stage', 'units'));
    expectIdentity({ reference: true });
    expect(screen.getAllByTestId('pick-product-card')).toHaveLength(1);
    expect(screen.getAllByText('Canvas Weekender Bag')).toHaveLength(1);
  });
});
