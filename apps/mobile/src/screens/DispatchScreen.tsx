// apps/mobile/src/screens/DispatchScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, ScrollView, TouchableOpacity,
} from 'react-native';
import { Screen, Card, Button, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { useAuth } from '../hooks/useAuth';

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

type Batch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
  units_picked: number;
  units_packed: number;
  assigned_operator_id: number | null;
  assigned_packer_id: number | null;
  released_at: string;
};

type StowTask = {
  stow_task_id: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  location_code: string | null;
  status: string;
  claimed_by: number | null;
};

type ReceiveJob = {
  receive_job_id: string;
  supplier_name: string;
  status: string;
  total_variants: number;
  total_units: number;
  units_accepted: number;
  assigned_operator_id: number | null;
};

type ProcessTab = 'pick' | 'receive' | 'stow' | 'pack';

export default function DispatchScreen() {
  const { logout } = useAuth();
  
  const [orderPoolCount, setOrderPoolCount] = useState<number>(0);
  const [tab, setTab] = useState<ProcessTab>('pick');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stowTasks, setStowTasks] = useState<StowTask[]>([]);
  const [receiveJobs, setReceiveJobs] = useState<ReceiveJob[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Assignment state
  const [selectedPicker, setSelectedPicker] = useState<number | null>(null);
  const [selectedPacker, setSelectedPacker] = useState<number | null>(null);
  const [selectedReceiveOperator, setSelectedReceiveOperator] = useState<number | null>(null);
  const [selectedPo, setSelectedPo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opsRes, batchRes, stowRes, receiveRes, poRes, poolRes] = await Promise.all([
        apiClient.get('/api/v1/operators/team'),
        apiClient.get('/api/v1/wms/batches'),
        apiClient.get('/api/v1/wms/stow-tasks'),
        apiClient.get('/api/v1/suppliers/receive-jobs?status=pending,in_progress,inspection'),
        apiClient.get('/api/v1/suppliers/purchase-orders'),
        apiClient.get('/api/v1/wms/order-pool'),
      ]);
      setOperators(opsRes.data.operators ?? []);
      setBatches(batchRes.data.batches ?? []);
      setStowTasks(stowRes.data.stow_tasks ?? []);
      setReceiveJobs(receiveRes.data.receive_jobs ?? []);
      setPurchaseOrders(
        (poRes.data.purchase_orders ?? []).filter(
          (po: PurchaseOrder) => po.status === 'shipped' || po.status === 'partially_received'
        )
      );
      setOrderPoolCount(poolRes.data.eligible_order_count ?? 0);
    } catch {
      Alert.alert('Error', 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const operatorName = (id: number | null) => {
    if (!id) return 'Pool';
    const op = operators.find(o => o.user_id === id);
    return op ? op.first_name : `#${id}`;
  };

  // ── Release pick batch ────────────────────────────────────────────────────
  const handleReleaseBatch = useCallback(async () => {
    Alert.alert(
      'Release pick batch',
      selectedPicker
        ? `Assign picker to ${operatorName(selectedPicker)}?`
        : 'Dispatch to operator pool?',
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
                Alert.alert('✓ Batch released', `${result.data.order_count} orders · ${result.data.total_line_items} lines`);
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
  }, [selectedPicker, selectedPacker, load]);

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
        ? ` → ${operatorName(selectedReceiveOperator)}`
        : ' → pool'}?`,
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
              void load();
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
  }, [selectedPo, selectedReceiveOperator, purchaseOrders, load]);

  // ── Operator picker ───────────────────────────────────────────────────────
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={styles.pickerRow}>
            <TouchableOpacity
              style={selected === null ? styles.chipSelected : styles.chip}
              onPress={() => onSelect(null)}
            >
              <Text style={selected === null ? styles.chipTextSelected : styles.chipText}>Pool</Text>
            </TouchableOpacity>
            {operators.map((op) => (
              <TouchableOpacity
                key={op.user_id}
                style={selected === op.user_id ? styles.chipSelected : styles.chip}
                onPress={() => onSelect(op.user_id)}
              >
                <Text style={selected === op.user_id ? styles.chipTextSelected : styles.chipText}>
                  {op.first_name}
                </Text>
              </TouchableOpacity>
            ))}
          </Row>
        </ScrollView>
      </View>
    );
  }

  // ── Batch status badge ────────────────────────────────────────────────────
  const batchBadgeVariant = (status: string) => {
    if (status === 'picking') return 'info' as const;
    if (status === 'pick_complete') return 'success' as const;
    if (status === 'packing') return 'warning' as const;
    return 'info' as const;
  };

  const pickBatches = batches.filter(b => b.status === 'pending' || b.status === 'picking');
  const packBatches = batches.filter(b => b.status === 'pick_complete' || b.status === 'packing');

  return (
    <Screen>
      {/* HEADER */}
      <AppHeader showLogo onRefresh={() => void load()}  />
      {/* TOP NAV */}
      <Row style={styles.topNav}>
        {(['pick', 'receive', 'stow', 'pack'] as ProcessTab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={tab === t ? styles.topNavItemActive : styles.topNavItem}
            onPress={() => setTab(t)}
          >
            <Text style={tab === t ? styles.topNavTextActive : styles.topNavText}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </Row>

      <Divider />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── PICK TAB ── */}
          {tab === 'pick' && (
            <>
              {/* Active pick batches */}
              {pickBatches.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Active ({pickBatches.length})</Text>
                  {pickBatches.map((b) => (
                    <Card key={b.pick_batch_id} style={styles.jobCard}>
                      <Row style={styles.jobHeader}>
                        <Text style={styles.jobId}>{b.pick_batch_id.slice(0, 8).toUpperCase()}</Text>
                        <Badge label={b.status.replace('_', ' ').toUpperCase()} variant={batchBadgeVariant(b.status)} />
                      </Row>
                      <Text style={styles.jobMeta}>{b.total_line_items} lines · {b.total_units} units · picker: {operatorName(b.assigned_operator_id)}</Text>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${b.total_units > 0 ? Math.round((b.units_picked / b.total_units) * 100) : 0}%` as any }]} />
                      </View>
                    </Card>
                  ))}
                  <Divider />
                </>
              )}

              {/* Order pool */}
              <View style={[styles.poolCard, orderPoolCount > 0 && styles.poolCardActive]}>
                <Text style={styles.poolCount}>{orderPoolCount}</Text>
                <Text style={styles.poolLabel}>
                  {orderPoolCount === 1 ? 'order' : 'orders'} ready in pool
                </Text>
              </View>

              {/* Release new batch */}
              <Text style={styles.sectionTitle}>Release batch</Text>
              <Text style={styles.sectionHint}>System selects eligible orders automatically. Oldest orders released first.</Text>

              <OperatorPicker label="Picker" selected={selectedPicker} onSelect={setSelectedPicker} />
              <OperatorPicker label="Packer" selected={selectedPacker} onSelect={setSelectedPacker} />
              <Button
                label={submitting ? 'Releasing…' : 'Release pick batch'}
                onPress={() => void handleReleaseBatch()}
                variant="primary"
                style={styles.actionBtn}
              />
            </>
          )}

          {/* ── RECEIVE TAB ── */}
          {tab === 'receive' && (
            <>
              {/* Active receive jobs */}
              {receiveJobs.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Active ({receiveJobs.length})</Text>
                  {receiveJobs.map((j) => (
                    <Card key={j.receive_job_id} style={styles.jobCard}>
                      <Row style={styles.jobHeader}>
                        <Text style={styles.jobSupplier}>{j.supplier_name}</Text>
                        <Badge
                          label={j.status.replace('_', ' ').toUpperCase()}
                          variant={j.status === 'closed' ? 'success' : 'info'}
                        />
                      </Row>
                      <Text style={styles.jobMeta}>
                        {j.total_variants} variants · {j.units_accepted} accepted · operator: {operatorName(j.assigned_operator_id)}
                      </Text>
                    </Card>
                  ))}
                  <Divider />
                </>
              )}

              {/* Create receive job */}
              <Text style={styles.sectionTitle}>New receive job</Text>
              {purchaseOrders.length === 0 ? (
                <Text style={styles.emptyText}>No POs ready to receive.</Text>
              ) : (
                <>
                  <Text style={styles.pickerLabel}>Select PO</Text>
                  {purchaseOrders.map((po) => (
                    <TouchableOpacity
                      key={po.id}
                      onPress={() => setSelectedPo(po.id === selectedPo ? null : po.id)}
                    >
                      <Card style={selectedPo === po.id
                        ? { ...styles.poCard, ...styles.poCardSelected }
                        : styles.poCard}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Text style={styles.jobSupplier}>{po.supplier_name}</Text>
                          <Badge label={po.status === 'shipped' ? 'SHIPPED' : 'PARTIAL'} variant={po.status === 'shipped' ? 'success' : 'warning'} />
                        </Row>
                        <Text style={styles.jobMeta}>
                          {po.line_items_count} variants · {po.total_units_ordered} units
                          {po.expected_delivery_date ? ` · ETA ${po.expected_delivery_date}` : ''}
                        </Text>
                      </Card>
                    </TouchableOpacity>
                  ))}
                  <OperatorPicker label="Assign operator" selected={selectedReceiveOperator} onSelect={setSelectedReceiveOperator} />
                  <Button
                    label={submitting ? 'Creating…' : 'Create receive job'}
                    onPress={() => void handleCreateReceiveJob()}
                    variant="primary"
                    style={styles.actionBtn}
                  />
                </>
              )}
            </>
          )}

          {/* ── STOW TAB ── */}
          {tab === 'stow' && (
            <>
              <Text style={styles.sectionTitle}>
                Stow tasks ({stowTasks.length})
              </Text>
              {stowTasks.length === 0 ? (
                <Text style={styles.emptyText}>No stow tasks pending.</Text>
              ) : (
                stowTasks.map((t) => (
                  <Card key={t.stow_task_id} style={styles.jobCard}>
                    <Row style={styles.jobHeader}>
                      <Text style={styles.jobSupplier} numberOfLines={1}>
                        {t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8)}
                      </Text>
                      <Badge
                        label={t.status === 'in_progress' ? 'IN PROGRESS' : 'PENDING'}
                        variant={t.status === 'in_progress' ? 'warning' : 'info'}
                      />
                    </Row>
                    <Text style={styles.jobMeta}>
                      {t.quantity} units → {t.location_code ?? 'No location'} · operator: {operatorName(t.claimed_by)}
                    </Text>
                  </Card>
                ))
              )}
            </>
          )}

          {/* ── PACK TAB ── */}
          {tab === 'pack' && (
            <>
              <Text style={styles.sectionTitle}>
                Pack jobs ({packBatches.length})
              </Text>
              {packBatches.length === 0 ? (
                <Text style={styles.emptyText}>No batches ready to pack.</Text>
              ) : (
                packBatches.map((b) => (
                  <Card key={b.pick_batch_id} style={styles.jobCard}>
                    <Row style={styles.jobHeader}>
                      <Text style={styles.jobId}>{b.pick_batch_id.slice(0, 8).toUpperCase()}</Text>
                      <Badge label={b.status.replace('_', ' ').toUpperCase()} variant={batchBadgeVariant(b.status)} />
                    </Row>
                    <Text style={styles.jobMeta}>
                      {b.total_units} units · packer: {operatorName(b.assigned_packer_id)}
                    </Text>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFillPack, { width: `${b.total_units > 0 ? Math.round((b.units_packed / b.total_units) * 100) : 0}%` as any }]} />
                    </View>
                  </Card>
                ))
              )}
            </>
          )}

        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  refreshText: { color: colors.accent, fontSize: font.size.xl },
  topNav: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  topNavItem: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.bg2,
  },
  topNavItemActive: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  topNavText: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  topNavTextActive: { color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.bold },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  sectionHint: { color: colors.ink3, fontSize: font.size.sm, lineHeight: 18 },
  jobCard: { gap: spacing.xs },
  jobHeader: { justifyContent: 'space-between', alignItems: 'center' },
  jobId: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.bold },
  jobSupplier: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, flex: 1, marginRight: spacing.sm },
  jobMeta: { color: colors.ink3, fontSize: font.size.sm },
  progressTrack: { height: 4, backgroundColor: colors.bg3, borderRadius: 2, overflow: 'hidden', marginTop: spacing.xs },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  progressFillPack: { height: '100%', backgroundColor: colors.success, borderRadius: 2 },
  pickerGroup: { gap: spacing.xs },
  pickerLabel: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  pickerRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.bg2, borderWidth: 1, borderColor: 'transparent' },
  chipSelected: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.accentGhost, borderWidth: 1, borderColor: colors.accentBorder },
  chipText: { color: colors.ink3, fontSize: font.size.sm },
  chipTextSelected: { color: colors.accent, fontWeight: font.weight.semibold, fontSize: font.size.sm },
  poCard: { gap: spacing.xs, borderWidth: 1, borderColor: 'transparent' },
  poCardSelected: { borderColor: colors.accent },
  actionBtn: { marginTop: spacing.xs },
  emptyText: { color: colors.ink3, fontSize: font.size.sm },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  poolCard: {
    backgroundColor: colors.bg2,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  poolCardActive: {
    borderColor: colors.accentBorder,
  },
  poolCount: {
    color: colors.accent,
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold,
  },
  poolLabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
    marginTop: spacing.xs,
  },
});