import { act, fireEvent, render, screen } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone, type SyntheticStation } from '@lasyncro/shared/ui';
import { zoomViewportAtCenter, preserveViewport, fitViewport } from '../../../../modules/shared/src/ui/warehouseViewport';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

const root: WarehouseZone = { location_code: 'ROOT', type: 'warehouse', parent_location_code: null,
  barcode: null, active: true, children_count: 0, position_x: 0, position_y: 0,
  width: 120, depth: 80, orientation: 0, rack_levels: null, zone_type: null,
  last_printed_at: null, warehouse_name: null };
let width = 1000, height = 500;
let observers: { element?: Element; callback: ResizeObserverCallback }[];
let originalObserver: typeof ResizeObserver;
beforeEach(() => {
  width = 1000; height = 500; observers = [];
  jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }));
  originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    element?: Element;
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(element: Element) { this.element = element; }
    unobserve() {}
    disconnect() { this.element = undefined; }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => { globalThis.ResizeObserver = originalObserver; jest.restoreAllMocks(); });
function resize(w = width, h = height) {
  width = w; height = h;
  act(() => observers.filter(o => o.element?.tagName.toLowerCase() === 'svg').forEach(o =>
    o.callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver)));
}
function isoState(container: HTMLElement) {
  const svg = container.querySelector('svg[width="100%"]')!;
  const translate = svg.querySelector('g')!.getAttribute('transform')!.match(/translate\(([-\d.e+]+),([-\d.e+]+)\)/)!;
  const points = svg.querySelector('polygon')!.getAttribute('points')!.trim().split(/\s+/).map(p => p.split(',').map(Number));
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { svg, x: Number(translate[1]), y: Number(translate[2]),
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    span: Math.max(...xs) - Math.min(...xs) };
}
function expectContained(container: HTMLElement) {
  const s = isoState(container);
  expect(s.minX + s.x).toBeGreaterThanOrEqual(-0.01);
  expect(s.maxX + s.x).toBeLessThanOrEqual(width + 0.01);
  expect(s.minY + s.y).toBeGreaterThanOrEqual(-0.01);
  expect(s.maxY + s.y).toBeLessThanOrEqual(height + 0.01);
}
it.each([false, true])('S3 isometric contains a large authoritative root with implicit origin=%s without mutating geometry', implicit => {
  const zones = [implicit ? { ...root, position_x: null, position_y: null } : root]; const before = JSON.stringify(zones);
  const { container } = render(<IsometricCanvas zones={zones} />); resize();
  expectContained(container);
  expect(isoState(container).span / 6000).toBeLessThan(0.3);
  expect(JSON.stringify(zones)).toBe(before);
});
it('S3 isometric Reset recalculates fit after zoom, pan and resize', () => {
  const { container } = render(<IsometricCanvas zones={[root]} />); resize();
  fireEvent.click(screen.getByText('+', { exact: true }));
  fireEvent.wheel(isoState(container).svg, { deltaX: 1000 });
  resize(650, 400);
  fireEvent.click(screen.getByText('Reset', { exact: true }));
  expectContained(container);
  expect(isoState(container).span).toBeCloseTo(650 * 0.68);
});
it('S3 isometric automatic views resize continuously, manual views preserve zoom, Reset restores automatic mode', () => {
  const { container, rerender } = render(<IsometricCanvas zones={[root]} />); resize();
  resize(700, 400); expect(isoState(container).span).toBeCloseTo(700 * 0.68);
  fireEvent.click(screen.getByText('+', { exact: true }));
  const manual = isoState(container).span;
  resize(800, 450); expect(isoState(container).span).toBeCloseTo(manual);
  rerender(<IsometricCanvas zones={[{ ...root, width: 140 }]} />);
  expect(isoState(container).span / (220 * 30)).toBeCloseTo(manual / 6000);
  fireEvent.click(screen.getByText('Reset', { exact: true }));
  resize(900, 500); expectContained(container);
});
it.each([false, true])('S3 isometric zoom-out at extreme pan keeps the root reachable with outliers=%s', outlier => {
  const zones = [{ ...root, width: 20, depth: 15 }, ...(outlier ? [{ ...root, location_code: 'LEGACY', type: 'bin' as const, position_x: 10000, width: 1, depth: 1 }] : [])];
  const { container } = render(<IsometricCanvas zones={zones} />); resize();
  for (let i = 0; i < 15; i++) fireEvent.click(screen.getByText('+', { exact: true }));
  fireEvent.wheel(isoState(container).svg, { deltaX: 100000 });
  fireEvent.click(screen.getByText('−', { exact: true }));
  const s = isoState(container);
  expect(s.maxX + s.x).toBeGreaterThan(0);
  expect(s.minX + s.x).toBeLessThan(width);
});
it('S3 isometric disablePan changes are respected in both directions', () => {
  const { container, rerender } = render(<IsometricCanvas zones={[root]} disablePan />); resize();
  const initial = isoState(container).x;
  rerender(<IsometricCanvas zones={[root]} disablePan={false} />);
  fireEvent.wheel(isoState(container).svg, { deltaX: 100 });
  expect(isoState(container).x).not.toBe(initial);
  rerender(<IsometricCanvas zones={[root]} disablePan />);
  const locked = isoState(container).x;
  fireEvent.wheel(isoState(container).svg, { deltaX: 100 });
  fireEvent.mouseDown(isoState(container).svg, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(window, { clientX: 100, clientY: 50 }); fireEvent.mouseUp(window);
  expect(isoState(container).x).toBe(locked);
});
it.each([false, true])('S3 station-only updates obey physicalFloorFirst=%s', physical => {
  const zones = [{ ...root, width: 5, depth: 5 }];
  const station: SyntheticStation = { id: 'queue', label: 'Queue', side: 'inbound', count: 1, rank: 0 };
  const { container, rerender } = render(<IsometricCanvas zones={zones} stations={[station]} fitPhysicalFloorFirst={physical} />); resize(1000, 120);
  const initial = isoState(container).span;
  rerender(<IsometricCanvas zones={zones} stations={[{ ...station, count: 10000 }]} fitPhysicalFloorFirst={physical} />);
  if (physical) expect(isoState(container).span).toBeCloseTo(initial);
  else expect(isoState(container).span).not.toBeCloseTo(initial);
});
it('S3 root owns physical fit despite legacy outliers; rootless/null geometry has finite fallback', () => {
  const { container, rerender } = render(<IsometricCanvas zones={[root]} />); resize();
  const initial = isoState(container).span;
  const legacy = { ...root, location_code: 'LEGACY', type: 'bin' as const, position_x: 10000, width: null, depth: null };
  rerender(<IsometricCanvas zones={[root, legacy]} />);
  expect(isoState(container).span).toBeCloseTo(initial);
  rerender(<IsometricCanvas zones={[{ ...legacy, position_x: 1 }]} />);
  expect(container.querySelector('svg[width="100%"] g')!.getAttribute('transform')).not.toMatch(/NaN|Infinity/);
});
it('S3 editor responds to repeated container/Inspector resize and preserves manual framing', () => {
  const zones = [{ ...root, width: 10, depth: 5 }];
  render(<CanvasEditor zones={zones} />); resize();
  resize(600, 400); expect(screen.getByText('90%')).toBeInTheDocument();
  resize(800, 400); expect(screen.getByText('120%')).toBeInTheDocument();
  fireEvent.click(screen.getByText('+', { exact: true }));
  resize(700, 400); expect(screen.getByText('135%')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Reset', { exact: true }));
  expect(screen.getByText('105%')).toBeInTheDocument();
});

it('S3 zoom anchors the drawable world center and resize preserves it', () => {
  const bounds = { minX: 0, maxX: 6000, minY: 0, maxY: 6000 };
  const initial = { zoom: 1, offset: { x: -1000, y: -1000 } };
  const zoomed = zoomViewportAtCenter(initial, -0.15, { w: 1000, h: 500 }, bounds, 0.3, 3, 100);
  expect((500 - zoomed.offset.x) / zoomed.zoom).toBeCloseTo(1500);
  expect((250 - zoomed.offset.y) / zoomed.zoom).toBeCloseTo(1250);
  const resized = preserveViewport(zoomed, { w: 1000, h: 500 }, { w: 800, h: 400 }, bounds, 100);
  expect((400 - resized.offset.x) / resized.zoom).toBeCloseTo(1500);
  expect((200 - resized.offset.y) / resized.zoom).toBeCloseTo(1250);
  expect(fitViewport(bounds, { w: 0, h: 0 }, 3)).toBeNull();
});
it('S3 isometric fits in-root height and refits automatic root geometry changes', () => {
  const small = { ...root, width: 5, depth: 5 };
  const rack = { ...root, location_code: 'TALL', type: 'bin' as const, position_x: 1, position_y: 1, width: 1, depth: 1, rack_levels: 20 };
  const { container, rerender } = render(<IsometricCanvas zones={[small, rack]} />); resize();
  const state = isoState(container);
  for (const polygon of state.svg.querySelectorAll('polygon')) {
    for (const point of polygon.getAttribute('points')!.trim().split(/\s+/)) {
      const [x, y] = point.split(',').map(Number);
      expect(x + state.x).toBeGreaterThanOrEqual(-0.01);
      expect(x + state.x).toBeLessThanOrEqual(width + 0.01);
      expect(y + state.y).toBeGreaterThanOrEqual(-0.01);
      expect(y + state.y).toBeLessThanOrEqual(height + 0.01);
    }
  }
  rerender(<IsometricCanvas zones={[root]} />); expectContained(container);
  expect(isoState(container).span).toBeCloseTo(1000 * 0.68);
});
it('S3 embedded navigation retains physical-floor reservation and wheel pass-through', () => {
  const { container } = render(<IsometricCanvas zones={[root]} disablePan showControls={false}
    fitPhysicalFloorFirst apronReserveRatio={0.22} fitPadding={0.88} />); resize();
  expect(isoState(container).span).toBeCloseTo(1000 * 0.78 * 0.88);
  expect(screen.queryByText('Reset', { exact: true })).not.toBeInTheDocument();
  const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
  act(() => { isoState(container).svg.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
});
it('S3 editor zoom-out at extreme pan remains reachable and Shift-wheel stays horizontal', () => {
  render(<CanvasEditor zones={[{ ...root, width: 20, depth: 15 }]} />); resize();
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByText('+', { exact: true }));
  const viewport = screen.getByTestId('floor-plan-viewport');
  const svg = viewport.closest('svg')!;
  fireEvent.wheel(svg, { deltaX: 100000 });
  fireEvent.click(screen.getByText('−', { exact: true }));
  const [x, y] = viewport.getAttribute('transform')!.match(/translate\(([-\d.e+]+),([-\d.e+]+)\)/)!.slice(1).map(Number);
  const zoom = Number(screen.getByText(/^[0-9]+%$/).textContent!.replace('%', '')) / 100;
  expect(x + 20 * 60 * zoom).toBeGreaterThan(0);
  fireEvent.wheel(svg, { deltaY: -100, shiftKey: true });
  const shifted = viewport.getAttribute('transform')!.match(/translate\(([-\d.e+]+),([-\d.e+]+)\)/)!.slice(1).map(Number);
  expect(shifted[0]).not.toBe(x); expect(shifted[1]).toBe(y);
});


it.each(['background', 'location'] as const)('S3 correction: no-motion isometric %s click retains automatic resize fitting', target => {
  const bin = { ...root, location_code: 'BIN', type: 'bin' as const, position_x: 2, position_y: 2, width: 1, depth: 1, rack_levels: 1 };
  const onSelect = jest.fn();
  const { container } = render(<IsometricCanvas zones={[root, bin]} enableHoverFocus onSelect={onSelect} />);
  resize();
  const clicked = target === 'location'
    ? container.querySelector('[aria-label="Inspect location BIN"] polygon')!
    : isoState(container).svg;
  fireEvent.mouseDown(clicked, { clientX: 500, clientY: 250 });
  fireEvent.mouseMove(window, { clientX: 500, clientY: 250 });
  fireEvent.mouseUp(window, { clientX: 500, clientY: 250 });
  fireEvent.click(clicked);
  if (target === 'location') expect(onSelect).toHaveBeenLastCalledWith('BIN');
  else expect(onSelect).not.toHaveBeenCalled();
  resize(600, 400);
  expect(isoState(container).span).toBeCloseTo(600 * 0.68);
  expectContained(container);
  if (target === 'location') expect(container.querySelector('[aria-label="Inspect location BIN"]')).toHaveAttribute('aria-pressed', 'true');
});

it('S3 correction: no-motion editor Pan click retains automatic resize fitting', () => {
  render(<CanvasEditor zones={[{ ...root, width: 10, depth: 5 }]} />); resize();
  fireEvent.click(screen.getByRole('button', { name: 'Pan mode' }));
  const svg = screen.getByTestId('floor-plan-viewport').closest('svg')!;
  fireEvent.mouseDown(svg, { clientX: 500, clientY: 250 });
  fireEvent.mouseMove(window, { clientX: 500, clientY: 250 });
  fireEvent.mouseUp(window, { clientX: 500, clientY: 250 });
  resize(600, 400);
  expect(screen.getByText('90%')).toBeInTheDocument();
});

it('S3 correction: real isometric panning changes framing and preserves zoom after resize', () => {
  const { container } = render(<IsometricCanvas zones={[root]} />); resize();
  const before = isoState(container);
  fireEvent.mouseDown(before.svg, { clientX: 500, clientY: 250 });
  fireEvent.mouseMove(window, { clientX: 550, clientY: 280 });
  fireEvent.mouseUp(window);
  expect(isoState(container).x).toBeCloseTo(before.x + 50);
  expect(isoState(container).y).toBeCloseTo(before.y + 30);
  resize(600, 400);
  expect(isoState(container).span).toBeCloseTo(before.span);
});

it('S3 correction: real editor panning changes framing and preserves zoom after resize', () => {
  render(<CanvasEditor zones={[{ ...root, width: 10, depth: 5 }]} />); resize();
  fireEvent.click(screen.getByRole('button', { name: 'Pan mode' }));
  const viewport = screen.getByTestId('floor-plan-viewport');
  const before = viewport.getAttribute('transform');
  fireEvent.mouseDown(viewport.closest('svg')!, { clientX: 500, clientY: 250 });
  fireEvent.mouseMove(window, { clientX: 550, clientY: 280 });
  fireEvent.mouseUp(window);
  expect(viewport.getAttribute('transform')).not.toBe(before);
  resize(600, 400);
  expect(screen.getByText('150%')).toBeInTheDocument();
});
