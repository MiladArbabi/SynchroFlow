/**
 * SF-PICK-LOCATION-TRUTH-01 — Pick location truth and scanning UX.
 *
 * - The target location code is the prominent instruction; placeholder is
 *   "Scan location"; no redundant hint line and no route breadcrumb.
 * - The map lights exactly the current stop: orange ('suggested') while
 *   pending, green ('confirmed') only after the server confirmed the scan.
 * - A rejected scan stays blocked with a short message and writes nothing.
 * - Unbinned (warehouse-root) stock: no location step and no map position;
 *   the product scan comes first. When the server says labelled units exist,
 *   each unit is identified by its own LSU label — never inferred.
 * - Any other non-pick-bin target fails closed: no scan field, no highlight.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PickSessionPage, {
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

const mockCanvasProps: Record<string, any>[] = [];
jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return {
    ...actual,
    IsometricCanvas: (props: Record<string, any>) => {
      mockCanvasProps.push(props);
      return <div data-testid="isometric-canvas-stub" />;
    },
  };
});

const ZONES = [
  { location_code: 'WH-1-ROOT', type: 'warehouse', position_x: null, position_y: null, width: 20, depth: 20 },
  { location_code: 'PICK-0A', type: 'bin', zone_type: 'pick', position_x: 1, position_y: 1 },
  { location_code: 'PICK-0B', type: 'bin', zone_type: 'pick', position_x: 3, position_y: 1 },
];

function line(overrides: Partial<LineItem> & { id: string }): LineItem {
  const { id, ...rest } = overrides;
  return {
    lasyncro_line_item_id: `line-${id}`,
    lasyncro_variant_id: `variant-${id}`,
    lasyncro_order_id: 'order-lt',
    reservation_allocation_id: `alloc-${id}`,
    sku: `SKU-${id}`,
    product_title: `Product ${id}`,
    variant_title: null,
    quantity: 1,
    location_code: 'PICK-0A',
    location_pickable: true,
    image_url: null,
    unit_ids: null,
    ...rest,
  };
}

function setup(lineItems: LineItem[], overrides: Record<string, unknown> = {}) {
  const props = {
    pickBatchId: 'b4ee6e63-0000-4000-8000-000000000001',
    lineItems,
    onComplete: jest.fn(),
    onResolveBarcode: jest.fn(async () => ({ lasyncro_variant_id: lineItems[0].lasyncro_variant_id })),
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exc-lt' }),
    onPickComplete: jest.fn().mockResolvedValue(undefined),
    resumePicking: true,
    floorZones: ZONES,
    ...overrides,
  };
  render(<PickSessionPage {...(props as any)} />);
  return props;
}

const locationInput = () => screen.queryByPlaceholderText(/^scan location$/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i);
const target = () => screen.getByTestId('pick-target-location');
const lastCanvas = () => mockCanvasProps[mockCanvasProps.length - 1];

function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}

beforeEach(() => { mockCanvasProps.length = 0; });
afterEach(() => jest.clearAllMocks());

describe('SF-PICK-LOCATION-TRUTH-01 — location step UX', () => {
  it('shows the target code prominently with a "Scan location" field and no redundant hint or breadcrumb', () => {
    setup([line({ id: '1' }), line({ id: '2', location_code: 'PICK-0B' })]);
    expect(target()).toHaveTextContent(/^PICK-0A$/);
    expect(screen.getByRole('heading', { name: /^PICK-0A$/ })).toBeInTheDocument();
    expect(locationInput()).toBeInTheDocument();
    expect(screen.queryByText(/scan the location label/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/go to location/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /route/i })).not.toBeInTheDocument();
  });

  it('the map highlights only the instructed target, orange while pending', () => {
    setup([line({ id: '1' }), line({ id: '2', location_code: 'PICK-0B' })]);
    expect(target()).toHaveAttribute('data-location-state', 'pending');
    expect(lastCanvas().selectedLocationCode).toBe('PICK-0A');
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'suggested' });
    expect(lastCanvas().operationalStateByLocation).toBeUndefined();
  });
});

describe('SF-PICK-LOCATION-TRUTH-01 — orange → green only after server confirmation', () => {
  it('stays orange while verification is in flight, turns green once the server confirms', async () => {
    let resolveVerify!: (v: { location_code: string }) => void;
    const onVerifyLocation = jest.fn(
      () => new Promise<{ location_code: string }>((r) => { resolveVerify = r; }),
    );
    const props = setup([line({ id: '1' })], { onVerifyLocation });

    scan(locationInput(), 'LOC-PICK-0A');
    expect(onVerifyLocation).toHaveBeenCalledWith({
      lasyncro_line_item_id: 'line-1',
      reservation_allocation_id: 'alloc-1',
      location_code: 'PICK-0A',
      scanned_value: 'LOC-PICK-0A',
    });
    // Pending: still orange, still on the location step, nothing written.
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'suggested' });
    expect(productInput()).not.toBeInTheDocument();

    resolveVerify({ location_code: 'PICK-0A' });
    await waitFor(() => expect(productInput()).toBeInTheDocument());
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'confirmed' });
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });

  it('a server-rejected scan stays blocked with the short message, stays orange and writes nothing', async () => {
    const rejection = Object.assign(new Error('rejected'), {
      response: { data: { error: 'Wrong location (PICK-0B). Scan PICK-0A.' } },
    });
    const onVerifyLocation = jest.fn().mockRejectedValue(rejection);
    const props = setup([line({ id: '1' })], { onVerifyLocation });

    scan(locationInput(), 'PICK-0B');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong location (PICK-0B). Scan PICK-0A.');
    expect(locationInput()).toBeInTheDocument();
    expect(productInput()).not.toBeInTheDocument();
    expect(target()).toHaveAttribute('data-location-state', 'pending');
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'suggested' });
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });

  it('green does not carry over to the next stop', async () => {
    const onVerifyLocation = jest.fn().mockResolvedValue({ location_code: 'PICK-0A' });
    const props = setup(
      [line({ id: '1' }), line({ id: '2', location_code: 'PICK-0B' })],
      { onVerifyLocation, onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: 'variant-1' }) },
    );
    scan(locationInput(), 'PICK-0A');
    await waitFor(() => expect(productInput()).toBeInTheDocument());
    scan(productInput() as HTMLInputElement, 'EAN-1');
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(target()).toHaveTextContent('PICK-0B'));
    expect(target()).toHaveAttribute('data-location-state', 'pending');
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0B', tone: 'suggested' });
  });
});

describe('SF-PICK-LOCATION-TRUTH-01 — non-pick-bin target fails closed', () => {
  const ZONE_LINE = line({ id: 'z', location_code: 'ZONE-A', location_pickable: false });

  it('no scan field, a clear correction message, and nothing lit on the map', () => {
    const onVerifyLocation = jest.fn();
    const props = setup([ZONE_LINE], { onVerifyLocation });

    expect(target()).toHaveAttribute('data-location-state', 'blocked');
    expect(locationInput()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/ZONE-A is not a pick bin.*stow/i);
    // QUANTITY-UX-001: a non-bin stop draws no map at all (truthful text fallback) — so nothing is ever lit.
    expect(mockCanvasProps.every((p: any) => p.destinationHighlight == null)).toBe(true);
    expect(screen.getByRole('button', { name: /report problem/i })).toBeEnabled();
    expect(onVerifyLocation).not.toHaveBeenCalled();
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });
});

describe('SF-PICK-LOCATION-TRUTH-01 — unbinned (warehouse-root) stock', () => {
  const root = (o: Partial<LineItem> = {}) =>
    line({ id: 'r', location_code: 'WH-1-ROOT', location_pickable: true, location_scan_required: false, unit_scan_required: 0, ...o });
  const resolveUnits = jest.fn(async (value: string) =>
    value.startsWith('LSU-')
      ? { lasyncro_variant_id: 'variant-r', lasyncro_unit_id: value, resolution_method: 'unit_barcode' }
      : { lasyncro_variant_id: 'variant-r' });

  it('no labelled units: product scan first, no location step, no map position, product-only confirm', async () => {
    const onVerifyLocation = jest.fn();
    const props = setup([root()], { onVerifyLocation, onResolveBarcode: resolveUnits });

    expect(productInput()).toBeInTheDocument();
    expect(locationInput()).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-target-location')).not.toBeInTheDocument();
    expect(screen.queryByText(/WH-1-ROOT/)).not.toBeInTheDocument();
    // QUANTITY-UX-001: root stock draws no map at all — no bin can appear as the destination.
    expect(mockCanvasProps.every((p: any) => p.selectedLocationCode == null && p.destinationHighlight == null)).toBe(true);
    expect(screen.getByText('Not in a bin — no map position. Scan the product.')).toBeInTheDocument();

    scan(productInput() as HTMLInputElement, 'EAN-R');
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    const sent = props.onConfirmScan.mock.calls[0][0];
    expect(sent).toMatchObject({ location_code: 'WH-1-ROOT', quantity_confirmed: 1 });
    expect(sent.lasyncro_unit_ids).toBeUndefined();
    expect(onVerifyLocation).not.toHaveBeenCalled();
  });

  // SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — one label verifies; the quantity is counted.
  it('labelled units: a product barcode is refused; one unit label verifies, the quantity is entered, the pick is sent with that label only', async () => {
    const props = setup([root({ quantity: 2, unit_scan_required: 1 })], { onResolveBarcode: resolveUnits });

    expect(screen.getByPlaceholderText(/scan unit label/i)).toBeInTheDocument();
    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'EAN-R');
    expect(await screen.findByRole('alert')).toHaveTextContent('Scan the unit label on the item.');

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-AAAA0001');
    await waitFor(() => expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent(/^✓ LSU-AAAA0001$/));
    expect(screen.queryByText(/of 2 scanned/)).not.toBeInTheDocument();
    // SCAN-INPUT-VISIBILITY-001: after the verifying scan (qty > 1) the scanner is hidden — no second label can be entered.
    expect(screen.queryByPlaceholderText(/scan unit label/i)).not.toBeInTheDocument();
    expect(props.onConfirmScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm 2 picked/i })).toBeEnabled());
    expect(props.onConfirmScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i }));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({
      location_code: 'WH-1-ROOT', quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-AAAA0001'],
    });
  });

  it('mixed stock: labelled units first, the unlabelled remainder is counted; the labels are sent, never more', async () => {
    const props = setup([root({ quantity: 3, unit_scan_required: 1 })], { onResolveBarcode: resolveUnits });

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-BBBB0001');
    // QUANTITY-UX-001: the separate "Units counted" text is gone; the field itself holds the count.
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toHaveValue(1));
    expect(screen.getByRole('button', { name: /remove one unit/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm 3 picked/i }));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({
      quantity_confirmed: 3, lasyncro_unit_ids: ['LSU-BBBB0001'],
    });
  });

  it('a server-refused label set is cleared so the operator rescans; the server message is shown', async () => {
    const refusal = Object.assign(new Error('refused'), {
      response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_MISMATCH', error: 'That unit label cannot be picked here. Scan another label.' } },
    });
    const onConfirmScan = jest.fn().mockRejectedValueOnce(refusal).mockResolvedValue(undefined);
    setup([root({ unit_scan_required: 1 })], { onResolveBarcode: resolveUnits, onConfirmScan });

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-DDDD0001');
    expect(await screen.findByRole('alert')).toHaveTextContent('That unit label cannot be picked here. Scan another label.');
    expect(screen.getByPlaceholderText(/scan unit label/i)).toBeInTheDocument();

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-DDDD0002');
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(2));
    expect(onConfirmScan.mock.calls[1][0]).toMatchObject({ lasyncro_unit_ids: ['LSU-DDDD0002'] });
  });

  it('a stale label count: the server\'s REQUIRED answer switches the item to label scanning', async () => {
    const required = Object.assign(new Error('required'), {
      response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_REQUIRED', units_required: 1, error: 'Scan the unit label on each item (1 label).' } },
    });
    const onConfirmScan = jest.fn().mockRejectedValueOnce(required).mockResolvedValue(undefined);
    setup([root({ unit_scan_required: 0 })], { onResolveBarcode: resolveUnits, onConfirmScan });

    scan(productInput() as HTMLInputElement, 'EAN-R');
    expect(await screen.findByRole('alert')).toHaveTextContent('Scan the unit label on each item (1 label).');
    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-EEEE0001');
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(2));
    expect(onConfirmScan.mock.calls[1][0]).toMatchObject({ lasyncro_unit_ids: ['LSU-EEEE0001'] });
  });

  it('short pick carries the scanned label for the found units', async () => {
    const props = setup([root({ quantity: 2, unit_scan_required: 1 })], { onResolveBarcode: resolveUnits });

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-CCCC0001');
    await waitFor(() => expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent('LSU-CCCC0001'));
    fireEvent.click(screen.getByRole('button', { name: /report problem/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText(/short pick/i));
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm exception/i }));
    await waitFor(() => expect(props.onReportException).toHaveBeenCalledTimes(1));
    expect(props.onReportException.mock.calls[0][0]).toMatchObject({
      exception_type: 'short_pick', quantity_found: 1, lasyncro_unit_ids: ['LSU-CCCC0001'],
    });
  });
});

describe('SF-PICK-LOCATION-TRUTH-01 — labelled units at a pick bin', () => {
  it('server-verified location first (orange → green), then one unit label and the counted quantity; the pick names exactly that label', async () => {
    const onVerifyLocation = jest.fn().mockResolvedValue({ location_code: 'PICK-0A' });
    const onResolveBarcode = jest.fn(async (value: string) =>
      value.startsWith('LSU-') ? { lasyncro_variant_id: 'variant-b', lasyncro_unit_id: value, resolution_method: 'unit_barcode' } : { lasyncro_variant_id: 'variant-b' });
    const props = setup(
      [line({ id: 'b', quantity: 2, location_code: 'PICK-0A', location_scan_required: true, unit_scan_required: 1 })],
      { onVerifyLocation, onResolveBarcode },
    );

    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'suggested' });
    scan(locationInput(), 'PICK-0A');
    await waitFor(() => expect(screen.getByPlaceholderText(/scan unit label/i)).toBeInTheDocument());
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'PICK-0A', tone: 'confirmed' });

    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, '5012345');
    expect(await screen.findByRole('alert')).toHaveTextContent('Scan the unit label on the item.');
    scan(screen.getByPlaceholderText(/scan unit label/i) as HTMLInputElement, 'LSU-B0000001');
    await waitFor(() => expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent('LSU-B0000001'));
    fireEvent.click(screen.getByRole('button', { name: /add one unit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm 2 picked/i })).toBeEnabled());
    expect(props.onConfirmScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i }));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan.mock.calls[0][0]).toMatchObject({
      location_code: 'PICK-0A', quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-B0000001'],
    });
  });
});
