export interface LabelFormat {
    id: string;
    label: string;
    labelsPerSheet: number;
    columns: number;
    labelWidthMm: number;
    labelHeightMm: number;
    paperSize: 'A4' | '4x6' | '1x2' | 'thermal';
}
/**
 * One printable label, decoupled from any particular row shape.
 *
 * `id` is the batch-print lookup key — location_code for locations,
 * lasyncro_variant_id for products. It is deliberately separate from `code`:
 * httpBatchPrintProductBarcodes looks variants up by id, not by barcode.
 */
export interface PrintableLabel {
    id: string;
    code: string;
    caption: string;
}
/**
 * SHOP-REVIEW-BARCODE-PRINT-05 — why QZ silent dispatch did not happen.
 * Mirrors PrintFallbackReason in apps/frontend/src/utils/qzPrint.ts. Kept as a
 * local type so the module has no dependency on the host app.
 */
export type PrintFallbackReason = 'no_default_printer' | 'qz_unavailable' | 'qz_failed';
/**
 * Outcome of a caller's batch-print submission. The caller owns the HTTP call
 * and the (optional) QZ dispatch; the panel owns the resulting UI.
 *   dispatched — QZ Tray accepted the job for `printerName`
 *   browser    — a printable PDF exists; render durable Open/Download controls
 *   empty      — server had nothing printable in the selection (400/404)
 *   error      — any other failure; message is already UI-safe if present
 */
export type PrintSubmitResult = {
    outcome: 'dispatched';
    printerName: string;
} | {
    outcome: 'browser';
    blob: Blob;
    reason: PrintFallbackReason;
} | {
    outcome: 'empty';
} | {
    outcome: 'error';
    message?: string;
};
interface PrintPreviewPanelProps {
    items: PrintableLabel[];
    formats: LabelFormat[];
    defaultFormatId: string;
    emptyMessage: string;
    onBatchPrint?: (ids: string[], formatId: string) => Promise<PrintSubmitResult>;
}
export declare function PrintPreviewPanel({ items, formats, defaultFormatId, emptyMessage, onBatchPrint }: PrintPreviewPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PrintPreviewPanel.d.ts.map