export type LocationType = 'warehouse' | 'lane' | 'shelf' | 'bin';
export type WarehouseZone = {
    location_code: string;
    type: LocationType;
    parent_location_code: string | null;
    barcode: string | null;
    active: boolean;
    children_count: number;
    position_x: number | null;
    position_y: number | null;
    width: number | null;
    depth: number | null;
    orientation: number;
    rack_levels: number | null;
    zone_type: string | null;
    last_printed_at: string | null;
    /** Editable warehouse display name — non-null only on type='warehouse' rows (§10.5) */
    warehouse_name: string | null;
};
/**
 * LiveBinActivity — keyed by location_code.
 * Derived from pick_scan_log last-scan-per-operator aggregation.
 * See overview-live-map-playbook.md §6.4.
 */
export interface LiveBinActivity {
    operatorCount: number;
    hasActivePick: boolean;
}
/**
 * SyntheticStation — virtual apron projected in isometric space,
 * not backed by a warehouse_locations row. Used by Overview live map
 * for order pool (inbound) and shipped-today (outbound) aprons.
 * See overview-live-map-playbook.md §5.
 */
export interface SyntheticStation {
    id: string;
    label: string;
    side: 'inbound' | 'outbound';
    /** Total token stack count. */
    count: number;
    /** Urgent sub-stack count rendered in critical red. */
    urgentCount?: number;
    /** Deep-link on click — passed to onSelect. */
    deepLink?: string;
}
//# sourceMappingURL=IsometricCanvas.types.d.ts.map