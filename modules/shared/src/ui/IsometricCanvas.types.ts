// Shared warehouse zone type — used by IsometricCanvas, FloorPlanning, Demand, and future modules.
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
  /**
   * Phase of the batch currently active at this bin, joined from
   * activeBatches (pick_batches.status) via pick_scan_log.pick_batch_id.
   * Optional for backward compatibility with callers that only know
   * "someone is here" (e.g. WarehouseGrid) without batch phase.
   * See overview-live-map-playbook.md §6.4 (OV-14).
   */
  status?: 'picking' | 'packing';
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
  /**
   * Screen rail the apron docks to, resolved in isometric screen space by
   * IsometricCanvas (OV-13): 'inbound' → right of the slab, 'outbound' → left.
   * NOT a world-axis hint — see the stationPlacements comment for why.
   */
  side: 'inbound' | 'outbound';
  /** Total token stack count. */
  count: number;
  /** Urgent sub-stack count rendered in critical red. */
  urgentCount?: number;
  /** Deep-link on click — passed to onSelect. */
  deepLink?: string;
}