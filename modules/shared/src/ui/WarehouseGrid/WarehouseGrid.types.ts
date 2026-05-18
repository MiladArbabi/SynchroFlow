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

export interface WarehouseLocation {
  location_code: string;
  type: WarehouseLocationType;
  parent_location_code: string | null;
  barcode: string | null;
  active: boolean;
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

export type LiveBinStatus =
  | 'picking'   // operator actively picking from this bin
  | 'stowing'   // operator actively stowing into this bin
  | 'reserved'; // reserved for a pending pick batch

export interface LiveBinState {
  status: LiveBinStatus;
  /** operator display name — shown on grid in full/mini variants */
  operator?: string;
}

export type GridMode =
  | 'map'      // Floor Planning — neutral occupancy view
  | 'pick'     // WMS batch — pick path highlighted
  | 'heatmap'  // Demand/WMS overview — occupancy colour scale
  | 'focus';   // Product/PO detail — specific bins highlighted, rest dimmed

export type GridVariant =
  | 'full'    // Primary surface: toolbar, right panel, full canvas
  | 'mini'    // Embedded in detail page: no toolbar, tooltip on click
  | 'inline'; // Card embed: read-only, tappable to expand to mini

export type GridRenderer = 'svg' | 'three'; // 'three' = Phase 3

export interface WarehouseGridProps {
  locations: WarehouseLocation[];
  occupancy?: Record<string, BinOccupancy>;       // keyed by location_code
  highlightedBins?: string[];                      // accent border (pick path bins)
  pickPath?: string[];                             // ordered location_codes for path overlay
  focusedBins?: string[];                          // focus mode: these bins bright, rest dimmed
  liveActivity?: Record<string, LiveBinState>;     // keyed by location_code
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