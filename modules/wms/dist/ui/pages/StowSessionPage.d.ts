import type { WmsStowTask, WmsStowConfirmResult } from './WmsModuleFT2.js';
/**
 * STOW SESSION PAGE — WEB-STOW-UNIT-01 / STOW-SPLIT-01
 * -----------------------------------------------------
 * Location-first flow with a sticky active bin:
 *
 *   brief → location_scan → item_scan ↺ → complete
 *
 * Location is established before any unit is handled. This mirrors the
 * operator's physical position in the warehouse and allows one task to be
 * split safely across multiple bins.
 *
 * Once active, the location persists across unit confirmations and task
 * advancement until the operator explicitly scans a different bin.
 *
 * STOW-SPLIT-01 — every accepted physical-unit scan commits exactly one unit.
 * There is intentionally no quantity-confirm or review phase: the successful
 * scanner event itself is the operator's placement confirmation.
 */
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
    onConfirmStow: (taskId: string, quantityPlaced: number, lasyncroUnitId?: string) => Promise<WmsStowConfirmResult>;
}
export default function StowSessionPage({ initialTaskId, onComplete, onFetchTasks, onResolveLocation, onAssignLocation, onClaimTask, onResolveBarcode, onConfirmStow, }: StowSessionPageProps): import("react").JSX.Element;
//# sourceMappingURL=StowSessionPage.d.ts.map