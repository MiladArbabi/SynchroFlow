/**
 * SF-STOW-UX-LSU-VISIBILITY-01 (FIX-001) — expected LSUs live in the item line:
 * image → product name → expected LSU(s) → optional barcode → secondary SKU.
 *
 * The page's real scan handlers run against mocked adapters. Pending LSUs are
 * the task-scoped unit_ids projection minus units registered for this task
 * (canonical placements plus this session's committed scans).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StowSessionPage, { type StowPlacement } from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import type { WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const ITEM_HINT = 'Scan item barcode (LSU- or product barcode)';
const BIN_HINT = 'Scan bin barcode or type location code';
const EAN = '2000000000015';

function task(overrides: Partial<WmsStowTask> = {}): WmsStowTask {
  return {
    stow_task_id: 'stow-a',
    status: 'in_progress',
    trigger: 'inbound_stock',
    lasyncro_variant_id: 'variant-a',
    quantity: 3,
    quantity_placed: 0,
    location_code: 'BIN-A',
    product_title: 'Trail Running Shoe',
    variant_title: null,
    sku: 'ACC-SHOE-42',
    barcode: EAN,
    image_url: 'https://example.invalid/shoe.png',
    unit_ids: ['LSU-5c962f99', 'LSU-abf58408', 'LSU-ccf5bd6a'],
    assigned_operator_id: null,
    assigned_operator_name: null,
    claimed_by: 7,
    claimed_at: '2026-11-08T00:00:00Z',
    created_at: '2026-11-08T00:00:00Z',
    ...overrides,
  } as WmsStowTask;
}

function placement(lsu: string): StowPlacement {
  return {
    lasyncro_unit_id: lsu, lasyncro_variant_id: 'variant-a', product_title: 'Trail Running Shoe',
    variant_title: null, sku: 'ACC-SHOE-42', location_code: 'BIN-A', operator_id: 7,
    operator_name: 'Operator', occurred_at: '2026-11-08T08:00:00Z',
  };
}

function renderSession(options: {
  tasks: WmsStowTask[];
  placements?: StowPlacement[];
  /** Canonical placements grow with each commit, like the real refetch. */
  livePlacements?: boolean;
  resolve?: (value: string) => Record<string, unknown> | null;
  onConfirmStow?: jest.Mock;
}) {
  const t = options.tasks[0];
  const committed: string[] = [];
  let placed = t.quantity_placed;
  const props = {
    initialTaskId: t.stow_task_id,
    initialStep: null,
    currentUserId: 7,
    onComplete: jest.fn(),
    onActiveTaskChange: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue(options.tasks),
    onResolveLocation: jest.fn().mockImplementation(async (value: string) =>
      value.startsWith('BIN-') ? { location_code: value } : null),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockImplementation(async (value: string) =>
      options.resolve ? options.resolve(value) : { lasyncro_variant_id: 'variant-a', lasyncro_unit_id: value }),
    onConfirmStow: options.onConfirmStow ?? jest.fn().mockImplementation(async (_id: string, _q: number, lsu: string) => {
      placed += 1;
      committed.push(lsu);
      return { stow_task_id: t.stow_task_id, quantity_total: t.quantity, quantity_placed: placed, is_fully_placed: placed >= t.quantity };
    }),
    onFetchPlacements: jest.fn().mockImplementation(async () =>
      options.livePlacements ? [...(options.placements ?? []), ...committed.map(placement)] : (options.placements ?? [])),
  };
  render(<StowSessionPage {...props} />);
  return props;
}

function scan(hint: string, value: string) {
  const input = screen.getByPlaceholderText(hint);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  return input;
}

