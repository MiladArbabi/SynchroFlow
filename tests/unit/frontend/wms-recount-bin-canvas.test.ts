jest.mock('../../../modules/wms/src/ui/components/WmsConnectionBadge.js', () => ({
  WmsConnectionBadge: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/PickSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/PackSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/ReceiveSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/StowSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/CountingSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/pages/ReturnSessionPage.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

jest.mock('../../../modules/wms/src/ui/components/WorkTally.js', () => ({
  WorkTally: () => null,
  isAllClear: () => false,
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: () => null,
  ModuleErrorBoundary: ({ children }: { children: unknown }) => children,
  WarehouseGrid: () => null,
}));

import {
  classifyRecountBinAvailability,
  mapRecountPreviewBinsToCanvas,
  type RecountPreviewBin,
} from '../../../modules/wms/src/ui/pages/recountSelection';
import type { WarehouseLocation } from '@lasyncro/shared/ui';

const previewBins: RecountPreviewBin[] = [
  {
    location_code: 'A-01',
    reason: 'negative_on_hand',
    variant_count: 2,
    units: -3,
  },
  {
    location_code: 'B-02',
    reason: 'dormant',
    variant_count: 1,
    units: 4,
  },
];

const gridLocations: WarehouseLocation[] = [
  {
    location_code: 'A-01',
    type: 'bin',
    parent_location_code: 'A',
    barcode: 'LOC-A-01',
    active: true,
    position_x: 1,
    position_y: 2,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 3,
    zone_type: 'pick',
  },
  {
    location_code: 'B-02',
    type: 'bin',
    parent_location_code: 'B',
    barcode: 'LOC-B-02',
    active: true,
    position_x: null,
    position_y: 4,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 2,
    zone_type: 'storage',
  },
  {
    location_code: 'C-03',
    type: 'bin',
    parent_location_code: 'C',
    barcode: 'LOC-C-03',
    active: true,
    position_x: 5,
    position_y: 6,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
  },
];

describe('mapRecountPreviewBinsToCanvas', () => {
  test('classifies only positioned preview bins as canvas-selectable', () => {
    const result = mapRecountPreviewBinsToCanvas(gridLocations, previewBins);

    expect(result.canvasZones.map((zone) => zone.location_code)).toEqual(['A-01']);
    expect(result.selectableCodes.has('A-01')).toBe(true);
    expect(result.fallbackBins.map((bin) => bin.location_code)).toEqual(['B-02']);
    expect(result.selectableCodes.has('C-03')).toBe(false);
  });
});

// RECOUNT-FRESH-NOBINS-40
const rootOnlyLocations: WarehouseLocation[] = [
  {
    location_code: 'WH-1-ROOT',
    type: 'warehouse',
    parent_location_code: null,
    barcode: null,
    active: true,
    position_x: 0,
    position_y: 0,
    width: 12,
    depth: 12,
    orientation: 0,
    rack_levels: null,
    zone_type: 'storage',
  },
];

// CRITICAL: unpositioned bin. position_x/position_y are canvas-placement
// data, not configuration state — a real bin created before it is dragged
// into place on the floor-planning canvas must still count as configured.
const unpositionedBinLocations: WarehouseLocation[] = [
  {
    location_code: 'A-1',
    type: 'bin',
    parent_location_code: 'A',
    barcode: 'LOC-A-1',
    active: true,
    position_x: null,
    position_y: null,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 3,
    zone_type: 'pick',
  },
];

describe('classifyRecountBinAvailability', () => {
  test('FRESH-01: grid resolved to zero locations -> no_bins_configured', () => {
    expect(classifyRecountBinAvailability([], [])).toBe('no_bins_configured');
  });

  test('FRESH-02: root-only warehouse row -> no_bins_configured', () => {
    expect(classifyRecountBinAvailability(rootOnlyLocations, [])).toBe(
      'no_bins_configured'
    );
  });

  test('FRESH-03: a bin exists but preview is empty -> no_suggestions', () => {
    expect(classifyRecountBinAvailability(gridLocations, [])).toBe(
      'no_suggestions'
    );
  });

  test('FRESH-03 unpositioned-bin guard: an unpositioned bin still counts as configured -> no_suggestions, not no_bins_configured', () => {
    expect(
      classifyRecountBinAvailability(unpositionedBinLocations, [])
    ).toBe('no_suggestions');
  });

  test('bins exist and preview has suggestions -> suggestions_available', () => {
    expect(classifyRecountBinAvailability(gridLocations, previewBins)).toBe(
      'suggestions_available'
    );
  });

  // RECOUNT-FRESH-NOBINS-40 correction: `undefined` means the warehouse-grid
  // query has not yet resolved (loading, or errored with no cached data) —
  // useWarehouseGrid's `data` stays undefined until the first successful
  // fetch, and the backend's /floor-planning/grid response always includes
  // `locations` as a real (possibly empty) array once resolved. `undefined`
  // must therefore never be treated as "resolved to zero bins".
  describe('unknown grid state (gridLocations is undefined)', () => {
    test('A: no preview suggestions either -> unknown, not no_bins_configured', () => {
      expect(classifyRecountBinAvailability(undefined, [])).toBe('unknown');
    });

    test('B: preview already has suggestions -> suggestions_available is not suppressed by an unresolved grid', () => {
      expect(classifyRecountBinAvailability(undefined, previewBins)).toBe(
        'suggestions_available'
      );
    });
  });
});
