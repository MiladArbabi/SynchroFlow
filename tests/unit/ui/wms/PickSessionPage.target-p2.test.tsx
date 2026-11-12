/**
 * SF-PICK-P2-UI-01 — Pick session adapted to the owner-approved target
 * (Pick Session.dc.html) inside the shared ExecutionSessionShell.
 *
 * Owner decisions covered here: 4 (multi-unit count starts at zero, single
 * unit advances only after backend acceptance, no partial /pick/scan),
 * 7 (no summary review; Done only after backend-confirmed completion),
 * 8 (wrong scans and network failures never advance or commit),
 * 9 (exit keeps backend-confirmed progress), 12 (responsive shell),
 * 13 (shortfall routes to the EXISTING exception workflow, entered count kept).
 *
 * Renders PickSessionPage directly with controlled props; every write prop is
 * a jest.fn so "no inventory write" is asserted on the exact callbacks.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const BATCH_ID = 'c4f7be77-0000-4000-8000-000000000p2';

function line(overrides: Partial<LineItem> & { id: string }): LineItem {
  const { id, ...rest } = overrides;
  return {
    lasyncro_line_item_id: `line-${id}`,
    lasyncro_variant_id: `variant-${id}`,
    lasyncro_order_id: 'order-p2',
    reservation_allocation_id: `alloc-${id}`,
    sku: `SKU-${id}`,
    product_title: `Product ${id}`,
    variant_title: null,
    quantity: 1,
    location_code: `A-${id}`,
    image_url: null,
    unit_ids: null,
    ...rest,
  };
}

const SINGLE = line({ id: '1', quantity: 1, location_code: 'A-1' });
const MULTI = line({ id: '2', quantity: 3, location_code: 'B-2' });

function setup(lineItems: LineItem[], overrides: Record<string, unknown> = {}) {
  const props = {
    pickBatchId: BATCH_ID,
    lineItems,
    onComplete: jest.fn(),
    onResolveBarcode: jest.fn(async (value: string) => {
      const match = lineItems.find((li) => `EAN-${li.lasyncro_variant_id}` === value);
      return match ? { lasyncro_variant_id: match.lasyncro_variant_id } : { lasyncro_variant_id: 'variant-other' };
    }),
    onConfirmScan: jest.fn().mockResolvedValue(undefined),
    onReportException: jest.fn().mockResolvedValue({ pick_exception_id: 'exc-p2' }),
    onPickComplete: jest.fn().mockResolvedValue(undefined),
    onStartPacking: jest.fn(),
    resumePicking: true,
    floorZones: [],
    ...overrides,
  };
  render(<PickSessionPage {...(props as any)} />);
  return props;
}

const locationInput = () => screen.queryByPlaceholderText(/scan bin barcode/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i) as HTMLInputElement | null;
// Navigation helpers use label/placeholder/text queries: *ByRole with a name
// computes the accessibility tree for every element and dominated the cost of
// the full-flow cases (SF-PICK-P2-CORRECTION-01 C1). Role queries stay where
// the role itself is the assertion.
const addUnit = () => screen.queryByLabelText(/add one unit/i);
const removeUnit = () => screen.queryByLabelText(/remove one unit/i);
/** The <button> whose visible text matches — a navigation helper, not a role assertion. */
const buttonByText = (text: RegExp) => screen.getByText(text).closest('button') as HTMLButtonElement;
const unitsCounted = () => screen.queryByLabelText(/units counted/i);

function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}

async function reachItem(li: LineItem) {
  scan(locationInput(), li.location_code);
  await waitFor(() => expect(productInput()).toBeInTheDocument());
}

async function reachQty(li: LineItem) {
  await reachItem(li);
  scan(productInput(), `EAN-${li.lasyncro_variant_id}`);
  await waitFor(() => expect(addUnit()).toBeInTheDocument());
}

function expectNoWrites(props: ReturnType<typeof setup>) {
  expect(props.onConfirmScan).not.toHaveBeenCalled();
  expect(props.onReportException).not.toHaveBeenCalled();
  expect(props.onPickComplete).not.toHaveBeenCalled();
}

