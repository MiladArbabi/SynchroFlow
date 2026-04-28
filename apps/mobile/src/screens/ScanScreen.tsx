// apps/mobile/src/screens/ScanScreen.tsx
import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Vibration, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Screen, Badge, Button } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { useOfflineScanQueue } from '../hooks/useOfflineScanQueue';
import type { Task } from './TaskListScreen';

/**
 * SCAN SCREEN (Sprint 1 M5)
 * --------------------------
 * Camera-based barcode scanning for pick task execution.
 *
 * Flow:
 * 1. Camera opens — operator scans product barcode
 * 2. Barcode resolves via POST /api/v1/wms/barcode/resolve
 * 3. If match → confirm pick scan via useOfflineScanQueue (offline-safe)
 * 4. Success feedback (vibration + visual) → ready for next scan
 * 5. All items scanned → pick complete
 *
 * Offline: scans queue locally and flush on reconnect.
 * Wrong item: shows error, does not count the scan.
 */

type Props = {
  task: Task;
  onComplete: () => void;
  onBack: () => void;
};

type ScanState = 'idle' | 'resolving' | 'success' | 'error';

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];

export default function ScanScreen({ task, onComplete, onBack }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);

  const { submitScan, isOnline, queuedCount } = useOfflineScanQueue();

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarcodeScan = useCallback(async ({ data: scannedValue }: { data: string }) => {
    // Cooldown prevents double-scans from camera jitter
    if (cooldown || scanState === 'resolving') return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1500);

    setLastScanned(scannedValue);
    setScanState('resolving');
    setFeedback(null);

    try {
      // STEP 1 — Resolve barcode to variant
      const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
        scanned_value: scannedValue,
      });

      if (!resolved?.lasyncro_variant_id) {
        Vibration.vibrate(VIBRATION_ERROR);
        setScanState('error');
        setFeedback('Barcode not recognised. Try again.');
        setTimeout(() => setScanState('idle'), 2000);
        return;
      }

      // STEP 2 — Confirm pick scan (offline-safe)
      await submitScan({
        deviceEventId: `${task.id}-${scannedValue}-${Date.now()}`,
        url: '/api/v1/wms/pick/scan',
        body: {
          pick_batch_id: task.id,
          lasyncro_variant_id: resolved.lasyncro_variant_id,
          quantity_confirmed: 1,
        },
      });

      Vibration.vibrate(VIBRATION_SUCCESS);
      setScanState('success');
      setScanCount((n) => n + 1);
      setFeedback('✓ Scanned');
      setTimeout(() => setScanState('idle'), 1200);

    } catch {
      Vibration.vibrate(VIBRATION_ERROR);
      setScanState('error');
      setFeedback('Scan failed. Check connection.');
      setTimeout(() => setScanState('idle'), 2000);
    }
  }, [cooldown, scanState, task.id, submitScan]);

  const handlePickComplete = useCallback(async () => {
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pick-complete`);
      onComplete();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to complete pick.';
      Alert.alert('Cannot complete', msg);
    }
  }, [task.id, onComplete]);

  // Permission not yet determined
  if (!permission) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.bodyText}>Requesting camera access...</Text>
        </View>
      </Screen>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.bodyText}>Camera access is required for scanning.</Text>
          <Button
            label="Grant permission"
            onPress={() => void requestPermission()}
            style={styles.permissionBtn}
          />
        </View>
      </Screen>
    );
  }

  const overlayColor =
    scanState === 'success' ? colors.success :
    scanState === 'error'   ? colors.error :
    'transparent';

  return (
    <View style={styles.root}>
      {/* CAMERA */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanState === 'idle' ? handleBarcodeScan : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
        }}
      />

      {/* SCAN STATE OVERLAY */}
      {scanState !== 'idle' && (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: `${overlayColor}22` }]} />
      )}

      {/* TOP BAR */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Badge
          label={isOnline ? `${scanCount} scanned` : `${queuedCount} queued`}
          variant={isOnline ? 'success' : 'warning'}
        />
      </View>

      {/* TASK CONTEXT */}
      <View style={styles.taskBar}>
        <Badge label={task.type.toUpperCase()} variant="info" />
        <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
      </View>

      {/* VIEWFINDER */}
      <View style={styles.viewfinderContainer}>
        <View style={[
          styles.viewfinder,
          scanState === 'success' && styles.viewfinderSuccess,
          scanState === 'error'   && styles.viewfinderError,
        ]}>
          {/* Corner marks */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {feedback && (
          <Text style={[
            styles.feedbackText,
            scanState === 'success' ? styles.feedbackSuccess : styles.feedbackError,
          ]}>
            {feedback}
          </Text>
        )}

        {!feedback && (
          <Text style={styles.instructionText}>
            Point at a barcode
          </Text>
        )}
      </View>

      {/* BOTTOM ACTIONS */}
      <View style={styles.bottomBar}>
        {scanCount > 0 && (
          <Button
            label={`Complete pick (${scanCount} scanned)`}
            onPress={() => void handlePickComplete()}
            variant="primary"
            style={styles.completeBtn}
          />
        )}
        <Button
          label="Cancel"
          onPress={onBack}
          variant="ghost"
          style={styles.cancelBtn}
        />
      </View>
    </View>
  );
}

const VIEWFINDER_SIZE = 240;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  overlay: {
    pointerEvents: 'none',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15,14,13,0.7)',
  },
  backBtn: {
    padding: spacing.xs,
  },
  backText: {
    color: colors.accent,
    fontSize: font.size.md,
  },
  taskBar: {
    position: 'absolute',
    top: 110,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  taskTitle: {
    color: colors.ink,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    flex: 1,
  },
  viewfinderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
  },
  viewfinderSuccess: {
    // Handled by overlay color
  },
  viewfinderError: {
    // Handled by overlay color
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.accent,
    borderWidth: CORNER_THICKNESS,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  feedbackText: {
    marginTop: spacing.lg,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  feedbackSuccess: { color: colors.success },
  feedbackError: { color: colors.error },
  instructionText: {
    marginTop: spacing.lg,
    color: 'rgba(240,238,232,0.6)',
    fontSize: font.size.sm,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: 'rgba(15,14,13,0.85)',
    gap: spacing.sm,
  },
  completeBtn: {},
  cancelBtn: {},
  bodyText: {
    color: colors.ink2,
    fontSize: font.size.md,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  permissionBtn: {
    marginTop: spacing.md,
  },
});