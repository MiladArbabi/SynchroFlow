/**
 * BARCODE SCAN SURFACE
 * ---------------------
 * Mobile-optimized camera viewfinder for warehouse scanning.
 *
 * Features:
 * - Full-width camera feed
 * - Targeting reticle overlay
 * - Torch toggle (low-light warehouse support)
 * - Permission/device error states with recovery
 * - Disabled state (between scans, awaiting confirmation)
 *
 * Props:
 * - onScan: called with raw scanned string value
 * - enabled: pause scanning while processing confirmation
 * - hint: instruction shown below reticle (e.g. "Scan item barcode")
 */
/**
 * SCAN SOURCE TYPE
 * ----------------
 * Physical input method that produced a scan event.
 * Declared here as the authoritative UI-layer definition.
 * Mirrors scan_source column in inventory_movements.
 */
export type ScanSource = 'camera' | 'nfc' | 'usb' | 'bt' | 'manual';
export interface BarcodeScanSurfaceProps {
    onScan: (value: string, source: ScanSource) => void;
    enabled?: boolean;
    hint?: string;
}
export declare function BarcodeScanSurface({ onScan, enabled, hint, }: BarcodeScanSurfaceProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=BarcodeScanSurface.d.ts.map