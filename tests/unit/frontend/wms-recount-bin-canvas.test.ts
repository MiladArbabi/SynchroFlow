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
