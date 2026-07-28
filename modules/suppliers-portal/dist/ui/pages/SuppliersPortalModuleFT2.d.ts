/**
 * SUPPLIERS PORTAL MODULE — FT2 SURFACE
 * ---------------------------------------
 * Displays POs (primary) and suppliers list (secondary/bottom).
 *
 * Layout:
 *   1. Open POs — accordion per PO, line items fetched on expand
 *   2. Suppliers — accordion list at bottom
 *
 * Create PO flow:
 *   - Supplier selector with inline "Add new supplier" option
 *   - Dynamic line items (description, qty, optional unit cost)
 *   - Expected delivery date + notes
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 */
export type PurchaseOrderStatus = 'draft' | 'ordered' | 'confirmed' | 'in_production' | 'shipped' | 'partially_received' | 'received' | 'cancelled';
export type PurchaseOrder = {
    id: string;
    supplier_name: string;
    supplier_contact_email: string | null;
    supplier_contact_name: string | null;
    supplier_moq: number | null;
    supplier_on_time_rate: number | null;
    supplier_fill_rate: number | null;
    status: PurchaseOrderStatus;
    expected_delivery_date: string | null;
    actual_delivery_date: string | null;
    line_items_count: number;
    total_units_ordered: number;
    total_units_received: number;
    notes: string | null;
    document_url: string | null;
    created_at: string;
    first_line_description: string | null;
};
export type PoLineItem = {
    id: string;
    lasyncro_variant_id: string | null;
    description: string;
    quantity_ordered: number;
    quantity_received: number;
    unit_cost_cents: number | null;
    sku: string | null;
    image_url: string | null;
    product_title: string | null;
};
export type Supplier = {
    id: number;
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    on_time_rate: number | null;
    fill_rate: number | null;
    defect_rate: number | null;
    total_pos: number;
    active: boolean;
    moq: number | null;
    lead_time_days: number | null;
    open_po_count: number;
};
export type CreateSupplierInput = {
    name: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    moq?: number;
    lead_time_days?: number;
};
export type CreatePoInput = {
    supplier_id: number;
    expected_delivery_date?: string;
    notes?: string;
    line_items: {
        description: string;
        quantity_ordered: number;
        unit_cost_cents?: number;
        lasyncro_variant_id?: string | null;
    }[];
};
export type SourcingRecommendation = {
    id: number;
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    on_time_rate: string | null;
    fill_rate: string | null;
    defect_rate: string | null;
    avg_delivery_days: string | null;
    moq: number | null;
    lead_time_days: number | null;
    score: number;
    exceeds_moq: boolean;
    is_preferred: boolean;
    preference_tier: 1 | 2 | null;
    preference_priority: number | null;
    preference_scope: string | null;
    preference_note: string | null;
};
export type PreferenceRow = {
    id: string;
    supplier_id: number;
    supplier_name: string;
    scope_type: 'variant' | 'product' | 'product_type';
    scope_id: string;
    priority: number;
    note: string | null;
    created_at: string;
    updated_at: string;
};
export type ReorderRequest = {
    id: string;
    lasyncro_variant_id: string;
    sku: string | null;
    title: string | null;
    qty_requested: number;
    source: 'alert' | 'manual';
    created_at: string;
};
export type SupplierAccumulation = {
    supplier_id: number;
    supplier_name: string;
    moq: number | null;
    total_qty: number;
    moq_met: boolean;
    requests: ReorderRequest[];
};
export type SuppliersPortalData = {
    purchase_orders: PurchaseOrder[];
    suppliers: Supplier[];
    never_ordered: {
        lasyncro_variant_id: string;
        sku: string | null;
        title: string;
        product_title: string | null;
        product_id: string | null;
        product_type: string | null;
        has_sku: boolean;
    }[];
    never_ordered_count: number;
} | null;
export type SuppliersPortalPageProps = {
    /** Which half of the Purchasing surface to render. Tab routing lives in the ft2-pages wrapper, not here. */
    view: 'pos' | 'suppliers' | 'sourcing';
    data: SuppliersPortalData;
    isLoading: boolean;
    isError: boolean;
    onRefresh: () => void;
    onFetchLineItems: (poId: string) => Promise<PoLineItem[]>;
    onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, actualDeliveryDate?: string) => Promise<void>;
    onCreateSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
    onUpdateSupplier: (id: number, input: CreateSupplierInput) => Promise<Supplier>;
    onDeleteSupplier: (id: number) => Promise<void>;
    onCreatePo: (input: CreatePoInput) => Promise<void>;
    /** Creates a WMS receive job for a shipped PO. Navigates operator to receive session. */
    onCreateReceiveJob: (poId: string) => Promise<{
        receive_job_id: string;
    }>;
    onSearchVariants: (q: string) => Promise<VariantOption[]>;
    /** Sourcing (Thread C): ranked supplier recommendations for onevariant, fetched on demand. */
    onFetchSourcingRecommendations: (variantId: string, neededQty?: number) => Promise<SourcingRecommendation[]>;
    onFetchPreferences: () => Promise<PreferenceRow[]>;
    onCreatePreference: (input: {
        supplier_id: number;
        scope_type: string;
        scope_id: string;
        priority?: number;
        note?: string;
    }) => Promise<PreferenceRow>;
    onUpdatePreference: (id: string, input: {
        priority?: number;
        note?: string;
    }) => Promise<PreferenceRow>;
    onDeletePreference: (id: string) => Promise<void>;
    onFetchReorderRequests: () => Promise<SupplierAccumulation[]>;
    onCreateReorderRequest: (input: {
        lasyncro_variant_id: string;
        supplier_id: number;
        qty_requested: number;
        source: 'alert' | 'manual';
    }) => Promise<ReorderRequest>;
    onDeleteReorderRequest: (id: string) => Promise<void>;
    onConvertReorderRequests: (supplierId: number) => Promise<{
        po_id: string;
    }>;
    /** §8: set by page after convert survives refetch re-render — cleared by dismiss */
    lastConvertedPoId?: string | null;
    onDismissConvertedPo?: () => void;
    /** Onboarding spotlights — resolved via useSpotlight() at page level */
    spotlights?: {
        neverOrdered: {
            isDismissed: boolean;
            dismiss: () => void;
        };
        alertTriggered: {
            isDismissed: boolean;
            dismiss: () => void;
        };
        accumulator: {
            isDismissed: boolean;
            dismiss: () => void;
        };
        poSendFlow: {
            isDismissed: boolean;
            dismiss: () => void;
        };
    };
    /** When true, auto-opens the Create PO dialog on mount */
    autoOpenCreatePo?: boolean;
    /** Pre-filled line item from demand module handoff */
    prefilledLineItem?: {
        description: string;
        quantity_ordered: number;
        lasyncro_variant_id?: string;
    };
};
type VariantOption = {
    lasyncro_variant_id: string;
    sku: string | null;
    title: string | null;
    unit_cost: number | null;
    image_url: string | null;
    product_title: string | null;
};
export default function SuppliersPortalModuleFT2(props: SuppliersPortalPageProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SuppliersPortalModuleFT2.d.ts.map