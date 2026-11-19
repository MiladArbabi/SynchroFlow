/**
 * SF-WMS-SCAN-UX-01 — Pick product-scan information and contextual Brief.
 *
 * - Product-only: SCAN PRODUCT · name · Barcode: <server barcode> · Quantity.
 *   No barcode from the server → no barcode line (never an SKU or LSU).
 * - Labelled units: SCAN UNIT LABEL · accepted identifier "Unit label (LSU-…)"
 *   · Quantity. One label verifies; the quantity is counted
 *   (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — no per-label progress).
 *   Only the label the operator actually scanned is listed; stowed unit_ids
 *   from the payload are never shown or preselected.
 * - Copy: "Quantity: N" (no "pick N"), one stage instruction, no product-name echo.
 * - Brief: root-only → no bin scan; bins → bin then product; mixed → both.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, {
  pickBriefSteps,
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const ROOT = 'WH-1-ROOT';
const ZONES = [{ location_code: ROOT, type: 'warehouse', position_x: null, position_y: null, width: 20, depth: 20 }];

function rootLine(over: Partial<LineItem> = {}): LineItem {
  return {
    lasyncro_line_item_id: 'line-r',
    lasyncro_variant_id: 'variant-r',
    lasyncro_order_id: 'order-r',
    reservation_allocation_id: 'alloc-r',
    sku: 'SKU-R',
    product_title: 'Wool Beanie',
    variant_title: 'Charcoal',
    quantity: 2,
    location_code: ROOT,
    location_pickable: true,
    location_scan_required: false,
    unit_scan_required: 0,
    image_url: null,
    unit_ids: null,
    ...over,
  };
}

function setup(items: LineItem[], onResolveBarcode = jest.fn(async (v: string) =>
  v.startsWith('LSU-') ? { lasyncro_variant_id: 'variant-r', lasyncro_unit_id: v, resolution_method: 'unit_barcode' } : { lasyncro_variant_id: 'variant-r' })) {
  const props = {
    pickBatchId: 'b4ee6e63-0000-4000-8000-0000000000aa',
    lineItems: items,
    onComplete: jest.fn(),
    onResolveBarcode,
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exc' }),
    onPickComplete: jest.fn().mockResolvedValue(undefined),
    resumePicking: true,
    floorZones: ZONES,
  };
  render(<PickSessionPage {...(props as any)} />);
  return props;
}

function scan(value: string) {
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

afterEach(() => jest.clearAllMocks());

describe('SF-WMS-SCAN-UX-01 — product-only scan step', () => {
  it('shows SCAN PRODUCT, name · variant, the server barcode, then Quantity — no "pick N", no name echo', async () => {
    setup([rootLine({ barcode: '501234567893' })]);
    await waitFor(() => expect(screen.getByTestId('pick-product-card')).toHaveAttribute('data-stage', 'product'));
    expect(screen.getByRole('heading', { name: /^scan product$/i })).toBeInTheDocument();
    expect(screen.getByTestId('scan-product-name')).toHaveTextContent(/^Wool Beanie · Charcoal$/);
    expect(screen.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: 501234567893$/);
    expect(screen.getByTestId('scan-product-quantity')).toHaveTextContent(/^Quantity: 2$/);
    // Order: name → barcode → quantity.
    const card = screen.getByTestId('pick-product-card');
    const order = ['scan-product-name', 'scan-product-barcode', 'scan-product-quantity']
      .map((id) => card.innerHTML.indexOf(`data-testid="${id}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.queryByText(/pick 2/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/take 2 from the shelf/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Wool Beanie/)).toHaveLength(1);
    expect(screen.queryByTestId('scan-product-lsu')).not.toBeInTheDocument();
  });

  it('server reports no barcode → "Barcode: Not assigned" — never the SKU or an LSU in its place', async () => {
    setup([rootLine({ barcode: null, unit_ids: ['LSU-STOWED01'] })]);
    await waitFor(() => expect(screen.getByTestId('pick-product-card')).toBeInTheDocument());
    expect(screen.getByTestId('scan-product-barcode')).toHaveTextContent(/^Barcode: Not assigned$/);
    // SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001: the SKU is shown on its own line when
    // available, but never substitutes for the missing barcode.
    expect(screen.getByTestId('scan-product-sku')).toHaveTextContent(/^SKU: SKU-R$/);
    expect(screen.getByTestId('scan-product-barcode')).not.toHaveTextContent(/SKU-R/);
    expect(screen.queryByText(/LSU-STOWED01/)).not.toBeInTheDocument();
  });

  it('a payload without the barcode field (older server) shows no barcode line rather than guessing', async () => {
    const { barcode: _omit, ...noField } = rootLine();
    setup([noField as LineItem]);
    await waitFor(() => expect(screen.getByTestId('pick-product-card')).toBeInTheDocument());
    expect(screen.queryByTestId('scan-product-barcode')).not.toBeInTheDocument();
  });
});

describe('SF-WMS-SCAN-UX-01 — labelled units (LSU mode)', () => {
  it('shows the complete server LSU (no heading, no placeholder), one label then a counted quantity, never the payload unit_ids', async () => {
    // A stale server count of 2 is clamped: one label verifies (QUANTITY-CUSTODY-001).
    const props = setup([rootLine({ quantity: 2, unit_scan_required: 2, barcode: '501234567893', unit_ids: ['LSU-STOWED01', 'LSU-STOWED02'], scan_unit_id: 'LSU-6b5540e0' })]);
    await waitFor(() => expect(screen.getByTestId('pick-product-card')).toHaveAttribute('data-stage', 'units'));
    // ACTIONABLE-ID-001: no "SCAN UNIT LABEL" heading; the full server-projected LSU is the instruction.
    expect(screen.queryByTestId('scan-stage-instruction')).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-product-accepted-identifier')).toHaveTextContent(/^Unit label: LSU-6b5540e0$/);
    expect(screen.queryByText(/LSU-…|Scan: Unit label/)).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-product-quantity')).toHaveTextContent(/^Quantity: 2$/);
    expect(screen.queryByTestId('scan-product-progress')).not.toBeInTheDocument();
    expect(screen.queryByText(/Scan individual unit labels/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Product barcode \(reference\)/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-product-barcode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
    expect(screen.queryByText(/LSU-STOWED0/)).not.toBeInTheDocument();

    scan('LSU-REAL0001');
    expect(await screen.findByTestId('scan-product-scanned-lsus')).toHaveTextContent(/^✓ LSU-REAL0001$/);
    // Display was not verification: a different eligible label was accepted, and it replaces the suggestion.
    expect(screen.queryByTestId('scan-product-accepted-identifier')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-product-progress')).not.toBeInTheDocument();
    expect(props.onConfirmScan).not.toHaveBeenCalled();

    // Enter the actual quantity, then Confirm.
    fireEvent.click(await screen.findByRole('button', { name: /add one unit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm 2 picked/i })).toBeEnabled());
    expect(props.onConfirmScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i }));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({ quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-REAL0001'] });
  });
});

describe('SF-WMS-SCAN-UX-01 — contextual Pick Brief steps', () => {
  const root = { location_scan_required: false, unit_scan_required: 0 };
  const bin = { location_scan_required: true, unit_scan_required: 0 };
  it('root-only: no bin-scan instruction', () => {
    const steps = pickBriefSteps([root, root]);
    expect(steps).toEqual(['At each stop, scan the product. No bin scan.']);
    expect(steps.join(' ')).not.toMatch(/bin label|bin barcode/i);
  });
  it('bin picking: location scan before product scan', () => {
    expect(pickBriefSteps([bin])).toEqual(['At each stop, scan the bin label, then the product.']);
  });
  it('mixed: explains both stop kinds, never that every stop needs a bin scan', () => {
    const steps = pickBriefSteps([bin, { ...root, unit_scan_required: 1 }]);
    expect(steps).toEqual([
      'Bin stops: scan the bin label, then the product.',
      'Stops not in a bin: scan the product only.',
      'Labelled units: scan each unit’s label.',
    ]);
    expect(steps.join(' ')).not.toMatch(/at each stop, scan the bin/i);
  });
  it('the Brief renders those steps', () => {
    render(
      <PickSessionPage
        {...({
          pickBatchId: 'b4ee6e63-0000-4000-8000-0000000000bb',
          lineItems: [rootLine()],
          onComplete: jest.fn(), onResolveBarcode: jest.fn(), onConfirmScan: jest.fn(),
          onReportException: jest.fn(), onPickComplete: jest.fn(), floorZones: ZONES,
        } as any)}
      />,
    );
    expect(screen.getByText('At each stop, scan the product. No bin scan.')).toBeInTheDocument();
    expect(screen.queryByText(/scan the bin barcode first/i)).not.toBeInTheDocument();
  });
});
