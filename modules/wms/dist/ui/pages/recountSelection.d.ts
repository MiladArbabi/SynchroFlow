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
//# sourceMappingURL=recountSelection.d.ts.map