describe('SF-PICK-P2 — shell, header and location step', () => {
  it('renders inside the shared execution shell with the PICK workflow label', () => {
    setup([SINGLE, MULTI]);
    const shell = screen.getByTestId('pick-session-shell');
    const header = within(shell).getByRole('banner');
    expect(within(header).getByRole('heading', { name: /^pick$/i })).toBeInTheDocument();
    expect(within(header).getByText('Batch C4F7BE77')).toBeInTheDocument();
    expect(within(header).getByText(/item\s+1\s+of\s+2/i)).toBeInTheDocument();
    expect(within(header).getByText(/0 of 2 picked/i)).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /^exit$/i })).toBeEnabled();
  });

  it('shows the location instruction and accepts the correct bin', async () => {
    setup([SINGLE]);
    expect(screen.getByRole('heading', { name: /go to\s+A-1/i })).toBeInTheDocument();
    await reachItem(SINGLE);
    expect(screen.getByRole('heading', { name: /scan the\s+product 1/i })).toBeInTheDocument();
  });

  it('a wrong bin shows an inline error, stays on location and writes nothing', async () => {
    const props = setup([SINGLE]);
    scan(locationInput(), 'Z-9');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Z-9/);
    expect(screen.getByRole('alert')).toHaveTextContent(/A-1/);
    expect(locationInput()).toBeInTheDocument();
    expect(productInput()).not.toBeInTheDocument();
    expectNoWrites(props);
  });
});

describe('SF-PICK-P2 — item step', () => {
  it('a wrong item shows an inline error, stays on the item step and writes nothing', async () => {
    const props = setup([SINGLE]);
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-somethingelse');
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong item/i);
    expect(productInput()).toBeInTheDocument();
    expectNoWrites(props);
  });

  it('single unit: the scan confirms the full quantity and advances only after backend acceptance', async () => {
    let accept!: () => void;
    const onConfirmScan = jest.fn(() => new Promise<void>((resolve) => { accept = resolve; }));
    const props = setup([SINGLE, MULTI], { onConfirmScan });
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
    expect(onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({
      lasyncro_line_item_id: 'line-1',
      reservation_allocation_id: 'alloc-1',
      location_code: 'A-1',
      quantity_confirmed: 1,
    }));
    // Pending backend: still on SINGLE's item step.
    expect(screen.getByRole('heading', { name: /scan the\s+product 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /go to\s+B-2/i })).not.toBeInTheDocument();
    await act(async () => { accept(); });
    expect(await screen.findByRole('heading', { name: /go to\s+B-2/i })).toBeInTheDocument();
    expect(props.onReportException).not.toHaveBeenCalled();
  });

  it('single unit: a backend/network failure keeps the step, shows the error and allows retry without duplicates', async () => {
    const onConfirmScan = jest.fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(undefined);
    setup([SINGLE, MULTI], { onConfirmScan });
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(productInput()).toBeInTheDocument();
    expect(onConfirmScan).toHaveBeenCalledTimes(1);

    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: /go to\s+B-2/i })).toBeInTheDocument();
  });

  it('duplicate hardware scans while a confirm is in flight send exactly one /pick/scan', async () => {
    let accept!: () => void;
    const onConfirmScan = jest.fn(() => new Promise<void>((resolve) => { accept = resolve; }));
    setup([SINGLE, MULTI], { onConfirmScan });
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    scan(productInput(), 'EAN-variant-1');
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
    await act(async () => { accept(); });
    expect(await screen.findByRole('heading', { name: /go to\s+B-2/i })).toBeInTheDocument();
    expect(onConfirmScan).toHaveBeenCalledTimes(1);
  });
});

