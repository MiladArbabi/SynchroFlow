// tests/unit/ui/products/ProductsFT2Page.map-inspection-wiring.test.tsx
//
// INVENTORY INTELLIGENCE RED-C — Inventory owns spatial inspection on the
// shared IsometricCanvas, through its existing generic props only.
//
// - inspectableLocationCodes: bins with a canonical inventoryInspection record
//   (positive, zero or negative truth). A mapped bin with no record and the
//   warehouse ROOT frame are never inspection targets.
// - knownOccupancyLocationCodes: the inventoryInspection record locations, so
//   the renderer can tell confirmed zero from no record.
// - locationPulseByCode: compact hover plates (identity, On hand, Available,
//   SKU count). The SELECTED code's entry is replaced by a rich pinned plate
//   (identity/type, On hand, Available, Reserved, per-SKU breakdown, truth
//   quality) — same channel, pinned wins over hover inside the canvas.
// - selectedLocationCode / onSelect / onPinnedClose: page-owned selection.
// - No pinnedAction and no mutation callback: the map never Receives, Stows,
//   Recounts, Orders or otherwise mutates Inventory.
//
// Truth-quality vocabulary (location level, precedence top-down):
//   Phantom → Physically empty → Fully reserved → Confirmed
// Not received and No valid pick location are rail context, never plates.
//
// Location codes are deliberately type-neutral (A-01 is the pick bin) so the
// identity/type assertion cannot pass on the code alone. Brief names:
//   PICK-A = A-01, STORAGE-A = B-01 (fully reserved), ZERO-A = Z-01,
//   PHANTOM-A = P-01, UNKNOWN-A = U-01, ROOT = WH-1-ROOT.
//
// Harness follows tests/unit/ui/orders/OrdersFT2Page.map-inspection-wiring.test.tsx
// (captured IsometricCanvas props) and the Inventory commercial-access suite.

import React from 'react';
import { act, render } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockCanvas = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Route: ({ path, element }: { path: string; element: React.ReactNode }) =>
    path === '/' ? <>{element}</> : null,
  Navigate: () => null,
}));

// The module only leases the primary slot; render mapContent so the real
// page-built canvas element mounts.
jest.mock('@lasyncro/products', () => ({
  ProductsModuleFT2: (props: Record<string, unknown>) => (
    <div data-testid="products-module-ft2">{props.mapContent as React.ReactNode}</div>
  ),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  IsometricCanvas: (props: Record<string, unknown>) => {
    mockCanvas(props);
    return null;
  },
}));

jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('components/ExportDrawer', () => ({ ExportDrawer: () => null }));
jest.mock('pages/ft2-pages/ProductsCatalogPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsCostsPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsWmsReadinessPage', () => ({ __esModule: true, default: () => null }));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth', hasResolved: true }),
}));
jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'growth', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: () => ({ allowed: true, reason: 'ALLOWED' }),
  }),
}));

const MOCK_ROOT = 'WH-1-ROOT';

