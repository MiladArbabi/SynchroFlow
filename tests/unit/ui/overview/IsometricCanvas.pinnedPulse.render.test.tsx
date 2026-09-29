import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { IsometricCanvas, type SyntheticStation, type WarehouseZone } from '@lasyncro/shared/ui';

function zone(location_code: string, zone_type = 'pick'): WarehouseZone {
  return {
    location_code,
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: location_code === 'B-1' ? 3 : 1,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type,
    last_printed_at: null,
    warehouse_name: null,
  };
}

function floorAnchor(): WarehouseZone {
  return { ...zone('FLOOR'), type: 'warehouse', width: 6, depth: 6, zone_type: 'storage' };
}

function station(overrides: Partial<SyntheticStation> = {}): SyntheticStation {
  return {
    id: 'pool',
    label: 'Order Pool',
    side: 'inbound',
    rank: 1,
    count: 20,
    ...overrides,
  };
}

function physicalOuterGroup(container: HTMLElement, locationCode: string): Element {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`Missing zone label ${locationCode}`);
  const boxGroup = textEl.closest('g');
  if (!boxGroup) throw new Error(`Missing box group for ${locationCode}`);
  return boxGroup;
}

function stationOuterGroup(container: HTMLElement, label: string): Element {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === label
  );
  if (!textEl) throw new Error(`Missing station label ${label}`);
  const plateGroup = textEl.closest('g');
  const outerGroup = plateGroup?.parentElement;
  if (!outerGroup) throw new Error(`Missing station group for ${label}`);
  return outerGroup;
}

const locationPulseByCode = {
  'PROBLEM': {
    title: 'PROBLEM',
    rows: [
      { label: 'On hand', value: '0 units' },
      { label: 'State', value: 'Critical — Open warehouse issue', tone: 'critical' as const },
      { label: 'Open issues', value: '5', tone: 'critical' as const },
    ],
  },
  'B-1': {
    title: 'B-1 · PICK',
    rows: [{ label: 'On hand', value: '2 units' }],
  },
};

const stationPulseById = {
  pool: {
    title: 'ORDER POOL',
    rows: [
      { label: 'Orders', value: '20 ready' },
      { label: 'State', value: 'Ready for release', tone: 'muted' as const },
    ],
  },
};