describe('SF-PICK-P2 — multi-unit quantity (decision 4)', () => {
  it('the count starts at zero, not prefilled, and is capped at the required quantity', async () => {
    const props = setup([MULTI]);
    await reachQty(MULTI);
    expect(unitsCounted()).toHaveTextContent(/^0$/);
    expect(screen.getByText(/^of 3$/i)).toBeInTheDocument();
    expect(removeUnit()).toBeDisabled();
    fireEvent.click(addUnit()!);
    fireEvent.click(addUnit()!);
    fireEvent.click(addUnit()!);
    expect(unitsCounted()).toHaveTextContent(/^3$/);
    expect(addUnit()).toBeDisabled();
    fireEvent.click(removeUnit()!);
    expect(unitsCounted()).toHaveTextContent(/^2$/);
    expectNoWrites(props);
  });

  it('confirming the full count sends the full required quantity exactly once', async () => {
    const props = setup([MULTI]);
    await reachQty(MULTI);
    for (let i = 0; i < 3; i += 1) fireEvent.click(addUnit()!);
    const confirm = screen.getByRole('button', { name: /confirm 3 picked/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    expect(props.onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({
      lasyncro_line_item_id: 'line-2',
      reservation_allocation_id: 'alloc-2',
      quantity_confirmed: 3,
    }));
  });

  it('a partial count never calls /pick/scan; it opens the existing exception workflow with the count kept', async () => {
    const props = setup([MULTI]);
    await reachQty(MULTI);
    fireEvent.click(addUnit()!);
    fireEvent.click(addUnit()!);
    fireEvent.click(screen.getByRole('button', { name: /report 2 of 3/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/report problem/i)).toBeInTheDocument();
    expect(props.onConfirmScan).not.toHaveBeenCalled();

    // Existing taxonomy: the operator chooses; the entered count is preserved.
    fireEvent.click(within(dialog).getByRole('button', { name: /short pick/i }));
    expect((within(dialog).getByLabelText(/quantity found/i) as HTMLInputElement).value).toBe('2');
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm exception/i }));
    await waitFor(() => expect(props.onReportException).toHaveBeenCalledTimes(1));
    expect(props.onReportException).toHaveBeenCalledWith(expect.objectContaining({
      exception_type: 'short_pick',
      stage: 'pick',
      quantity_required: 3,
      quantity_found: 2,
      reservation_allocation_id: 'alloc-2',
    }));
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });

  it('cancelling the exception returns to the stepper with the entered count intact', async () => {
    setup([MULTI]);
    await reachQty(MULTI);
    fireEvent.click(addUnit()!);
    fireEvent.click(screen.getByRole('button', { name: /report 1 of 3/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(unitsCounted()).toHaveTextContent(/^1$/);
  });
});

describe('SF-PICK-P2 — existing exception access', () => {
  it('Report problem stays available in the footer at location and item steps', async () => {
    const props = setup([SINGLE]);
    expect(screen.getByRole('button', { name: /report problem/i })).toBeEnabled();
    await reachItem(SINGLE);
    fireEvent.click(screen.getByRole('button', { name: /report problem/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /item not found/i })).toBeInTheDocument();
    expectNoWrites(props);
  });
});

describe('SF-PICK-P2 — completion (decisions 6 off-mode and 7)', () => {
  async function pickAll(props: ReturnType<typeof setup>) {
    await reachItem(SINGLE);
    scan(productInput(), 'EAN-variant-1');
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/item\s+2\s+of\s+2/i)).toBeInTheDocument());
    await reachQty(MULTI);
    for (let i = 0; i < 3; i += 1) fireEvent.click(addUnit()!);
    fireEvent.click(buttonByText(/confirm 3 picked/i));
    await waitFor(() => expect(props.onConfirmScan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());
  }

  it('after the last item there is no summary review; completion is an explicit backend call', async () => {
    const props = setup([SINGLE, MULTI]);
    await pickAll(props);
    expect(await screen.findByRole('button', { name: /confirm pick complete/i })).toBeEnabled();
    expect(screen.queryByText(/pick summary|review before confirming/i)).not.toBeInTheDocument();
    // Handoff is not verified without Pack stations: no station claim is shown.
    expect(screen.queryByText(/handed to|verified handoff/i)).not.toBeInTheDocument();
    expect(props.onPickComplete).not.toHaveBeenCalled();
  });

  it('Done appears only after pick-complete succeeds, with accurate picked and short counts', async () => {
    let finish!: () => void;
    const onPickComplete = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = setup([SINGLE, MULTI], { onPickComplete });
    await pickAll(props);
    fireEvent.click(buttonByText(/confirm pick complete/i));
    await waitFor(() => expect(onPickComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: /^pick complete$/i })).not.toBeInTheDocument();
    await act(async () => { finish(); });
    expect(await screen.findByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
    const facts = screen.getByTestId('pick-done-facts');
    expect(facts).toHaveTextContent(/picked\s*4/i); // 1 + 3 units
    expect(facts).toHaveTextContent(/short\s*0/i);
    expect(screen.getByRole('button', { name: /^start packing\s*→?$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^return to operations$/i })).toBeEnabled();
  });

  it('a failed pick-complete keeps the operator on the completion step with the error', async () => {
    const onPickComplete = jest.fn().mockRejectedValue({ response: { data: { error: 'BATCH_NOT_IN_PICKING:packing' } } });
    const props = setup([SINGLE, MULTI], { onPickComplete });
    await pickAll(props);
    fireEvent.click(buttonByText(/confirm pick complete/i));
    expect(await screen.findByRole('alert')).toHaveTextContent(/BATCH_NOT_IN_PICKING/);
    expect(screen.queryByRole('heading', { name: /^pick complete$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm pick complete/i })).toBeEnabled();
  });

  it('Done reports short units from a short_pick exception', async () => {
    const props = setup([MULTI]);
    await reachQty(MULTI);
    fireEvent.click(addUnit()!);
    fireEvent.click(addUnit()!);
    fireEvent.click(buttonByText(/report 2 of 3/i));
    await waitFor(() => expect(screen.queryByText('Report Problem')).not.toBeNull());
    fireEvent.click(buttonByText(/short pick/i));
    fireEvent.click(buttonByText(/confirm exception/i));
    await waitFor(() => expect(props.onReportException).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/confirm pick complete/i)).not.toBeNull());
    fireEvent.click(buttonByText(/confirm pick complete/i));
    expect(await screen.findByRole('heading', { name: /^pick complete$/i })).toBeInTheDocument();
    const facts = screen.getByTestId('pick-done-facts');
    expect(facts).toHaveTextContent(/picked\s*2/i); // quantity_found
    expect(facts).toHaveTextContent(/short\s*1/i);  // required − found
  });
});

