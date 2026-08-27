import type { WarehouseLocation, WarehouseZone } from '@lasyncro/shared/ui';
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
export declare function mapRecountPreviewBinsToCanvas(gridLocations: WarehouseLocation[] | undefined, previewBins: RecountPreviewBin[]): RecountBinCanvasSelection;
export declare function toggleRecountBinSelection(selectedCodes: string[], locationCode: string): string[];
export declare function selectAllRecountBins(previewBins: Array<{
    location_code: string;
}>): string[];
export type RecountBinAvailability = 'no_bins_configured' | 'no_suggestions' | 'suggestions_available' | 'unknown';
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
export declare function classifyRecountBinAvailability(gridLocations: WarehouseLocation[] | undefined, previewBins: RecountPreviewBin[]): RecountBinAvailability;
//# sourceMappingURL=recountSelection.d.ts.map