import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('respects minimum and maximum zoom constraints', () => {
    expect(fitWarehouseToViewport({ ...warehouse, width: 1000, depth: 1000 }, 300, 200)?.zoom).toBe(0.3);
    expect(fitWarehouseToViewport({ ...warehouse, width: 0.1, depth: 0.1 }, 300, 200)?.zoom).toBe(3);
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
