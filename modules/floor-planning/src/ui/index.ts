// modules/floor-planning/src/ui/index.ts
export { default as FloorPlanningModuleFT2 } from './pages/FloorPlanningModuleFT2.js';
export type { FloorPlanningPageProps, FloorPlanningData, WarehouseZone, ProductBarcode, LocationType } from './pages/FloorPlanningModuleFT2.js';
// SHOP-REVIEW-BARCODE-PRINT-05: the host app's Floor Planning gate page builds
// PrintSubmitResult values for the barcode print callbacks.
export type { PrintSubmitResult, PrintFallbackReason } from './components/PrintPreviewPanel.js';
export { default } from './ModuleEntry.js';
export { IsometricZoneView } from './components/IsometricCanvas.js';
export type { IsometricZoneViewProps } from './components/IsometricCanvas.js';