describe('IsometricCanvas pinned pulse card', () => {
  it('keeps hover/default pinned width at 228 and uses the pinned override for width, flip and left placement', () => {
    const originalObserver = global.ResizeObserver;
    let notifyResize: ResizeObserverCallback;
    global.ResizeObserver = jest.fn().mockImplementation((callback) => {
      notifyResize = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
    const canvas = (width?: number) => (
      <IsometricCanvas zones={[zone('B-1')]} autoFit={false} enableHoverFocus
        locationPulseByCode={locationPulseByCode} pinnedPulseWidth={width} />
    );
    let unmount: (() => void) | undefined;
    try {
      const view = render(canvas(288));
      unmount = view.unmount;
      const resize = (width: number) => act(() => notifyResize([
        { contentRect: { width, height: 600 } } as ResizeObserverEntry,
      ], {} as ResizeObserver));
      resize(1000);
      const group = physicalOuterGroup(view.container, 'B-1');
      fireEvent.mouseEnter(group.parentElement!);
      const card = screen.getByTestId('isometric-pulse-card');
      expect(window.getComputedStyle(card).width).toBe('228px');
      const rightSideLeft = parseFloat(window.getComputedStyle(card).left);
      // Enough room for 228, but not 288, on the right of this fixed anchor.
      resize(rightSideLeft + 228 + 8 + 30);
      expect(parseFloat(window.getComputedStyle(card).left)).toBe(rightSideLeft);
      view.rerender(canvas());
      fireEvent.click(group);
      expect(window.getComputedStyle(card).width).toBe('228px');
      expect(parseFloat(window.getComputedStyle(card).left)).toBe(rightSideLeft);
      view.rerender(canvas(288));
      expect(window.getComputedStyle(card).width).toBe('288px');
      const flippedLeft = parseFloat(window.getComputedStyle(card).left);
      expect(flippedLeft).toBeGreaterThan(8);
      expect(flippedLeft).toBeLessThan(rightSideLeft);
      view.rerender(canvas(348));
      expect(parseFloat(window.getComputedStyle(card).left)).toBeCloseTo(flippedLeft - 60);
    } finally {
      unmount?.();
      global.ResizeObserver = originalObserver;
    }
  });

  it('refreshes pinned bounds after a layout shift without resize/scroll and tracks subsequent events with cleanup', () => {
    const originalObserver = global.ResizeObserver;
    const originalHeight = window.innerHeight;
    let notifyResize: ResizeObserverCallback;
    const disconnect = jest.fn();
    const observe = jest.fn();
    global.ResizeObserver = jest.fn().mockImplementation((callback) => {
      notifyResize = callback;
      return { observe, disconnect };
    });
    let canvasTop = 153.95;
    let canvasHeight = 600;
    const rect = jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: canvasTop, top: canvasTop, bottom: canvasTop + canvasHeight,
      left: 0, right: 1000, width: 1000, height: canvasHeight,
      toJSON: () => ({}),
    }));
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    const longTitle = 'ZONE-' + 'Y'.repeat(40);
    const longLabel = 'SKU-' + 'X'.repeat(44);
    const longValue = 'VALUE-' + 'Z'.repeat(44);
    let unmount: (() => void) | undefined;
    try {
      const rendered = render(
        <div data-testid="page-scroll">
          <IsometricCanvas
            zones={[zone('B-1')]}
            enableHoverFocus
            locationPulseByCode={{ 'B-1': { title: longTitle, rows: [{ label: longLabel, value: longValue }] } }}
          />
        </div>
      );
      unmount = rendered.unmount;
      const svg = rendered.container.querySelector('svg')!;
      expect(observe).toHaveBeenCalledWith(svg);
      const resizeCanvas = () => act(() => notifyResize([
        { target: svg, contentRect: { width: 1000, height: canvasHeight } } as ResizeObserverEntry,
      ], {} as ResizeObserver));
      resizeCanvas();
      const group = physicalOuterGroup(rendered.container, 'B-1');
      fireEvent.mouseEnter(group.parentElement!);
      const hover = screen.getByTestId('isometric-pulse-card');
      const hoverMax = window.getComputedStyle(hover).maxHeight;
      expect(hoverMax).toMatch(/^calc\(/);
      fireEvent.scroll(screen.getByTestId('page-scroll'));
      expect(window.getComputedStyle(hover).maxHeight).toBe(hoverMax);

      // Only viewport position changes: no ResizeObserver, resize or scroll.
      // Opening inspection must measure the new geometry before painting.
      canvasTop = 240;
      rect.mockClear();
      fireEvent.click(group);
      expect(rect).toHaveBeenCalled();
      const card = screen.getByTestId('isometric-pulse-card');
      const top = parseFloat(window.getComputedStyle(card).top);
      const left = window.getComputedStyle(card).left;
      const expectBound = () => {
        const currentTop = parseFloat(window.getComputedStyle(card).top);
        const expected = Math.max(0, Math.min(canvasHeight, Math.max(0, Math.min(canvasTop + canvasHeight, window.innerHeight) - canvasTop)) - currentTop - 8);
        expect(parseFloat(window.getComputedStyle(card).maxHeight)).toBeCloseTo(expected, 5);
      };
      expectBound();
      expect(window.getComputedStyle(card).width).toBe('228px');
      expect(window.getComputedStyle(card).overflowWrap).toBe('anywhere');
      expect(window.getComputedStyle(card).wordBreak).toBe('break-word');
      const body = scrollingAncestorWithin(within(card).getByText(longLabel), card)!;
      expect(window.getComputedStyle(body).overflowY).toBe('auto');
      expect(body.contains(within(card).getByText(longValue))).toBe(true);
      expect(body.contains(within(card).getByText(longTitle))).toBe(false);
      expect(body.contains(within(card).getByRole('button', { name: 'Close map inspection' }))).toBe(false);

      // A nested page scroll does not bubble; the window listener must capture it.
      canvasTop = 200;
      fireEvent.scroll(screen.getByTestId('page-scroll'), { bubbles: false });
      expectBound();
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 680 });
      fireEvent(window, new Event('resize'));
      expectBound();
      expect(parseFloat(window.getComputedStyle(card).top)).toBe(top);
      expect(window.getComputedStyle(card).left).toBe(left);
      canvasHeight = 400;
      resizeCanvas();
      expectBound(); // Viewport below canvas: retain the canvas-relative cap.
      canvasTop = 800;
      fireEvent.scroll(screen.getByTestId('page-scroll'), { bubbles: false });
      expectBound(); // Entire canvas below viewport: non-negative zero bound.

      const scrollListener = add.mock.calls.find(([type, , capture]) => type === 'scroll' && capture === true);
      expect(scrollListener).toBeDefined();
      expect(add).toHaveBeenCalledWith('resize', scrollListener![1]);
      unmount();
      expect(remove).toHaveBeenCalledWith('scroll', scrollListener![1], true);
      expect(remove).toHaveBeenCalledWith('resize', scrollListener![1]);
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      unmount?.();
      global.ResizeObserver = originalObserver;
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
      rect.mockRestore();
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('hover card remains transient without selection', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
      />
    );
    const problem = physicalOuterGroup(container, 'PROBLEM');
    fireEvent.mouseEnter(problem.parentElement!);
    const card = screen.getByTestId('isometric-pulse-card');
    expect(card).toHaveAttribute('data-pinned', 'false');
    expect(within(card).getByText('PROBLEM')).toBeInTheDocument();

    fireEvent.mouseLeave(problem.parentElement!);
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('click pins the same card, mouse leave does not dismiss it, and same-object click deselects it', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
        problemByLocation={{ PROBLEM: 5 }}
        pinnedAction={{ label: 'Open Problem Center →', onClick: jest.fn() }}
      />
    );
    const problem = physicalOuterGroup(container, 'PROBLEM');
    fireEvent.click(problem);
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByText('Critical — Open warehouse issue')).toBeInTheDocument();
    expect(screen.queryByText('State')).not.toBeInTheDocument();
    expect(screen.getByText('Open Problem Center →')).toBeInTheDocument();

    fireEvent.mouseLeave(problem);
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');

    fireEvent.click(problem);
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('selecting another object replaces the pinned card and only one pulse card exists', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem'), zone('B-1')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
        problemByLocation={{ PROBLEM: 5 }}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    expect(within(screen.getByTestId('isometric-pulse-card')).getByText('PROBLEM')).toBeInTheDocument();

    fireEvent.click(physicalOuterGroup(container, 'B-1'));
    const card = screen.getByTestId('isometric-pulse-card');
    expect(within(card).queryByText('PROBLEM')).not.toBeInTheDocument();
    expect(within(card).getByText('B-1 · PICK')).toBeInTheDocument();
    expect(screen.getAllByTestId('isometric-pulse-card')).toHaveLength(1);
  });

  it('close clears selection and pinned card', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        locationPulseByCode={locationPulseByCode}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    fireEvent.click(screen.getByLabelText('Close map inspection'));
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('pinned action callbacks navigate by caller-owned behavior and click itself does not trigger it', () => {
    const action = jest.fn();
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        locationPulseByCode={locationPulseByCode}
        pinnedAction={{ label: 'Open Problem Center →', onClick: action }}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Open Problem Center →'));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('physical no-problem selection has no CTA when caller passes no pinned action', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('B-1')]}
        locationPulseByCode={locationPulseByCode}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'B-1'));
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');
    expect(screen.queryByText('Open Problem Center →')).not.toBeInTheDocument();
  });

  it('pinned station shows order-flow action without replacing operational fill semantics', () => {
    const action = jest.fn();
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchor()]}
        stations={[station()]}
        stationPulseById={stationPulseById}
        operationalStateByStation={{ pool: 'active' }}
        pinnedAction={{ label: 'Open order flow →', onClick: action }}
      />
    );
    const group = stationOuterGroup(container, 'Order Pool');
    fireEvent.click(group);
    expect(screen.getByText('Ready for release')).toBeInTheDocument();
    expect(screen.getByText('20 ready')).toBeInTheDocument();
    expect(screen.getByText('Open order flow →')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open order flow →'));
    expect(action).toHaveBeenCalledTimes(1);

    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--space-azure)');
    expect(topBar.getAttribute('stroke')).toBe('var(--accent)');
  });
});

