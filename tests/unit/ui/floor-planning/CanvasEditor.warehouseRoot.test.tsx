import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import {
  CanvasEditor,
  fitWarehouseToViewport,
} from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'ZONE-01',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 2,
    depth: 2,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

const warehouse = zone({
  location_code: 'ROOT-01',
  type: 'warehouse',
  zone_type: null,
  position_x: 2,
  position_y: 1,
  width: 10,
  depth: 5,
});

const lane = zone({
  location_code: 'LANE-01',
  type: 'lane',
  zone_type: 'pick',
  position_x: 3,
  position_y: 2,
  width: 4,
  depth: 2,
});

function canvasRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockCanvasRect(width = 1000, height = 500) {
  return jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(canvasRect(width, height));
}

describe('warehouse viewport fitting', () => {
  it('fits and centres valid warehouse bounds with a ten-percent safe margin', () => {
    const viewport = fitWarehouseToViewport(warehouse, 1000, 500);

    if (!viewport) throw new Error('Expected a fitted viewport');
    expect(viewport.zoom).toBeCloseTo(1.5);
    const left = viewport.offset.x + 2 * 60 * viewport.zoom;
    const top = viewport.offset.y + 1 * 60 * viewport.zoom;
    const right = left + 10 * 60 * viewport.zoom;
    const bottom = top + 5 * 60 * viewport.zoom;
    expect(left).toBeCloseTo(50);
    expect(top).toBeCloseTo(25);
    expect(right).toBeCloseTo(950);
    expect(bottom).toBeCloseTo(475);
  });

  it('does not collapse a 12m square warehouse to minimum zoom in a desktop viewport', () => {
    const viewport = fitWarehouseToViewport({ ...warehouse, width: 12, depth: 12 }, 1200, 800);

    expect(viewport?.zoom).toBeCloseTo(1);
    expect(viewport?.zoom).toBeGreaterThan(0.3);
  });

  it('respects maximum zoom, and auto-fit goes below the manual minimum when the full boundary requires it (GH1176)', () => {
    // GH1176 supersedes the former 0.3 floor, which clipped large warehouses.
    expect(fitWarehouseToViewport({ ...warehouse, width: 1000, depth: 1000 }, 300, 200)?.zoom).toBeCloseTo(0.003, 6);
    expect(fitWarehouseToViewport({ ...warehouse, width: 0.1, depth: 0.1 }, 300, 200)?.zoom).toBe(3);
  });

  it('GH1176: fits the complete boundary of a warehouse far larger than the default canvas', () => {
    // 120m x 80m — six times the default 20m x 15m canvas — in a desktop viewport.
    const viewportWidth = 1200;
    const viewportHeight = 800;
    const large = { ...warehouse, position_x: 0, position_y: 0, width: 120, depth: 80 };
    const viewport = fitWarehouseToViewport(large, viewportWidth, viewportHeight);

    if (!viewport) throw new Error('Expected a fitted viewport');
    const left = viewport.offset.x;
    const top = viewport.offset.y;
    const right = left + 120 * 60 * viewport.zoom;
    const bottom = top + 80 * 60 * viewport.zoom;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(viewportWidth);
    expect(bottom).toBeLessThanOrEqual(viewportHeight);
  });

  it('does not turn an unmeasurable viewport into a fallback fit', () => {
    expect(fitWarehouseToViewport(warehouse, 0, 0)).toBeNull();
  });

  it.each([
    null,
    { ...warehouse, position_x: null },
    { ...warehouse, width: null },
    { ...warehouse, depth: 0 },
  ])('uses the safe fallback for missing or invalid warehouse geometry', (root) => {
    expect(fitWarehouseToViewport(root, 1000, 500)).toEqual({
      zoom: 1,
      offset: { x: 40, y: 40 },
    });
  });
});

