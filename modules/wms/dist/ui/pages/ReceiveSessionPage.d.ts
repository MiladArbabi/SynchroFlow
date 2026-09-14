export interface ReceiveJobLine {
    receive_job_line_id: string;
    lasyncro_variant_id: string | null;
    sku: string | null;
    variant_title: string | null;
    description: string | null;
    quantity_expected: number;
    quantity_accepted?: number;
    quantity_rejected?: number;
    quantity_sellable_provisional?: number | null;
    reconciliation_started_at?: string | null;
    inspection_complete?: boolean;
    image_url: string | null;
    barcode: string | null;
    product_title: string | null;
    barcode_ready?: boolean;
    barcode_readiness_reason?: 'not_inspected' | 'no_accepted_units' | 'external_barcode' | 'labels_acknowledged' | 'labels_outstanding' | 'unit_evidence_mismatch';
    awaiting_label_ack?: boolean;
    accepted_unit_count?: number;
    labelled_unit_count?: number;
    reported_problems?: ReceiveReportedProblem[];
    reconciliation?: {
        expected: number;
        sellable: number;
        accounted: number;
        unaccounted: number;
        allocations: ReceiveReportedProblem[];
    };
}
export interface ReceiveReportedProblem {
    receive_exception_id: string;
    exception_type: ProblemType | string;
    quantity_affected: number;
    notes?: string | null;
    resolved?: boolean;
    raised_at?: string | null;
    counts_toward_shortfall?: boolean;
}
export interface ReceiveSessionPageProps {
    receiveJobId: string;
    poId: string;
    supplierName: string;
    closedAt?: string | null;
    actualDeliveryDate?: string | null;
    lines: ReceiveJobLine[];
    onInspectLine: (params: {
        lasyncro_variant_id: string | null;
        receive_job_line_id: string;
        quantity_accepted: number;
        quantity_rejected: number;
    }) => Promise<void>;
    onReportException: (params: {
        lasyncro_variant_id: string | null;
        receive_job_line_id: string;
        exception_type: string;
        quantity_affected: number;
        accounting_role?: string;
        notes?: string;
    }) => Promise<void>;
    onPersistLineProgress?: (receiveJobLineId: string, params: {
        quantity_sellable_provisional: number;
        reconciliation_required?: boolean;
    }) => Promise<void>;
    onCloseJob: (params: {
        actual_delivery_date?: string;
    }) => Promise<void>;
    onComplete: () => void;
    onResolveBarcode?: (scannedValue: string) => Promise<{
        lasyncro_variant_id: string;
    } | null>;
    onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
    onConfirmUnitLabelsPrinted: (receiveJobLineId: string) => Promise<void>;
    onRefresh?: () => Promise<void> | void;
}
type ProblemType = 'defect' | 'packaging_damage' | 'wrong_item' | 'wrong_variant' | 'wrong_quantity' | 'missing_item' | 'extra_item' | 'barcode_mismatch' | 'other';
export default function ReceiveSessionPage({ receiveJobId, poId, supplierName, closedAt, actualDeliveryDate, lines, onInspectLine, onReportException, onPersistLineProgress, onCloseJob, onComplete, onResolveBarcode, onPrintUnitLabels, onConfirmUnitLabelsPrinted, onRefresh, }: ReceiveSessionPageProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ReceiveSessionPage.d.ts.map