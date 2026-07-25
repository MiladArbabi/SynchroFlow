import type { WarehouseLocation, BinOccupancy, BinLogResponse, BinStats, WarehouseLocationType, WarehouseZone } from '@lasyncro/shared/ui';
/**
 * FLOOR PLANNING MODULE — FT2 SURFACE
 * -------------------------------------
 * Manages warehouse floor zones and barcode assignments
 * for floors (locations) and products (variants).
 *
 * All API data injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Data model:
 *   warehouse_locations — location_code, type, barcode (system-generated)
 *   variants + external_product_identity_map — lasyncro_variant_id, sku, supplier barcode
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */
export type { LocationType, WarehouseZone } from '@lasyncro/shared/ui';
export type ProductBarcode = {
    lasyncro_variant_id: string;
    sku: string | null;
    product_title: string;
    variant_title: string | null;
    barcode: string | null;
};
export type FloorPlanningData = {
    zones: WarehouseZone[];
    product_barcodes: ProductBarcode[];
} | null;
export type FloorPlanningPageProps = {
    data: FloorPlanningData;
    isLoading: boolean;
    isError: boolean;
    onRefresh: () => void;
    /** Grid data — loaded separately for fast layout paint */
    gridLocations?: WarehouseLocation[];
    gridOccupancy?: Record<string, BinOccupancy>;
    isGridLoading?: boolean;
    binLog?: BinLogResponse;
    isBinLogLoading?: boolean;
    onBinLogOpen?: (locationCode: string) => void;
    binStats?: BinStats;
    onBinSelect?: (locationCode: string) => void;
    variantFocusBins?: string[];
    onCreateZone?: (payload: {
        location_code: string;
        type: WarehouseLocationType;
        parent_location_code?: string;
    }) => Promise<void>;
    onDeleteZone?: (locationCode: string) => Promise<void>;
    onPrintBarcode?: (locationCode: string) => Promise<Blob>;
    onBatchPrintBarcodes?: (locationCodes: string[], formatId: string) => Promise<Blob>;
    onToggleZoneActive?: (locationCode: string, active: boolean) => Promise<void>;
    onUpdateProductBarcode?: (lasyncroVariantId: string, barcode: string) => Promise<void>;
    /** Controlled tab — gate page syncs to URL search params for persistence across refreshes */
    activeTab?: 'map' | 'setup' | 'barcodes';
    onTabChange?: (tab: 'map' | 'setup' | 'barcodes') => void;
    activeView?: 'list' | 'canvas';
    onViewChange?: (view: 'list' | 'canvas') => void;
    activeSubTab?: 'locations' | 'products';
    onSubTabChange?: (subTab: 'locations' | 'products') => void;
    onUpdateZone?: (locationCode: string, payload: {
        position_x?: number | null;
        position_y?: number | null;
        width?: number | null;
        depth?: number | null;
        orientation?: number;
        rack_levels?: number | null;
        zone_type?: string | null;
    }) => Promise<void>;
};
export default function FloorPlanningModuleFT2(props: FloorPlanningPageProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=FloorPlanningModuleFT2.d.ts.map