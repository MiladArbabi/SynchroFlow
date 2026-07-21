/**
 * BARCODE SCANNER HOOK
 * ---------------------
 * Drives continuous camera-based barcode scanning for WMS pick flow.
 *
 * Features:
 * - Continuous decode loop (~100ms per frame)
 * - Multi-format: Code128, EAN-13, EAN-8, QR, DataMatrix
 * - Torch/flashlight control via MediaTrackConstraints
 * - Camera permission error surfacing
 * - Graceful cleanup on unmount
 *
 * Environmental considerations:
 * - Torch toggle for low-light warehouse conditions
 * - Continuous scan — no tap-to-scan, works one-handed
 * - NotFoundException suppressed — normal between scans
 * - onScan fires once per unique result — debounced by result value
 *
 * Usage:
 *   const { videoRef, isScanning, torchOn, toggleTorch, error } = useBarcodeScanner({ onScan })
 *   <video ref={videoRef} />
 */
export interface UseBarcodeScannnerOptions {
    onScan: (value: string) => void;
    enabled?: boolean;
}
export interface UseBarcannnerResult {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    isScanning: boolean;
    torchSupported: boolean;
    torchOn: boolean;
    toggleTorch: () => void;
    error: string | null;
    restart: () => void;
}
export declare function useBarcodeScanner({ onScan, enabled, }: UseBarcodeScannnerOptions): UseBarcannnerResult;
//# sourceMappingURL=useBarcodeScanner.d.ts.map