function mockZone(location_code: string, type: string, zone_type: string | null, x: number) {
  return {
    location_code,
    type,
    parent_location_code: type === 'warehouse' ? null : MOCK_ROOT,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: x,
    position_y: 1,
    width: type === 'warehouse' ? 20 : 1,
    depth: type === 'warehouse' ? 10 : 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type,
    last_printed_at: null,
    warehouse_name: type === 'warehouse' ? 'Main' : null,
  };
}

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: {
      zones: [
        mockZone(MOCK_ROOT, 'warehouse', null, 0),
        mockZone('A-01', 'bin', 'pick', 1),
        mockZone('B-01', 'bin', 'storage', 3),
        mockZone('Z-01', 'bin', 'pick', 5),
        mockZone('P-01', 'bin', 'storage', 7),
        mockZone('U-01', 'bin', 'pick', 9),
      ],
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

function variantRow(
  id: string, sku: string, onHand: number, available: number, reserved: number
) {
  return {
    lasyncro_variant_id: id,
    sku,
    product_title: `Product ${sku}`,
    variant_title: `Variant ${sku}`,
    on_hand_quantity: onHand,
    available_quantity: available,
    reserved_quantity: reserved,
  };
}

// Legacy positive-only occupancy (unchanged contract) + additive inspection.
const mockOccupancyResponse = {
  occupancy: {
    'A-01': {
      on_hand_quantity: 12,
      variants: [
        { lasyncro_variant_id: 'v-a', sku: 'SKU-A', product_title: 'Product SKU-A', on_hand_quantity: 8 },
        { lasyncro_variant_id: 'v-b', sku: 'SKU-B', product_title: 'Product SKU-B', on_hand_quantity: 4 },
      ],
    },
    'B-01': {
      on_hand_quantity: 6,
      variants: [{ lasyncro_variant_id: 'v-c', sku: 'SKU-C', product_title: 'Product SKU-C', on_hand_quantity: 6 }],
    },
    'P-01': {
      on_hand_quantity: 2,
      variants: [{ lasyncro_variant_id: 'v-f', sku: 'SKU-F', product_title: 'Product SKU-F', on_hand_quantity: 2 }],
    },
    [MOCK_ROOT]: {
      on_hand_quantity: 5,
      variants: [{ lasyncro_variant_id: 'v-g', sku: 'SKU-G', product_title: 'Product SKU-G', on_hand_quantity: 5 }],
    },
  },
  inventoryInspection: {
    // Normal: 12 on hand / 9 available / 3 reserved, two SKUs → Confirmed.
    'A-01': {
      on_hand_quantity: 12, available_quantity: 9, reserved_quantity: 3,
      variants: [variantRow('v-a', 'SKU-A', 8, 5, 3), variantRow('v-b', 'SKU-B', 4, 4, 0)],
    },
    // Fully reserved: on hand 6, available 0, reserved 6.
    'B-01': {
      on_hand_quantity: 6, available_quantity: 0, reserved_quantity: 6,
      variants: [variantRow('v-c', 'SKU-C', 6, 0, 6)],
    },
    // Physically empty: explicit canonical zero row.
    'Z-01': {
      on_hand_quantity: 0, available_quantity: 0, reserved_quantity: 0,
      variants: [variantRow('v-d', 'SKU-D', 0, 0, 0)],
    },
    // Phantom AND aggregate zero → Phantom wins by precedence.
    'P-01': {
      on_hand_quantity: 0, available_quantity: 2, reserved_quantity: 0,
      variants: [variantRow('v-e', 'SKU-E', -2, 0, 0), variantRow('v-f', 'SKU-F', 2, 2, 0)],
    },
    // ROOT has canonical truth but is a frame — never an inspection target.
    [MOCK_ROOT]: {
      on_hand_quantity: 5, available_quantity: 5, reserved_quantity: 0,
      variants: [variantRow('v-g', 'SKU-G', 5, 5, 0)],
    },
    // U-01 deliberately absent: no canonical truth record.
  },
};

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({ data: mockOccupancyResponse, isLoading: false, isError: false }),
}));

jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: () => ({ isSuccess: true, data: {} }),
}));
jest.mock('pages/products/useProductsFt2Adapter', () => ({
  mapProductsFt2Props: () => ({
    context: {
      period: { from: '2026-08-01', to: '2026-08-31' },
      productsObserved: 10,
      variantsObserved: 12,
      productsWithSkuCount: 12,
      productsWithoutSkuCount: 0,
      statusCounts: null,
    },
    dataFreshness: null,
    outcome: null,
    operationalCounts: null,
  }),
}));
jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => ({
    isSuccess: true,
    data: { sellability: { sellable: 5, blocked: 0, blockedReasons: {} } },
  }),
}));

import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';

type Pulse = { title: string; subtitle?: string; rows: Array<{ label: string; value: string; tone?: string }> };

function lastCanvasProps(): Record<string, any> {
  expect(mockCanvas).toHaveBeenCalled();
  return mockCanvas.mock.calls[mockCanvas.mock.calls.length - 1][0];
}

function pulseFor(code: string): Pulse {
  const pulse = lastCanvasProps().locationPulseByCode?.[code];
  expect(pulse).toBeDefined();
  return pulse as Pulse;
}

function pulseText(pulse: Pulse): string {
  return JSON.stringify(pulse);
}

/** Signed integers in a string, tolerating a typographic minus. */
function numbersIn(text: string): number[] {
  return (text.replace(/[−–]/g, '-').match(/-?\d+/g) ?? []).map(Number);
}

function rowValue(pulse: Pulse, label: RegExp): string {
  const row = pulse.rows.find((r) => label.test(r.label));
  expect(row).toBeDefined();
  return row!.value;
}

function hasRow(pulse: Pulse, label: RegExp): boolean {
  return pulse.rows.some((r) => label.test(r.label));
}

/** The breakdown row that names a SKU (in its label or value). */
function skuRow(pulse: Pulse, sku: string) {
  const row = pulse.rows.find((r) => r.label.includes(sku) || r.value.includes(sku));
  expect(row).toBeDefined();
  return row!;
}

const TRUTH_QUALITY = ['Phantom', 'Physically empty', 'Fully reserved', 'Confirmed'];

function expectTruthQuality(pulse: Pulse, expected: string) {
  const text = pulseText(pulse);
  expect(text).toContain(expected);
  for (const other of TRUTH_QUALITY.filter((q) => q !== expected)) {
    expect(text).not.toContain(other);
  }
  expect(text).not.toMatch(/Not received/i);
  expect(text).not.toMatch(/No valid pick location/i);
}