describe('CanvasEditor passive warehouse root', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('renders warehouse behind foreground zones with passive faded pointer treatment', () => {
    const { container } = render(<CanvasEditor zones={[lane, warehouse]} />);
    const root = container.querySelector('[data-zone-code="ROOT-01"]') as SVGGElement;
    const foreground = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    expect(root.compareDocumentPosition(foreground) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root).toHaveAttribute('opacity', '0.55');
    expect(root).toHaveStyle({ pointerEvents: 'none' });
    expect(root.querySelector('[style*="resize"]')).not.toBeInTheDocument();
  });

  it('does not select or drag warehouse geometry while overlapping foreground remains selectable', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[warehouse, lane]} onUpdateZone={onUpdateZone} />);
    const root = container.querySelector('[data-zone-code="ROOT-01"]') as SVGGElement;
    const foreground = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(root, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 180, clientY: 160 });
    fireEvent.mouseUp(window);
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalled();

    fireEvent.mouseDown(foreground, { clientX: 200, clientY: 150 });
    expect(screen.getByTitle('Duplicate zone')).toBeInTheDocument();
    expect(screen.getAllByText('LANE-01').length).toBeGreaterThan(0);
    expect(foreground.querySelectorAll('[style*="resize"]')).toHaveLength(3);

    fireEvent.mouseMove(window, { clientX: 260, clientY: 150 });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledWith(
      'LANE-01',
      expect.objectContaining({ position_x: expect.any(Number), position_y: expect.any(Number) }),
    ));
  });

  it('uses warehouse fit initially and restores it on Reset', async () => {
    render(<CanvasEditor zones={[warehouse, lane]} />);

    await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+'));
    expect(screen.getByText('165%')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('keeps initial fit eligible after a zero-size measurement and fits once measurable', async () => {
    rectSpy.mockReset();
    rectSpy
      .mockReturnValueOnce(canvasRect(0, 0))
      .mockReturnValue(canvasRect(1000, 500));

    render(<CanvasEditor zones={[warehouse, lane]} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());
  });

  it('re-fits the initial viewport when the drawable canvas grows after first measurement', async () => {
    rectSpy.mockReturnValue(canvasRect(600, 500));

    let notifyResize: (() => void) | undefined;
    const observe = jest.fn();
    const disconnect = jest.fn();

    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this);
      }

      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;
    } as typeof ResizeObserver;

    try {
      render(<CanvasEditor zones={[warehouse, lane]} />);

      await waitFor(() => {
        expect(screen.queryByText('100%')).not.toBeInTheDocument();
      });

      rectSpy.mockReturnValue(canvasRect(1000, 500));

      expect(observe).toHaveBeenCalled();
      expect(notifyResize).toBeDefined();

      notifyResize?.();

      await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('stops observing after the initial resize fit has settled', async () => {
    rectSpy.mockReturnValue(canvasRect(600, 500));

    let notifyResize: (() => void) | undefined;
    const observe = jest.fn();
    const disconnect = jest.fn();

    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this);
      }

      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;
    } as typeof ResizeObserver;

    try {
      render(<CanvasEditor zones={[warehouse, lane]} />);

      rectSpy.mockReturnValue(canvasRect(1000, 500));
      expect(notifyResize).toBeDefined();
      notifyResize?.();

      await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());
      expect(disconnect).toHaveBeenCalled();
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('Reset recomputes fit from the current drawable viewport', async () => {
    render(<CanvasEditor zones={[warehouse, lane]} />);
    await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());

    rectSpy.mockReturnValue(canvasRect(600, 500));
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('does not re-fit after an ordinary zone update', async () => {
    const { rerender } = render(<CanvasEditor zones={[warehouse, lane]} />);
    await waitFor(() => expect(screen.getByText('150%')).toBeInTheDocument());

    rerender(<CanvasEditor zones={[warehouse, { ...lane, position_x: 8 }]} />);
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('uses fallback viewport when warehouse roots are ambiguous', () => {
    render(<CanvasEditor zones={[warehouse, { ...warehouse, location_code: 'ROOT-02' }]} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-viewport')).toHaveAttribute('transform', 'translate(40,40)');
  });
});

// ===========================================================================
// GH1176 — fresh (null x/y) warehouse root is the implicit setup boundary
// ===========================================================================
describe('GH1176 — fresh warehouse root with null position', () => {
  let rectSpy: jest.SpyInstance;

  const freshRoot = zone({
    location_code: 'WH-1-ROOT',
    type: 'warehouse',
    zone_type: null,
    position_x: null,
    position_y: null,
    width: 20,
    depth: 15,
  });

  const unplacedBin = zone({
    location_code: 'BIN-UNPLACED',
    position_x: null,
    position_y: null,
  });

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('GH1176: renders the root as a passive setup boundary at the implicit origin', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CanvasEditor zones={[freshRoot, lane, unplacedBin]} onUpdateZone={onUpdateZone} />,
    );
    const root = container.querySelector('[data-zone-code="WH-1-ROOT"]') as SVGGElement | null;

    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('transform', 'translate(0,0)');
    expect(root).toHaveAttribute('opacity', '0.55');
    expect(root).toHaveStyle({ pointerEvents: 'none' });

    fireEvent.mouseDown(root as SVGGElement, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 180, clientY: 160 });
    fireEvent.mouseUp(window);
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1176: excludes the root from the unpositioned count and list while children stay placeable', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[freshRoot, lane, unplacedBin]} onUpdateZone={onUpdateZone} />);

    expect(screen.getByText(/\d+ unpositioned/)).toHaveTextContent('1 unpositioned');
    expect(screen.getByText(/not placed on the floor/)).toHaveTextContent('1 zone not placed on the floor');

    const list = screen.getByText(/^Unpositioned · \d+$/).parentElement as HTMLElement;
    expect(within(list).getByText(/^Unpositioned · \d+$/)).toHaveTextContent('Unpositioned · 1');
    expect(within(list).queryByText('WH-1-ROOT')).not.toBeInTheDocument();

    // Ordinary child zones remain positionable components.
    fireEvent.click(within(list).getByText('BIN-UNPLACED'));
    expect(onUpdateZone).toHaveBeenCalledWith(
      'BIN-UNPLACED',
      { position_x: expect.any(Number), position_y: expect.any(Number) },
    );
  });
});

// ===========================================================================
// GH1176 — existing positioned warehouse roots are preserved
// ===========================================================================
describe('GH1176 — existing positioned warehouse root', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('GH1176: keeps persisted non-zero root and child geometry without re-origining or translation', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const offsetRoot = { ...warehouse, position_x: 5, position_y: 3, width: 20, depth: 15 };
    const child = { ...lane, position_x: 7, position_y: 4 };
    const { container } = render(<CanvasEditor zones={[offsetRoot, child]} onUpdateZone={onUpdateZone} />);

    // 20m x 15m fitted into 1000x500 with a 5% margin per side => 50%.
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());

    expect(container.querySelector('[data-zone-code="ROOT-01"]'))
      .toHaveAttribute('transform', 'translate(150,90)');
    expect(container.querySelector('[data-zone-code="LANE-01"]'))
      .toHaveAttribute('transform', 'translate(210,120)');
    expect(onUpdateZone).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GH1176 — floor-boundary contextual guidance on a fresh warehouse
// ===========================================================================
describe('GH1176 — floor-boundary contextual guidance', () => {
  let rectSpy: jest.SpyInstance;

  const BOUNDARY_TITLE = 'Set your warehouse boundary';
  // Apostrophe style is normalized; the meaning is the contract.
  const BOUNDARY_BODY = /Click Floor settings above, then enter your warehouse Width and Depth\. We.ll use this boundary to place Stock locations, optional aisles, and work areas such as Receiving, Packing and Shipping\./;

  // Fresh root: no position, no Width/Depth yet.
  const freshRoot = zone({
    location_code: 'WH-1-ROOT',
    type: 'warehouse',
    zone_type: null,
    position_x: null,
    position_y: null,
    width: null,
    depth: null,
  });
  // Width/Depth configured, still no persisted position (implicit origin).
  const boundedRoot = { ...freshRoot, width: 12, depth: 10 };

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('GH1176: a fresh root-only canvas guides the merchant to set the warehouse boundary first, without selecting or mutating the root', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<CanvasEditor zones={[freshRoot]} onUpdateZone={onUpdateZone} />);

    // Rendered by the floor canvas itself (root setup context), not a page-level tour.
    const title = within(container).getByText(BOUNDARY_TITLE);
    expect(within(container).getByText(BOUNDARY_BODY)).toBeInTheDocument();

    fireEvent.click(title);
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalledWith('WH-1-ROOT', expect.objectContaining({ position_x: expect.anything() }));
    expect(onUpdateZone).not.toHaveBeenCalledWith('WH-1-ROOT', expect.objectContaining({ position_y: expect.anything() }));
  });

  it('GH1176: guidance is anchored to the Floor settings control and names Width and Depth', () => {
    render(<CanvasEditor zones={[freshRoot]} />);

    const guidance = screen.getByTestId('floor-boundary-guidance');
    const floorSettings = screen.getByRole('button', { name: 'Floor settings' });
    // Associated with the control it coaches — shares its host, not a generic canvas overlay.
    expect(floorSettings.parentElement).toContainElement(guidance);
    expect(guidance).toHaveTextContent('Click Floor settings above');
    expect(guidance).toHaveTextContent('Width');
    expect(guidance).toHaveTextContent('Depth');
    expect(within(guidance).getByRole('button', { name: 'Open Floor settings' })).toBeInTheDocument();
    expect(within(guidance).queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
  });

  it('GH1176: "Open Floor settings" opens the panel and fulfils the guidance without moving the root', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[freshRoot]} onUpdateZone={onUpdateZone} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Floor settings' }));

    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Floor width')).toBeInTheDocument();
    expect(screen.getByLabelText('Floor depth')).toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1176: clicking the Floor settings control directly also fulfils the guidance', () => {
    render(<CanvasEditor zones={[freshRoot]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));

    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
  });

  it('GH1176: X dismisses the guidance without opening Floor settings', () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    render(<CanvasEditor zones={[freshRoot]} onUpdateZone={onUpdateZone} />);

    fireEvent.click(within(screen.getByTestId('floor-boundary-guidance')).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('floor-settings-panel')).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1176: guidance stays visible while the root bounds are incomplete (width set, depth missing)', () => {
    render(<CanvasEditor zones={[{ ...freshRoot, width: 20, depth: null }]} />);

    expect(screen.getByText(BOUNDARY_TITLE)).toBeInTheDocument();
  });

  it('GH1176: guidance is hidden once the root has usable Width/Depth, even with no operational components', () => {
    render(<CanvasEditor zones={[boundedRoot]} />);

    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('floor-boundary-guidance')).not.toBeInTheDocument();
  });

  it('GH1176: boundary guidance is not shown once a positioned non-root operational component exists', () => {
    render(<CanvasEditor zones={[boundedRoot, lane]} />);

    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(BOUNDARY_BODY)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// GH1177 — post-boundary stock-location onboarding
// ===========================================================================
describe('GH1177 — post-boundary stock-location onboarding', () => {
  let rectSpy: jest.SpyInstance;

  const BOUNDARY_TITLE = 'Set your warehouse boundary';
  const STOCK_TITLE = 'Add where you keep your stock';

  const freshRoot = zone({
    location_code: 'WH-1-ROOT',
    type: 'warehouse',
    zone_type: null,
    position_x: null,
    position_y: null,
    width: null,
    depth: null,
  });

  const boundedRoot = {
    ...freshRoot,
    width: 12,
    depth: 10,
  };

  const operationalAreas = [
    zone({
      location_code: 'PACK-01',
      zone_type: 'pack',
      parent_location_code: null,
    }),
    zone({
      location_code: 'RECEIVE-01',
      zone_type: 'receive',
      parent_location_code: null,
    }),
    zone({
      location_code: 'SHIP-01',
      zone_type: 'ship',
      parent_location_code: null,
    }),
  ];

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('keeps boundary guidance authoritative before usable Width and Depth exist', () => {
    render(<CanvasEditor zones={[freshRoot]} />);

    expect(screen.getByText(BOUNDARY_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(STOCK_TITLE)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add stock location' })
    ).not.toBeInTheDocument();
  });

  it('guides a bounded root-only warehouse to add its first stock location', () => {
    render(<CanvasEditor zones={[boundedRoot]} />);

    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText(STOCK_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(/Stock location.*stores.*picks products/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/aisle.*only if/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add stock location' })
    ).toBeInTheDocument();
  });

  it('keeps stock guidance visible when only operational work areas exist', () => {
    render(
      <CanvasEditor zones={[boundedRoot, ...operationalAreas]} />
    );

    expect(screen.getByText(STOCK_TITLE)).toBeInTheDocument();
  });

  it('hides stock guidance once an active stock-holding pick location exists', () => {
    const stock = zone({
      location_code: 'PICK-01',
      type: 'bin',
      zone_type: 'pick',
      active: true,
      parent_location_code: null,
    });

    render(
      <CanvasEditor zones={[boundedRoot, ...operationalAreas, stock]} />
    );

    expect(screen.queryByText(BOUNDARY_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK_TITLE)).not.toBeInTheDocument();
  });

  it.each([
    ['active storage location', 'storage', true, false],
    ['inactive pick location', 'pick', false, true],
  ])(
    'GH1177: stock guidance follows active pick/storage semantics — %s',
    (_caseName, zoneType, active, shouldShowGuidance) => {
      const stock = zone({
        location_code: 'STOCK-01',
        type: 'bin',
        zone_type: zoneType,
        active,
        parent_location_code: null,
      });

      render(
        <CanvasEditor zones={[boundedRoot, stock]} />
      );

      if (shouldShowGuidance) {
        expect(screen.getByText(STOCK_TITLE)).toBeInTheDocument();
      } else {
        expect(screen.queryByText(STOCK_TITLE)).not.toBeInTheDocument();
      }
    }
  );

  it('reuses the existing Stock location inline creation flow from the guidance CTA', () => {
    const onCreateZone = jest.fn().mockResolvedValue(undefined);

    render(
      <CanvasEditor
        zones={[boundedRoot]}
        onCreateZone={onCreateZone}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Add stock location' })
    );

    expect(screen.getAllByLabelText('Location code')).toHaveLength(1);
    expect(screen.getByLabelText('Location code')).toHaveValue('PICK-01');
    expect(onCreateZone).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GH1176 audit — a usable warehouse root, not the 20m x 15m default, sets the
// floor extent (pan bounds, rulers, floor area)
// ===========================================================================
describe('GH1176 — real warehouse bounds replace the 20×15 default', () => {
  let rectSpy: jest.SpyInstance;

  const large = zone({
    location_code: 'WH-BIG',
    type: 'warehouse',
    zone_type: null,
    position_x: null,
    position_y: null,
    width: 120,
    depth: 80,
  });

  function ruler(axis: 'x' | 'y') {
    return within(screen.getByTestId(`floor-ruler-${axis}`));
  }

  function viewportSvg() {
    return screen.getByTestId('floor-plan-viewport').closest('svg') as SVGSVGElement;
  }

  beforeEach(() => {
    rectSpy = mockCanvasRect();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('GH1176: a 120m × 80m root sets the floor area and ruler extents', async () => {
    render(<CanvasEditor zones={[large]} />);
    // 120m x 80m fitted into 1000x500 => 9.375%.
    await waitFor(() => expect(screen.getByText('9%')).toBeInTheDocument());

    expect(screen.getByText(/9600m²/)).toBeInTheDocument();
    expect(screen.queryByText(/300m²/)).not.toBeInTheDocument();
    expect(ruler('x').getByText('120m')).toBeInTheDocument();
    expect(ruler('x').queryByText('122m')).not.toBeInTheDocument();
    expect(ruler('y').getByText('80m')).toBeInTheDocument();
    expect(ruler('y').queryByText('82m')).not.toBeInTheDocument();
  });

  it('GH1176: a 120m × 80m root controls the pan bounds instead of 20m × 15m', async () => {
    render(<CanvasEditor zones={[large]} />);
    await waitFor(() => expect(screen.getByText('9%')).toBeInTheDocument());
    // Fit: 675px x 450px floor centred => translate(162.5,25).
    expect(screen.getByTestId('floor-plan-viewport')).toHaveAttribute('transform', 'translate(162.5,25)');

    // Wheel-pan 400px left. The real floor is 675px wide, so this stays in bounds;
    // a 20m-wide clamp would stop at -12.5.
    fireEvent.wheel(viewportSvg(), { deltaX: 500 });
    expect(screen.getByTestId('floor-plan-viewport')).toHaveAttribute('transform', 'translate(-237.5,25)');
  });

  it('GH1176: a persisted non-zero root origin is preserved and extends the rulers', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const offsetRoot = { ...large, position_x: 4, position_y: 2 };
    const child = { ...lane, position_x: 10, position_y: 10 };
    const { container } = render(<CanvasEditor zones={[offsetRoot, child]} onUpdateZone={onUpdateZone} />);
    await waitFor(() => expect(screen.getByText('9%')).toBeInTheDocument());

    expect(container.querySelector('[data-zone-code="WH-BIG"]')).toHaveAttribute('transform', 'translate(22.5,11.25)');
    expect(screen.getByText(/9600m²/)).toBeInTheDocument();
    expect(ruler('x').getByText('124m')).toBeInTheDocument();
    expect(ruler('x').queryByText('126m')).not.toBeInTheDocument();
    expect(ruler('y').getByText('82m')).toBeInTheDocument();
    expect(ruler('y').queryByText('84m')).not.toBeInTheDocument();
    expect(onUpdateZone).not.toHaveBeenCalled();
  });

  it('GH1176: keeps the 20m × 15m fallback when there is no usable warehouse root', () => {
    render(<CanvasEditor zones={[lane]} />);

    expect(screen.getByText(/300m²/)).toBeInTheDocument();
    expect(ruler('x').getByText('20m')).toBeInTheDocument();
    expect(ruler('x').queryByText('21m')).not.toBeInTheDocument();
    expect(ruler('y').getByText('15m')).toBeInTheDocument();
    expect(ruler('y').queryByText('16m')).not.toBeInTheDocument();

    // Fallback pan clamp: 100px margin minus a 1200px (20m at 100%) floor.
    fireEvent.wheel(viewportSvg(), { deltaX: 2000 });
    expect(screen.getByTestId('floor-plan-viewport')).toHaveAttribute('transform', 'translate(-1100,40)');
  });
});
