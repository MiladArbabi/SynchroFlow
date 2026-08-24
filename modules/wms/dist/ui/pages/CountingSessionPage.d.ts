export type CountingSkipReason = 'bin_inaccessible' | 'stock_in_motion' | 'bin_not_found' | 'other';
export type CountingTask = {
    recount_task_id: string;
    label: string;
    status: 'draft' | 'dispatched' | 'claimed' | 'counting' | 'manual_review';
    scope: string;
    blind: boolean;
    assigned_to: number | null;
    claimed_by: number | null;
    created_at: string;
    claimed_at: string | null;
    line_count: number;
    counted_count: number;
};
export type CountingFindingType = 'unexpected_item' | 'product_defect' | 'packaging_defect';
export type CountingFinding = {
    recount_finding_id: string;
    recount_task_id: string;
    recount_line_id: string | null;
    lasyncro_variant_id: string;
    location_code: string;
    finding_type: CountingFindingType;
    quantity: number;
    notes: string | null;
    reported_by: number | null;
    reported_at: string;
};
export type CountingLine = {
    recount_line_id: string;
    lasyncro_variant_id: string;
    location_code: string;
    counted_quantity: number | null;
    count_method: 'unit_scan' | 'bin_quantity' | null;
    scan_count: number | null;
    counted_at: string | null;
    skip_reason: CountingSkipReason | null;
    skipped_at: string | null;
    product_title: string | null;
    variant_title: string | null;
    sku: string | null;
    image_url: string | null;
};
export type CountingSessionPageProps = {
    task: CountingTask;
    onComplete: (finishedLabel?: string) => void;
    onFetchLines: (taskId: string) => Promise<CountingLine[]>;
    onFetchFindings: (taskId: string) => Promise<CountingFinding[]>;
    onCreateFinding: (taskId: string, params: {
        client_event_id: string;
        recount_line_id?: string | null;
        lasyncro_variant_id: string;
        location_code: string;
        finding_type: CountingFindingType;
        quantity: number;
        notes?: string;
    }) => Promise<CountingFinding>;
    onClaimTask: (taskId: string) => Promise<void>;
    onResolveBarcode: (scannedValue: string) => Promise<{
        lasyncro_variant_id: string;
    } | null>;
    onRecordCount: (taskId: string, lineId: string, params: {
        counted_quantity: number;
        count_method: 'unit_scan' | 'bin_quantity';
    }) => Promise<void>;
    onSkipLine: (taskId: string, lineId: string, params: {
        skip_reason: CountingSkipReason;
        notes?: string;
    }) => Promise<void>;
    onCloseTask: (taskId: string) => Promise<void>;
};
export default function CountingSessionPage({ task, onComplete, onFetchLines, onFetchFindings, onCreateFinding, onClaimTask, onResolveBarcode, onRecordCount, onSkipLine, onCloseTask, }: CountingSessionPageProps): import("react").JSX.Element;
//# sourceMappingURL=CountingSessionPage.d.ts.map