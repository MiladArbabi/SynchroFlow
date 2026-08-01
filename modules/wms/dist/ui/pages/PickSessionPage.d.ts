/**
 * PICK SESSION PAGE — WEBAPP
 * --------------------------
 * Playbook contract: Brief → location_scan → product_scan → summary → done
 *
 * Per line item — two-scan confirm pattern:
 * 1. Brief        — batch summary (items, units), Start Picking CTA
 * 2. location_scan — ScanInput for bin barcode, client-side match against location_code
 * 3. product_scan  — ScanInput for product barcode, resolved via onResolveBarcode
 * 4. summary       — per-line results (picked vs exception), Pick Complete CTA
 * 5. done          — success state
 *
 * Line items are pre-sorted by optimized pick route — iterate in order.
 * No camera. ScanInput pattern only (USB/BT scanner or manual + Enter).
 * Problem Center called on every exception alongside workflow exception endpoint.
 * Session persistence: ?batchId= URL param managed by WmsModuleFT2 (pendingPickBatchId prop).
 *
 * PICK-AUD-01/02 — BarcodeScanSurface + Camera removed entirely
 * PICK-AUD-03    — Brief screen added
 * PICK-AUD-04    — location_scan phase added (two-scan track per item)
 * PICK-AUD-05    — Summary screen added
 * PICK-AUD-06    — Session persistence via WmsModuleFT2 URL param (pendingPickBatchId)
 * PICK-AUD-07    — All async callbacks use .catch(), no void handler()
 * PICK-AUD-08    — No MUI color= props, sx with var(--accent) tokens throughout
 * PICK-AUD-09    — fontWeight max 600
 * PICK-AUD-10    — Full exception taxonomy from Playbook §3
 * PICK-AUD-11    — onCreateProblemTask called on every exception
 */
export interface LineItem {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    lasyncro_order_id: string;
    sku: string | null;
    product_title: string;
    variant_title: string | null;
    quantity: number;
    location_code: string;
    /** WEB-PICK-UNIT-01: variant image from Shopify sync; null when not synced. */
    image_url: string | null;
    /** WEB-PICK-UNIT-01: stowed LSU- unit IDs for this variant; null on legacy path. */
    unit_ids: string[] | null;
}
export interface ConfirmScanParams {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    location_code: string;
    quantity_confirmed: number;
    scan_source?: 'camera' | 'nfc' | 'usb' | 'bt' | 'manual';
    /** WEB-PICK-UNIT-01: LSU- unit ID from resolver; undefined on legacy barcode path. */
    lasyncro_unit_id?: string;
}
export interface ReportExceptionParams {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    exception_type: string;
    quantity_required: number;
    quantity_found: number;
    notes?: string;
}
export interface CreateProblemTaskParams {
    lasyncro_variant_id: string;
    quantity: number;
    exception_type: string;
    source: 'pick' | 'pack';
}
export interface PickSessionPageProps {
    pickBatchId: string;
    lineItems: LineItem[];
    onComplete: () => void;
    onResolveBarcode: (scannedValue: string) => Promise<{
        lasyncro_variant_id: string;
        lasyncro_unit_id?: string;
    } | null>;
    onConfirmScan: (params: ConfirmScanParams) => Promise<void>;
    onReportException: (params: ReportExceptionParams) => Promise<void>;
    onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
    onPickComplete: () => Promise<void>;
}
export default function PickSessionPage({ pickBatchId, lineItems, onComplete, onResolveBarcode, onConfirmScan, onReportException, onCreateProblemTask, onPickComplete, }: PickSessionPageProps): import("react").JSX.Element | null;
//# sourceMappingURL=PickSessionPage.d.ts.map