import type { WmsStowTask } from './WmsModuleFT2.js';
/**
 * STOW SESSION PAGE — WEB-STOW-UNIT-01
 * --------------------------------------
 * Option B flow — item-first, system-guided location:
 *
 *   brief → item_scan → location_scan → qty_confirm → summary → complete
 *
 * Node 1 (item_scan): Operator scans LSU- barcode. Resolver confirms variant
 *   match. Product image + details shown for visual confirmation.
 *
 * Node 2 (location_scan): System shows suggested bin from stow task.
 *   Operator walks there and scans bin barcode to confirm. Claim fires here.
 *
 * Node 3 (qty_confirm): Operator confirms quantity placed. Shortfall triggers
 *   exception dialog before summary.
 *
 * Bulk stow: scanning one LSU- and confirming qty=N updates all N matching
 * received units (same variant + job line) to stowed in one backend pass.
 *
 * Legacy path: if no LSU- available, legacy EAN/UPC resolves via
 * legacy_barcode_fallback_enabled. lasyncroUnitId will be undefined —
 * backend handles gracefully.
 */
export type StowExceptionResult = {
    prob_label?: string;
    problem_bin?: string;
};
export type BarcodeResolveResult = {
    lasyncro_variant_id: string;
    lasyncro_unit_id?: string;
    unit_status?: string;
};
export interface StowSessionPageProps {
    initialTaskId: string;
    onComplete: () => void;
    onFetchTasks: () => Promise<WmsStowTask[]>;
    onResolveLocation: (scannedValue: string) => Promise<{
        location_code: string;
    } | null>;
    onAssignLocation: (taskId: string, locationCode: string) => Promise<void>;
    onClaimTask: (taskId: string) => Promise<void>;
    onResolveBarcode: (scannedValue: string) => Promise<BarcodeResolveResult | null>;
    onConfirmStow: (taskId: string, quantityPlaced: number, lasyncroUnitId?: string) => Promise<void>;
    onReportException: (taskId: string, params: {
        exception_type: string;
        quantity: number;
        notes?: string;
        lasyncro_unit_id?: string;
    }) => Promise<StowExceptionResult>;
}
export default function StowSessionPage({ initialTaskId, onComplete, onFetchTasks, onResolveLocation, onAssignLocation, onClaimTask, onResolveBarcode, onConfirmStow, onReportException, }: StowSessionPageProps): import("react").JSX.Element | null;
//# sourceMappingURL=StowSessionPage.d.ts.map