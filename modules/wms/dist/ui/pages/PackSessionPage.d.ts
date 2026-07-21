import type { CreateProblemTaskParams } from './PickSessionPage.js';
import type { PackFreeScanResult, PackFreeScanApiResponse } from './WmsModuleFT2.js';
/**
 * PACK SESSION PAGE — WEB-PACK-02
 * --------------------------------
 * Item-centric free-scan surface. Opened by WmsModuleFT2 after the first
 * successful LSU- scan on the operations page.
 *
 * Flow:
 * 1. Mount → auto-trigger invoice + carrier label print
 * 2. Multi-item orders → scan each sibling LSU- barcode
 * 3. All items confirmed → scan LSO- invoice barcode to ship
 * 4. Shipment confirmed → onComplete (returns to pack mode listening state)
 *
 * Guards:
 * - Back-nav: warns when leaving a partially-confirmed multi-item order
 * - LSO- mismatch: rejects wrong invoice barcode with inline error
 * - Cross-order LSU-: rejects unit from a different order
 * - Print failure: non-blocking warning, operator proceeds normally
 */
export interface PackLineItem {
    lasyncro_line_item_id: string;
    lasyncro_order_id: string;
    lasyncro_variant_id: string;
    sku: string | null;
    product_title: string;
    variant_title: string | null;
    quantity: number;
    pack_scanned: boolean;
    has_tracked_unit: boolean;
}
export interface PackOrder {
    lasyncro_order_id: string;
    external_order_id: string;
    wms_barcode: string | null;
    total_price: number;
    currency: string;
    warehouse_status: string;
    line_items: PackLineItem[];
}
export interface PackSessionPageProps {
    initialFreeScanResult: PackFreeScanResult;
    onPackFreeScan: (scannedValue: string) => Promise<PackFreeScanApiResponse>;
    onPackCountConfirm: (params: {
        lasyncro_line_item_id: string;
        lasyncro_variant_id: string;
        quantity_confirmed: number;
    }) => Promise<void>;
    onPrintInvoice: (orderId: string) => Promise<void>;
    onPrintLabel: (orderId: string) => Promise<void>;
    onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
    onComplete: () => void;
}
export default function PackSessionPage({ initialFreeScanResult, onPackFreeScan, onPackCountConfirm, onPrintInvoice, onPrintLabel, onCreateProblemTask, onComplete, }: PackSessionPageProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=PackSessionPage.d.ts.map