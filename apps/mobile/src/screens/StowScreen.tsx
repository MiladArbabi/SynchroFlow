// apps/mobile/src/screens/StowScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, Vibration, TouchableOpacity,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type StowTask = {
  stow_task_id: string;
  lasyncro_variant_id: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  location_code: string | null;
  status: string;
  claimed_by: number | null;
};

type ScanPhase = 'location' | 'product';
type ScreenPhase = 'summary' | 'stowing' | 'complete';

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];

const EXCEPTION_TYPES = [
  { type: 'item_missing', label: 'Item missing' },
  { type: 'product_defect', label: 'Product defect' },
  { type: 'packaging_defect', label: 'Packaging defect' },
  { type: 'wrong_item', label: 'Wrong item' },
];

export default function StowScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'Stow'>['route']>();
  const { task } = route.params;

  // ── Screen state ──────────────────────────────────────────────────────────
  const [screenPhase, setScreenPhase] = useState<ScreenPhase>('summary');
  const [tasks, setTasks] = useState<StowTask[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Scan state ────────────────────────────────────────────────────────────
  const [scanPhase, setScanPhase] = useState<ScanPhase>('location');
  const [scannedLocation, setScannedLocation] = useState<string | null>(null);
  const [scannedProduct, setScannedProduct] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scanOk, setScanOk] = useState<boolean | null>(null);
  const [cooldown, setCooldown] = useState(false);

  // ── Exception state ───────────────────────────────────────────────────────
  const [showException, setShowException] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();

  // ── Load all pending stow tasks ───────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/wms/stow-tasks');
      const pending = (data.stow_tasks ?? []).filter(
        (t: StowTask) => t.status === 'pending' || t.status === 'in_progress'
      );
      setTasks(pending);
    } catch {
      setError('Failed to load stow tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!permission?.granted) void requestPermission();
  }, [permission, requestPermission]);

  const currentTask = tasks[currentIndex] ?? null;

  // ── Assign location + claim task ──────────────────────────────────────────
  const assignAndClaim = useCallback(async (locationCode: string) => {
    if (!currentTask) return;
    setSubmitting(true);
    try {
      // Assign location if not already set
      if (!currentTask.location_code) {
        await apiClient.patch(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/location`, {
          location_code: locationCode,
        });
      }
      // Claim task
      await apiClient.post(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/claim`);
      setTasks((prev) =>
        prev.map((t, i) =>
          i === currentIndex ? { ...t, location_code: locationCode, status: 'in_progress' } : t
        )
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to claim task.';
      Alert.alert('Error', msg);
      setScanPhase('location');
      setScannedLocation(null);
    } finally {
      setSubmitting(false);
    }
  }, [currentTask, currentIndex]);

  // ── Confirm stow ──────────────────────────────────────────────────────────
  const confirmStow = useCallback(async () => {
    if (!currentTask) return;
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/confirm`);
      Vibration.vibrate(VIBRATION_SUCCESS);

      const nextIndex = currentIndex + 1;
      if (nextIndex >= tasks.length) {
        setScreenPhase('complete');
      } else {
        setCurrentIndex(nextIndex);
        setScanPhase('location');
        setScannedLocation(null);
        setScannedProduct(null);
        setScanFeedback(null);
        setScanOk(null);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to confirm stow.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [currentTask, currentIndex, tasks.length]);

  // ── Report exception ──────────────────────────────────────────────────────
  const reportException = useCallback(async (exceptionType: string) => {
    if (!currentTask) return;
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/exception`, {
        lasyncro_line_item_id: currentTask.stow_task_id,
        lasyncro_variant_id: currentTask.lasyncro_variant_id,
        exception_type: exceptionType,
        stage: 'pick',
        quantity_required: currentTask.quantity,
        quantity_found: 0,
      });
      setShowException(false);
      Alert.alert('Exception reported', 'Moving to next task.');
      const nextIndex = currentIndex + 1;
      if (nextIndex >= tasks.length) {
        setScreenPhase('complete');
      } else {
        setCurrentIndex(nextIndex);
        setScanPhase('location');
        setScannedLocation(null);
        setScannedProduct(null);
      }
    } catch {
      Alert.alert('Error', 'Failed to report exception.');
    }
  }, [currentTask, currentIndex, tasks.length, task.id]);

  // ── Barcode scan handler ──────────────────────────────────────────────────
  const handleScan = useCallback(async ({ data: scannedValue }: { data: string }) => {
    if (cooldown || submitting) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1500);

    if (scanPhase === 'location') {
      try {
        const { data } = await apiClient.post('/api/v1/wms/location/resolve', {
          scanned_value: scannedValue,
        });
        Vibration.vibrate(VIBRATION_SUCCESS);
        setScanOk(true);
        setScanFeedback(`✓ ${data.location_code}`);
        setScannedLocation(data.location_code);
        setScanPhase('product');
        await assignAndClaim(data.location_code);
      } catch {
        Vibration.vibrate(VIBRATION_ERROR);
        setScanOk(false);
        setScanFeedback('Location not found. Try again.');
        setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2000);
      }
    } else {
      // Product scan — verify it matches the current task's variant
      try {
        const { data } = await apiClient.post('/api/v1/wms/barcode/resolve', {
          scanned_value: scannedValue,
        });
        if (data.lasyncro_variant_id !== currentTask?.lasyncro_variant_id) {
          Vibration.vibrate(VIBRATION_ERROR);
          setScanOk(false);
          setScanFeedback('Wrong product. Scan the correct barcode.');
          setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2000);
          return;
        }
        Vibration.vibrate(VIBRATION_SUCCESS);
        setScanOk(true);
        setScannedProduct(scannedValue);
        setScanFeedback(`✓ Product confirmed`);
      } catch {
        Vibration.vibrate(VIBRATION_ERROR);
        setScanOk(false);
        setScanFeedback('Barcode not recognised.');
        setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2000);
      }
    }
  }, [cooldown, submitting, scanPhase, currentTask, assignAndClaim]);

  // ── SUMMARY SCREEN ────────────────────────────────────────────────────────
  if (screenPhase === 'summary') {
    return (
      <Screen>
        <Row style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Stow tasks</Text>
          <Badge label={`${tasks.length} tasks`} variant="info" />
        </Row>
        <Divider />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={load} style={styles.retryBtn} />
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No stow tasks pending.</Text>
          </View>
        ) : (
          <>
            {/* Summary stats */}
            <Row style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{tasks.length}</Text>
                <Text style={styles.summaryLabel}>Tasks</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {tasks.reduce((s, t) => s + t.quantity, 0)}
                </Text>
                <Text style={styles.summaryLabel}>Units</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {new Set(tasks.map((t) => t.location_code).filter(Boolean)).size}
                </Text>
                <Text style={styles.summaryLabel}>Locations</Text>
              </View>
            </Row>

            <Divider />

            {/* Task list preview */}
            {tasks.map((t, i) => (
              <Card key={t.stow_task_id} style={styles.previewCard}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.variantTitle} numberOfLines={1}>
                      {t.variant_title ?? t.sku ?? t.lasyncro_variant_id.slice(0, 8)}
                    </Text>
                    <Text style={styles.sku}>{t.sku}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                    <Text style={styles.qty}>{t.quantity} units</Text>
                    {t.location_code
                      ? <Badge label={t.location_code} variant="success" />
                      : <Badge label="No location" variant="warning" />
                    }
                  </View>
                </Row>
              </Card>
            ))}

            <View style={styles.footer}>
              <Button
                label="Start stowing"
                onPress={() => setScreenPhase('stowing')}
                variant="primary"
              />
            </View>
          </>
        )}
      </Screen>
    );
  }

  // ── COMPLETE SCREEN ───────────────────────────────────────────────────────
  if (screenPhase === 'complete') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>Stow complete</Text>
          <Text style={styles.completeSubtitle}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} completed.{'\n'}
            Inventory has been updated.
          </Text>
          <Button
            label="Done"
            onPress={() => navigation.goBack()}
            variant="primary"
            style={styles.doneBtn}
          />
        </View>
      </Screen>
    );
  }

  // ── STOW SCREEN (per task) ────────────────────────────────────────────────
  if (!currentTask) return null;

  const overlayColor = scanOk === true
    ? colors.success
    : scanOk === false
    ? colors.error
    : 'transparent';

  return (
    <View style={styles.root}>
      {/* CAMERA */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={!cooldown && !submitting && !scannedProduct ? handleScan : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
        }}
      />

      {/* OVERLAY */}
      {scanOk !== null && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `${overlayColor}22` }]} />
      )}

      {/* ── SECTION 1: LOCATION ── */}
      <View style={styles.topBar}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setScreenPhase('summary')}>
            <Text style={styles.backText}>‹ Summary</Text>
          </TouchableOpacity>
          <Badge
            label={`${currentIndex + 1} / ${tasks.length}`}
            variant="info"
          />
        </Row>

        {/* Location section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>① Location</Text>
          {scannedLocation ? (
            <Row style={styles.sectionValue}>
              <Text style={styles.sectionValueText}>✓ {scannedLocation}</Text>
            </Row>
          ) : currentTask.location_code ? (
            <Text style={styles.sectionHint}>
              Scan location barcode — target: {currentTask.location_code}
            </Text>
          ) : (
            <Text style={styles.sectionHint}>Scan any available bin location</Text>
          )}
        </View>

        {/* Product section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>② Product</Text>
          {scannedProduct ? (
            <Text style={styles.sectionValueText}>✓ Barcode confirmed</Text>
          ) : scannedLocation ? (
            <Text style={styles.sectionHint}>
              Scan product barcode
            </Text>
          ) : (
            <Text style={styles.sectionHintDisabled}>Waiting for location scan…</Text>
          )}
        </View>
      </View>

      {/* ── SECTION 2: PRODUCT ── */}
      <View style={styles.productBar}>
        <Text style={styles.productTitle} numberOfLines={1}>
          {currentTask.variant_title ?? currentTask.sku ?? '—'}
        </Text>
        {currentTask.sku && (
          <Text style={styles.productSku}>{currentTask.sku}</Text>
        )}
        <Text style={styles.productQty}>{currentTask.quantity} units to stow</Text>
      </View>

      {/* Viewfinder */}
      <View style={styles.viewfinderContainer}>
        <View style={[
          styles.viewfinder,
          scanOk === true && { borderColor: colors.success },
          scanOk === false && { borderColor: colors.error },
        ]}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        {scanFeedback ? (
          <Text style={[
            styles.feedbackText,
            scanOk === true ? styles.feedbackSuccess : styles.feedbackError,
          ]}>
            {scanFeedback}
          </Text>
        ) : (
          <Text style={styles.instructionText}>
            {scanPhase === 'location' ? 'Scan location barcode' : 'Scan product barcode'}
          </Text>
        )}
      </View>

      {/* ── SECTION 3: ACTIONS ── */}
      <View style={styles.bottomBar}>
        {scannedProduct && (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              {currentTask.variant_title ?? currentTask.sku} → {scannedLocation}
            </Text>
            <Text style={styles.confirmSubtext}>{currentTask.quantity} units</Text>
          </View>
        )}

        {scannedProduct && (
          <Button
            label={submitting ? 'Confirming…' : 'Confirm stow'}
            onPress={() => void confirmStow()}
            variant="primary"
          />
        )}

        <Button
          label="Report exception"
          onPress={() => setShowException(true)}
          variant="ghost"
        />

        <Button
          label="Back to summary"
          onPress={() => {
            setScreenPhase('summary');
            setScanPhase('location');
            setScannedLocation(null);
            setScannedProduct(null);
            setScanFeedback(null);
            setScanOk(null);
          }}
          variant="ghost"
        />
      </View>

      {/* EXCEPTION SHEET */}
      {showException && (
        <View style={styles.exceptionSheet}>
          <Text style={styles.exceptionTitle}>Report exception</Text>
          {EXCEPTION_TYPES.map(({ type, label }) => (
            <Button
              key={type}
              label={label}
              onPress={() => void reportException(type)}
              variant="ghost"
            />
          ))}
          <Button
            label="Cancel"
            onPress={() => setShowException(false)}
            variant="ghost"
            style={{ marginTop: spacing.xs }}
          />
        </View>
      )}
    </View>
  );
}