function select(code: string | null) {
  act(() => { lastCanvasProps().onSelect(code); });
}

beforeEach(() => {
  mockCanvas.mockClear();
  mockNavigate.mockClear();
});

describe('INVENTORY RED-C: inspection targets come from canonical inspection truth', () => {
  it('inspectableLocationCodes = bins with a truth record (positive, zero, negative); never U-01 or ROOT', () => {
    render(<ProductsFT2Page />);
    const props = lastCanvasProps();

    expect(props.enableHoverFocus).toBe(true);
    expect(props.pinnedPulseWidth).toBe(288);
    expect(props.inspectableLocationCodes).toBeInstanceOf(Set);
    expect([...props.inspectableLocationCodes].sort()).toEqual(['A-01', 'B-01', 'P-01', 'Z-01']);
  });

  it('knownOccupancyLocationCodes covers the truth-record bins and excludes the no-record bin', () => {
    render(<ProductsFT2Page />);
    const known: ReadonlySet<string> = lastCanvasProps().knownOccupancyLocationCodes;

    expect(known).toBeInstanceOf(Set);
    for (const code of ['A-01', 'B-01', 'Z-01', 'P-01']) expect(known.has(code)).toBe(true);
    expect(known.has('U-01')).toBe(false);
  });

  it('legacy occupancy is still passed through unchanged', () => {
    render(<ProductsFT2Page />);

    expect(lastCanvasProps().occupancy).toBe(mockOccupancyResponse.occupancy);
  });
});

describe('INVENTORY RED-C: compact hover plates', () => {
  it('a normal location shows identity, On hand, Available and SKU count — no Reserved, no SKU rows', () => {
    render(<ProductsFT2Page />);
    const pulse = pulseFor('A-01');

    expect(pulse.title).toContain('A-01');
    expect(numbersIn(rowValue(pulse, /^on hand$/i))).toContain(12);
    expect(numbersIn(rowValue(pulse, /^available$/i))).toContain(9);
    expect(numbersIn(rowValue(pulse, /sku/i))).toContain(2);

    expect(hasRow(pulse, /^reserved$/i)).toBe(false);
    expect(hasRow(pulse, /^truth$/i)).toBe(false);
    expect(pulse.rows.map((row) => row.label)).toEqual(['On hand', 'Available', 'SKUs']);
    expect(pulseText(pulse)).not.toContain('SKU-A');
    expect(pulseText(pulse)).not.toContain('SKU-B');
  });

  it('no plate is fabricated for a location with no truth record, nor for ROOT', () => {
    render(<ProductsFT2Page />);
    const pulses = lastCanvasProps().locationPulseByCode;

    expect(pulses).toBeDefined();
    expect(pulses['U-01']).toBeUndefined();
    expect(pulses[MOCK_ROOT]).toBeUndefined();
  });
});

describe('INVENTORY RED-C: page-owned selection', () => {
  it('starts unselected; onSelect selects and replaces; onSelect(null) and onPinnedClose clear', () => {
    render(<ProductsFT2Page />);
    expect(lastCanvasProps().selectedLocationCode).toBeNull();

    select('A-01');
    expect(lastCanvasProps().selectedLocationCode).toBe('A-01');

    select('B-01');
    expect(lastCanvasProps().selectedLocationCode).toBe('B-01');

    select(null);
    expect(lastCanvasProps().selectedLocationCode).toBeNull();

    select('A-01');
    act(() => { lastCanvasProps().onPinnedClose(); });
    expect(lastCanvasProps().selectedLocationCode).toBeNull();
  });
});

describe('INVENTORY RED-C: rich pinned plate through the same pulse channel', () => {
  it('selecting A-01 replaces only its entry with identity/type, On hand / Available / Reserved and a per-SKU breakdown', () => {
    render(<ProductsFT2Page />);
    expect(hasRow(pulseFor('A-01'), /^reserved$/i)).toBe(false);

    select('A-01');
    const pinned = pulseFor('A-01');

    expect(pinned.title).toContain('A-01');
    expect(pulseText(pinned)).toMatch(/pick/i); // location type/zone, not in the code
    expect(numbersIn(rowValue(pinned, /^on hand$/i))).toContain(12);
    expect(numbersIn(rowValue(pinned, /^available$/i))).toContain(9);
    expect(numbersIn(rowValue(pinned, /^reserved$/i))).toContain(3);

    const skuA = skuRow(pinned, 'SKU-A');
    const skuB = skuRow(pinned, 'SKU-B');
    expect(pinned.rows).toContainEqual({ label: 'SKU', value: 'On hand · Available · Reserved', tone: 'muted' });
    expect(skuA.value).toBe('8 · 5 · 3');
    expect(skuB.value).toBe('4 · 4 · 0');
    expect(pinned.rows.filter((row) => row.label === 'SKU-A')).toHaveLength(1);
    expect(pinned.rows.filter((row) => row.label === 'SKU-B')).toHaveLength(1);
    expect(pulseText(pinned)).not.toMatch(/\d+ on hand · \d+ available · \d+ reserved/);
    expect(numbersIn(`${skuA.label} ${skuA.value}`.replace('SKU-A', ''))).toContain(8);
    expect(numbersIn(`${skuB.label} ${skuB.value}`.replace('SKU-B', ''))).toContain(4);

    // Other locations stay compact.
    expect(hasRow(pulseFor('B-01'), /^reserved$/i)).toBe(false);
  });
});

