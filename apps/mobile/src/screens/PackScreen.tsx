// apps/mobile/src/screens/PackScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, TouchableOpacity, ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider, AppHeader, WorkflowStep } from '../ui';
import { colors, font, spacing } from '../theme';
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

type ScreenPhase = 'brief' | 'item_scan' | 'invoice_scan' | 'complete';

const PACK_EXCEPTIONS = [
  { type: 'product_defect', label: 'Damaged', icon: 'hammer-outline' },
  { type: 'packaging_defect', label: 'Packaging', icon: 'cube-outline' },
  { type: 'wrong_item', label: 'Wrong item', icon: 'swap-horizontal-outline' },
  { type: 'short_pick', label: 'Short pick', icon: 'remove-circle-outline' },
  { type: 'item_missing', label: 'Item missing', icon: 'search-outline' },
];

export default function PackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'Pack'>['route']>();
  const { task } = route.params;

  const [screenPhase, setScreenPhase] = useState<ScreenPhase>('brief');
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrderIndex, setCurrentOrderIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentOrder = orders[currentOrderIndex] ?? null;
  const unscannedLines = currentOrder?.line_items.filter(li => !li.pack_scanned) ?? [];
  const currentLine = unscannedLines[0] ?? null;
  const scannedCount = currentOrder?.line_items.filter(li => li.pack_scanned).length ?? 0;

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

  // ── Claim pack ────────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pack/claim`);
      setScreenPhase('item_scan');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to claim pack job.';
      if (msg.includes('packing') || msg.includes('already')) {
        setScreenPhase('item_scan');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [task.id]);

  // ── Confirm item scan ─────────────────────────────────────────────────────
  const handleItemScan = useCallback(async (scannedValue: string) => {
    if (!currentOrder || !currentLine) return;

    // Resolve barcode
    const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
      scanned_value: scannedValue,
    });

    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again.' } },
      });
    }

    if (resolved.lasyncro_variant_id !== currentLine.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong item.'), {
        response: { data: { error: 'Wrong item — does not match this order line.' } },
      });
    }

    // Confirm pack scan
    await apiClient.post('/api/v1/wms/pack/scan', {
      pick_batch_id: task.id,
      lasyncro_order_id: currentOrder.lasyncro_order_id,
      lasyncro_line_item_id: currentLine.lasyncro_line_item_id,
      lasyncro_variant_id: currentLine.lasyncro_variant_id,
      quantity_confirmed: currentLine.quantity,
    });

    // Mark line as scanned
    setOrders(prev =>
      prev.map((o, i) =>
        i === currentOrderIndex
          ? {
              ...o,
              line_items: o.line_items.map(li =>
                li.lasyncro_line_item_id === currentLine.lasyncro_line_item_id
                  ? { ...li, pack_scanned: true }
                  : li
              ),
            }
          : o
      )
    );

    // Check if all lines scanned for this order
    const remainingAfter = unscannedLines.filter(
      li => li.lasyncro_line_item_id !== currentLine.lasyncro_line_item_id
    );

    if (remainingAfter.length === 0) {
      // All items scanned → move to invoice scan
      setScreenPhase('invoice_scan');
    }
  }, [currentOrder, currentLine, currentOrderIndex, unscannedLines, task.id]);

  // ── Confirm invoice scan → ship ───────────────────────────────────────────
  const handleInvoiceScan = useCallback(async (scannedValue: string) => {
    if (!currentOrder) return;

    const normalizedScan = scannedValue.replace(/^#/, '').trim();
    if (normalizedScan !== currentOrder.external_order_id) {
      throw Object.assign(new Error('Wrong invoice.'), {
        response: { data: { error: `Wrong invoice. Expected order #${currentOrder.external_order_id}` } },
      });
    }

    await apiClient.post(`/api/v1/wms/batch/${task.id}/ship`, {
      lasyncro_order_id: currentOrder.lasyncro_order_id,
      partial_shipment: false,
    });

    const nextIndex = currentOrderIndex + 1;
    if (nextIndex >= orders.length) {
      try {
        await apiClient.post(`/api/v1/wms/batch/${task.id}/pack-complete`);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to complete pack.';
        // If already complete, still show complete screen
        if (!msg.includes('pack_complete')) {
          Alert.alert('Warning', msg);
        }
      }
      setScreenPhase('complete');
    } else {
      setCurrentOrderIndex(nextIndex);
      setCurrentLineIndex(0);
      setScreenPhase('item_scan');
    }
  }, [currentOrder, currentOrderIndex, orders.length, task.id]);

  // ── Report exception ──────────────────────────────────────────────────────
  const handleItemException = useCallback(async (exceptionType: string, quantity: number = 1) => {
    if (!currentOrder || !currentLine) return;
    await apiClient.post(`/api/v1/wms/batch/${task.id}/exception`, {
        lasyncro_line_item_id: currentLine.lasyncro_line_item_id,
        lasyncro_variant_id: currentLine.lasyncro_variant_id,
        exception_type: exceptionType,
        stage: 'pack',
        quantity_required: currentLine.quantity,
        quantity_found: currentLine.quantity - quantity,
      });
    // Create PROB label + problem center task for physical bin routing
    await apiClient.post('/api/v1/wms/problem-center', {
      lasyncro_variant_id: currentLine.lasyncro_variant_id,
      quantity,
      exception_type: exceptionType,
      source: 'pack',
      source_exception_id: task.id,
    });
    // Mark as scanned to advance
    setOrders(prev =>
      prev.map((o, i) =>
        i === currentOrderIndex
          ? {
              ...o,
              line_items: o.line_items.map(li =>
                li.lasyncro_line_item_id === currentLine.lasyncro_line_item_id
                  ? { ...li, pack_scanned: true }
                  : li
              ),
            }
          : o
      )
    );
    const remainingAfter = unscannedLines.filter(
      li => li.lasyncro_line_item_id !== currentLine.lasyncro_line_item_id
    );
    if (remainingAfter.length === 0) {
      setScreenPhase('invoice_scan');
    }
  }, [currentOrder, currentLine, currentOrderIndex, unscannedLines, task.id]);

  // ── BRIEF SCREEN ──────────────────────────────────────────────────────────
  if (screenPhase === 'brief') {
    return (
      <Screen>
        <AppHeader showLogo />
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={load} style={{ marginTop: spacing.md }} />
          </View>
        ) : (
          <>
            <Row style={styles.summaryRow}>
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
                  {order.line_items.map(li => (
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

  // ── COMPLETE SCREEN ───────────────────────────────────────────────────────
  if (screenPhase === 'complete') {
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>📦</Text>
          <Text style={styles.completeTitle}>Pack complete</Text>
          <Text style={styles.completeSub}>
            {orders.length} order{orders.length !== 1 ? 's' : ''} packed and shipped.{'\n'}
            Inventory updated.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Back to tasks</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (!currentOrder) return null;

  // ── ITEM SCAN PHASE ───────────────────────────────────────────────────────
  if (screenPhase === 'item_scan' && currentLine) {
    const totalLines = currentOrder.line_items.length;
    return (
      <Screen>
        <AppHeader
          title={`Pack · Order ${currentOrderIndex + 1}/${orders.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => navigation.goBack() }}
        />
        <WorkflowStep
          context={{
            label: 'Order',
            value: `#${currentOrder.external_order_id}`,
            sublabel: `${currentOrder.currency} ${Number(currentOrder.total_price).toFixed(2)} · ${scannedCount}/${totalLines} items scanned`,
          }}
          item={{
            title: currentLine.title,
            sku: currentLine.sku,
            quantity: currentLine.quantity,
            currentIndex: scannedCount + 1,
            totalCount: totalLines,
          }}
          exceptions={PACK_EXCEPTIONS}
          onConfirm={handleItemScan}
          onException={handleItemException}
          confirmLabel="Confirm item"
          isSubmitting={submitting}
        />
      </Screen>
    );
  }

  // ── INVOICE SCAN PHASE ────────────────────────────────────────────────────
  if (screenPhase === 'invoice_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Pack · Order ${currentOrderIndex + 1}/${orders.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => navigation.goBack() }}
        />
        <WorkflowStep
          context={{
            label: 'Ready to ship',
            value: `#${currentOrder.external_order_id}`,
            sublabel: 'All items verified. Seal parcel and attach shipping label.',
          }}
          item={{
            title: 'Scan invoice barcode',
            sku: `${currentOrder.line_items.length} item${currentOrder.line_items.length !== 1 ? 's' : ''} confirmed`,
            quantity: currentOrder.line_items.reduce((s, li) => s + li.quantity, 0),
            currentIndex: currentOrderIndex + 1,
            totalCount: orders.length,
          }}
          exceptions={[{ type: 'other', label: 'Cannot ship this order' }]}
          inputPrefix="#"
          onConfirm={handleInvoiceScan}
          onException={async () => {
            Alert.alert('Cannot ship', 'Please contact the owner/admin.');
          }}
          confirmLabel="Confirm shipment"
          isSubmitting={submitting}
        />
      </Screen>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  summaryRow: {
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
  },
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
  completeIcon: { fontSize: 64, marginBottom: spacing.md },
  completeTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  completeSub: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  completeBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
});