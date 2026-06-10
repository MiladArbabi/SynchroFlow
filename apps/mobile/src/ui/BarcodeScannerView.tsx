// apps/mobile/src/ui/BarcodeScannerView.tsx
//
// UNIFIED BARCODE SCANNER CAMERA VIEW
// -------------------------------------
// Single camera implementation used across all scanning surfaces:
//   - ReceiveJobScreen (scan mode)
//   - ScannerScreen (universal scanner tab)
//   - Any future scanning surface
//
// Features:
//   - Dynamic bounds overlay — frame tracks actual barcode position
//   - Static centered guide when no barcode detected
//   - Auto-dismissing inline error banner (no blocking Alert)
//   - Manual entry fallback (bottom sheet)
//   - Vibration feedback (success / error patterns)
//   - Per-value 1500ms debounce to suppress duplicate reads (consecutive different values pass through immediately)
//   - Camera permission handling
//
// CHANGE CONTROL: Any modification to this component affects ALL scanning
// surfaces. Test on both ReceiveJobScreen and ScannerScreen after changes.

import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';

export type BarcodeScanEvent = {
  data: string;
  bounds?: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
};

export type BarcodeScannerViewProps = {
  /** Called when a barcode is successfully scanned. Return an error string to show inline error, or void for success. */
  onScan: (event: BarcodeScanEvent) => Promise<string | void>;
  /** Hint text below the static viewfinder. Defaults to 'Scan product barcode' */
  hint?: string;
  /** Optional overlay rendered above the camera (e.g. HUD, progress bar) */
  overlay?: React.ReactNode;
  /** Hide built-in manual entry (ScanDock provides its own persistent path) */
  hideManualEntry?: boolean;
};

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];
// Per-value debounce — same barcode within this window is a duplicate read.
// Different values pass through immediately (consecutive LSU- unit scans).
const DEBOUNCE_MS = 1500;
const ERROR_DISMISS_MS = 2000;

export function BarcodeScannerView({ 
  onScan, 
  hint = 'Scan product barcode', 
  overlay, 
  hideManualEntry = false 
}: BarcodeScannerViewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // Tracks last decoded value + timestamp for per-value duplicate suppression.
  const lastScanRef = useRef<{ value: string; ts: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [detectedBounds, setDetectedBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setScanError(msg);
    Vibration.vibrate(VIBRATION_ERROR);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setScanError(null), ERROR_DISMISS_MS);
  }, []);

  const handleBarcodeScanned = useCallback(async (event: BarcodeScanEvent) => {
    // Always update bounds for visual overlay
    if (event.bounds) {
      setDetectedBounds({
        x: event.bounds.origin.x,
        y: event.bounds.origin.y,
        width: event.bounds.size.width,
        height: event.bounds.size.height,
      });
      if (boundsTimer.current) clearTimeout(boundsTimer.current);
      boundsTimer.current = setTimeout(() => setDetectedBounds(null), 1000);
    }

    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.value === event.data && now - last.ts < DEBOUNCE_MS) return;
    lastScanRef.current = { value: event.data, ts: now };

    const error = await onScan(event);
    if (error) {
      showError(error);
    } else {
      Vibration.vibrate(VIBRATION_SUCCESS);
    }
  }, [onScan, showError]);

  const handleManualSubmit = useCallback(() => {
    if (!manualValue.trim()) return;
    setManualMode(false);
    void handleBarcodeScanned({ data: manualValue.trim() });
    setManualValue('');
  }, [manualValue, handleBarcodeScanned]);

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access required for scanning.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={() => void requestPermission()}>
          <Text style={styles.permBtnText}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Camera */}
      <View style={{ flex: 1 }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
          }}
        />

        {/* Overlay layer */}
        <View style={StyleSheet.absoluteFill}>
          {/* Inline error banner */}
          {scanError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          )}

          {/* Barcode detection frame */}
          {detectedBounds ? (
            <View style={{
              position: 'absolute',
              left: detectedBounds.x,
              top: detectedBounds.y,
              width: detectedBounds.width,
              height: detectedBounds.height,
            }}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          ) : (
            <View style={styles.viewfinderContainer}>
              <View style={styles.viewfinder}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.hint}>{hint}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Consumer overlay (HUD, progress, etc.) */}
      {overlay}

      {/* Manual entry */}
      {hideManualEntry ? null : manualMode ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.manualSheetWrapper}
        >
          <View style={styles.manualSheet}>
            <Text style={styles.manualLabel}>Enter barcode manually</Text>
            <TextInput
              style={styles.manualInput}
              value={manualValue}
              onChangeText={setManualValue}
              placeholder="SKU, barcode or order ID"
              placeholderTextColor={colors.ink4}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <View style={styles.manualBtns}>
              <TouchableOpacity style={styles.manualSubmit} onPress={handleManualSubmit}>
                <Text style={styles.manualSubmitText}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manualCancel} onPress={() => { setManualMode(false); setManualValue(''); }}>
                <Text style={styles.manualCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <TouchableOpacity style={styles.manualTrigger} onPress={() => setManualMode(true)}>
          <Ionicons name="create-outline" size={18} color={colors.ink3} />
          <Text style={styles.manualTriggerText}>Enter manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const CORNER_SIZE = 22;
const CORNER_THICKNESS = 3;
const VIEWFINDER_SIZE = 240;

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  permText: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', marginBottom: spacing.lg },
  permBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  permBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  errorBanner: {
    position: 'absolute', bottom: 16, left: spacing.lg, right: spacing.lg,
    backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: radius.sm,
    padding: spacing.md, zIndex: 10,
  },
  errorText: { color: '#fff', fontSize: font.size.sm, textAlign: 'center' },
  viewfinderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE, position: 'relative' },
  hint: { marginTop: spacing.lg, color: colors.cameraHint ?? '#FFFFFF99', fontSize: font.size.sm },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: colors.accent, borderWidth: CORNER_THICKNESS },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  manualTrigger: {
    position: 'absolute', bottom: spacing.xxl + spacing.lg, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    padding: spacing.md, backgroundColor: colors.cameraBg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.rule,
  },
  manualTriggerText: { color: colors.ink3, fontSize: font.size.sm },
  manualSheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  manualSheet: {
    backgroundColor: colors.bg2, padding: spacing.lg, paddingBottom: spacing.xxl,
    borderTopWidth: 1, borderTopColor: colors.rule, gap: spacing.md,
  },
  manualLabel: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  manualInput: {
    backgroundColor: colors.bg3, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.medium,
  },
  manualBtns: { flexDirection: 'row', gap: spacing.sm },
  manualSubmit: { flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  manualSubmitText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  manualCancel: { flex: 1, backgroundColor: colors.bg3, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.rule },
  manualCancelText: { color: colors.ink3, fontSize: font.size.md },
});
