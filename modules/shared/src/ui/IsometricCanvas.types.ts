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
 * OV-132: derived from active pick_batches. Position comes from the last
 * confirmed scan (pickers) or the pack zone (packers); presence does not.
 * See overview-live-map-playbook.md §6.4.
 */
export interface LiveBinActivity {
  operatorCount: number;
  hasActivePick: boolean;
  /**
   * OV-132: operators at this bin whose freshness exceeds the shop's
   * idle_alert_threshold_minutes. Rendered amber rather than hidden — an
   * operator who stopped moving is the case a merchant most needs to see.
   * Optional so older WarehouseGrid callers remain compatible.
   */
  staleCount?: number;
  /**
   * OV-136: preserve phase counts when multiple operators share a bin.
   * A single status cannot represent one picker and one packer together.
   * Optional so older WarehouseGrid callers remain compatible.
   */
  pickingCount?: number;
  packingCount?: number;
  /**
   * Homogeneous phase when every operator at the bin shares one status.
   * Undefined for mixed picking/packing activity.
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