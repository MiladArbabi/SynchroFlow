/**
 * STOW-UX-01 — responsive Stow session and warehouse map.
 *
 * The canonical renderer is mocked at its boundary so the props Stow sends it
 * can be inspected; renderer internals are not under test. Scanner contracts
 * use the page's real handlers with mocked adapters.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import StowSessionPage from '../../../../modules/wms/src/ui/pages/StowSessionPage';
import WmsModuleFT2, { type WmsStowTask } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

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

const ITEM_HINT = 'Scan item barcode (LSU- or product barcode)';
const BIN_HINT = 'Scan bin barcode or type location code';

function setViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: desktop && query.includes('min-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function zone(location_code: string, overrides: Record<string, unknown> = {}) {
  return {
    location_code,
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 1,
    depth: 1,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'storage',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  } as any;
}

const FLOOR = [
  zone('WH-ROOT', { type: 'warehouse' }),
  zone('LANE-1', { type: 'lane', parent_location_code: 'WH-ROOT' }),
  zone('SHELF-2', { type: 'shelf', parent_location_code: 'LANE-1' }),
  zone('BIN-A', { parent_location_code: 'SHELF-2' }),
  zone('BIN-B', { parent_location_code: 'SHELF-2' }),
];

function task(overrides: Partial<WmsStowTask> = {}): WmsStowTask {
  return {
    stow_task_id: 'stow-a',
    status: 'in_progress',
    trigger: 'inbound_stock',
    lasyncro_variant_id: 'variant-a',
    quantity: 3,
    quantity_placed: 1,
    location_code: 'BIN-A',
    product_title: 'Map Widget',
    variant_title: 'Map Widget / Blue',
    sku: 'MAP-1',
    image_url: null,
    unit_ids: [],
    assigned_operator_id: null,
    assigned_operator_name: null,
    claimed_by: 7,
    claimed_at: '2026-11-05T00:00:00Z',
    created_at: '2026-11-05T00:00:00Z',
    ...overrides,
  } as WmsStowTask;
}

function renderSession(options: {
  tasks?: WmsStowTask[];
  floorZones?: any[];
  placements?: any[];
  onConfirmStow?: jest.Mock;
} = {}) {
  const tasks = options.tasks ?? [task()];
  const props = {
    initialTaskId: tasks[0].stow_task_id,
    currentUserId: 7,
    onComplete: jest.fn(),
    onActiveTaskChange: jest.fn(),
    onFetchTasks: jest.fn().mockResolvedValue(tasks),
    onResolveLocation: jest.fn().mockImplementation(async (value: string) =>
      value.startsWith('BIN-') ? { location_code: value } : null,
    ),
    onAssignLocation: jest.fn().mockResolvedValue(undefined),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue({
      lasyncro_variant_id: 'variant-a',
      lasyncro_unit_id: 'LSU-1',
    }),
    onConfirmStow:
      options.onConfirmStow ??
      jest.fn().mockResolvedValue({
        stow_task_id: tasks[0].stow_task_id,
        quantity_total: tasks[0].quantity,
        quantity_placed: tasks[0].quantity_placed + 1,
        is_fully_placed: false,
      }),
    onFetchPlacements: jest.fn().mockResolvedValue(options.placements ?? []),
    floorZones: options.floorZones,
  };
  render(<StowSessionPage {...props} />);
  return props;
}

function scan(hint: string, value: string) {
  const input = screen.getByPlaceholderText(hint);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const lastCanvas = () => mockCanvasProps[mockCanvasProps.length - 1];

beforeEach(() => {
  mockCanvasProps.length = 0;
  setViewport(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('STOW-UX-01 — warehouse map', () => {
  it('desktop: shows the map beside execution and highlights the destination', async () => {
    renderSession({ floorZones: FLOOR });

    expect(await screen.findByPlaceholderText(ITEM_HINT)).toBeInTheDocument();
    const map = screen.getByRole('region', { name: 'Warehouse map' });
    expect(within(map).getByTestId('isometric-canvas-stub')).toBeInTheDocument();
    expect(lastCanvas().selectedLocationCode).toBe('BIN-A');
    // SF-STOW-UX-REFINEMENT-01 — the scanned destination is the green open
    // bin, painted by destinationHighlight instead of an operational state.
    expect(lastCanvas().operationalStateByLocation).toEqual({});
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-A', tone: 'confirmed' });
    expect(within(map).getByText('Destination BIN-A is highlighted on the map.')).toBeInTheDocument();
  });

  it('mobile: scanner comes first and the map stays unmounted until asked for', async () => {
    setViewport(false);
    renderSession({ floorZones: FLOOR });

    const input = await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show map' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(screen.getByRole('region', { name: 'Warehouse map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide map' })).toHaveAttribute('aria-expanded', 'true');
    // Keystrokes from a hardware scanner must not land on the toggle.
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('offers no map once the session is complete', async () => {
    setViewport(false);
    const onConfirmStow = jest.fn().mockResolvedValue({
      stow_task_id: 'stow-a', quantity_total: 3, quantity_placed: 3, is_fully_placed: true,
    });
    renderSession({ tasks: [task({ quantity_placed: 2 })], floorZones: FLOOR, onConfirmStow });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');

    expect(await screen.findByText('Stow complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();
  });

  it('gives textual directions from real geometry, without the warehouse root', async () => {
    renderSession({ floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into BIN-A');
    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Found in LANE-1 › SHELF-2');
    expect(screen.getByTestId('stow-directions')).not.toHaveTextContent('WH-ROOT');
  });

  it('a destination absent from the floor stays actionable and is said to be unmapped', async () => {
    renderSession({ tasks: [task({ location_code: 'BIN-OFFMAP' })], floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lastCanvas().selectedLocationCode).toBeNull();
    expect(screen.getByText(/BIN-OFFMAP is not placed on this map/)).toBeInTheDocument();
  });

  it.each([
    ['access denied or unresolved geometry', undefined],
    ['an empty floor', []],
    ['only the warehouse root', [zone('WH-ROOT', { type: 'warehouse' })]],
    ['unpositioned bins', [zone('BIN-A', { position_x: null, position_y: null })]],
  ])('falls back to text only with %s, and scanning still commits', async (_label, floorZones) => {
    const props = renderSession({ floorZones: floorZones as any[] | undefined });

    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Warehouse map' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into BIN-A');

    scan(ITEM_HINT, 'LSU-1');
    await waitFor(() => expect(props.onConfirmStow).toHaveBeenCalledTimes(1));
    expect(props.onConfirmStow).toHaveBeenCalledWith('stow-a', 1, 'LSU-1');
  });
});

describe('STOW-UX-01 — operational contracts through the new presentation', () => {
  it('Brief → Location → Item: a pending task is claimed only by its first valid bin scan', async () => {
    const props = renderSession({
      tasks: [task({ status: 'pending', quantity_placed: 0, location_code: null, claimed_by: null })],
      floorZones: FLOOR,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Claim & start stowing' }));
    expect(props.onClaimTask).not.toHaveBeenCalled();

    scan(BIN_HINT, 'BIN-B');
    expect(await screen.findByPlaceholderText(ITEM_HINT)).toBeInTheDocument();
    expect(props.onAssignLocation).toHaveBeenCalledWith('stow-a', 'BIN-B');
    expect(props.onClaimTask).toHaveBeenCalledTimes(1);
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });

  it('each successful unit scan commits exactly one unit and returns focus to the scanner', async () => {
    const props = renderSession({ floorZones: FLOOR });
    const input = await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');
    await waitFor(() => expect(props.onConfirmStow).toHaveBeenCalledTimes(1));
    expect(props.onConfirmStow).toHaveBeenCalledWith('stow-a', 1, 'LSU-1');
    expect(await screen.findByText('Unit placed · LSU-1')).toBeInTheDocument();
    await waitFor(() => expect(input).not.toBeDisabled());
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('a rapid second scan while saving is refused, never a second commit', async () => {
    let release: (value: unknown) => void = () => {};
    const onConfirmStow = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const props = renderSession({ onConfirmStow: onConfirmStow as unknown as jest.Mock });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');
    await waitFor(() => expect(onConfirmStow).toHaveBeenCalledTimes(1));
    expect(screen.getByPlaceholderText(ITEM_HINT)).toBeDisabled();
    expect(screen.getByText('Saving scan…')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText(ITEM_HINT), { key: 'Enter' });
    expect(onConfirmStow).toHaveBeenCalledTimes(1);

    release({ stow_task_id: 'stow-a', quantity_total: 3, quantity_placed: 2, is_fully_placed: false });
    await waitFor(() => expect(screen.getByPlaceholderText(ITEM_HINT)).not.toBeDisabled());
    expect(props.onResolveBarcode).toHaveBeenCalledTimes(1);
  });

  it('switching bins moves the highlight; earlier placements keep their original location', async () => {
    const earlier = {
      lasyncro_unit_id: 'LSU-EARLIER',
      lasyncro_variant_id: 'variant-a',
      product_title: 'Map Widget',
      variant_title: null,
      sku: 'MAP-1',
      location_code: 'BIN-A',
      operator_id: 7,
      operator_name: 'Operator Dev',
      occurred_at: '2026-11-05T08:00:00Z',
    };
    const props = renderSession({ floorZones: FLOOR, placements: [earlier] });
    await waitFor(() =>
      expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('registered in BIN-A'),
    );

    scan(ITEM_HINT, 'BIN-B');

    await waitFor(() =>
      expect(screen.getByTestId('stow-stage-location')).toHaveTextContent('BIN-B'),
    );
    expect(props.onAssignLocation).toHaveBeenCalledWith('stow-a', 'BIN-B');
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
    expect(screen.getByTestId('stow-bin-activity')).toHaveTextContent('registered in BIN-A');
    expect(lastCanvas().selectedLocationCode).toBe('BIN-B');
    expect(lastCanvas().operationalStateByLocation).toEqual({ 'BIN-A': 'healthy' });
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-B', tone: 'confirmed' });
  });

  it('a failed commit shows recovery copy, registers nothing and leaves the scanner usable', async () => {
    const onConfirmStow = jest.fn().mockRejectedValue(new Error('boom'));
    renderSession({ onConfirmStow, floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That scan could not be completed. Check the unit label and try again.',
    );
    expect(screen.getByTestId('stow-stage-complete')).toHaveAttribute('data-state', 'pending');
    await waitFor(() => expect(screen.getByPlaceholderText(ITEM_HINT)).not.toBeDisabled());
    await waitFor(() => expect(screen.getByPlaceholderText(ITEM_HINT)).toHaveFocus());
  });

  it('task advancement moves the map to the next task and never carries the old bin', async () => {
    const onConfirmStow = jest.fn().mockResolvedValue({
      stow_task_id: 'stow-a', quantity_total: 3, quantity_placed: 3, is_fully_placed: true,
    });
    const props = renderSession({
      tasks: [
        task({ quantity_placed: 2 }),
        task({ stow_task_id: 'stow-b', status: 'pending', quantity_placed: 0, location_code: 'BIN-B', claimed_by: null, product_title: 'Next Widget' }),
      ],
      floorZones: FLOOR,
      onConfirmStow,
    });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');

    expect(await screen.findByPlaceholderText(BIN_HINT)).toBeInTheDocument();
    expect(props.onActiveTaskChange).toHaveBeenLastCalledWith('stow-b', 'location');
    expect(lastCanvas().selectedLocationCode).toBe('BIN-B');
    // Task B's bin is only a suggestion until scanned: restrained orange.
    expect(lastCanvas().operationalStateByLocation).toEqual({});
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-B', tone: 'suggested' });
  });

  it('asks for no tote scan: bin then unit is the whole path', async () => {
    renderSession({ floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.queryByText(/tote/i)).not.toBeInTheDocument();
  });

  it('Exit is non-mutating: keep stowing returns to the scanner, leaving calls only onComplete', async () => {
    const props = renderSession({ floorZones: FLOOR });
    const input = await screen.findByPlaceholderText(ITEM_HINT);

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Exiting does not undo units already placed. Your progress remains saved.',
    );
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/claimed by you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Keep stowing' }));
    expect(props.onComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Warehouse' }));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(props.onClaimTask).not.toHaveBeenCalled();
    expect(props.onAssignLocation).not.toHaveBeenCalled();
    expect(props.onConfirmStow).not.toHaveBeenCalled();
  });
});

describe('STOW-UX-01 — session Exit control', () => {
  it('is an outlined button that opens the existing confirmation', async () => {
    renderSession({ floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);

    const exit = screen.getByRole('button', { name: 'Exit' });
    expect(exit).toHaveClass('MuiButton-outlined');
    fireEvent.click(exit);
    expect(screen.getByRole('dialog')).toHaveTextContent('Your progress remains saved.');
  });

  it('stays unavailable while a scan is saving', async () => {
    const onConfirmStow = jest.fn(() => new Promise(() => {}));
    renderSession({ onConfirmStow: onConfirmStow as unknown as jest.Mock });
    await screen.findByPlaceholderText(ITEM_HINT);

    scan(ITEM_HINT, 'LSU-1');
    await waitFor(() => expect(onConfirmStow).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Exit' })).toBeDisabled();
  });
});

describe('SF-STOW-UX-REFINEMENT-01 — suggested vs confirmed destination on the map', () => {
  it('an unscanned suggestion is restrained orange, then green once its label is scanned', async () => {
    renderSession({
      tasks: [task({ status: 'pending', quantity_placed: 0, claimed_by: null, location_code: 'BIN-A' })],
      floorZones: FLOOR,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Claim & start stowing' }));
    await screen.findByPlaceholderText(BIN_HINT);

    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-A', tone: 'suggested' });
    expect(
      within(screen.getByRole('region', { name: 'Warehouse map' })).getByRole('status'),
    ).toHaveTextContent('Suggested bin BIN-A is highlighted on the map.');

    scan(BIN_HINT, 'BIN-A');

    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-A', tone: 'confirmed' });
  });

  it('a destination missing from the floor is never highlighted', async () => {
    renderSession({ tasks: [task({ location_code: 'BIN-OFFMAP' })], floorZones: FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lastCanvas().destinationHighlight).toBeNull();
  });
});

// SF-STOW-UX-REFINEMENT-01 — rack levels stay visual geometry. The session no
// longer prints level counts; it must still never invent or assign a level.
describe('STOW-UX-01 — rack-level guidance', () => {
  const RACK_FLOOR = [
    zone('WH-ROOT', { type: 'warehouse' }),
    zone('B-1', { rack_levels: 3 }),
    zone('A-1', { rack_levels: 1 }),
    zone('C-1', { rack_levels: null }),
  ];
  const INVENTED_LEVEL = /\blevel\s*\d|\bL\d\b|(?:top|middle|bottom)\s+(?:level|shelf)|shelf\s*\d/i;

  it('Brief: names the multilevel destination with no level count, inventing no level', async () => {
    renderSession({
      tasks: [task({ status: 'pending', quantity_placed: 0, location_code: 'B-1', claimed_by: null })],
      floorZones: RACK_FLOOR,
    });
    await screen.findByRole('button', { name: 'Claim & start stowing' });

    const directions = screen.getByTestId('stow-directions');
    expect(directions).toHaveTextContent('Suggested destination');
    expect(directions).toHaveTextContent('B-1');
    expect(document.body.textContent).not.toMatch(/rack levels?|shelf level/i);
    expect(document.body.textContent).not.toMatch(INVENTED_LEVEL);
  });

  it('Execution: B-1 stays the destination and the map caption claims only the rack', async () => {
    const props = renderSession({ tasks: [task({ location_code: 'B-1' })], floorZones: RACK_FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);

    const directions = screen.getByTestId('stow-directions');
    expect(directions).toHaveTextContent('Placing into B-1');
    expect(lastCanvas().selectedLocationCode).toBe('B-1');
    // The whole rack is lit; the highlight carries no level of any kind.
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'B-1', tone: 'confirmed' });
    expect(
      within(screen.getByRole('region', { name: 'Warehouse map' })).getByRole('status'),
    ).toHaveTextContent(/^Destination B-1 is highlighted on the map\.$/);
    expect(document.body.textContent).not.toMatch(/rack levels?|shelf level/i);
    expect(document.body.textContent).not.toMatch(INVENTED_LEVEL);

    scan(ITEM_HINT, 'LSU-1');
    await waitFor(() => expect(props.onConfirmStow).toHaveBeenCalledWith('stow-a', 1, 'LSU-1'));
  });

  it.each([
    ['one level', 'A-1'],
    ['an unknown level count', 'C-1'],
    ['a destination missing from the geometry', 'BIN-OFFMAP'],
  ])('shows no rack-level guidance for %s', async (_label, locationCode) => {
    renderSession({ tasks: [task({ location_code: locationCode })], floorZones: RACK_FLOOR });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(screen.getByTestId('stow-directions')).toHaveTextContent(`Placing into ${locationCode}`);
    expect(document.body.textContent).not.toMatch(/rack levels?|shelf level/i);
  });

  it('with no geometry stays text only and claims nothing about levels', async () => {
    renderSession({ tasks: [task({ location_code: 'B-1' })], floorZones: undefined });
    await screen.findByPlaceholderText(ITEM_HINT);

    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into B-1');
    expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/rack levels?|shelf level/i);
  });

  it('follows a bin switch from a multilevel rack: the highlight moves whole, no level text appears', async () => {
    renderSession({ tasks: [task({ location_code: 'B-1' })], floorZones: [...RACK_FLOOR, zone('BIN-A')] });
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'B-1', tone: 'confirmed' });

    scan(ITEM_HINT, 'BIN-A');

    await waitFor(() => expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into BIN-A'));
    expect(lastCanvas().destinationHighlight).toEqual({ locationCode: 'BIN-A', tone: 'confirmed' });
    expect(document.body.textContent).not.toMatch(/rack levels?|shelf level/i);
  });
});

describe('STOW-UX-01 — WmsModuleFT2 host', () => {
  function hostProps(overrides: Record<string, unknown>) {
    return {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: 7,
      pendingStowTaskId: 'stow-a',
      onFetchStowTasks: jest.fn().mockResolvedValue([task()]),
      onRefresh: jest.fn(),
      onResolveBarcode: jest.fn(),
      ...overrides,
    } as any;
  }

  it('hands existing grid geometry to the session', async () => {
    render(<WmsModuleFT2 {...hostProps({ gridLocations: FLOOR })} />);
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.getByTestId('isometric-canvas-stub')).toBeInTheDocument();
    expect(lastCanvas().zones.map((z: any) => z.location_code)).toEqual(
      FLOOR.map((z: any) => z.location_code),
    );
  });

  it('with no grid resolved the session is text only', async () => {
    render(<WmsModuleFT2 {...hostProps({ gridLocations: undefined })} />);
    await screen.findByPlaceholderText(ITEM_HINT);
    expect(screen.queryByTestId('isometric-canvas-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into BIN-A');
  });

  // Mirrors WmsOperationsPage: the URL param is the pendingStowTaskId prop, so
  // a late URL write reopens the session through the host's own effect.
  function renderDelayedLoadHost() {
    let resolveTasks: (tasks: WmsStowTask[]) => void = () => {};
    const onFetchStowTasks = jest.fn(
      () => new Promise<WmsStowTask[]>((resolve) => { resolveTasks = resolve; }),
    );
    const urlWrites: string[] = [];
    function Host() {
      const [pendingStowTaskId, setPendingStowTaskId] = React.useState<string | null>('stow-a');
      return (
        <WmsModuleFT2
          {...hostProps({
            pendingStowTaskId,
            onFetchStowTasks,
            onSessionExit: () => setPendingStowTaskId(null),
            onStowSessionStepChange: (taskId: string) => {
              urlWrites.push(taskId);
              setPendingStowTaskId(taskId);
            },
          })}
        />
      );
    }
    render(<Host />);
    return {
      onFetchStowTasks,
      urlWrites,
      finishLoading: async () => {
        await act(async () => {
          resolveTasks([task()]);
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      },
    };
  }

  it('Exit during the initial load stays exited when the load finishes later', async () => {
    const host = renderDelayedLoadHost();

    fireEvent.click(await screen.findByRole('button', { name: 'Exit' }));
    await waitFor(() => expect(screen.queryByTestId('stow-session-shell')).not.toBeInTheDocument());

    await host.finishLoading();

    expect(host.urlWrites).toEqual([]);
    expect(screen.queryByTestId('stow-session-shell')).not.toBeInTheDocument();
    expect(host.onFetchStowTasks).toHaveBeenCalledTimes(1);
  });

  it('a delayed load with no Exit still resumes the in-progress task and reports it', async () => {
    const host = renderDelayedLoadHost();
    expect(await screen.findByRole('button', { name: 'Exit' })).toBeInTheDocument();

    await host.finishLoading();

    expect(await screen.findByPlaceholderText(ITEM_HINT)).toBeInTheDocument();
    expect(host.urlWrites).toEqual(['stow-a']);
    expect(screen.getByTestId('stow-directions')).toHaveTextContent('Placing into BIN-A');
  });
});
