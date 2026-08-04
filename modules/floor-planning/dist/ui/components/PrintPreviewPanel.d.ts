/**
 * PrintPreviewPanel — Barcodes tab right panel.
 *
 * Renders a live label sheet preview for barcoded warehouse locations.
 * Supports 4 label formats — each controls grid layout, label dimensions,
 * and @media print page size.
 *
 * Barcode type is Code128 for all formats in Phase 1.
 * Phase 2: user-selectable barcode type per format.
 *
 * Print isolation: #lasyncro-print-sheet is the only element visible
 * during window.print() — all other app chrome is hidden via @media print.
 */
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
interface PrintPreviewPanelProps {
    items: PrintableLabel[];
    formats: LabelFormat[];
    defaultFormatId: string;
    emptyMessage: string;
    onBatchPrint?: (ids: string[], formatId: string) => Promise<Blob | null>;
}
export declare function PrintPreviewPanel({ items, formats, defaultFormatId, emptyMessage, onBatchPrint }: PrintPreviewPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PrintPreviewPanel.d.ts.map