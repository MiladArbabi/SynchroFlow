// apps/mobile/src/screens/StowScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider, AppHeader, WorkflowStep } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { Ionicons } from '@expo/vector-icons';

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

type ScreenPhase = 'summary' | 'location_scan' | 'product_scan' | 'qty_confirm' | 'complete';

const STOW_EXCEPTIONS = [
  { type: 'item_missing', label: 'Item missing', icon: 'search-outline' },
  { type: 'product_defect', label: 'Damaged', icon: 'hammer-outline' },
  { type: 'packaging_defect', label: 'Packaging', icon: 'cube-outline' },
];

export default function StowScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'Stow'>['route']>();
  const { task } = route.params;

  const [screenPhase, setScreenPhase] = useState<ScreenPhase>('summary');
  const [tasks, setTasks] = useState<StowTask[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedLocation, setConfirmedLocation] = useState<string | null>(null);

  // Partial stow tracking
  const [remainingQty, setRemainingQty] = useState(0);
  const [qtyInput, setQtyInput] = useState('');

  const currentTask = tasks[currentIndex] ?? null;

  const [shortfallModal, setShortfallModal] = useState<{
    qty: number;
    shortfall: number;
    reportedExceptions: Array<{ type: string; qty: number; probLabel: string }>;
  } | null>(null);
  const [selectedExType, setSelectedExType] = useState('');
  const [exQtyInput, setExQtyInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/wms/stow-tasks');
      const all = (data.stow_tasks ?? []).filter(
        (t: StowTask) => t.status === 'pending' || t.status === 'in_progress'
      );
      const tapped = all.find((t: StowTask) => t.stow_task_id === task.id);
      const rest = all.filter((t: StowTask) => t.stow_task_id !== task.id);
      const ordered = tapped ? [tapped, ...rest] : all;
      setTasks(ordered);
      if (ordered.length > 0) {
        setRemainingQty(ordered[0].quantity);
        // Resume in-progress task at correct step
        if (ordered[0].status === 'in_progress' && ordered[0].location_code) {
          setConfirmedLocation(ordered[0].location_code);
          setScreenPhase('product_scan');
        }
      }
    } catch {
      setError('Failed to load stow tasks.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  // ── Location scan confirmed ───────────────────────────────────────────────
  const handleLocationScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;

    const { data } = await apiClient.post('/api/v1/wms/location/resolve', {
      scanned_value: scannedValue,
    });

    if (!data?.location_code) {
      throw Object.assign(new Error('Location not found.'), {
        response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
      });
    }

    if (!currentTask.location_code) {
      await apiClient.patch(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/location`, {
        location_code: data.location_code,
      });
    } else if (data.location_code !== currentTask.location_code) {
      throw Object.assign(new Error('Wrong location.'), {
        response: { data: { error: `Wrong location. Expected: ${currentTask.location_code}` } },
      });
    }

    setTasks(prev => prev.map((t, i) =>
      i === currentIndex ? { ...t, location_code: data.location_code, status: 'in_progress' } : t
    ));

    try {
      await apiClient.post(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/claim`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? '';
      // Already claimed by this operator — treat as success
      if (!msg.includes('already') && !msg.includes('in_progress')) throw err;
    }
    setConfirmedLocation(data.location_code);
    setScreenPhase('product_scan');
  }, [currentTask, currentIndex]);

  // ── Product scan confirmed ────────────────────────────────────────────────
  const handleProductScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;

    const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
      scanned_value: scannedValue,
    });

    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again.' } },
      });
    }

    if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong product.'), {
        response: { data: { error: 'Wrong product — does not match this stow task.' } },
      });
    }

    // Move to qty confirmation
    setQtyInput('');
    setScreenPhase('qty_confirm');
  }, [currentTask]);

  // ── Submit Handler Helper ───────────────────────────────────────────────────────────
  const submitStow = useCallback(async (qty: number, exceptionsFiled = false) => {
    if (!currentTask) return;
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/confirm`, {
        quantity_placed: qty,
      });
      const newRemaining = remainingQty - qty;
      // Only loop back for partial stow if no exceptions were filed for the shortfall.
      // If exceptions cover the gap, advance to next task.
      if (newRemaining > 0 && !exceptionsFiled) {
        setRemainingQty(newRemaining);
        setConfirmedLocation(null);
        setQtyInput('');
        setShortfallModal(null);
        setScreenPhase('location_scan');
      } else {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= tasks.length) {
          setScreenPhase('complete');
        } else {
          setCurrentIndex(nextIndex);
          setRemainingQty(tasks[nextIndex].quantity);
          setConfirmedLocation(null);
          setQtyInput('');
          setShortfallModal(null);
          setScreenPhase('location_scan');
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Stow confirm failed.';
      if (msg.includes('not in progress') || msg.includes('completed')) {
        // Already confirmed — advance
        const nextIndex = currentIndex + 1;
        if (nextIndex >= tasks.length) setScreenPhase('complete');
        else {
          setCurrentIndex(nextIndex);
          setRemainingQty(tasks[nextIndex].quantity);
          setConfirmedLocation(null);
          setQtyInput('');
          setShortfallModal(null);
          setScreenPhase('location_scan');
        }
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [currentTask, remainingQty, currentIndex, tasks]);

  // ── Qty confirm ───────────────────────────────────────────────────────────
  const handleQtyConfirm = useCallback(async () => {
    if (!currentTask) return;

    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid', 'Enter how many units you are placing here.');
      return;
    }
    if (qty > remainingQty) {
      Alert.alert('Too many', `Only ${remainingQty} units remaining to stow.`);
      return;
    }

    const shortfall = remainingQty - qty;

    if (shortfall > 0) {
      // Show shortfall modal — same pattern as receive
      setShortfallModal({ qty, shortfall, reportedExceptions: [] });
      setSelectedExType('');
      setExQtyInput(String(shortfall));
      return;
    }

    await submitStow(qty);
  }, [currentTask, qtyInput, remainingQty]);

  // ── Exception handler ─────────────────────────────────────────────────────
  const handleException = useCallback(async (exceptionType: string, quantity: number = 1) => {
    if (!currentTask) return;
    try {
      await apiClient.post(`/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/exception`, {
        exception_type: exceptionType,
        quantity,
        notes: 'Reported during stow',
      });

      const newRemaining = remainingQty - quantity;
      if (newRemaining <= 0) {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= tasks.length) {
          setScreenPhase('complete');
        } else {
          setCurrentIndex(nextIndex);
          setRemainingQty(tasks[nextIndex].quantity);
          setConfirmedLocation(null);
          setScreenPhase('location_scan');
        }
      } else {
        setRemainingQty(newRemaining);
      }
    } catch {
      Alert.alert('Error', 'Failed to report exception.');
    }
  }, [currentTask, remainingQty, currentIndex, tasks]);


  // ----------------- shortfall exception confirm handler ---------------------------//
  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallModal || !currentTask || !selectedExType) return;

    const exQty = parseInt(exQtyInput, 10);
    if (isNaN(exQty) || exQty <= 0 || exQty > shortfallModal.shortfall) {
      Alert.alert('Invalid', `Enter between 1 and ${shortfallModal.shortfall}.`);
      return;
    }

    setSubmitting(true);
    try {
      const { data: probData } = await apiClient.post(
        `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/exception`,
        { exception_type: selectedExType, quantity: exQty, notes: 'Reported during stow qty confirm' }
      );

      const newReported = [
        ...shortfallModal.reportedExceptions,
        { type: selectedExType, qty: exQty, probLabel: probData.prob_label ?? 'PROB-?' },
      ];
      // Tip operator to place item in problem bin
      if (selectedExType !== 'item_missing') {
        Alert.alert(
          '⚠ Place in Problem Bin',
          `Label ${probData.prob_label ?? 'PROB-?'} — place the item in ${probData.problem_bin ?? 'the PROBLEM BIN'} before continuing.`,
          [{ text: 'Got it', style: 'default' }]
        );
      }
      const newShortfall = shortfallModal.shortfall - exQty;

      if (newShortfall > 0) {
        setShortfallModal(prev => prev ? { ...prev, shortfall: newShortfall, reportedExceptions: newReported } : null);
        setSelectedExType('');
        setExQtyInput('');
      } else {
        setShortfallModal(null);
        await submitStow(shortfallModal.qty, true);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to report exception.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [shortfallModal, currentTask, selectedExType, exQtyInput, submitStow]);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  if (screenPhase === 'summary') {
    return (
      <Screen>
        <AppHeader showLogo />
        <Divider />
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={load} style={{ marginTop: spacing.md }} />
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No stow tasks pending.</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backLink}>
              <Text style={styles.backLinkText}>Back to tasks</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Row style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{tasks.length}</Text>
                <Text style={styles.summaryLabel}>SKUs</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {tasks.reduce((s, t) => s + t.quantity, 0)}
                </Text>
                <Text style={styles.summaryLabel}>Units</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {new Set(tasks.map(t => t.location_code).filter(Boolean)).size}
                </Text>
                <Text style={styles.summaryLabel}>Locations</Text>
              </View>
            </Row>
            <Divider />
            <ScrollView contentContainerStyle={styles.list}>
              {tasks.map((t) => (
                <Card key={t.stow_task_id} style={styles.taskCard}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskTitle} numberOfLines={1}>
                        {t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8)}
                      </Text>
                      <Text style={styles.taskMeta}>{t.quantity} units</Text>
                    </View>
                    {t.location_code
                      ? <Badge label={t.location_code} variant="success" />
                      : <Badge label="No location" variant="warning" />
                    }
                  </Row>
                </Card>
              ))}
            </ScrollView>
            <View style={styles.footer}>
              <Button
                label="Start stowing"
                onPress={() => setScreenPhase('location_scan')}
                variant="primary"
              />
            </View>
          </>
        )}
      </Screen>
    );
  }

  // ── COMPLETE ──────────────────────────────────────────────────────────────
  if (screenPhase === 'complete') {
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>Stow complete</Text>
          <Text style={styles.completeSub}>
            {tasks.length} SKU{tasks.length !== 1 ? 's' : ''} stowed.{'\n'}
            Inventory updated.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Back to tasks</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (!currentTask) return null;

  // ── LOCATION SCAN ─────────────────────────────────────────────────────────
  if (screenPhase === 'location_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => setScreenPhase('summary') }}
        />
        <WorkflowStep
          scanType="location"
          context={{
            label: 'Stowing',
            value: currentTask.variant_title ?? currentTask.sku ?? '—',
            sublabel: `${remainingQty} of ${currentTask.quantity} units remaining`,
          }}
          item={{
            title: 'Scan the bin barcode',
            sku: 'Point camera at location barcode or type location code',
            quantity: remainingQty,
            currentIndex: currentIndex + 1,
            totalCount: tasks.length,
          }}
          exceptions={STOW_EXCEPTIONS}
          onConfirm={handleLocationScan}
          onException={handleException}
          confirmLabel="Confirm location"
          isSubmitting={submitting}
        />
      </Screen>
    );
  }

  // ── PRODUCT SCAN ──────────────────────────────────────────────────────────
  if (screenPhase === 'product_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => setScreenPhase('summary') }}
        />
        <WorkflowStep
          scanType="product"
          context={{
            label: 'Location confirmed',
            value: confirmedLocation ?? currentTask.location_code ?? '—',
            sublabel: 'Now scan the product barcode',
          }}
          item={{
            title: currentTask.variant_title ?? currentTask.sku ?? '—',
            sku: currentTask.sku,
            quantity: remainingQty,
            currentIndex: currentIndex + 1,
            totalCount: tasks.length,
          }}
          exceptions={STOW_EXCEPTIONS}
          onConfirm={handleProductScan}
          onException={handleException}
          confirmLabel="Confirm product"
          isSubmitting={submitting}
        />
      </Screen>
    );
  }

 // ── QTY CONFIRM ───────────────────────────────────────────────────────────
  if (screenPhase === 'qty_confirm') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => setScreenPhase('summary') }}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {/* Step banner */}
          <View style={[styles.stepBanner, { borderLeftColor: colors.success }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
            <Text style={[styles.stepBannerText, { color: colors.success }]}>
              CONFIRM QUANTITY
            </Text>
          </View>

          {/* Context */}
          <View style={styles.qtySection}>
            <Text style={styles.qtySectionLabel}>Location</Text>
            <Text style={styles.qtySectionValue}>{confirmedLocation}</Text>
          </View>
          <Divider />
          <View style={styles.qtySection}>
            <Text style={styles.qtySectionLabel}>Product</Text>
            <Text style={styles.qtySectionValue}>
              {currentTask.variant_title ?? currentTask.sku ?? '—'}
            </Text>
            {currentTask.sku && (
              <Text style={styles.qtySectionSub}>{currentTask.sku}</Text>
            )}
          </View>
          <Divider />

          {/* Qty input */}
          <View style={styles.qtyInputSection}>
            <Text style={styles.qtyQuestion}>
              How many units are you placing here?
            </Text>
            <Row style={styles.qtyRow}>
              <TextInput
                style={styles.qtyInput}
                keyboardType="number-pad"
                value={qtyInput}
                onChangeText={setQtyInput}
                placeholder={`/ ${remainingQty}`}
                placeholderTextColor={colors.ink4}
                maxLength={4}
                autoFocus
              />
              <Text style={styles.qtyRemaining}>of {remainingQty}</Text>
            </Row>
            {remainingQty < currentTask.quantity && (
              <Text style={styles.partialNote}>
                Partial stow — {currentTask.quantity - remainingQty} units already placed
              </Text>
            )}
          </View>

          {/* Buttons inline — not absolute, moves with keyboard */}
          <View style={styles.qtyActions}>
            <Button
              label={submitting ? 'Confirming…' : 'Confirm stow'}
              onPress={() => void handleQtyConfirm()}
              variant="primary"
            />
            <Button
              label="Back to product scan"
              onPress={() => setScreenPhase('product_scan')}
              variant="ghost"
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </KeyboardAvoidingView>

        {/* Shortfall modal */}
        <Modal
          visible={!!shortfallModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShortfallModal(null)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShortfallModal(null)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'position' : 'height'}
          >
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              {shortfallModal && (
                <>
                  <Text style={styles.modalTitle}>
                    {shortfallModal.shortfall} unit{shortfallModal.shortfall > 1 ? 's' : ''} unaccounted
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {shortfallModal.reportedExceptions.length > 0
                      ? `${shortfallModal.reportedExceptions.reduce((s, e) => s + e.qty, 0)} explained. What about the rest?`
                      : `You placed ${shortfallModal.qty} of ${remainingQty}. What happened to the rest?`
                    }
                  </Text>

                  {/* Already reported */}
                  {shortfallModal.reportedExceptions.map((ex, i) => (
                    <View key={i} style={styles.reportedEx}>
                      <Text style={styles.reportedExText}>
                        ✓ {ex.qty} × {ex.type} → {ex.probLabel}
                      </Text>
                    </View>
                  ))}

                  {/* Exception type grid */}
                  <View style={styles.exceptionGrid}>
                    {STOW_EXCEPTIONS.map(({ type, label, icon }) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.exceptionGridItem,
                          selectedExType === type && styles.exceptionGridItemSelected,
                        ]}
                        onPress={() => setSelectedExType(type)}
                      >
                        <Ionicons
                          name={icon as any}
                          size={22}
                          color={selectedExType === type ? colors.accent : colors.ink3}
                        />
                        <Text style={[
                          styles.exceptionGridLabel,
                          selectedExType === type && styles.exceptionGridLabelSelected,
                        ]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Qty */}
                  <View style={styles.exQtyRow}>
                    <Text style={styles.exQtyLabel}>
                      How many? (max {shortfallModal.shortfall})
                    </Text>
                    <TextInput
                      style={styles.exQtyInput}
                      keyboardType="number-pad"
                      value={exQtyInput}
                      onChangeText={setExQtyInput}
                      placeholder={String(shortfallModal.shortfall)}
                      placeholderTextColor={colors.ink4}
                      maxLength={3}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.modalConfirm, (!selectedExType || submitting) && styles.modalConfirmDisabled]}
                    onPress={() => void handleShortfallConfirm()}
                    disabled={!selectedExType || submitting}
                  >
                    <Text style={styles.modalConfirmText}>
                      {submitting ? 'Processing…' : 'Report & continue'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.miscountBtn}
                    onPress={() => { setShortfallModal(null); void submitStow(remainingQty); }}
                    disabled={submitting}
                  >
                    <Ionicons name="refresh-outline" size={16} color={colors.ink3} />
                    <Text style={styles.miscountText}>
                      I miscounted — all {remainingQty} are here
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Screen>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  summaryRow: { justifyContent: 'space-around', paddingVertical: spacing.md },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: { color: colors.accent, fontSize: font.size.lg, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs },
  list: { padding: spacing.md, paddingBottom: 120, gap: spacing.sm },
  taskCard: { gap: spacing.xs },
  taskTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  taskMeta: { color: colors.ink3, fontSize: font.size.sm },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  emptyText: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center' },
  backLink: { marginTop: spacing.lg, padding: spacing.md },
  backLinkText: { color: colors.ink3, fontSize: font.size.sm },
  completeIcon: { fontSize: 64, color: colors.success, marginBottom: spacing.md },
  completeTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  completeSub: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  completeBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  // Step banner
  stepBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderLeftWidth: 3, backgroundColor: colors.bg2,
  },
  stepBannerText: {
    fontSize: font.size.sm, fontWeight: font.weight.bold,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  // Qty confirm
  qtySection: { padding: spacing.lg, gap: spacing.xs },
  qtySectionLabel: {
    color: colors.ink3, fontSize: font.size.xs,
    fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  qtySectionValue: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  qtySectionSub: { color: colors.ink3, fontSize: font.size.sm },
  qtyInputSection: { padding: spacing.lg, gap: spacing.md },
  qtyQuestion: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  qtyRow: { alignItems: 'center', gap: spacing.md },
  qtyInput: {
    flex: 1, backgroundColor: colors.bg3, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.ink, fontSize: font.size.xxl, fontWeight: font.weight.bold,
    textAlign: 'center',
  },
  qtyRemaining: { color: colors.ink3, fontSize: font.size.md },
  partialNote: { color: colors.info, fontSize: font.size.sm },
  qtyActions: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    backgroundColor: colors.bg,
    marginTop: 'auto',
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.bg2, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: spacing.lg,
    paddingBottom: spacing.xxl, gap: spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: colors.ink4,
    borderRadius: 2, alignSelf: 'center', marginBottom: spacing.xs,
  },
  modalTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  modalSubtitle: { color: colors.ink3, fontSize: font.size.sm, lineHeight: 18 },
  reportedEx: {
    backgroundColor: colors.successGhost, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.successBorder,
  },
  reportedExText: { color: colors.success, fontSize: font.size.sm },
  exceptionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  exceptionGridItem: {
    width: '30%', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.rule,
    gap: spacing.xs,
  },
  exceptionGridItemSelected: { borderColor: colors.accent, backgroundColor: colors.accentGhost },
  exceptionGridLabel: { color: colors.ink3, fontSize: font.size.xs, textAlign: 'center' },
  exceptionGridLabelSelected: { color: colors.accent, fontWeight: font.weight.semibold },
  exQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exQtyLabel: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  exQtyInput: {
    backgroundColor: colors.bg3, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold,
    textAlign: 'center', width: 80,
  },
  modalConfirm: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  modalConfirmDisabled: { backgroundColor: colors.bg3 },
  modalConfirmText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  miscountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md,
  },
  miscountText: { color: colors.ink3, fontSize: font.size.sm },
});