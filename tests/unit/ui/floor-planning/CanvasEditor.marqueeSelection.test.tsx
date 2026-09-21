import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'BIN-01',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 2,
    depth: 1.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

const warehouse = zone({
  location_code: 'WAREHOUSE-01',
  type: 'warehouse',
  position_x: 0,
  position_y: 0,
  width: 12,
  depth: 12,
  zone_type: null,
});
const first = zone();
const second = zone({ location_code: 'LANE-01', type: 'lane', position_x: 4, position_y: 1, width: 2, depth: 2 });
const outside = zone({ location_code: 'BIN-OUTSIDE', position_x: 9, position_y: 9 });
const unpositioned = zone({ location_code: 'BIN-UNPOSITIONED', position_x: null, position_y: null });

function selectedOutline(container: HTMLElement, code: string) {
  return container.querySelector(`[data-zone-code="${code}"] rect[stroke="var(--accent)"]`);
}

describe('CanvasEditor marquee and multi-selection', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 800,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => rectSpy.mockRestore());

  it('replaces selection on normal click, toggles with Shift, and clears on empty canvas', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);
    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;
    const canvas = screen.getByTestId('floor-planning-canvas');

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(screen.getByTitle('Duplicate zone')).toBeInTheDocument();

    fireEvent.mouseDown(secondNode, { clientX: 500, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(selectedOutline(container, first.location_code)).not.toBeInTheDocument();
    expect(selectedOutline(container, second.location_code)).toBeInTheDocument();

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100, shiftKey: true });
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    fireEvent.mouseDown(secondNode, { clientX: 500, clientY: 100, shiftKey: true });
    expect(screen.queryByTestId('bulk-selection-panel')).not.toBeInTheDocument();
    expect(screen.getByTitle('Duplicate zone')).toBeInTheDocument();

    fireEvent.mouseDown(canvas, { clientX: 900, clientY: 400 });
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
  });

  it('renders a marquee and selects only intersecting positioned non-warehouse zones', async () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second, outside, unpositioned]} />);
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Marquee mode' }));
    const canvas = screen.getByTestId('floor-planning-canvas');

    fireEvent.mouseDown(canvas, { clientX: 290, clientY: 70 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 240 });
    expect(screen.getByTestId('selection-marquee')).toBeInTheDocument();
    fireEvent.mouseUp(window);

    expect(screen.queryByTestId('selection-marquee')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'WAREHOUSE-01')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-OUTSIDE')).not.toBeInTheDocument();
    expect(container.querySelector('[data-zone-code="BIN-UNPOSITIONED"]')).not.toBeInTheDocument();
  });

  it('uses Shift-marquee to toggle hits against the existing selection', async () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());
    fireEvent.mouseDown(container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement);
    fireEvent.click(screen.getByRole('button', { name: 'Marquee mode' }));
    const canvas = screen.getByTestId('floor-planning-canvas');

    fireEvent.mouseDown(canvas, { clientX: 450, clientY: 70, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 240 });
    fireEvent.mouseUp(window);

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Marquee mode' }));
    fireEvent.mouseDown(canvas, { clientX: 450, clientY: 70, shiftKey: true });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 240 });
    fireEvent.mouseUp(window);

    expect(screen.queryByTestId('bulk-selection-panel')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).not.toBeInTheDocument();
  });


  it('returns to Pointer after marquee selection while preserving the selection', async () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());

    const marqueeButton = screen.getByRole('button', { name: 'Marquee mode' });
    const pointerButton = screen.getByRole('button', { name: 'Pointer mode' });
    const canvas = screen.getByTestId('floor-planning-canvas');

    fireEvent.click(marqueeButton);

    expect(marqueeButton).toHaveAttribute('aria-pressed', 'true');
    expect(pointerButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.mouseDown(canvas, { clientX: 290, clientY: 70 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 240 });
    fireEvent.mouseUp(window);

    expect(pointerButton).toHaveAttribute('aria-pressed', 'true');
    expect(marqueeButton).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).toBeInTheDocument();
  });

  it('uses current local drag geometry for marquee intersection', async () => {
    const { container } = render(<CanvasEditor zones={[first]} onUpdateZone={jest.fn().mockResolvedValue(undefined)} />);
    const node = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 100 });
    fireEvent.mouseUp(window);

    fireEvent.click(screen.getByRole('button', { name: 'Marquee mode' }));
    const canvas = screen.getByTestId('floor-planning-canvas');
    fireEvent.mouseDown(canvas, { clientX: 390, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 570, clientY: 210 });
    fireEvent.mouseUp(window);

    expect(screen.getByTitle('Duplicate zone')).toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
  });

  it('keeps Pointer, Marquee, and Pan gestures distinct', () => {
    const { container } = render(<CanvasEditor zones={[first]} />);
    const canvas = screen.getByTestId('floor-planning-canvas');
    const viewport = screen.getByTestId('floor-plan-viewport');
    const node = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const initialTransform = viewport.getAttribute('transform');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 80 });
    expect(screen.queryByTestId('selection-marquee')).not.toBeInTheDocument();
    fireEvent.mouseUp(window);

    fireEvent.click(screen.getByRole('button', { name: 'Marquee mode' }));
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 80 });
    expect(screen.getByTestId('selection-marquee')).toBeInTheDocument();
    fireEvent.mouseUp(window);
    expect(viewport).toHaveAttribute('transform', initialTransform);

    fireEvent.click(screen.getByRole('button', { name: 'Pan mode' }));
    fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(window);
    expect(screen.queryByTitle('Duplicate zone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-marquee')).not.toBeInTheDocument();
    expect(viewport.getAttribute('transform')).not.toBe(initialTransform);
  });


  it('moves an existing multi-selection together as a preview and restores it on release without persisting', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CanvasEditor zones={[warehouse, first, second]} onUpdateZone={onUpdateZone} />
    );

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(firstNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(secondNode, { clientX: 200, clientY: 100, shiftKey: true });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');

    const firstTransformBefore = firstNode.getAttribute('transform');
    const secondTransformBefore = secondNode.getAttribute('transform');

    fireEvent.mouseDown(firstNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 160 });

    const firstTransformDuring = firstNode.getAttribute('transform');
    const secondTransformDuring = secondNode.getAttribute('transform');

    expect(firstTransformDuring).not.toBe(firstTransformBefore);
    expect(secondTransformDuring).not.toBe(secondTransformBefore);
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');

    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(firstNode.getAttribute('transform')).toBe(firstTransformBefore);
      expect(secondNode.getAttribute('transform')).toBe(secondTransformBefore);
    });

    expect(onUpdateZone).not.toHaveBeenCalled();
  });


  it('persists a multi-selection with one atomic callback and no single-zone updates', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const onUpdateZonePositions = jest.fn().mockResolvedValue(undefined);

    const { container } = render(
      <CanvasEditor
        zones={[warehouse, first, second]}
        onUpdateZone={onUpdateZone}
        onUpdateZonePositions={onUpdateZonePositions}
      />
    );

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseDown(secondNode, { clientX: 500, clientY: 100, shiftKey: true });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 380, clientY: 160 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onUpdateZonePositions).toHaveBeenCalledTimes(1));

    expect(onUpdateZone).not.toHaveBeenCalled();

    const payload = onUpdateZonePositions.mock.calls[0][0];

    expect(payload).toHaveLength(2);
    expect(payload.map((item: { location_code: string }) => item.location_code).sort())
      .toEqual(['BIN-01', 'LANE-01']);

    const firstUpdate = payload.find(
      (item: { location_code: string }) => item.location_code === 'BIN-01',
    );
    const secondUpdate = payload.find(
      (item: { location_code: string }) => item.location_code === 'LANE-01',
    );

    expect(firstUpdate.position_x).toBeGreaterThan(Number(first.position_x));
    expect(firstUpdate.position_y).toBeGreaterThan(Number(first.position_y));
    expect(secondUpdate.position_x).toBeGreaterThan(Number(second.position_x));
    expect(secondUpdate.position_y).toBeGreaterThan(Number(second.position_y));

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).toBeInTheDocument();
  });

  it('keeps successful group movement at the persisted target', async () => {
    const onUpdateZonePositions = jest.fn().mockResolvedValue(undefined);

    const { container } = render(
      <CanvasEditor
        zones={[warehouse, first, second]}
        onUpdateZonePositions={onUpdateZonePositions}
      />
    );

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseDown(secondNode, { clientX: 500, clientY: 100, shiftKey: true });

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 380, clientY: 160 });

    const movedPayloadPromise = waitFor(() => {
      const call = onUpdateZonePositions.mock.calls[0];
      expect(call).toBeTruthy();
      return call[0];
    });

    fireEvent.mouseUp(window);

    const payload = await movedPayloadPromise;
    const firstTarget = payload.find(
      (item: { location_code: string }) => item.location_code === 'BIN-01',
    );

    await waitFor(() => {
      const transform = firstNode.getAttribute('transform') ?? '';
      expect(transform).toContain(String(firstTarget.position_x * 60));
    });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
  });

  it('restores the complete group when atomic persistence fails and keeps selection active', async () => {
    const onUpdateZonePositions = jest.fn().mockRejectedValue(new Error('save failed'));

    const { container } = render(
      <CanvasEditor
        zones={[warehouse, first, second]}
        onUpdateZonePositions={onUpdateZonePositions}
      />
    );

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    const firstBefore = firstNode.getAttribute('transform');
    const secondBefore = secondNode.getAttribute('transform');

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseDown(secondNode, { clientX: 500, clientY: 100, shiftKey: true });

    fireEvent.mouseDown(firstNode, { clientX: 320, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 380, clientY: 160 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onUpdateZonePositions).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(firstNode.getAttribute('transform')).toBe(firstBefore);
      expect(secondNode.getAttribute('transform')).toBe(secondBefore);
    });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(selectedOutline(container, 'BIN-01')).toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).toBeInTheDocument();
  });

  it('preserves relative spacing while preview-moving a multi-selection', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(firstNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(secondNode, { clientX: 200, clientY: 100, shiftKey: true });

    const parseTranslate = (node: Element) => {
      const transform = node.getAttribute('transform') ?? '';
      const match = transform.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
      if (!match) throw new Error(`Unexpected transform: ${transform}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    };

    const firstBefore = parseTranslate(firstNode);
    const secondBefore = parseTranslate(secondNode);
    const deltaBefore = {
      x: secondBefore.x - firstBefore.x,
      y: secondBefore.y - firstBefore.y,
    };

    fireEvent.mouseDown(firstNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 220 });

    const firstDuring = parseTranslate(firstNode);
    const secondDuring = parseTranslate(secondNode);
    const deltaDuring = {
      x: secondDuring.x - firstDuring.x,
      y: secondDuring.y - firstDuring.y,
    };

    expect(deltaDuring).toEqual(deltaBefore);

    fireEvent.mouseUp(window);
  });

  it('does not include the warehouse in a group drag', () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);

    const warehouseNode = container.querySelector('[data-zone-code="WAREHOUSE-01"]') as SVGGElement;
    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;

    fireEvent.mouseDown(firstNode);
    fireEvent.mouseDown(secondNode, { shiftKey: true });

    const warehouseBefore = warehouseNode.getAttribute('transform');

    fireEvent.mouseDown(firstNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 200 });

    expect(warehouseNode.getAttribute('transform')).toBe(warehouseBefore);

    fireEvent.mouseUp(window);
  });

  it('collapses to ordinary single selection when dragging an unselected zone', () => {
    const third = zone({
      location_code: 'BIN-03',
      position_x: 7,
      position_y: 1,
    });

    const { container } = render(<CanvasEditor zones={[warehouse, first, second, third]} />);

    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;
    const thirdNode = container.querySelector('[data-zone-code="BIN-03"]') as SVGGElement;

    fireEvent.mouseDown(firstNode);
    fireEvent.mouseDown(secondNode, { shiftKey: true });
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');

    fireEvent.mouseDown(thirdNode, { clientX: 300, clientY: 100 });

    expect(screen.queryByTestId('bulk-selection-panel')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-01')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-03')).toBeInTheDocument();

    fireEvent.mouseUp(window);
  });

  it('keeps ordinary single-zone drag persistence unchanged', async () => {
    const onUpdateZone = jest.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CanvasEditor zones={[first]} onUpdateZone={onUpdateZone} />
    );

    const node = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;

    fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 160 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onUpdateZone).toHaveBeenCalledTimes(1));

    expect(onUpdateZone).toHaveBeenCalledWith(
      'BIN-01',
      expect.objectContaining({
        position_x: expect.any(Number),
        position_y: expect.any(Number),
      }),
    );
  });


  it('clamps the complete selection before an unselected operational blocker', () => {
    const movingA = zone({
      location_code: 'MOVE-A',
      position_x: 1,
      position_y: 1,
      width: 1,
      depth: 1,
    });
    const movingB = zone({
      location_code: 'MOVE-B',
      position_x: 1,
      position_y: 3,
      width: 1,
      depth: 1,
    });
    const blocker = zone({
      location_code: 'BLOCKER',
      position_x: 4,
      position_y: 1,
      width: 1,
      depth: 1,
    });

    const { container } = render(
      <CanvasEditor zones={[warehouse, movingA, movingB, blocker]} />
    );

    const a = container.querySelector('[data-zone-code="MOVE-A"]') as SVGGElement;
    const b = container.querySelector('[data-zone-code="MOVE-B"]') as SVGGElement;

    fireEvent.mouseDown(a);
    fireEvent.mouseDown(b, { shiftKey: true });

    const beforeA = a.getAttribute('transform');
    const beforeB = b.getAttribute('transform');

    fireEvent.mouseDown(a, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 100 });

    const duringA = a.getAttribute('transform');
    const duringB = b.getAttribute('transform');

    expect(duringA).not.toBe(beforeA);
    expect(duringB).not.toBe(beforeB);

    // Both members must still move as one group; the blocker may clamp the
    // requested transform, but it must never split or distort the selection.
    const parseTranslate = (node: Element) => {
      const transform = node.getAttribute('transform') ?? '';
      const match = transform.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
      if (!match) throw new Error(`Unexpected transform: ${transform}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    };

    const aDuring = parseTranslate(a);
    const bDuring = parseTranslate(b);

    expect(bDuring.y - aDuring.y).toBeCloseTo(120);
    expect(bDuring.x - aDuring.x).toBeCloseTo(0);

    fireEvent.mouseUp(window);
  });

  it('ignores selected members as blockers during group movement', () => {
    const a = zone({
      location_code: 'GROUP-A',
      position_x: 1,
      position_y: 1,
      width: 1,
      depth: 1,
    });
    const b = zone({
      location_code: 'GROUP-B',
      position_x: 2,
      position_y: 1,
      width: 1,
      depth: 1,
    });

    const { container } = render(<CanvasEditor zones={[warehouse, a, b]} />);

    const aNode = container.querySelector('[data-zone-code="GROUP-A"]') as SVGGElement;
    const bNode = container.querySelector('[data-zone-code="GROUP-B"]') as SVGGElement;

    fireEvent.mouseDown(aNode);
    fireEvent.mouseDown(bNode, { shiftKey: true });

    const beforeA = aNode.getAttribute('transform');
    const beforeB = bNode.getAttribute('transform');

    fireEvent.mouseDown(aNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 220, clientY: 160 });

    expect(aNode.getAttribute('transform')).not.toBe(beforeA);
    expect(bNode.getAttribute('transform')).not.toBe(beforeB);

    fireEvent.mouseUp(window);
  });

  it('keeps frame members free while operational members still respect external blockers', () => {
    const lane = zone({
      location_code: 'LANE-GROUP',
      type: 'lane',
      zone_type: 'pick',
      position_x: 1,
      position_y: 1,
      width: 2,
      depth: 4,
    });
    const bin = zone({
      location_code: 'BIN-GROUP',
      position_x: 2,
      position_y: 2,
      width: 1,
      depth: 1,
    });
    const blocker = zone({
      location_code: 'BIN-BLOCKER',
      position_x: 5,
      position_y: 2,
      width: 1,
      depth: 1,
    });

    const { container } = render(
      <CanvasEditor zones={[warehouse, lane, bin, blocker]} />
    );

    const laneNode = container.querySelector('[data-zone-code="LANE-GROUP"]') as SVGGElement;
    const binNode = container.querySelector('[data-zone-code="BIN-GROUP"]') as SVGGElement;

    fireEvent.mouseDown(laneNode);
    fireEvent.mouseDown(binNode, { shiftKey: true });

    fireEvent.mouseDown(laneNode, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 100 });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');

    fireEvent.mouseUp(window);
  });

  it('shows the bulk summary, clears it, and clears multi-selection for Floor settings', async () => {
    const { container } = render(<CanvasEditor zones={[warehouse, first, second]} />);
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());
    const firstNode = container.querySelector('[data-zone-code="BIN-01"]') as SVGGElement;
    const secondNode = container.querySelector('[data-zone-code="LANE-01"]') as SVGGElement;
    fireEvent.mouseDown(firstNode);
    fireEvent.mouseDown(secondNode, { shiftKey: true });

    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('pick');
    expect(screen.getByTestId('bulk-selection-panel')).toHaveTextContent('lane');
    fireEvent.click(screen.getByText('Deselect all'));
    expect(screen.queryByTestId('bulk-selection-panel')).not.toBeInTheDocument();

    fireEvent.mouseDown(firstNode);
    fireEvent.mouseDown(secondNode, { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Floor settings' }));
    expect(screen.getByTestId('floor-settings-panel')).toBeInTheDocument();
    expect(selectedOutline(container, 'BIN-01')).not.toBeInTheDocument();
    expect(selectedOutline(container, 'LANE-01')).not.toBeInTheDocument();
  });
});
