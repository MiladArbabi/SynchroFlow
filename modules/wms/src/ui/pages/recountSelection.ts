import type {
  WarehouseLocation,
  WarehouseZone,
} from '@lasyncro/shared/ui';

export type RecountPreviewBin = {
  location_code: string;
  reason: 'negative_on_hand' | 'unlocated_sale' | 'dormant';
  variant_count: number;
  units: number;
};

export type RecountBinCanvasSelection = {
  canvasZones: WarehouseZone[];
  fallbackBins: RecountPreviewBin[];
  selectableCodes: Set<string>;
};

export function mapRecountPreviewBinsToCanvas(
  gridLocations: WarehouseLocation[] | undefined,
  previewBins: RecountPreviewBin[]
): RecountBinCanvasSelection {
  const previewByCode = new Map(
    previewBins.map((bin) => [bin.location_code, bin])
  );

  const representedCodes = new Set<string>();

  const canvasZones = (gridLocations ?? [])
    .filter(
      (location) =>
        previewByCode.has(location.location_code) &&
        location.type === 'bin' &&
        location.position_x != null &&
        location.position_y != null
    )
    .map((location): WarehouseZone => {
      representedCodes.add(location.location_code);

      return {
        location_code: location.location_code,
        type: location.type,
        parent_location_code: location.parent_location_code,
        barcode: location.barcode,
        active: location.active,
        children_count: 0,
        position_x: location.position_x,
        position_y: location.position_y,
        width: location.width,
        depth: location.depth,
        orientation: location.orientation,
        rack_levels: location.rack_levels,
        zone_type: location.zone_type,
        dock_face: null,
        last_printed_at: null,
        warehouse_name: null,
      };
    });

  return {
    canvasZones,
    fallbackBins: previewBins.filter(
      (bin) => !representedCodes.has(bin.location_code)
    ),
    selectableCodes: representedCodes,
  };
}

export function toggleRecountBinSelection(
  selectedCodes: string[],
  locationCode: string
): string[] {
  return selectedCodes.includes(locationCode)
    ? selectedCodes.filter((code) => code !== locationCode)
    : [...selectedCodes, locationCode];
}

export function selectAllRecountBins(
  previewBins: Array<{ location_code: string }>
): string[] {
  return [...new Set(previewBins.map((bin) => bin.location_code))];
}
