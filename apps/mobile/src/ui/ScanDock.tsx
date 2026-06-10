// apps/mobile/src/ui/ScanDock.tsx
//
// SCAN DOCK — §10.7 shared component (MOB-UX-01)
// ------------------------------------------------
// The single scan surface for all Work screens. Composes BarcodeScannerView
// (camera concern, untouched) and adds the §10 layer:
//
//   1. CAMERA  — delegated to BarcodeScannerView (per-value debounce inside)
//   2. HID/BT  — invisible always-focused TextInput; captures keyboard-wedge
//                scanner input terminated by Enter; never opens OS keyboard.
//                (resolves MOB-AUD-01, MOB-AUD-09)
//   3. MANUAL  — persistent affordance in the dock strip, not hidden behind
//                a camera-area tap.
//
// All three methods funnel into ONE submit path → per-value 1500ms debounce
// (camera debounces internally; ScanDock applies the same rule to hid/manual)
// → onResolve callback.
//
// CONTRACT (§6, §10.7):
//   - NO API calls in this component. The owning screen performs server
//     resolution inside onResolve and returns an error string (shown inline,
//     error vibration) or void (success vibration handled by camera path;
//     ScanDock fires it for hid/manual).
//   - Screens never read scan state from ScanDock; they own all data.
//
// FOCUS ARBITRATION: the hidden HID field holds focus while the dock is
// mounted. Opening manual entry yields focus to the manual input; closing
// it returns focus to the HID field. Without this the two inputs fight.
//
// CHANGE CONTROL: consumed by every Work screen (Receive, Stow, Pick, and
// later the global Scan tab). Test all surfaces after changes.

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Vibration, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerView, type BarcodeScanEvent } from './BarcodeScannerView';
import { colors, font, spacing, radius } from '../theme';

export type ScanMethod = 'camera' | 'hid' | 'manual';

export type ScanDockProps = {
  /**
   * Called for every accepted scan. The screen performs server resolution
   * here. Return an error string to show inline + error vibration; return
   * void on success.
   */
  onResolve: (raw: string, method: ScanMethod) => Promise<string | void>;
  /** Hint under the camera viewfinder */
  hint?: string;
  /** Enable the hidden HID/BT input path (default true) */
  hidEnabled?: boolean;
  /** Overlay passthrough to BarcodeScannerView (HUD, progress) */
  overlay?: React.ReactNode;
};

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];
const DEBOUNCE_MS = 1500;
const ERROR_DISMISS_MS = 2000;

export function ScanDock({ onResolve, hint, hidEnabled = true, overlay }: ScanDockProps) {
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [hidBuffer, setHidBuffer] = useState('');
  const [dockError, setDockError] = useState<string | null>(null);

  // Per-value debounce for hid/manual paths (camera debounces internally).
  const lastSubmitRef = useRef<{ value: string; ts: number } | null>(null);
  const hidInputRef = useRef<TextInput>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDockError = useCallback((msg: string) => {
    setDockError(msg);
    Vibration.vibrate(VIBRATION_ERROR);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setDockError(null), ERROR_DISMISS_MS);
  }, []);

  /** Single funnel for hid + manual. Camera funnels via handleCameraScan. */
  const submit = useCallback(async (raw: string, method: ScanMethod) => {
    const value = raw.trim();
    if (!value) return;

    const now = Date.now();
    const last = lastSubmitRef.current;
    if (last && last.value === value && now - last.ts < DEBOUNCE_MS) return;
    lastSubmitRef.current = { value, ts: now };

    const error = await onResolve(value, method);
    if (error) {
      showDockError(error);
    } else {
      Vibration.vibrate(VIBRATION_SUCCESS);
    }
  }, [onResolve, showDockError]);

  /** Camera path — BarcodeScannerView owns debounce + vibration for this path. */
  const handleCameraScan = useCallback(
    (event: BarcodeScanEvent) => onResolve(event.data, 'camera'),
    [onResolve]
  );

  /** HID keyboard-wedge scanners terminate with Enter → onSubmitEditing. */
  const handleHidSubmit = useCallback(() => {
    const value = hidBuffer;
    setHidBuffer('');
    void submit(value, 'hid');
  }, [hidBuffer, submit]);

  const handleManualSubmit = useCallback(() => {
    const value = manualValue;
    setManualValue('');
    setManualMode(false);
    void submit(value, 'manual');
  }, [manualValue, submit]);

  // FOCUS ARBITER — HID field holds focus unless manual entry is open.
  useEffect(() => {
    if (hidEnabled && !manualMode) {
      const t = setTimeout(() => hidInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [hidEnabled, manualMode]);

  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* CAMERA — composed, untouched; its own manual UI suppressed */}
      <View style={{ flex: 1 }}>
        <BarcodeScannerView
          onScan={handleCameraScan}
          hint={hint}
          overlay={overlay}
          hideManualEntry
        />
      </View>

      {/* HID — invisible, always focused while dock is active */}
      {hidEnabled && (
        <TextInput
          ref={hidInputRef}
          style={styles.hidInput}
          value={hidBuffer}
          onChangeText={setHidBuffer}
          onSubmitEditing={handleHidSubmit}
          onBlur={() => {
            // Reclaim focus unless the operator is in manual entry.
            if (!manualMode) setTimeout(() => hidInputRef.current?.focus(), 50);
          }}
          blurOnSubmit={false}
          autoCapitalize="none"
          autoCorrect={false}
          showSoftInputOnFocus={false}
          caretHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}

      {/* DOCK STRIP — persistent manual path + dock-level error */}
      {dockError && (
        <View style={styles.dockErrorBanner}>
          <Text style={styles.dockErrorText}>{dockError}</Text>
        </View>
      )}

      {manualMode ? (
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
              onSubmitEditing={handleManualSubmit}
            />
            <View style={styles.manualBtns}>
              <TouchableOpacity style={styles.manualSubmit} onPress={handleManualSubmit}>
                <Text style={styles.manualSubmitText}>Submit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.manualCancel}
                onPress={() => { setManualMode(false); setManualValue(''); }}
              >
                <Text style={styles.manualCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.dockStrip}>
          <TouchableOpacity style={styles.manualTrigger} onPress={() => setManualMode(true)}>
            <Ionicons name="create-outline" size={18} color={colors.ink3} />
            <Text style={styles.manualTriggerText}>Enter manually</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Invisible but focusable — 1px offscreen-ish footprint, zero opacity.
  hidInput: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  dockErrorBanner: {
    backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: radius.sm,
    padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  dockErrorText: { color: '#fff', fontSize: font.size.sm, textAlign: 'center' },
  dockStrip: {
    flexDirection: 'row', justifyContent: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  manualTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.bg3, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.rule, minHeight: 48, minWidth: 160,
    justifyContent: 'center',
  },
  manualTriggerText: { color: colors.ink3, fontSize: font.size.sm },
  manualSheetWrapper: { width: '100%' },
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
  manualSubmit: { flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  manualSubmitText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  manualCancel: { flex: 1, backgroundColor: colors.bg3, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.rule, minHeight: 48, justifyContent: 'center' },
  manualCancelText: { color: colors.ink3, fontSize: font.size.md },
});