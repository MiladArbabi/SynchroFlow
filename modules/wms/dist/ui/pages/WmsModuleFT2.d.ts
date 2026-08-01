import { type LineItem, type ConfirmScanParams, type ReportExceptionParams, type CreateProblemTaskParams } from './PickSessionPage.js';
import { type PackOrder } from './PackSessionPage.js';
import { type ReceiveJobLine } from './ReceiveSessionPage.js';
import type { WarehouseLocation } from '@lasyncro/shared/ui';
import { AddReturnLineInput, CompleteReturnJobInput, ReturnJobDetail, UpdateReturnLineInput } from './ReturnSessionPage.js';
/**
 * WMS MODULE — FT2 SURFACE
 * -------------------------
 * Mobile-optimized pick/pack operator interface.
 *
 * Zones:
 * - Active pick session → PickSessionPage
 * - Active pack session → PackSessionPage
 * - Available/pick_complete batches → action buttons
 * - Empty state → no batches released
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */
export type WmsBatch = {
    pick_batch_id: string;
    status: string;
    total_line_items: number;
    total_units: number;
    units_picked: number;
    units_packed: number;
    picked_by: number | null;
    packed_by: number | null;
    released_at: string;
};
export type WmsData = {
    batches: WmsBatch[];
} | null;
export type WmsStowTask = {
    stow_task_id: string;
    lasyncro_variant_id: string;
    quantity: number;
    location_code: string | null;
    status: 'pending' | 'in_progress';
    trigger: string;
    claimed_by: number | null;
    claimed_at: string | null;
    created_at: string;
    variant_title: string | null;
    sku: string | null;
    product_title: string | null;
    image_url: string | null;
    unit_ids: string[] | null;
};
export type WmsModuleFT2Props = {
    data: WmsData;
    isLoading: boolean;
    isError: boolean;
    gridLocations?: WarehouseLocation[];
    onCreateReceiveJob?: (poId: string) => Promise<{
        receive_job_id: string;
    }>;
    onFetchReceiveJob?: (jobId: string) => Promise<{
        job: {
            po_id: string;
            supplier_name: string;
        };
        lines: ReceiveJobLine[];
    }>;
    onInspectReceiveLine?: (jobId: string, params: {
        lasyncro_variant_id: string | null;
        receive_job_line_id: string;
        quantity_accepted: number;
        quantity_rejected: number;
    }) => Promise<void>;
    onReportReceiveException?: (jobId: string, params: {
        lasyncro_variant_id: string | null;
        receive_job_line_id: string;
        exception_type: string;
        quantity_affected: number;
        notes?: string;
    }) => Promise<void>;
    onCloseReceiveJob?: (jobId: string, params: {
        actual_delivery_date?: string;
    }) => Promise<void>;
    onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
    onClaimBatch: (batchId: string) => Promise<void>;
    onFetchLineItems: (batchId: string) => Promise<LineItem[]>;
    onResolveBarcode: (scannedValue: string) => Promise<{
        lasyncro_variant_id: string;
    } | null>;
    onConfirmScan: (batchId: string, params: ConfirmScanParams) => Promise<void>;
    onReportException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
    onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
    onPickComplete: (batchId: string) => Promise<void>;
    onClaimPack: (batchId: string) => Promise<void>;
    onFetchPackOrders: (batchId: string) => Promise<PackOrder[]>;
    onPackFreeScan: (scannedValue: string) => Promise<PackFreeScanApiResponse>;
    onConfirmPackScan: (batchId: string, params: {
        lasyncro_order_id: string;
        lasyncro_line_item_id: string;
        lasyncro_variant_id: string;
        quantity_confirmed: number;
    }) => Promise<{
        order_complete: boolean;
    }>;
    onReportPackException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
    onPrintLabel: (orderId: string) => Promise<void>;
    onPrintInvoice: (orderId: string) => Promise<void>;
    onPackComplete: (batchId: string) => Promise<void>;
    /** WEB-PACK-02 — item-centric free-scan. Accepts LSU- or LSO- barcode. */
    onConfirmShipment: (batchId: string, orderId: string, partial?: boolean) => Promise<void>;
    onRaisePackDecision: (batchId: string, params: {
        pick_batch_id: string;
        lasyncro_order_id: string;
        lasyncro_line_item_id: string;
        exception_type: 'item_missing' | 'short_pick';
        question: 'ship_partial';
    }) => Promise<{
        id: string;
    }>;
    onPollPackDecision: (requestId: string) => Promise<{
        status: 'pending' | 'approved' | 'rejected';
        partial_shipment: boolean | null;
        note: string | null;
    }>;
    onRefresh: () => void;
    onSessionExit?: () => void;
    /** Stow tasks — pending stock that needs to be put away after receive or cancelled pick */
    stowTasks?: WmsStowTask[];
    onClaimStowTask?: (taskId: string) => Promise<void>;
    onConfirmStow?: (taskId: string, quantityPlaced?: number, lasyncroUnitId?: string) => Promise<void>;
    onFetchStowTasks?: () => Promise<WmsStowTask[]>;
    onResolveLocation?: (scannedValue: string) => Promise<{
        location_code: string;
    } | null>;
    onAssignStowLocation?: (taskId: string, locationCode: string) => Promise<void>;
    onReportStowException?: (taskId: string, params: {
        exception_type: string;
        quantity: number;
        notes?: string;
    }) => Promise<{
        prob_label?: string;
        problem_bin?: string;
    }>;
    isOnline: boolean;
    queuedCount: number;
    /** Pre-fetched receive job from URL handoff (Suppliers → WMS). Auto-enters receive session on mount. */
    pendingReceiveSession?: {
        receiveJobId: string;
        poId: string;
        supplierName: string;
        lines: ReceiveJobLine[];
    } | null;
    /** Stow task ID from URL param — auto-enters stow session on mount. */
    pendingStowTaskId?: string | null;
    /** Called when operator claims a stow task — parent sets URL param for refresh recovery. */
    onStowSessionEnter?: (taskId: string) => void;
    /** Pick batch ID from URL param — auto-enters pick session on mount. */
    pendingPickBatchId?: string | null;
    /** Called when operator enters a pick session — parent sets URL param for refresh recovery. */
    onPickSessionEnter?: (batchId: string) => void;
    /** Pack batch ID from URL param — auto-enters pack session on mount. */
    pendingPackBatchId?: string | null;
    /** Called when operator enters a pack session — parent sets URL param for refresh recovery. */
    onPackSessionEnter?: (batchId: string) => void;
    onFetchReturnJob: (returnJobId: string) => Promise<ReturnJobDetail>;
    onAddReturnLine: (returnJobId: string, input: AddReturnLineInput) => Promise<void>;
    onProcessReturnLine: (returnJobId: string, input: UpdateReturnLineInput) => Promise<void>;
    onCompleteReturnJob: (returnJobId: string, input: CompleteReturnJobInput) => Promise<void>;
    /**
     * Orders sitting in pick_complete batches — picked, no pack claim yet.
     * Powers the "X orders ready to be packed" summary + expandable list,
     * so operators can see which LSU- barcodes to scan without already
     * being mid pack-session. See wms_qa_findings_2026_07_24.md.
     */
    readyToPackOrders?: {
        pick_batch_id: string;
        lasyncro_order_id: string;
        external_order_id: string;
        wms_barcode: string | null;
        line_items: {
            lasyncro_line_item_id: string;
            product_title: string;
            variant_title: string | null;
            sku: string | null;
            quantity: number;
            unit_barcode: string | null;
        }[];
    }[];
    readyToPackCount?: number;
};
export interface PackFreeScanLineItem {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    product_title: string;
    quantity: number;
    image_url: string | null;
    sku: string | null;
    pack_scanned: boolean;
    has_tracked_unit: boolean;
}
/** Shape of POST /wms/pack/free-scan LSU- happy-path response (WEB-PACK-02). */
export interface PackFreeScanResult {
    type: 'unit_resolved';
    pick_batch_id: string;
    lasyncro_unit_id: string;
    lasyncro_order_id: string;
    order_complete: boolean;
    auto_claimed: boolean;
    has_carrier_label: boolean;
    variant: {
        variant_title: string;
        sku: string | null;
        image_url: string | null;
    } | null;
    order: {
        lasyncro_order_id: string;
        external_order_id: string;
        wms_barcode: string | null;
        total_price: number;
        currency: string;
        shipping_name: string | null;
        shipping_address1: string | null;
        shipping_city: string | null;
        shipping_zip: string | null;
        shipping_country_code: string | null;
    } | null;
    line_items: {
        lasyncro_line_item_id: string;
        lasyncro_variant_id: string;
        product_title: string;
        quantity: number;
        image_url: string | null;
        sku: string | null;
        pack_scanned: boolean;
        has_tracked_unit: boolean;
    }[];
}
export type PackFreeScanApiResponse = PackFreeScanResult | {
    type: 'packed';
    lasyncro_order_id: string;
    external_order_id: string;
    pick_batch_id: string;
    batch_complete: boolean;
} | {
    type: 'return';
    lasyncro_order_id: string;
    returnJobId: string;
    status: string;
    isNew: boolean;
    claimedByOther: boolean;
} | {
    error: string;
    message: string;
};
export default function WmsModuleFT2(props: WmsModuleFT2Props): import("react").JSX.Element;
//# sourceMappingURL=WmsModuleFT2.d.ts.map