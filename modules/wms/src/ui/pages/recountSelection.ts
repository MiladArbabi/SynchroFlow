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

export type RecountBinAvailability =
  | 'no_bins_configured'
  | 'no_suggestions'
  | 'suggestions_available'
  | 'unknown';

/**
 * RECOUNT-FRESH-NOBINS-40: distinguishes "nothing configured yet" from
 * "nothing currently needs reconciliation" — both previously rendered the
 * identical "No suggested bins right now." copy. Bin existence is judged
 * purely by `type === 'bin'`: position_x/position_y are canvas-placement
 * data, not configuration state, so an unpositioned bin still counts as
 * configured. Root (`type: 'warehouse'`) never counts as a bin.
 *
 * `gridLocations === undefined` means the warehouse-grid query has not yet
 * resolved (loading, or errored with no cached data) — useWarehouseGrid's
 * `data` stays undefined until the first successful fetch, and the grid
 * endpoint always returns `locations` as a real, possibly-empty array once
 * resolved. An unresolved grid must never be read as "resolved to zero
 * bins", so it is checked only after ruling out real, already-known
 * suggestions (a merchant with suggestions in hand should see them
 * immediately, not wait on an unrelated, slower-to-resolve query).
 */
export function classifyRecountBinAvailability(
  gridLocations: WarehouseLocation[] | undefined,
  previewBins: RecountPreviewBin[]
): RecountBinAvailability {
  if (previewBins.length > 0) return 'suggestions_available';
  if (gridLocations === undefined) return 'unknown';

  const hasOperationalBin = gridLocations.some(
    (location) => location.type === 'bin'
  );

  return hasOperationalBin ? 'no_suggestions' : 'no_bins_configured';
}