describe('SF-PICK-P2 — exit and resume (decision 9)', () => {
  it('Exit opens a non-mutating sheet; Keep picking returns to the same step', async () => {
    const props = setup([SINGLE]);
    await reachItem(SINGLE);
    fireEvent.click(screen.getByRole('button', { name: /^exit$/i }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/leave pick/i)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /keep picking/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(productInput()).toBeInTheDocument();
    expect(props.onComplete).not.toHaveBeenCalled();
    expectNoWrites(props);
  });

  it('Back to Warehouse exits through the existing session exit without any write', async () => {
    const props = setup([SINGLE]);
    fireEvent.click(screen.getByRole('button', { name: /^exit$/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /back to warehouse/i }));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expectNoWrites(props);
  });

  it('a resumed picking batch starts at the location step of the first remaining line', () => {
    setup([MULTI], { resumePicking: true });
    expect(screen.getByRole('heading', { name: /go to\s+B-2/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start picking/i })).not.toBeInTheDocument();
  });
});

describe('SF-PICK-P2 — responsive layout (decision 12)', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  function mockViewport(desktop: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: desktop && /min-width/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it('mobile/tablet: scan controls come before the map so they stay in view', () => {
    mockViewport(false);
    setup([SINGLE]);
    const map = screen.getByRole('region', { name: /map/i });
    const input = locationInput()!;
    // eslint-disable-next-line no-bitwise
    expect(input.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('desktop: the map takes its own column beside the task', () => {
    mockViewport(true);
    setup([SINGLE]);
    const map = screen.getByRole('region', { name: /map/i });
    const input = locationInput()!;
    // eslint-disable-next-line no-bitwise
    expect(map.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.contains(input)).toBe(false);
  });
});
