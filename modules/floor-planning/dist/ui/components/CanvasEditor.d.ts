import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';
import { WarehouseLocationType } from '@lasyncro/shared/ui';
interface CanvasEditorProps {
    zones: WarehouseZone[];
    onUpdateZone?: (locationCode: string, payload: {
        position_x?: number | null;
        position_y?: number | null;
        width?: number | null;
        depth?: number | null;
        orientation?: number;
        rack_levels?: number | null;
        zone_type?: string | null;
    }) => Promise<void>;
    onDeleteZone?: (locationCode: string) => Promise<void>;
    onPrintBarcode?: (locationCode: string) => Promise<void>;
    onCreateZone?: (payload: {
        location_code: string;
        type: WarehouseLocationType;
        zone_type?: string;
        position_x?: number;
        position_y?: number;
        width?: number;
        depth?: number;
        rack_levels?: number;
    }) => Promise<void>;
}
export declare function CanvasEditor({ zones, onUpdateZone, onDeleteZone, onCreateZone, onPrintBarcode, }: CanvasEditorProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=CanvasEditor.d.ts.map