const lsus = () => Array.from(screen.queryByTestId('stow-item-lsus')?.querySelectorAll('li') ?? []).map((li) => li.textContent);
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('SF-STOW-UX-LSU-VISIBILITY-01 — expected LSUs in the item line', () => {
  it('orders image → product name → LSUs → barcode → SKU, with no separate panel', async () => {
    renderSession({ tasks: [task()] });
    await screen.findByPlaceholderText(ITEM_HINT);

    const list = screen.getByTestId('stow-item-lsus');
    const img = list.closest('div')!.parentElement!.parentElement!.querySelector('img')!;
    const name = screen.getAllByText('Trail Running Shoe').find((el) => follows(el, list))!;
    expect(img).toBeTruthy();
    expect(follows(img, name)).toBe(true);
    expect(follows(name, list)).toBe(true);
    expect(follows(list, screen.getByTestId('stow-item-barcode'))).toBe(true);
    expect(follows(screen.getByTestId('stow-item-barcode'), screen.getByTestId('stow-item-sku'))).toBe(true);
    expect(screen.queryByRole('region', { name: 'Expected unit labels' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Expected unit labels' })).toBe(list);
  });

  it('lists multiple pending LSUs in full, never truncated', async () => {
    renderSession({ tasks: [task()] });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(lsus()).toEqual(['LSU-5c962f99', 'LSU-abf58408', 'LSU-ccf5bd6a']);
    for (const li of Array.from(screen.getByTestId('stow-item-lsus').querySelectorAll('li'))) {
      expect(li.textContent).toBe(li.getAttribute('data-lsu'));
    }
  });

  it('an LSU scan removes that unit at once; history stays in Stow activity', async () => {
    const props = renderSession({ tasks: [task()], livePlacements: true });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-abf58408');

    await waitFor(() => expect(lsus()).toEqual(['LSU-5c962f99', 'LSU-ccf5bd6a']));
    expect(props.onConfirmStow).toHaveBeenCalledWith('stow-a', 1, 'LSU-abf58408');
    await waitFor(() => expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('LSU-abf'));
  });

  it('a product-barcode scan removes the unit the server resolved; the barcode line stays', async () => {
    renderSession({
      tasks: [task()],
      resolve: (value) => (value === EAN
        ? { lasyncro_variant_id: 'variant-a', lasyncro_unit_id: 'LSU-5c962f99', resolution_method: 'barcode' }
        : { lasyncro_variant_id: 'variant-a', lasyncro_unit_id: value }),
    });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, EAN);

    await waitFor(() => expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']));
    expect(screen.getByTestId('stow-item-barcode')).toHaveTextContent(`Barcode ${EAN}`);
  });

  it('a single remaining LSU is shown alone, and the last one leaves "all registered"', async () => {
    renderSession({ tasks: [task({ quantity: 2, quantity_placed: 1, unit_ids: ['LSU-c6c97434'] })], placements: [placement('LSU-481873e7')] });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lsus()).toEqual(['LSU-c6c97434']);
  });

  it('with none left to list and none remaining, says all expected units are registered', async () => {
    renderSession({ tasks: [task({ quantity: 1, quantity_placed: 1, unit_ids: [] })], placements: [placement('LSU-5c962f99')] });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.getByTestId('stow-item-lsus-done')).toHaveTextContent('All expected units registered');
  });

  it('refresh / re-entry rebuilds from server truth (unit_ids already excludes stowed units)', async () => {
    renderSession({ tasks: [task({ quantity_placed: 1, unit_ids: ['LSU-abf58408', 'LSU-ccf5bd6a'] })], placements: [placement('LSU-5c962f99')] });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']);
  });

  it('a stale projection still listing a stowed unit hides it once placements show it', async () => {
    renderSession({ tasks: [task({ quantity_placed: 1 })], placements: [placement('LSU-5c962f99')] });
    await screen.findByPlaceholderText(ITEM_HINT);
    await waitFor(() => expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']));
  });

  it('survives a destination switch and Back / Resume unchanged', async () => {
    renderSession({ tasks: [task()] });
    await screen.findByPlaceholderText(ITEM_HINT);
    scan(ITEM_HINT, 'LSU-5c962f99');
    await waitFor(() => expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']));

    scan(ITEM_HINT, 'BIN-B');
    await waitFor(() => expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-B'));
    expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']);

    fireEvent.click(screen.getByRole('button', { name: 'Back to stow session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume stowing' }));
    await screen.findByPlaceholderText(BIN_HINT);
    expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']);
  });

  it('no-barcode products show their LSUs with no barcode line and no SKU as a scan target', async () => {
    renderSession({ tasks: [task({ barcode: null, sku: 'ACC-TOTE-01', product_title: 'Canvas Tote', quantity: 3,
      unit_ids: ['LSU-5d73d2bc', 'LSU-9ce1dfe0', 'LSU-de05cc35'] })] });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(lsus()).toEqual(['LSU-5d73d2bc', 'LSU-9ce1dfe0', 'LSU-de05cc35']);
    expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
    expect(screen.getByTestId('stow-item-lsus')).not.toHaveTextContent(/ACC-TOTE-01/);
    expect(screen.getByTestId('stow-item-sku')).toHaveTextContent(/^SKU ACC-TOTE-01$/);
    expect(document.body.textContent).not.toMatch(/No product barcode|scan (the|an?) sku/i);
  });

  it.each([
    ['receive_recovery', ['LSU-REQ00001']],
    ['order_cancelled_mid_pick', ['LSU-a73ef5ef']],
  ])('exact-unit %s shows only the required LSU and never the product barcode', async (trigger, unitIds) => {
    renderSession({ tasks: [task({ trigger, quantity: 1, unit_ids: unitIds })] });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(lsus()).toEqual(unitIds);
    expect(screen.getByRole('list', { name: 'Required unit label' })).toBeInTheDocument();
    expect(screen.queryByTestId('stow-item-barcode')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(EAN);
  });

  it.each([
    ['a task type whose projection is not task-scoped', task({ trigger: 'return_restock', unit_ids: ['LSU-ELSEWHERE1'] }), 'Unit labels unavailable for this task.'],
    ['a missing projection', task({ unit_ids: null }), 'Unit labels unavailable for this task.'],
    ['an empty projection with units remaining', task({ unit_ids: [] }), 'Unit labels unavailable for this task.'],
    ['an exact-unit task with no declared unit', task({ trigger: 'receive_recovery', unit_ids: [], quantity: 1 }), 'Required unit label unavailable.'],
  ])('shows an inline unavailable state for %s and lists no identifiers', async (_label, t, text) => {
    renderSession({ tasks: [t] });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(screen.getByTestId('stow-item-lsus-unavailable')).toHaveTextContent(text);
    expect(screen.queryByTestId('stow-item-lsus')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('LSU-ELSEWHERE1');
  });

  it('re-scanning a registered unit says so (the server still refuses it)', async () => {
    let calls = 0;
    const onConfirmStow = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { stow_task_id: 'stow-a', quantity_total: 2, quantity_placed: 1, is_fully_placed: false };
      throw Object.assign(new Error('confirm failed'), { response: { data: { error: 'Stow confirmation failed: [STOW_CONFIRM] INBOUND_LSU_MISMATCH' } } });
    });
    renderSession({ tasks: [task({ quantity: 2, unit_ids: ['LSU-481873e7', 'LSU-c6c97434'] })], onConfirmStow });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-481873e7');
    await waitFor(() => expect(lsus()).toEqual(['LSU-c6c97434']));
    scan(ITEM_HINT, 'LSU-481873e7');

    expect(await screen.findByText('LSU-481873e7 is already registered. Scan one of the expected unit labels.')).toBeInTheDocument();
    expect(onConfirmStow).toHaveBeenCalledTimes(2);
    expect(lsus()).toEqual(['LSU-c6c97434']);
  });

  it('an unregistered wrong unit gets the wrong-unit message (INBOUND_LSU_MISMATCH now mapped)', async () => {
    const onConfirmStow = jest.fn().mockRejectedValue(
      Object.assign(new Error('x'), { response: { data: { error: '[STOW_CONFIRM] INBOUND_LSU_MISMATCH' } } }));
    renderSession({ tasks: [task()], onConfirmStow });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-OTHER001');

    expect(await screen.findByText('Wrong unit. Scan the LSU shown for this stow task.')).toBeInTheDocument();
    expect(lsus()).toEqual(['LSU-5c962f99', 'LSU-abf58408', 'LSU-ccf5bd6a']);
  });

  it('the LSU list holds no focusable control and the scanner keeps focus after a commit', async () => {
    renderSession({ tasks: [task()] });
    const input = await screen.findByPlaceholderText(ITEM_HINT);
    const list = screen.getByTestId('stow-item-lsus');
    expect(list.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0);

    scan(ITEM_HINT, 'LSU-5c962f99');
    await waitFor(() => expect(lsus()).toEqual(['LSU-abf58408', 'LSU-ccf5bd6a']));
    expect(document.activeElement).toBe(input);
  });

  it('375px: LSUs wrap compactly as whole identifiers, before the scanner', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 375 });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
    });
    renderSession({ tasks: [task()] });
    const input = await screen.findByPlaceholderText(ITEM_HINT);

    const list = screen.getByTestId('stow-item-lsus');
    expect(getComputedStyle(list).display).toBe('flex');
    expect(getComputedStyle(list).flexWrap).toBe('wrap');
    for (const li of Array.from(list.querySelectorAll('li'))) {
      expect(getComputedStyle(li).textOverflow).not.toBe('ellipsis');
      expect(li.textContent).toMatch(/^LSU-[0-9a-f]{8}$/);
    }
    expect(follows(list, input)).toBe(true);
  });
});
