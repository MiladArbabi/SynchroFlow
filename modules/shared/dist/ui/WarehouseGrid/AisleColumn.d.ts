import type { WarehouseLocation, BinOccupancy, LiveBinState, GridMode, GridVariant } from './WarehouseGrid.types.js';
/**
 * AisleColumn — one vertical column in the warehouse grid.
 *
 * Derives aisle label from the first bin's location_code prefix
 * (e.g. "A" from "A-1", "A-2"). Bins are ordered by location_code ASC
 * which matches the existing pick-route sort in wms.controller.ts.
 *
 * Each cell = one bin at an aisle/shelf intersection.
 */
interface AisleColumnProps {
    aisleLabel: string;
    bins: WarehouseLocation[];
    occupancy?: Record<string, BinOccupancy>;
    highlightedBins?: Set<string>;
    focusedBins?: Set<string>;
    selectedBin?: string;
    liveActivity?: Record<string, LiveBinState>;
    mode?: GridMode;
    variant?: GridVariant;
    onBinSelect?: (locationCode: string) => void;
}
export declare function AisleColumn({ aisleLabel, bins, occupancy, highlightedBins, focusedBins, selectedBin, liveActivity, mode, variant, onBinSelect, }: AisleColumnProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AisleColumn.d.ts.map