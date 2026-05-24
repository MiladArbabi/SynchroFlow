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
};