// ---------------------------------------------------------------------------
// RED-E — pinned plate stays reachable with long / many rows (generic).
// jsdom cannot lay out, so the contract is structural: a bounded card, a
// scrollable body that holds every supplied row, a close control outside that
// scrolling body, and safe breaking for long unbroken strings.
// ---------------------------------------------------------------------------

const SAFE_WRAP_OVERFLOW = ['anywhere', 'break-word'];
const SAFE_WRAP_WORD_BREAK = ['break-word', 'break-all'];

/** overflow-wrap / word-break are inherited: the element or any ancestor up to the card may own them. */
function breaksLongWords(el: Element, card: Element): boolean {
  let node: Element | null = el;
  while (node) {
    const cs = window.getComputedStyle(node);
    if (
      SAFE_WRAP_OVERFLOW.includes(cs.getPropertyValue('overflow-wrap')) ||
      SAFE_WRAP_WORD_BREAK.includes(cs.getPropertyValue('word-break'))
    ) return true;
    if (node === card) return false;
    node = node.parentElement;
  }
  return false;
}

function scrollingAncestorWithin(el: Element, boundary: Element): Element | null {
  let node: Element | null = el.parentElement;
  while (node && node !== boundary) {
    if (['auto', 'scroll'].includes(window.getComputedStyle(node).getPropertyValue('overflow-y'))) return node;
    node = node.parentElement;
  }
  return null;
}

