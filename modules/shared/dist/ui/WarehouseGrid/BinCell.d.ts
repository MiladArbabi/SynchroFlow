import type { BinOccupancy, LiveBinState, GridMode, GridVariant } from './WarehouseGrid.types.js';
/**
 * BinCell — single bin in the warehouse grid.
 *
 * States (priority order):
 *   live     — pick/stow in progress (pulsing indicator)
 *   selected — solid accent border, triggers right panel in 'full' variant
 *   focused  — bright; used in 'focus' mode (product/PO detail)
 *   dimmed   — non-focused bins in 'focus' mode
 *   occupied — has stock (green alpha fill)
 *   empty    — no stock (var(--bg-3) fill)
 *
 * Colour tokens: CSS variables only — no hardcoded hex.
 */
interface BinCellProps {
    locationCode: string;
    occupancy?: BinOccupancy;
    isHighlighted?: boolean;
    isSelected?: boolean;
    isFocused?: boolean;
    isDimmed?: boolean;
    liveState?: LiveBinState;
    mode?: GridMode;
    variant?: GridVariant;
    onClick?: (locationCode: string) => void;
}
export declare function BinCell({ locationCode, occupancy, isHighlighted, isSelected, isFocused, isDimmed, liveState, mode, variant, onClick, }: BinCellProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=BinCell.d.ts.map