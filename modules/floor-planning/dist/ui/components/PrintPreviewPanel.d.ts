import type { WarehouseZone } from '@lasyncro/shared/ui';
interface PrintPreviewPanelProps {
    selectedZones: WarehouseZone[];
    onBatchPrint?: (locationCodes: string[], formatId: string) => Promise<Blob | null>;
}
export declare function PrintPreviewPanel({ selectedZones, onBatchPrint }: PrintPreviewPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=PrintPreviewPanel.d.ts.map