function pinOnly(code: string, pulse: { title: string; rows: Array<{ label: string; value: string }> }) {
  const view = render(
    <IsometricCanvas
      zones={[zone(code)]}
      enableHoverFocus
      locationPulseByCode={{ [code]: pulse }}
    />
  );
  fireEvent.click(physicalOuterGroup(view.container, code));
  const card = screen.getByTestId('isometric-pulse-card');
  expect(card).toHaveAttribute('data-pinned', 'true');
  return card;
}

describe('IsometricCanvas pinned pulse card — long / many rows', () => {
  it('A. many rows: bounded card, scrollable body holding every row, close control outside the scroll body', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ label: `Row label ${i + 1}`, value: `${i + 1} units` }));
    const card = pinOnly('A-1', { title: 'A-1', rows });

    for (const row of rows) expect(within(card).getByText(row.label)).toBeInTheDocument();

    const maxHeight = window.getComputedStyle(card).getPropertyValue('max-height');
    expect(['', 'none']).not.toContain(maxHeight);

    const firstRow = within(card).getByText('Row label 1');
    const lastRow = within(card).getByText('Row label 40');
    const body = scrollingAncestorWithin(firstRow, card);
    expect(body).not.toBeNull();
    expect(body!.contains(lastRow)).toBe(true);

    const close = within(card).getByRole('button', { name: 'Close map inspection' });
    expect(body!.contains(close)).toBe(false);
  });

  it('B. a long unbroken row label wraps safely inside a bounded-width card', () => {
    const longLabel = 'SKU-' + 'X'.repeat(44);
    const card = pinOnly('A-1', { title: 'A-1', rows: [{ label: longLabel, value: '8 units' }] });

    expect(breaksLongWords(within(card).getByText(longLabel), card)).toBe(true);
    expect(['', 'auto']).not.toContain(window.getComputedStyle(card).getPropertyValue('width'));
  });

  it('C. a long unbroken title wraps safely', () => {
    const longTitle = 'ZONE-' + 'Y'.repeat(40);
    const card = pinOnly('A-1', { title: longTitle, rows: [{ label: 'On hand', value: '2 units' }] });

    expect(breaksLongWords(within(card).getByText(longTitle), card)).toBe(true);
  });

  it('D. a short pinned pulse keeps its structure: title, rows and close control', () => {
    const card = pinOnly('B-1', locationPulseByCode['B-1']);

    expect(within(card).getByText('B-1 · PICK')).toBeInTheDocument();
    expect(within(card).getByText('On hand')).toBeInTheDocument();
    expect(within(card).getByText('2 units')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Close map inspection' })).toBeInTheDocument();
  });
});
