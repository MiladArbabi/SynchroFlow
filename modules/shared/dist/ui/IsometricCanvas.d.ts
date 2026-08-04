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
    packQueueCount?: number;
    /**
     * OV-129: pending stow units keyed by location_code. Rendered as a badge on
     * the bin's top face — work waiting to be put away, distinct from an
     * operator being present (liveActivity). See overview-live-map-playbook §6.4.
     */
    stowPending?: Record<string, number>;
    /**
     * OV-129c: show the live-marker key (stow / pick / pack glyphs with words).
     * Deliberately separate from `showLegend`, which controls the occupancy
     * COLOR-SCALE legend and is false on Overview. A glyph at 6px can remind a
     * user of a label they already learned; it cannot teach one. Without this
     * key the badges are unexplained integers.
     */
    showMarkerKey?: boolean;
    /**
     * OV-129d: floor-wide units awaiting stow, shown in the marker key.
     * Units, not task count — must reconcile with the sum of the badges.
     */
    stowPendingTotal?: number;
    /**
     * OV-131: units physically at a dock, keyed by location_code. Sourced from
     * inventory_units.current_location_code where status='received' — receive_jobs
     * has no location column, and its totals are expected PO quantities rather
     * than observations. See overview-live-map-playbook §6.5.
     */
    receiveAtDock?: Record<string, number>;
    /** OV-131: floor-wide units at dock, for the marker key. */
    receiveAtDockTotal?: number;
    awaitingPackCount?: number;
    /**
     * FP-NULL1: called when the unplaced-zones badge is clicked. Provide on
     * surfaces with a placement affordance (Map tab → Setup Canvas); omit on
     * read-only surfaces (Overview, Display) to render an informational-only
     * badge with no click affordance.
     */
    onUnplacedZonesClick?: () => void;
    /**
     * FP-LEGEND1: which color-scale legend to render in the top-right slot
     * (replaces the old static FACES legend). 'occupancy' shows the 4-tier
     * heatmap scale matching fillOverride's thresholds; 'stockout'/'empty'
     * show their single focusFill color; 'none' or omitted renders no legend.
     * Colors are pulled from the same rgba(var(--zone-x,...)) strings used
     * in IsometricBox's actual paint logic so this can't drift from the
     * real render.
     */
    overlay?: 'occupancy' | 'stockout' | 'empty' | 'none';
    /**
    * FP-SUMMARY1: headline counts rendered top-left, above the
    * unplaced-zones badge (FP-NULL1) if both are present. Replaces the
    * earlier FP-CTRL1 statusLabel string — this is now the primary
    * first-glance answer to "is anything wrong", not secondary status
    * text, so it's passed as structured counts (computed page-side from
    * gridLocations/gridOccupancy — a different array than `zones`, so
    * recomputing here risked the same count-mismatch found during
    * FP-NULL1/FP-SCROLL1 verification) rather than one flat string.
    */
    summaryCounts?: {
        atRisk: number;
        empty: number;
        total: number;
    };
    /**
     * FP-CTRL1: optional manual refresh trigger, rendered in the bottom-right
     * controls cluster alongside zoom/reset/mirror. useFloorPlanning has no
     * auto-refetch (staleTime: 60s, no polling, no refetchOnWindowFocus —
     * "refetch on demand" by design) so this is the only way to pull fresh
     * layout data without a full page reload once the page-level toolbar
     * button (its previous home) was removed.
     */
    onRefresh?: () => void;
}
export declare function IsometricCanvas({ zones, onSelect, filteredCodes, highlightZoneTypes, focusedBins, focusTone, occupancy, showFloor, showBins, initialZoom, initialOffset, autoFit, fitPadding, showLegend, showControls, disablePan, stations, liveActivity, packQueueCount, stowPending, showMarkerKey, stowPendingTotal, receiveAtDock, receiveAtDockTotal, onUnplacedZonesClick, overlay, summaryCounts, onRefresh, }: IsometricCanvasProps): import("react").JSX.Element;
export declare function IsometricZoneView({ zone, width, height }: IsometricZoneViewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=IsometricCanvas.d.ts.map