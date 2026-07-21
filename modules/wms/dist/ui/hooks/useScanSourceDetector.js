// modules/wms/src/ui/hooks/useScanSourceDetector.ts
//
// SCAN SOURCE DETECTOR (WMS-USB-01)
// ----------------------------------
// Heuristic: hardware scanners (USB/BT) emit full barcode strings
// in <100ms total — far faster than human typing.
//
// Detection method:
// - Record timestamp of first keystroke in current input sequence
// - On Enter (scan complete), measure elapsed time
// - < SCANNER_THRESHOLD_MS → 'usb' (hardware scanner)
// - >= SCANNER_THRESHOLD_MS → 'manual' (human typing)
//
// Note: Camera scans bypass this detector entirely —
// they call handleBarcodeInput directly with source='camera'.
import { useRef, useCallback } from 'react';
const SCANNER_THRESHOLD_MS = 100;
export function useScanSourceDetector() {
    const firstKeystrokeAt = useRef(null);
    const onInputChange = useCallback(() => {
        // Record time of first character in this input sequence
        if (firstKeystrokeAt.current === null) {
            firstKeystrokeAt.current = Date.now();
        }
    }, []);
    const detectSourceAndReset = useCallback(() => {
        const start = firstKeystrokeAt.current;
        firstKeystrokeAt.current = null; // reset for next scan
        if (start === null)
            return 'manual';
        const elapsed = Date.now() - start;
        return elapsed < SCANNER_THRESHOLD_MS ? 'usb' : 'manual';
    }, []);
    const reset = useCallback(() => {
        firstKeystrokeAt.current = null;
    }, []);
    return { onInputChange, detectSourceAndReset, reset };
}
//# sourceMappingURL=useScanSourceDetector.js.map