const VIEWFINDER_SIZE = 220;
const CORNER_SIZE = 22;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingTop: 56,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.cameraBg,
    gap: spacing.sm,
  },
  backText: { color: colors.accent, fontSize: font.size.md },
  section: { gap: 2 },
  sectionLabel: {
    color: colors.ink3,
    fontSize: font.size.xs ?? 11,
    fontWeight: font.weight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionValue: { alignItems: 'center', gap: spacing.xs },
  sectionValueText: {
    color: colors.success,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  sectionHint: { color: colors.ink2, fontSize: font.size.sm },
  sectionHintDisabled: { color: colors.ink4, fontSize: font.size.sm },
  productBar: {
    position: 'absolute',
    bottom: 200,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.cameraBgCard,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  productTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  productSku: { color: colors.ink3, fontSize: font.size.sm },
  productQty: { color: colors.accent, fontSize: font.size.sm },
  viewfinderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
    borderColor: colors.accent,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: 'inherit',
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
    color: colors.cameraHint,
    fontSize: font.size.sm,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.cameraBgDark,
    gap: spacing.sm,
  },
  confirmBox: {
    backgroundColor: colors.bg3,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  confirmText: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  confirmSubtext: { color: colors.ink3, fontSize: font.size.sm },
  exceptionSheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: colors.bg2,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    gap: spacing.sm,
  },
  exceptionTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    marginBottom: spacing.xs,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  summary: {
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
  },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: {
    color: colors.accent,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs ?? 11 },
  previewCard: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  variantTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  sku: { color: colors.ink3, fontSize: font.size.sm },
  qty: { color: colors.ink2, fontSize: font.size.sm },
  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  emptyText: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center' },
  retryBtn: { marginTop: spacing.md },
  completeIcon: { fontSize: 64, marginBottom: spacing.md },
  completeTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    marginBottom: spacing.sm,
  },
  completeSubtitle: {
    color: colors.ink3,
    fontSize: font.size.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneBtn: { marginTop: spacing.xl, width: '100%' },
});