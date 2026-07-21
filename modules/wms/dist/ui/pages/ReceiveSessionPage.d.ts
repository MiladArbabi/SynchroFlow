export interface ReceiveJobLine {
    receive_job_line_id: string;
    lasyncro_variant_id: string | null;
    sku: string | null;
    variant_title: string | null;
    description: string | null;
    quantity_expected: number;
    inspection_complete?: boolean;
    quantity_accepted?: number;
    image_url: string | null;
    barcode: string | null;
    product_title: string | null;
}
export interface ReceiveSessionPageProps {
    receiveJobId: string;
    poId: string;
    supplierName: string;
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
        notes?: string;
    }) => Promise<void>;
    onCloseJob: (params: {
        actual_delivery_date?: string;
    }) => Promise<void>;
    onComplete: () => void;
    onResolveBarcode?: (scannedValue: string) => Promise<{
        lasyncro_variant_id: string;
    } | null>;
    onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
}
export default function ReceiveSessionPage({ receiveJobId, supplierName, lines, onInspectLine, onReportException, onCloseJob, onComplete, onResolveBarcode, onPrintUnitLabels, }: ReceiveSessionPageProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=ReceiveSessionPage.d.ts.map