describe('INVENTORY RED-C: location truth-quality vocabulary on the pinned plate', () => {
  it('A-01 (normal) omits redundant Confirmed truth', () => {
    render(<ProductsFT2Page />);
    select('A-01');
    expect(hasRow(pulseFor('A-01'), /^truth$/i)).toBe(false);
    expect(pulseText(pulseFor('A-01'))).not.toContain('Confirmed');
  });

  it('B-01 (on hand 6, available 0, reserved 6) → Fully reserved', () => {
    render(<ProductsFT2Page />);
    select('B-01');
    expectTruthQuality(pulseFor('B-01'), 'Fully reserved');
    expect(pulseFor('B-01').rows).toContainEqual({ label: 'Truth', value: 'Fully reserved', tone: 'warning' });
  });

  it('Z-01 (explicit canonical zero) → Physically empty, On hand 0', () => {
    render(<ProductsFT2Page />);
    select('Z-01');
    const pinned = pulseFor('Z-01');
    expectTruthQuality(pinned, 'Physically empty');
    expect(pinned.rows).toContainEqual({ label: 'Truth', value: 'Physically empty', tone: 'muted' });
    expect(numbersIn(rowValue(pinned, /^on hand$/i))).toContain(0);
  });

  it('P-01 (a −2 row, aggregate 0) → Phantom outranks Physically empty; the signed row is shown', () => {
    render(<ProductsFT2Page />);
    select('P-01');
    const pinned = pulseFor('P-01');
    expectTruthQuality(pinned, 'Phantom');
    expect(pinned.rows).toContainEqual({ label: 'Truth', value: 'Phantom', tone: 'critical' });

    const skuE = skuRow(pinned, 'SKU-E');
    expect(numbersIn(`${skuE.label} ${skuE.value}`.replace('SKU-E', ''))).toContain(-2);
  });
});

describe('INVENTORY RED-C: the map never mutates Inventory', () => {
  it('no pinnedAction and no mutation callback, before or after selection', () => {
    render(<ProductsFT2Page />);

    const expectNoMutationSurface = () => {
      const props = lastCanvasProps();
      expect(props.pinnedAction).toBeNull();
      expect(props.onZoneClick).toBeUndefined();
      const callbacks = Object.keys(props).filter((key) => typeof props[key] === 'function');
      for (const key of callbacks) expect(['onSelect', 'onPinnedClose']).toContain(key);
    };

    expectNoMutationSurface();
    if (typeof lastCanvasProps().onSelect === 'function') select('A-01');
    expectNoMutationSurface();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('INVENTORY F1: complete compact variant list', () => {
  it('keeps all 22 variants and long SKUs exactly once with compact quantities', () => {
    const original = mockOccupancyResponse.inventoryInspection['A-01'];
    const variants = Array.from({ length: 22 }, (_, i) =>
      variantRow(`stress-${i}`, `SKU-${i}-${'X'.repeat(80)}`, 1, 1, 0));
    mockOccupancyResponse.inventoryInspection['A-01'] = {
      on_hand_quantity: 22, available_quantity: 22, reserved_quantity: 0, variants,
    };
    try {
      render(<ProductsFT2Page />);
      expect(rowValue(pulseFor('A-01'), /^SKUs$/)).toBe('22');
      expect(pulseFor('A-01').rows).toHaveLength(3);
      select('A-01');
      const pinned = pulseFor('A-01');
      expect(pinned.rows).toHaveLength(26); // Three summary facts, column header, all 22 variants.
      for (const variant of variants) {
        expect(pinned.rows.filter((row) => row.label === variant.sku)).toEqual([
          { label: variant.sku, value: '1 · 1 · 0', tone: 'muted' },
        ]);
      }
      expect(pulseText(pinned)).not.toContain('1 on hand · 1 available · 0 reserved');
      act(() => { lastCanvasProps().onPinnedClose(); });
      expect(pulseFor('A-01').rows).toHaveLength(3);
    } finally {
      mockOccupancyResponse.inventoryInspection['A-01'] = original;
    }
  });
});
