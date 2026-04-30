// apps/mobile/src/screens/DispatchScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Button, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { useAuth } from '../hooks/useAuth';

type ProcessTab = 'inbound' | 'outbound' | 'exceptions';

type Operator = { id: number; name: string; email: string };
type Batch = {
  pick_batch_id: string;
  status: string;
  total_units: number;
  total_line_items: number;
  assigned_operator_id: number | null;
  assigned_packer_id: number | null;
};
type StowTask = {
  stow_task_id: string;
  status: string;
  variant_title: string | null;
  quantity: number;
  location_code: string | null;
};
type ReceiveJob = {
  receive_job_id: string;
  status: string;
  supplier_name: string;
  po_id: string;
  assigned_operator_id: number | null;
};
type PurchaseOrder = {
  id: string;
  status: string;
  supplier_name: string;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  total_units_ordered: number;
  line_items_count: number;
  has_active_job: boolean;
};
type ProblemTask = {
  problem_task_id: string;
  status: string;
  source: string;
  exception_type: string;
  quantity: number;
  variant_title: string | null;
  sku: string | null;
  prob_label: string;
  problem_bin_location: string | null;
  created_at: string;
};

function getEtaLabel(dateStr: string | null): { label: string; variant: 'error' | 'warning' | 'info' | 'success' } {
  if (!dateStr) return { label: 'No ETA', variant: 'info' };
  const eta = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((eta.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: 'Overdue', variant: 'error' };
  if (diffDays === 0) return { label: 'Arriving today', variant: 'warning' };
  if (diffDays <= 3) return { label: `In ${diffDays} day${diffDays > 1 ? 's' : ''}`, variant: 'warning' };
  if (diffDays <= 7) return { label: 'This week', variant: 'info' };
  if (diffDays <= 30) return { label: 'This month', variant: 'info' };
  return { label: 'Next month+', variant: 'info' };
}

export default function DispatchScreen() {
  const { logout } = useAuth();
  const [tab, setTab] = useState<ProcessTab>('inbound');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stowTasks, setStowTasks] = useState<StowTask[]>([]);
  const [receiveJobs, setReceiveJobs] = useState<ReceiveJob[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [problemTasks, setProblemTasks] = useState<ProblemTask[]>([]);
  const [orderPoolCount, setOrderPoolCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Inbound state
  const [selectedPo, setSelectedPo] = useState<string | null>(null);
  const [selectedReceiveOperator, setSelectedReceiveOperator] = useState<number | null>(null);

  // Outbound state
  const [selectedPicker, setSelectedPicker] = useState<number | null>(null);

  // PO Modal States
  const [poModal, setPoModal] = useState<PurchaseOrder | null>(null);
  const [poSubmitting, setPoSubmitting] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [opsRes, batchRes, stowRes, receiveRes, poRes, poolRes, problemRes] = await Promise.all([
        apiClient.get('/api/v1/operators/team'),
        apiClient.get('/api/v1/wms/batches'),
        apiClient.get('/api/v1/wms/stow-tasks'),
        apiClient.get('/api/v1/suppliers/receive-jobs?status=pending,in_progress,inspection'),
        apiClient.get('/api/v1/suppliers/purchase-orders'),
        apiClient.get('/api/v1/wms/order-pool'),
        apiClient.get('/api/v1/wms/problem-center'),
      ]);

      setOperators(opsRes.data.members ?? []);
      setBatches(batchRes.data.batches ?? []);
      setStowTasks(stowRes.data.stow_tasks ?? []);
      setReceiveJobs(receiveRes.data.receive_jobs ?? []);
      setOrderPoolCount(poolRes.data.eligible_order_count ?? 0);
      setProblemTasks(problemRes.data.problem_tasks ?? []);

      // Enrich POs with active job flag
      const jobs: ReceiveJob[] = receiveRes.data.receive_jobs ?? [];
      const activePoIds = new Set(jobs.map(j => j.po_id));
      const pos = (poRes.data.purchase_orders ?? []).map((po: PurchaseOrder) => ({
        ...po,
        has_active_job: activePoIds.has(po.id),
      }));
      setPurchaseOrders(pos);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  // ── PO status update handler ─────────────────────────────────────────────────────────
  const handlePoStatusUpdate = useCallback(async (poId: string, status: string) => {
    setPoSubmitting(true);
    try {
      await apiClient.patch(`/api/v1/suppliers/purchase-orders/${poId}/status`, {
        status,
        ...(status === 'shipped' && { actual_delivery_date: new Date().toISOString().split('T')[0] }),
      });
      setPoModal(null);
      void load(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to update PO.';
      Alert.alert('Error', msg);
    } finally {
      setPoSubmitting(false);
    }
  }, [load]);

  // ── Release batch ─────────────────────────────────────────────────────────
  const handleReleaseBatch = useCallback(async () => {
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/wms/batch/release', {
        assigned_operator_id: selectedPicker ?? null,
        assigned_packer_id: null,
      });
      setSelectedPicker(null);
      void load(true);
      Alert.alert('✓ Batch released', 'Pick batch is now available for operators.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to release batch.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [selectedPicker, load]);

  // ── Create receive job ────────────────────────────────────────────────────
  const handleCreateReceiveJob = useCallback(async () => {
    if (!selectedPo) { Alert.alert('Select a PO first'); return; }
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/suppliers/purchase-orders/${selectedPo}/receive-jobs`, {
        assigned_operator_id: selectedReceiveOperator ?? null,
      });
      setSelectedPo(null);
      setSelectedReceiveOperator(null);
      void load(true);
      Alert.alert('✓ Receive job created', 'Operators can now claim the job.');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to create receive job.';
      if (status === 409) Alert.alert('Already exists', msg);
      else Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [selectedPo, selectedReceiveOperator, load]);

  // ── Operator picker chip ──────────────────────────────────────────────────
  const OperatorPicker = ({ label, selected, onSelect }: {
    label: string;
    selected: number | null;
    onSelect: (id: number | null) => void;
  }) => (
    <View style={styles.operatorPicker}>
      <Text style={styles.operatorPickerLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row style={styles.operatorChips}>
          <TouchableOpacity
            style={[styles.chip, selected === null && styles.chipSelected]}
            onPress={() => onSelect(null)}
          >
            <Text style={[styles.chipText, selected === null && styles.chipTextSelected]}>
              Pool
            </Text>
          </TouchableOpacity>
          {operators.map(op => (
            <TouchableOpacity
              key={op.id}
              style={[styles.chip, selected === op.id && styles.chipSelected]}
              onPress={() => onSelect(op.id)}
            >
              <Text style={[styles.chipText, selected === op.id && styles.chipTextSelected]}>
                {op.name ?? op.email.split('@')[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </Row>
      </ScrollView>
    </View>
  );

  const activeBatches = batches.filter(b => !['pack_complete', 'cancelled'].includes(b.status));
  const activeStow = stowTasks.filter(t => ['pending', 'in_progress'].includes(t.status));
  const activeReceive = receiveJobs.filter(j => ['pending', 'in_progress', 'inspection'].includes(j.status));
  const packReady = batches.filter(b => ['pick_complete', 'packing'].includes(b.status));
  const openProblems = problemTasks.filter(t => ['open', 'investigating'].includes(t.status));

  return (
    <Screen>
      <AppHeader showLogo onRefresh={() => void load()} />

      {/* Top nav */}
      <View style={styles.topNav}>
        {(['inbound', 'outbound', 'exceptions'] as ProcessTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={t === tab ? styles.topNavItemActive : styles.topNavItem}
            onPress={() => setTab(t)}
          >
            <Text style={t === tab ? styles.topNavTextActive : styles.topNavText}>
              {t === 'inbound' ? 'Inbound' : t === 'outbound' ? 'Outbound' : 'Exceptions'}
            </Text>
            {t === 'exceptions' && openProblems.length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{openProblems.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── INBOUND ── */}
          {tab === 'inbound' && (
            <>
              {/* Summary cards */}
              <Row style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCount}>{activeReceive.length}</Text>
                  <Text style={styles.summaryLabel}>Active receive</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCount}>{activeStow.length}</Text>
                  <Text style={styles.summaryLabel}>Stow pending</Text>
                </View>
              </Row>
              <Divider />

              {/* Active receive jobs */}
              {activeReceive.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Active receive jobs</Text>
                  {activeReceive.map(job => (
                    <Card key={job.receive_job_id} style={styles.jobCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.jobTitle}>{job.supplier_name}</Text>
                        <Badge label={job.status.toUpperCase()} variant="info" />
                      </Row>
                    </Card>
                  ))}
                  <Divider />
                </>
              )}

              {/* Active stow tasks */}
              {activeStow.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Stow tasks</Text>
                  {activeStow.map(t => (
                    <Card key={t.stow_task_id} style={styles.jobCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.jobTitle}>{t.variant_title ?? t.stow_task_id.slice(0, 8)}</Text>
                        <Badge label={`${t.quantity} units`} variant="warning" />
                      </Row>
                      {t.location_code && (
                        <Text style={styles.jobMeta}>{t.location_code}</Text>
                      )}
                    </Card>
                  ))}
                  <Divider />
                </>
              )}

              {/* Create receive job */}
              <Text style={styles.sectionTitle}>Create receive job</Text>
              <Text style={styles.sectionHint}>Select a shipped PO to open a receive session.</Text>

              {purchaseOrders
                .filter(po => ['shipped', 'partially_received'].includes(po.status))
                .map(po => (
                  <TouchableOpacity
                    key={po.id}
                    style={[
                      styles.poCard,
                      selectedPo === po.id && styles.poCardSelected,
                      po.has_active_job && styles.poCardDisabled,
                    ]}
                    onPress={() => !po.has_active_job && setSelectedPo(
                      selectedPo === po.id ? null : po.id
                    )}
                    disabled={po.has_active_job}
                  >
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.poName}>{po.supplier_name}</Text>
                      <Row style={{ gap: spacing.xs }}>
                        {po.has_active_job
                          ? <Badge label="JOB ACTIVE" variant="warning" />
                          : <Badge label="ARRIVED" variant="success" />
                        }
                      </Row>
                    </Row>
                    {(() => {
                      const dateStr = po.actual_delivery_date ?? po.expected_delivery_date;
                      const label = po.actual_delivery_date ? 'Arrived' : 'Expected';
                      if (!dateStr) return null;
                      return (
                        <Text style={styles.poMeta}>
                          {label}: {new Date(dateStr).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </Text>
                      );
                    })()}
                  </TouchableOpacity>
                ))
              }

              {purchaseOrders.filter(po => ['shipped', 'partially_received'].includes(po.status)).length === 0 && (
                <Text style={styles.emptyText}>No POs ready to receive.</Text>
              )}

              <OperatorPicker
                label="Assign operator (optional)"
                selected={selectedReceiveOperator}
                onSelect={setSelectedReceiveOperator}
              />

              <Button
                label={submitting ? 'Creating…' : 'Create receive job'}
                onPress={() => void handleCreateReceiveJob()}
                variant={selectedPo ? 'primary' : 'ghost'}
                style={{ marginTop: spacing.md }}
              />

              {/* PO Pipeline */}
              {purchaseOrders.filter(po => !['shipped', 'partially_received', 'received', 'cancelled'].includes(po.status)).length > 0 && (
                <>
                  <Divider />
                  <Text style={styles.sectionTitle}>PO pipeline</Text>
                  <Text style={styles.sectionHint}>All open purchase orders and their arrival status.</Text>
                  {purchaseOrders
                    .filter(po => !['shipped', 'partially_received', 'received', 'cancelled'].includes(po.status))
                    .sort((a, b) => {
                      if (!a.expected_delivery_date) return 1;
                      if (!b.expected_delivery_date) return -1;
                      return new Date(a.expected_delivery_date).getTime() - new Date(b.expected_delivery_date).getTime();
                    })
                    .map(po => {
                      const eta = getEtaLabel(po.expected_delivery_date);
                      return (
                        <TouchableOpacity key={po.id} onPress={() => setPoModal(po)}>
                         <Card style={styles.pipelineCard}>
                          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.jobTitle} numberOfLines={1}>
                                {po.supplier_name}
                              </Text>
                              <Text style={styles.jobMeta}>
                                {po.line_items_count} SKU{Number(po.line_items_count) !== 1 ? 's' : ''} · {po.total_units_ordered} units
                              </Text>
                            </View>
                            <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
                              <Badge
                                label={po.status.replace(/_/g, ' ').toUpperCase()}
                                variant={
                                  po.status === 'shipped' ? 'success' :
                                  po.status === 'partially_received' ? 'warning' : 'info'
                                }
                              />
                              <Badge label={eta.label} variant={eta.variant} />
                            </View>
                          </Row>
                          {(() => {
                            const dateStr = po.actual_delivery_date ?? po.expected_delivery_date;
                            const label = po.actual_delivery_date ? 'Arrived' : 'Expected';
                            if (!dateStr) return null;
                            return (
                              <Text style={styles.poMeta}>
                                {label}: {new Date(dateStr).toLocaleDateString('en-GB', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                })}
                              </Text>
                            );
                          })()}
                         </Card>
                        </TouchableOpacity>
                      );
                    })
                  }
                </>
              )}
            </>
          )}

          {/* ── OUTBOUND ── */}
          {tab === 'outbound' && (
            <>
              {/* Order pool card */}
              <View style={[styles.poolCard, orderPoolCount > 0 && styles.poolCardActive]}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={styles.poolCount}>{orderPoolCount}</Text>
                    <Text style={styles.poolLabel}>
                      {orderPoolCount === 1 ? 'order' : 'orders'} ready in pool
                    </Text>
                  </View>
                  <Ionicons
                    name="layers-outline"
                    size={32}
                    color={orderPoolCount > 0 ? colors.accent : colors.ink4}
                  />
                </Row>
              </View>

              {/* Active batches */}
              {activeBatches.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Active batches</Text>
                  {activeBatches.map(batch => (
                    <Card key={batch.pick_batch_id} style={styles.jobCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.jobTitle}>
                          {batch.pick_batch_id.slice(0, 8).toUpperCase()}
                        </Text>
                        <Badge
                          label={batch.status.replace(/_/g, ' ').toUpperCase()}
                          variant={
                            batch.status === 'picking' ? 'info' :
                            batch.status === 'pick_complete' ? 'success' :
                            batch.status === 'packing' ? 'warning' : 'info'
                          }
                        />
                      </Row>
                      <Text style={styles.jobMeta}>
                        {batch.total_units} units · {batch.total_line_items} lines
                      </Text>
                    </Card>
                  ))}
                  <Divider />
                </>
              )}

              {/* Release batch */}
              <Text style={styles.sectionTitle}>Release pick batch</Text>
              <Text style={styles.sectionHint}>
                System selects eligible orders automatically. Oldest orders released first.
              </Text>

              <OperatorPicker
                label="Assign picker (optional)"
                selected={selectedPicker}
                onSelect={setSelectedPicker}
              />

              <Button
                label={submitting ? 'Releasing…' : orderPoolCount > 0 ? 'Release batch' : 'No orders in pool'}
                onPress={() => orderPoolCount > 0 ? void handleReleaseBatch() : null}
                variant={orderPoolCount > 0 ? 'primary' : 'ghost'}
                style={{ marginTop: spacing.md }}
              />
            </>
          )}

          {/* ── EXCEPTIONS ── */}
          {tab === 'exceptions' && (
            <>
              <Row style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={[styles.summaryCount, openProblems.length > 0 && { color: colors.error }]}>
                    {openProblems.length}
                  </Text>
                  <Text style={styles.summaryLabel}>Open problems</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCount}>
                    {problemTasks.filter(t => t.status === 'resolved').length}
                  </Text>
                  <Text style={styles.summaryLabel}>Resolved</Text>
                </View>
              </Row>
              <Divider />

              {openProblems.length === 0 ? (
                <View style={styles.center}>
                  <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
                  <Text style={styles.quietTitle}>No open exceptions</Text>
                  <Text style={styles.quietSub}>All problems resolved.</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>Open problem tasks</Text>
                  {openProblems.map(task => (
                    <Card key={task.problem_task_id} style={styles.problemCard}>
                      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.jobTitle} numberOfLines={1}>
                            {task.variant_title ?? task.sku ?? '—'}
                          </Text>
                          <Text style={styles.jobMeta}>
                            {task.exception_type.replace(/_/g, ' ')} · {task.quantity} unit{task.quantity > 1 ? 's' : ''}
                          </Text>
                        </View>
                        <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
                          <Badge
                            label={task.source.toUpperCase()}
                            variant="info"
                          />
                          <Badge
                            label={task.status.toUpperCase()}
                            variant={task.status === 'open' ? 'error' : 'warning'}
                          />
                        </View>
                      </Row>
                      <Row style={styles.probLabelRow}>
                        <Ionicons name="pricetag-outline" size={14} color={colors.accent} />
                        <Text style={styles.probLabelText}>{task.prob_label}</Text>
                        {task.problem_bin_location && (
                          <Text style={styles.probBin}>→ {task.problem_bin_location}</Text>
                        )}
                      </Row>
                    </Card>
                  ))}
                </>
              )}
            </>
          )}

        </ScrollView>
      )}
    {/* PO Modal */}
      <Modal
        visible={!!poModal}
        transparent
        animationType="slide"
        onRequestClose={() => setPoModal(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setPoModal(null)}
        />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />
          {poModal && (
            <>
              <Text style={styles.modalTitle}>{poModal.supplier_name}</Text>
              <Text style={styles.modalSubtitle}>
                {poModal.line_items_count} SKU{Number(poModal.line_items_count) !== 1 ? 's' : ''} · {poModal.total_units_ordered} units
              </Text>
              {poModal.expected_delivery_date && (
                <Text style={styles.modalMeta}>
                  ETA: {new Date(poModal.expected_delivery_date).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </Text>
              )}

              <View style={styles.modalDivider} />

              {/* Status badge */}
              <Row style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                <Badge
                  label={poModal.status.replace(/_/g, ' ').toUpperCase()}
                  variant={poModal.status === 'shipped' ? 'success' : 'info'}
                />
                <Badge label={getEtaLabel(poModal.expected_delivery_date).label}
                  variant={getEtaLabel(poModal.expected_delivery_date).variant}
                />
              </Row>

              {/* Actions */}
              {!['shipped', 'partially_received', 'received'].includes(poModal.status) && (
                <TouchableOpacity
                  style={styles.modalActionPrimary}
                  onPress={() => void handlePoStatusUpdate(poModal.id, 'shipped')}
                  disabled={poSubmitting}
                >
                  <Ionicons name="checkmark-circle-outline" size={20} color={colors.bg} />
                  <Text style={styles.modalActionPrimaryText}>
                    {poSubmitting ? 'Updating…' : 'Mark as arrived'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.modalActionSecondary}
                onPress={() => {
                  setPoModal(null);
                  Alert.alert('Coming soon', 'PO edit screen coming in next sprint.');
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.ink} />
                <Text style={styles.modalActionSecondaryText}>Modify PO</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalActionDanger}
                onPress={() => {
                  Alert.alert(
                    'Cancel PO',
                    'Are you sure you want to cancel this purchase order?',
                    [
                      { text: 'Keep', style: 'cancel' },
                      { text: 'Cancel PO', style: 'destructive',
                        onPress: () => void handlePoStatusUpdate(poModal.id, 'cancelled') },
                    ]
                  );
                }}
                disabled={poSubmitting}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                <Text style={styles.modalActionDangerText}>Cancel PO</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setPoModal(null)}
              >
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topNav: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  topNavItem: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.bg2, flexDirection: 'row',
    justifyContent: 'center', gap: spacing.xs,
  },
  topNavItemActive: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.accent, flexDirection: 'row',
    justifyContent: 'center', gap: spacing.xs,
  },
  topNavText: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  topNavTextActive: { color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.bold },
  tabBadge: {
    backgroundColor: colors.error, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: colors.bg, fontSize: 10, fontWeight: font.weight.bold },
  content: { padding: spacing.lg, paddingBottom: 100, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  summaryRow: { gap: spacing.md },
  summaryCard: {
    flex: 1, backgroundColor: colors.bg2, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', gap: spacing.xs,
    borderWidth: 1, borderColor: colors.rule,
  },
  summaryCount: { color: colors.accent, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs },
  sectionTitle: {
    color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold,
  },
  sectionHint: { color: colors.ink3, fontSize: font.size.sm, marginTop: -spacing.xs },
  jobCard: { gap: spacing.xs },
  jobTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, flex: 1 },
  jobMeta: { color: colors.ink3, fontSize: font.size.sm },
  poCard: {
    backgroundColor: colors.bg2, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.rule, gap: spacing.xs,
  },
  poCardSelected: { borderColor: colors.accent, backgroundColor: colors.accentGhost },
  poCardDisabled: { opacity: 0.5 },
  poName: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, flex: 1 },
  poMeta: { color: colors.ink3, fontSize: font.size.sm },
  poolCard: {
    backgroundColor: colors.bg2, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.rule,
  },
  poolCardActive: { borderColor: colors.accentBorder },
  poolCount: { color: colors.accent, fontSize: font.size.xxl, fontWeight: font.weight.bold },
  poolLabel: { color: colors.ink3, fontSize: font.size.sm, marginTop: spacing.xs },
  operatorPicker: { gap: spacing.sm },
  operatorPickerLabel: { color: colors.ink3, fontSize: font.size.sm },
  operatorChips: { gap: spacing.sm, flexWrap: 'nowrap' },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.sm, backgroundColor: colors.bg2,
    borderWidth: 1, borderColor: colors.rule,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentGhost },
  chipText: { color: colors.ink3, fontSize: font.size.sm },
  chipTextSelected: { color: colors.accent, fontWeight: font.weight.semibold },
  problemCard: { gap: spacing.sm },
  probLabelRow: { alignItems: 'center', gap: spacing.xs },
  probLabelText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.bold },
  probBin: { color: colors.ink3, fontSize: font.size.sm },
  emptyText: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center', paddingVertical: spacing.md },
  quietTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  quietSub: { color: colors.ink3, fontSize: font.size.md },
  pipelineCard: { gap: spacing.xs },
  etaDate: { color: colors.ink4, fontSize: font.size.xs },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.bg2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: colors.ink4,
    borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm,
  },
  modalTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  modalSubtitle: { color: colors.ink3, fontSize: font.size.sm },
  modalMeta: { color: colors.ink4, fontSize: font.size.xs },
  modalDivider: { height: 1, backgroundColor: colors.rule, marginVertical: spacing.xs },
  modalActionPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.accent, borderRadius: radius.md,
    padding: spacing.md,
  },
  modalActionPrimaryText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  modalActionSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bg3, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.rule,
  },
  modalActionSecondaryText: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.medium },
  modalActionDanger: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.errorGhost, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.errorBorder,
  },
  modalActionDangerText: { color: colors.error, fontSize: font.size.md, fontWeight: font.weight.medium },
  modalCancel: { alignItems: 'center', paddingVertical: spacing.md },
  modalCancelText: { color: colors.ink3, fontSize: font.size.md },
});