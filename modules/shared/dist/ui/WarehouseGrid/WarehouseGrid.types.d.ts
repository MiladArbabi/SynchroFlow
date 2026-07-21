/**
 * WarehouseGrid — Shared type contracts
 * ----------------------------------------
 * Single source of truth for all WarehouseGrid consumers:
 *   modules/floor-planning, modules/wms, modules/demand,
 *   apps/frontend product/order detail pages.
 *
 * Props contract is renderer-agnostic — Phase 3 swaps SvgRenderer
 * for ThreeRenderer without changing these interfaces.
 */
export type WarehouseLocationType = 'warehouse' | 'lane' | 'shelf' | 'bin';
export type WarehouseZoneType = 'pick' | 'pack' | 'receive' | 'ship' | 'returns' | 'quarantine' | 'kitting' | 'storage';
export interface WarehouseLocation {
    location_code: string;
    type: WarehouseLocationType;
    parent_location_code: string | null;
    barcode: string | null;
    active: boolean;
    /** Floor canvas coordinates (metres from top-left origin). Null = not yet positioned. */
    position_x: number | null;
    position_y: number | null;
    /** Physical dimensions in metres */
    width: number | null;
    depth: number | null;
    /** Rotation: 0=north, 90=east, 180=south, 270=west */
    orientation: number;
    /** Vertical shelf levels — drives 3D rack height */
    rack_levels: number | null;
    /** Operational zone — drives colour coding */
    zone_type: WarehouseZoneType | null;
}
export interface BinOccupancy {
    /** Total units on hand across all variants in this bin */
    on_hand_quantity: number;
    variants: BinVariant[];
}
export interface BinVariant {
    lasyncro_variant_id: string;
    sku: string | null;
    product_title: string | null;
    on_hand_quantity: number;
}
export type LiveBinStatus = 'picking' | 'stowing' | 'reserved';
export interface LiveBinState {
    status: LiveBinStatus;
    /** operator display name — shown on grid in full/mini variants */
    operator?: string;
}
export type GridMode = 'map' | 'pick' | 'heatmap' | 'focus';
export type GridVariant = 'full' | 'mini' | 'inline';
export type GridRenderer = 'svg' | 'three';
export interface WarehouseGridProps {
    locations: WarehouseLocation[];
    occupancy?: Record<string, BinOccupancy>;
    highlightedBins?: string[];
    pickPath?: string[];
    focusedBins?: string[];
    liveActivity?: Record<string, LiveBinState>;
    onBinSelect?: (locationCode: string) => void;
    mode?: GridMode;
    variant?: GridVariant;
    renderer?: GridRenderer;
}
/** Bin activity log — returned by GET /floor-planning/bin/:locationCode/log */
export interface BinLogEvent {
    id: string;
    movement_type: string;
    quantity_delta: number;
    event_at: string;
    triggered_by: string | null;
    reference_type: string | null;
    reference_id: string | null;
    sku: string | null;
    operator_name: string | null;
    event_source: 'movement' | 'pick_scan';
}
export interface BinLogResponse {
    location_code: string;
    events: BinLogEvent[];
}
export interface BinStats {
    location_code: string;
    picks_7d: number;
    last_pick_at: string | null;
    last_pick_by: string | null;
    /** Minimum days of stock remaining across all variants in this bin. Null = no velocity data. */
    reorder_in_days: number | null;
}
//# sourceMappingURL=WarehouseGrid.types.d.ts.map