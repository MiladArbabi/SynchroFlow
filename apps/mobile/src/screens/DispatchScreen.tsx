// apps/mobile/src/screens/DispatchScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, ScrollView, TouchableOpacity,
} from 'react-native';
import { Screen, Card, Button, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type Operator = {
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
};

type PurchaseOrder = {
  id: string;
  status: string;
  supplier_name: string;
  expected_delivery_date: string | null;
  line_items_count: number;
  total_units_ordered: number;
};

type ActiveBatch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
  units_picked: number;
  units_packed: number;
  assigned_operator_id: number | null;
  assigned_packer_id: number | null;
};

type Tab = 'pick' | 'receive' | 'active';

export default function DispatchScreen() {
  const [tab, setTab] = useState<Tab>('pick');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [activeBatches, setActiveBatches] = useState<ActiveBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Assignment selection state
  const [selectedPicker, setSelectedPicker] = useState<number | null>(null);
  const [selectedPacker, setSelectedPacker] = useState<number | null>(null);
  const [selectedReceiveOperator, setSelectedReceiveOperator] = useState<number | null>(null);
  const [selectedPo, setSelectedPo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opsRes, batchRes] = await Promise.all([
        apiClient.get('/api/v1/operators/team'),
        apiClient.get('/api/v1/wms/batches'),
      ]);
      setOperators(opsRes.data.operators ?? []);
      setActiveBatches(batchRes.data.batches ?? []);

      if (tab === 'receive') {
        const poRes = await apiClient.get('/api/v1/suppliers/purchase-orders');
        setPurchaseOrders(
          (poRes.data.purchase_orders ?? []).filter(
            (po: PurchaseOrder) => po.status === 'shipped' || po.status === 'partially_received'
          )
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to load dispatch data.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  // ── Release pick batch ────────────────────────────────────────────────────
  const handleReleaseBatch = useCallback(async () => {
    Alert.alert(
      'Release pick batch',
      selectedPicker
        ? `Assign to ${operators.find(o => o.user_id === selectedPicker)?.first_name ?? 'operator'}?`
        : 'Dispatch to operator pool (first to claim gets it)?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          onPress: async () => {
            setSubmitting(true);
            try {
              const result = await apiClient.post('/api/v1/wms/batch/release', {
                assigned_operator_id: selectedPicker ?? null,
                assigned_packer_id: selectedPacker ?? null,
              });
              if (result.data?.message) {
                Alert.alert('No orders', 'No eligible orders available for batching.');
              } else {
                Alert.alert(
                  '✓ Batch released',
                  `${result.data.order_count} orders · ${result.data.total_line_items} lines`,
                );
                setSelectedPicker(null);
                setSelectedPacker(null);
                void load();
              }
            } catch (err: unknown) {
              const msg = (err as { response?: { data?: { error?: string } } })
                ?.response?.data?.error ?? 'Failed to release batch.';
              Alert.alert('Error', msg);
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }, [selectedPicker, selectedPacker, operators, load]);

  // ── Create receive job ────────────────────────────────────────────────────
  const handleCreateReceiveJob = useCallback(async () => {
    if (!selectedPo) {
      Alert.alert('Select PO', 'Please select a purchase order first.');
      return;
    }
    const po = purchaseOrders.find(p => p.id === selectedPo);
    Alert.alert(
      'Create receive job',
      `PO from ${po?.supplier_name}${selectedReceiveOperator
        ? ` — assign to ${operators.find(o => o.user_id === selectedReceiveOperator)?.first_name}`
        : ' — dispatch to operator pool'
      }?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            setSubmitting(true);
            try {
              await apiClient.post(
                `/api/v1/suppliers/purchase-orders/${selectedPo}/receive-jobs`,
                { assigned_operator_id: selectedReceiveOperator ?? null }
              );
              Alert.alert('✓ Receive job created', 'Operator notified.');
              setSelectedPo(null);
              setSelectedReceiveOperator(null);
            } catch (err: unknown) {
              const msg = (err as { response?: { data?: { error?: string } } })
                ?.response?.data?.error ?? 'Failed to create receive job.';
              Alert.alert('Error', msg);
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }, [selectedPo, selectedReceiveOperator, purchaseOrders, operators]);

  const operatorName = (id: number | null) => {
    if (!id) return 'Pool';
    const op = operators.find(o => o.user_id === id);
    return op ? `${op.first_name} ${op.last_name}` : `#${id}`;
  };

  // ── OPERATOR PICKER ───────────────────────────────────────────────────────
  function OperatorPicker({
    label,
    selected,
    onSelect,
  }: {
    label: string;
    selected: number | null;
    onSelect: (id: number | null) => void;
  }) {
    return (
      <View style={styles.pickerGroup}>
        <Text style={styles.pickerLabel}>{label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
          <TouchableOpacity
            style={[styles.chip, selected === null && styles.chipSelected]}
            onPress={() => onSelect(null)}
          >
            <Text style={[styles.chipText, selected === null && styles.chipTextSelected]}>
              Pool
            </Text>
          </TouchableOpacity>
          {operators.map((op) => (
            <TouchableOpacity
              key={op.user_id}
              style={[styles.chip, selected === op.user_id && styles.chipSelected]}
              onPress={() => onSelect(op.user_id)}
            >
              <Text style={[styles.chipText, selected === op.user_id && styles.chipTextSelected]}>
                {op.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dispatch</Text>
      </View>

      {/* TABS */}
      <Row style={styles.tabs}>
        {(['pick', 'receive', 'active'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'pick' ? 'Pick batch' : t === 'receive' ? 'Receive' : 'Active'}
            </Text>
          </TouchableOpacity>
        ))}
      </Row>

      <Divider />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── PICK BATCH TAB ── */}
          {tab === 'pick' && (
            <>
              <Text style={styles.sectionTitle}>Release pick batch</Text>
              <Text style={styles.sectionHint}>
                System selects eligible orders automatically. Assign operators or dispatch to pool.
              </Text>

              <OperatorPicker
                label="Picker"
                selected={selectedPicker}
                onSelect={setSelectedPicker}
              />
              <OperatorPicker
                label="Packer"
                selected={selectedPacker}
                onSelect={setSelectedPacker}
              />

              <Card style={styles.summaryCard}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={styles.summaryKey}>Picker</Text>
                  <Text style={styles.summaryVal}>{operatorName(selectedPicker)}</Text>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={styles.summaryKey}>Packer</Text>
                  <Text style={styles.summaryVal}>{operatorName(selectedPacker)}</Text>
                </Row>
              </Card>

              <Button
                label={submitting ? 'Releasing…' : 'Release batch'}
                onPress={() => void handleReleaseBatch()}
                variant="primary"
                style={styles.actionBtn}
              />
            </>
          )}

          {/* ── RECEIVE TAB ── */}
          {tab === 'receive' && (
            <>
              <Text style={styles.sectionTitle}>Create receive job</Text>
              <Text style={styles.sectionHint}>
                Select a shipped PO and assign an operator to receive the delivery.
              </Text>

              {/* PO selector */}
              <Text style={styles.pickerLabel}>Purchase order</Text>
              {purchaseOrders.length === 0 ? (
                <Text style={styles.emptyText}>No POs ready to receive.</Text>
              ) : (
                purchaseOrders.map((po) => (
                  <TouchableOpacity
                    key={po.id}
                    onPress={() => setSelectedPo(po.id === selectedPo ? null : po.id)}
                  >

                    <Card style={selectedPo === po.id ? { ...styles.poCard, ...styles.poCardSelected } : styles.poCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.poSupplier}>{po.supplier_name}</Text>
                        <Badge
                          label={po.status === 'shipped' ? 'SHIPPED' : 'PARTIAL'}
                          variant={po.status === 'shipped' ? 'success' : 'warning'}
                        />
                      </Row>
                      <Text style={styles.poMeta}>
                        {po.line_items_count} variants · {po.total_units_ordered} units
                        {po.expected_delivery_date
                          ? ` · ETA ${po.expected_delivery_date}`
                          : ''}
                      </Text>
                    </Card>
                  </TouchableOpacity>
                ))
              )}

              <OperatorPicker
                label="Assign operator"
                selected={selectedReceiveOperator}
                onSelect={setSelectedReceiveOperator}
              />

              <Button
                label={submitting ? 'Creating…' : 'Create receive job'}
                onPress={() => void handleCreateReceiveJob()}
                variant="primary"
                style={styles.actionBtn}
              />
            </>
          )}

          {/* ── ACTIVE TAB ── */}
          {tab === 'active' && (
            <>
              <Text style={styles.sectionTitle}>Active batches</Text>
              {activeBatches.length === 0 ? (
                <Text style={styles.emptyText}>No active batches.</Text>
              ) : (
                activeBatches.map((batch) => {
                  const pickProgress = batch.total_units > 0
                    ? Math.round((batch.units_picked / batch.total_units) * 100)
                    : 0;
                  const packProgress = batch.total_units > 0
                    ? Math.round((batch.units_packed / batch.total_units) * 100)
                    : 0;

                  return (
                    <Card key={batch.pick_batch_id} style={styles.batchCard}>
                      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.batchId}>
                          {batch.pick_batch_id.slice(0, 8).toUpperCase()}
                        </Text>
                        <Badge
                          label={batch.status.replace('_', ' ').toUpperCase()}
                          variant={
                            batch.status === 'picking' ? 'info'
                            : batch.status === 'pick_complete' ? 'success'
                            : batch.status === 'packing' ? 'warning'
                            : 'info'
                          }
                        />
                      </Row>
                      <Row style={styles.batchMeta}>
                        <Text style={styles.metaText}>
                          {batch.total_line_items} lines · {batch.total_units} units
                        </Text>
                      </Row>
                      <Row style={styles.batchMeta}>
                        <Text style={styles.metaLabel}>Picker: </Text>
                        <Text style={styles.metaText}>{operatorName(batch.assigned_operator_id)}</Text>
                        <Text style={styles.metaLabel}>  Packer: </Text>
                        <Text style={styles.metaText}>{operatorName(batch.assigned_packer_id)}</Text>
                      </Row>
                      {/* Pick progress bar */}
                      <View style={styles.progressRow}>
                        <Text style={styles.progressLabel}>Pick {pickProgress}%</Text>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${pickProgress}%` as any }]} />
                        </View>
                      </View>
                      {batch.status !== 'pending' && batch.status !== 'picking' && (
                        <View style={styles.progressRow}>
                          <Text style={styles.progressLabel}>Pack {packProgress}%</Text>
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFillPack, { width: `${packProgress}%` as any }]} />
                          </View>
                        </View>
                      )}
                    </Card>
                  );
                })
              )}
            </>
          )}

        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.bg2,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    color: colors.ink3,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  tabTextActive: {
    color: colors.bg,
    fontWeight: font.weight.bold,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  sectionHint: {
    color: colors.ink3,
    fontSize: font.size.sm,
    lineHeight: 18,
  },
  pickerGroup: { gap: spacing.xs },
  pickerLabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerRow: { flexDirection: 'row' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bg2,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.infoGhost,
  },
  chipText: { color: colors.ink3, fontSize: font.size.sm },
  chipTextSelected: { color: colors.accent, fontWeight: font.weight.semibold },
  summaryCard: { gap: spacing.xs },
  summaryKey: { color: colors.ink3, fontSize: font.size.sm },
  summaryVal: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  actionBtn: { marginTop: spacing.sm },
  poCard: { gap: spacing.xs, borderWidth: 1, borderColor: 'transparent' },
  poCardSelected: { borderColor: colors.accent },
  poSupplier: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  poMeta: { color: colors.ink3, fontSize: font.size.sm },
  batchCard: { gap: spacing.sm },
  batchId: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  batchMeta: { gap: 4 },
  metaLabel: { color: colors.ink3, fontSize: font.size.sm },
  metaText: { color: colors.ink2, fontSize: font.size.sm },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressLabel: { color: colors.ink3, fontSize: font.size.xs ?? 11, width: 60 },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  progressFillPack: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  emptyText: { color: colors.ink3, fontSize: font.size.sm },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});