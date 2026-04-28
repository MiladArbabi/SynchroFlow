// apps/mobile/src/screens/PackScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, Vibration, TouchableOpacity, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type LineItem = {
  lasyncro_line_item_id: string;
  lasyncro_order_id: string;
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  pack_scanned: boolean;
};

type Order = {
  lasyncro_order_id: string;
  external_order_id: string;
  total_price: number;
  currency: string;
  warehouse_status: string;
  line_items: LineItem[];
};

type ScreenPhase = 'brief' | 'scanning' | 'complete';
type ScanMode = 'product' | 'invoice';

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];

const EXCEPTION_TYPES = [
  { type: 'product_defect', label: 'Product defect' },
  { type: 'packaging_defect', label: 'Packaging defect' },
  { type: 'wrong_item', label: 'Wrong item' },
  { type: 'short_pick', label: 'Short pick' },
  { type: 'item_missing', label: 'Item missing' },
];

export default function PackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'Pack'>['route']>();
  const { task } = route.params;

  const [screenPhase, setScreenPhase] = useState<ScreenPhase>('brief');
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrderIndex, setCurrentOrderIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanMode, setScanMode] = useState<ScanMode>('product');
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scanOk, setScanOk] = useState<boolean | null>(null);
  const [cooldown, setCooldown] = useState(false);

  const [showException, setShowException] = useState(false);
  const [exceptionLine, setExceptionLine] = useState<LineItem | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const currentOrder = orders[currentOrderIndex] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/wms/batch/${task.id}/orders`);
      setOrders(data.orders ?? []);
    } catch {
      setError('Failed to load batch orders.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!permission?.granted) void requestPermission();
  }, [permission, requestPermission]);

  const handleClaim = useCallback(async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pack/claim`);
      setScreenPhase('scanning');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to claim pack job.';
      if (msg.includes('packing')) {
        setScreenPhase('scanning');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [task.id]);

  const handleShipOrder = useCallback(async (lasyncroOrderId: string) => {
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/ship`, {
        lasyncro_order_id: lasyncroOrderId,
        partial_shipment: false,
      });
      const nextIndex = currentOrderIndex + 1;
      if (nextIndex >= orders.length) {
        await apiClient.post(`/api/v1/wms/batch/${task.id}/pack-complete`);
        setScreenPhase('complete');
      } else {
        setCurrentOrderIndex(nextIndex);
        setScanMode('product');
        setScanFeedback(null);
        setScanOk(null);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to ship order.';
      Alert.alert('Ship failed', msg);
    } finally {
      setSubmitting(false);
    }
  }, [task.id, currentOrderIndex, orders.length]);

  const handleScan = useCallback(async ({ data: scannedValue }: { data: string }) => {
    if (cooldown || submitting || !currentOrder) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1500);

    if (scanMode === 'invoice') {
      if (scannedValue !== currentOrder.external_order_id) {
        Vibration.vibrate(VIBRATION_ERROR);
        setScanOk(false);
        setScanFeedback(`Wrong invoice. Expected #${currentOrder.external_order_id}`);
        setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2500);
        return;
      }
      Vibration.vibrate(VIBRATION_SUCCESS);
      setScanOk(true);
      setScanFeedback(`✓ Invoice confirmed`);
      await handleShipOrder(currentOrder.lasyncro_order_id);
      return;
    }

    try {
      const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
        scanned_value: scannedValue,
      });
      const matchingLine = currentOrder.line_items.find(
        (li) => li.lasyncro_variant_id === resolved.lasyncro_variant_id && !li.pack_scanned
      );
      if (!matchingLine) {
        Vibration.vibrate(VIBRATION_ERROR);
        setScanOk(false);
        setScanFeedback('Item not in this order or already scanned.');
        setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2000);
        return;
      }
      await apiClient.post('/api/v1/wms/pack/scan', {
        pick_batch_id: task.id,
        lasyncro_order_id: currentOrder.lasyncro_order_id,
        lasyncro_line_item_id: matchingLine.lasyncro_line_item_id,
        lasyncro_variant_id: matchingLine.lasyncro_variant_id,
        quantity_confirmed: matchingLine.quantity,
      });
      Vibration.vibrate(VIBRATION_SUCCESS);
      setScanOk(true);
      setScanFeedback(`✓ ${matchingLine.title}`);
      setOrders((prev) =>
        prev.map((o, i) =>
          i === currentOrderIndex
            ? { ...o, line_items: o.line_items.map((li) =>
                li.lasyncro_line_item_id === matchingLine.lasyncro_line_item_id
                  ? { ...li, pack_scanned: true } : li) }
            : o
        )
      );
      setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 1200);
      const allScanned = currentOrder.line_items.every(
        (li) => li.lasyncro_line_item_id === matchingLine.lasyncro_line_item_id || li.pack_scanned
      );
      if (allScanned) {
        setScanMode('invoice');
        setScanFeedback('✓ All items scanned — scan invoice to ship');
        setScanOk(true);
      }
    } catch {
      Vibration.vibrate(VIBRATION_ERROR);
      setScanOk(false);
      setScanFeedback('Barcode not recognised.');
      setTimeout(() => { setScanFeedback(null); setScanOk(null); }, 2000);
    }
  }, [cooldown, submitting, currentOrder, currentOrderIndex, scanMode, task.id, handleShipOrder]);

  const handleException = useCallback(async (exceptionType: string) => {
    if (!exceptionLine || !currentOrder) return;
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/exception`, {
        lasyncro_line_item_id: exceptionLine.lasyncro_line_item_id,
        lasyncro_variant_id: exceptionLine.lasyncro_variant_id,
        exception_type: exceptionType,
        stage: 'pack',
        quantity_required: exceptionLine.quantity,
        quantity_found: 0,
      });
      setShowException(false);
      setExceptionLine(null);
      setOrders((prev) =>
        prev.map((o, i) =>
          i === currentOrderIndex
            ? { ...o, line_items: o.line_items.map((li) =>
                li.lasyncro_line_item_id === exceptionLine.lasyncro_line_item_id
                  ? { ...li, pack_scanned: true } : li) }
            : o
        )
      );
    } catch {
      Alert.alert('Error', 'Failed to report exception.');
    }
  }, [exceptionLine, currentOrder, currentOrderIndex, task.id]);

  const unscannedLines = currentOrder?.line_items.filter((li) => !li.pack_scanned) ?? [];

  if (screenPhase === 'brief') {
    return (
      <Screen>
        <Row style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pack brief</Text>
          <Badge label={`${orders.length} order${orders.length !== 1 ? 's' : ''}`} variant="info" />
        </Row>
        <Divider />
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={load} style={styles.retryBtn} />
          </View>
        ) : (
          <>
            <Row style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{orders.length}</Text>
                <Text style={styles.summaryLabel}>Orders</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {orders.reduce((s, o) => s + o.line_items.length, 0)}
                </Text>
                <Text style={styles.summaryLabel}>Lines</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {orders.reduce((s, o) => s + o.line_items.reduce((ls, li) => ls + li.quantity, 0), 0)}
                </Text>
                <Text style={styles.summaryLabel}>Units</Text>
              </View>
            </Row>
            <Divider />
            <ScrollView contentContainerStyle={styles.list}>
              {orders.map((order) => (
                <Card key={order.lasyncro_order_id} style={styles.orderCard}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={styles.orderId}>#{order.external_order_id}</Text>
                    <Text style={styles.orderTotal}>
                      {order.currency} {Number(order.total_price).toFixed(2)}
                    </Text>
                  </Row>
                  {order.line_items.map((li) => (
                    <Text key={li.lasyncro_line_item_id} style={styles.lineText} numberOfLines={1}>
                      · {li.title} × {li.quantity}
                    </Text>
                  ))}
                </Card>
              ))}
            </ScrollView>
            <View style={styles.footer}>
              <Button
                label={submitting ? 'Claiming…' : 'Claim & start packing'}
                onPress={() => void handleClaim()}
                variant="primary"
              />
            </View>
          </>
        )}
      </Screen>
    );
  }

  if (screenPhase === 'complete') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.completeIcon}>📦</Text>
          <Text style={styles.completeTitle}>Pack complete</Text>
          <Text style={styles.completeSubtitle}>
            {orders.length} order{orders.length !== 1 ? 's' : ''} packed and shipped.{'\n'}
            Inventory updated.
          </Text>
          <Button label="Done" onPress={() => navigation.goBack()} variant="primary" style={styles.doneBtn} />
        </View>
      </Screen>
    );
  }

  if (!currentOrder) return null;

  const overlayColor = scanOk === true ? colors.success : scanOk === false ? colors.error : 'transparent';

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={!cooldown && !submitting ? handleScan : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
        }}
      />
      {scanOk !== null && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `${overlayColor}22` }]} />
      )}
      <View style={styles.topBar}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setScreenPhase('brief')}>
            <Text style={styles.backText}>‹ Brief</Text>
          </TouchableOpacity>
          <Badge label={`Order ${currentOrderIndex + 1} / ${orders.length}`} variant="info" />
          <Badge
            label={scanMode === 'invoice' ? 'SCAN INVOICE' : 'SCAN PRODUCT'}
            variant={scanMode === 'invoice' ? 'warning' : 'info'}
          />
        </Row>
        <Text style={styles.orderIdText}>#{currentOrder.external_order_id}</Text>
        {scanMode === 'product' && (
          <View style={styles.remainingList}>
            {currentOrder.line_items.map((li) => (
              <Row key={li.lasyncro_line_item_id} style={styles.remainingItem}>
                <Text style={[styles.remainingText, li.pack_scanned && styles.remainingTextDone]} numberOfLines={1}>
                  {li.pack_scanned ? '✓ ' : '· '}{li.title} × {li.quantity}
                </Text>
                {!li.pack_scanned && (
                  <TouchableOpacity onPress={() => { setExceptionLine(li); setShowException(true); }}>
                    <Text style={styles.exceptionTrigger}>!</Text>
                  </TouchableOpacity>
                )}
              </Row>
            ))}
          </View>
        )}
        {scanMode === 'invoice' && (
          <Text style={styles.invoiceHint}>
            All items scanned. Seal parcel, attach shipping label, then scan invoice barcode.
          </Text>
        )}
      </View>
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
          <Text style={[styles.feedbackText, scanOk === true ? styles.feedbackSuccess : styles.feedbackError]}>
            {scanFeedback}
          </Text>
        ) : (
          <Text style={styles.instructionText}>
            {scanMode === 'invoice' ? 'Scan invoice barcode' : `${unscannedLines.length} item${unscannedLines.length !== 1 ? 's' : ''} remaining`}
          </Text>
        )}
      </View>
      <View style={styles.bottomBar}>
        {scanMode === 'invoice' && (
          <Button
            label={submitting ? 'Shipping…' : `Ship order #${currentOrder.external_order_id}`}
            onPress={() => void handleShipOrder(currentOrder.lasyncro_order_id)}
            variant="primary"
          />
        )}
        <Button
          label="Report exception"
          onPress={() => { setExceptionLine(unscannedLines[0] ?? null); setShowException(true); }}
          variant="ghost"
        />
      </View>
      {showException && exceptionLine && (
        <View style={styles.exceptionSheet}>
          <Text style={styles.exceptionTitle}>Exception — {exceptionLine.title}</Text>
          {EXCEPTION_TYPES.map(({ type, label }) => (
            <Button key={type} label={label} onPress={() => void handleException(type)} variant="ghost" />
          ))}
          <Button
            label="Cancel"
            onPress={() => { setShowException(false); setExceptionLine(null); }}
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
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    backgroundColor: colors.cameraBg, gap: spacing.sm,
  },
  backText: { color: colors.accent, fontSize: font.size.md },
  orderIdText: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  remainingList: { gap: 4 },
  remainingItem: { justifyContent: 'space-between', alignItems: 'center' },
  remainingText: { color: colors.ink2, fontSize: font.size.sm, flex: 1 },
  remainingTextDone: { color: colors.success, textDecorationLine: 'line-through' },
  exceptionTrigger: { color: colors.error, fontSize: font.size.md, fontWeight: font.weight.bold, paddingHorizontal: spacing.sm },
  invoiceHint: { color: colors.ink2, fontSize: font.size.sm, lineHeight: 18 },
  viewfinderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE, position: 'relative', borderColor: colors.accent },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: 'inherit', borderWidth: CORNER_THICKNESS },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  feedbackText: { marginTop: spacing.lg, fontSize: font.size.lg, fontWeight: font.weight.bold, textAlign: 'center', paddingHorizontal: spacing.lg },
  feedbackSuccess: { color: colors.success },
  feedbackError: { color: colors.error },
  instructionText: { marginTop: spacing.lg, color: colors.cameraHint, fontSize: font.size.sm },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.cameraBgDark, gap: spacing.sm,
  },
  exceptionSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.bg2, padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.rule, gap: spacing.sm,
  },
  exceptionTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, marginBottom: spacing.xs },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summary: { justifyContent: 'space-around', paddingVertical: spacing.md },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: { color: colors.accent, fontSize: font.size.lg, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs },
  list: { padding: spacing.md, paddingBottom: 120 },
  orderCard: { gap: spacing.xs, marginBottom: spacing.sm },
  orderId: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  orderTotal: { color: colors.ink3, fontSize: font.size.sm },
  lineText: { color: colors.ink3, fontSize: font.size.sm },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  retryBtn: { marginTop: spacing.md },
  completeIcon: { fontSize: 64, marginBottom: spacing.md },
  completeTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.sm },
  completeSubtitle: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', lineHeight: 22 },
  doneBtn: { marginTop: spacing.xl, width: '100%' },
});