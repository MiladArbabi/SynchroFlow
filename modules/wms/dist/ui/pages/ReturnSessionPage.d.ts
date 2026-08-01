export type ReturnItemCondition = 'resellable' | 'repackable' | 'damaged' | 'unsellable';
export type ReturnJobLine = {
    lasyncro_refund_line_item_id: string;
    refunded_quantity: number;
    item_condition: ReturnItemCondition | null;
    quantity_received: number | null;
    processed_at: string | null;
    variant_title: string | null;
    sku: string | null;
};
export type ReturnJobDetail = {
    return_job_id: string;
    origin: 'customer_return' | 'undelivered_return';
    status: string;
    external_order_id: string | null;
    total_refund_amount: string;
    created_at: string;
    lines: ReturnJobLine[];
};
export interface AddReturnLineInput {
    scannedValue: string;
    quantityReceived: number;
    itemCondition: ReturnItemCondition;
    conditionNotes?: string;
}
export interface UpdateReturnLineInput {
    lineId: string;
    itemCondition: ReturnItemCondition;
    quantityReceived: number;
    conditionNotes?: string;
}
export interface CompleteReturnJobInput {
    returnReason?: string;
    returnNotes?: string;
}
export interface ReturnSessionPageProps {
    returnJobId: string;
    onFetchReturnJob: (returnJobId: string) => Promise<ReturnJobDetail>;
    onAddReturnLine: (returnJobId: string, input: AddReturnLineInput) => Promise<void>;
    onProcessReturnLine: (returnJobId: string, input: UpdateReturnLineInput) => Promise<void>;
    onCompleteReturnJob: (returnJobId: string, input: CompleteReturnJobInput) => Promise<void>;
    onComplete: () => void;
}
export default function ReturnSessionPage({ returnJobId, onFetchReturnJob, onAddReturnLine, onProcessReturnLine, onCompleteReturnJob, onComplete, }: ReturnSessionPageProps): import("react").JSX.Element;
//# sourceMappingURL=ReturnSessionPage.d.ts.map