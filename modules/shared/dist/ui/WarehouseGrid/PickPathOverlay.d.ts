import type { GridVariant } from './WarehouseGrid.types.js';
export interface PickPathOverlayProps {
    pickPath: string[];
    /** All bin location codes in the grid, sorted as rendered */
    allBins: Map<string, string[]>;
    variant?: GridVariant;
}
export declare function PickPathOverlay({ pickPath, allBins, variant }: PickPathOverlayProps): import("react").JSX.Element | null;
//# sourceMappingURL=PickPathOverlay.d.ts.map