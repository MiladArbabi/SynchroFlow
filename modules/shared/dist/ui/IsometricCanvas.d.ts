import type { WarehouseZone } from './IsometricCanvas.types.js';
/**
 * Embeddable presentational component — renders a single zone as an isometric box.
 * No pan/zoom/interaction. Intended for product/order detail page embeds.
 * Props:
 *   zone    — the zone to render (must have width, depth, rack_levels)
 *   width   — SVG viewport width in px (default 120)
 *   height  — SVG viewport height in px (default 90)
 */
export interface IsometricZoneViewProps {
    zone: WarehouseZone;
    width?: number;
    height?: number;
}
type FocusTone = 'empty' | 'risk';
export interface IsometricCanvasProps {
    zones: WarehouseZone[];
    onSelect?: (locationCode: string | null) => void;
    filteredCodes?: Set<string>;
    highlightZoneTypes?: Set<string>;
    /** Bin location codes to emphasize; an empty array means focus mode has zero matches. */
    focusedBins?: string[];
    /** Semantic colour applied to bins contained in focusedBins. */
    focusTone?: FocusTone;
    occupancy?: Record<string, {
        on_hand_quantity: number;
    }>;
    showFloor?: boolean;
    showBins?: boolean;
    /** Override default zoom for embedded contexts (default: 0.9) */
    initialZoom?: number;
    /** Override default pan offset for embedded contexts (default: { x:420, y: 120 }) */
    initialOffset?: {
        x: number;
        y: number;
    };
    /** Auto-fit the whole layout to the container on mount/resize/zone-change (default: true) */
    autoFit?: boolean;
    fitPadding?: number;
    /** Hide the FACES opacity legend — false for embedded/overview contexts (default: true) */
    showLegend?: boolean;
    /** Hide zoom/reset/angle controls — false for embedded/overview contexts (default: true) */
    showControls?: boolean;
    /** Disable pan and scroll — true for embedded/overview contexts where autoFit owns positioning (default: false) */
    disablePan?: boolean;
    /**
     * Synthetic apron stations — order pool (inbound) and shipped-today (outbound).
     * Not backed by warehouse_locations. See overview-live-map-playbook.md §5.
     */
    stations?: import('./IsometricCanvas.types.js').SyntheticStation[];
    /**
     * Live picker activity keyed by location_code.
     * Renders operator dot markers on active bins.
     * Populated by useWmsLiveActivity — absent until v2 is wired at page level.
     */
    liveActivity?: Record<string, import('./IsometricCanvas.types.js').LiveBinActivity>;
}
export declare function IsometricCanvas({ zones, onSelect, filteredCodes, highlightZoneTypes, focusedBins, focusTone, occupancy, showFloor, showBins, initialZoom, initialOffset, autoFit, fitPadding, showLegend, showControls, disablePan, stations, liveActivity, }: IsometricCanvasProps): import("react/jsx-runtime").JSX.Element;
export declare function IsometricZoneView({ zone, width, height }: IsometricZoneViewProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=IsometricCanvas.d.ts.map