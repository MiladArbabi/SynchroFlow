// apps/mobile/src/screens/StowScreen.tsx
//
// MOB-STOW-01 — re-composed onto §10.7 shell
// -------------------------------------------
// FIXES:
//   MOB-STW-01 + MOB-STW-08  lasyncro_unit_id captured + threaded to /confirm & /exception
//   MOB-STW-02               device_event_id on /claim, /confirm, /exception
//   MOB-STW-03               bin_over_capacity response handled (advisory + PC task)
//   MOB-STW-04               ProblemSheet replaces silent scan-phase exceptions;
//                            shortfall modal gains Problem Center POST
//   MOB-STW-07               WorkflowStep removed; ScanDock + NodeTrack in scan phases
// STRUCTURAL (via SessionShell):
//   MOB-STW-05               back guard on location_scan / product_scan / qty_confirm
//   MOB-STW-06               AsyncStorage persistence + resume

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import {
  Screen, Card, Button, Badge, Row, Divider, AppHeader,
  SessionShell, useSession,
  ScanDock,
  NodeTrack,
  ProblemSheet,
} from '../ui';
import type { TrackNode, ExceptionItem } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// Phases where SessionShell back guard is active (MOB-STW-05)
const ACTIVE_PHASES: readonly ScreenPhase[] = [
  'location_scan', 'product_scan', 'qty_confirm',
];

const STOW_EXCEPTIONS: ExceptionItem[] = [
  { type: 'item_missing',     label: 'Item missing', icon: 'search-outline'  },
  { type: 'product_defect',   label: 'Damaged',      icon: 'hammer-outline'  },
  { type: 'packaging_defect', label: 'Packaging',    icon: 'cube-outline'    },
];

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function StowScreen() {
  const route = useRoute<TaskStackScreenProps<'Stow'>['route']>();
  const { task } = route.params;
  return (
    <SessionShell
      sessionKey={`stow:${task.id}`}
      initialPhase="summary"
      activePhases={ACTIVE_PHASES}
    >
      <StowScreenInner task={task} />
    </SessionShell>
  );
}

// ─── Inner ────────────────────────────────────────────────────────────────────

function StowScreenInner({ task }: { task: { id: string } }) {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const { phase, phaseData, setPhase, newEventId, clearSession, isRestoring } =
    useSession();

  // ── Persisted phase data (restored from AsyncStorage on remount) ──────────
  const confirmedLocation = (phaseData.confirmedLocation as string | null) ?? null;
  const currentIndex      = (phaseData.currentIndex      as number)        ?? 0;
  const remainingQty      = (phaseData.remainingQty      as number)        ?? 0;
  const resolvedUnitId    = (phaseData.resolvedUnitId    as string | null) ?? null; // MOB-STW-01/08

  // ── Transient state ───────────────────────────────────────────────────────
  const [tasks,      setTasks]     = useState<StowTask[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [error,      setError]     = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ProblemSheet — scan-phase exceptions
  const [problemSheetVisible, setProblemSheetVisible] = useState(false);
  const pendingExQtyRef = useRef<number>(0); // qty reported; read in onClose

  // Shortfall modal — qty_confirm phase
  const [shortfallModal, setShortfallModal] = useState<{
    qty: number;
    shortfall: number;
    reportedExceptions: Array<{ type: string; qty: number; probLabel: string }>;
  } | null>(null);
  const [selectedExType, setSelectedExType] = useState('');
  const [exQtyInput,     setExQtyInput]     = useState('');

  // Qty confirm input
  const [qtyInput, setQtyInput] = useState('');

  const currentTask = tasks[currentIndex] ?? null;

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/wms/stow-tasks');
      const all = (data.stow_tasks ?? []).filter(
        (t: StowTask) => t.status === 'pending' || t.status === 'in_progress'
      );
      const tapped = all.find((t: StowTask) => t.stow_task_id === task.id);
      const rest   = all.filter((t: StowTask) => t.stow_task_id !== task.id);
      setTasks(tapped ? [tapped, ...rest] : all);
    } catch {
      setError('Failed to load stow tasks.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  // ── Advance to next task or complete ─────────────────────────────────────
  const advanceToNext = useCallback(async (nextIdx: number, taskList: StowTask[]) => {
    if (nextIdx >= taskList.length) {
      await clearSession();
      await setPhase('complete', {});
    } else {
      await setPhase('location_scan', {
        confirmedLocation: null,
        currentIndex:      nextIdx,
        remainingQty:      taskList[nextIdx].quantity,
        resolvedUnitId:    null,
      });
    }
  }, [clearSession, setPhase]);

  // ── Location scan resolve ─────────────────────────────────────────────────
  const handleLocationResolve = useCallback(
    async (raw: string): Promise<string | void> => {
      if (!currentTask) return 'No active task.';
      try {
        const { data } = await apiClient.post('/api/v1/wms/location/resolve', {
          scanned_value: raw,
        });
        if (!data?.location_code)
          return 'Location not recognised. Try scanning the bin barcode.';
        if (
          currentTask.location_code &&
          data.location_code !== currentTask.location_code
        )
          return `Wrong location. Expected: ${currentTask.location_code}`;

        const eventId = newEventId(); // MOB-STW-02
        if (!currentTask.location_code) {
          await apiClient.patch(
            `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/location`,
            { location_code: data.location_code }
          );
        }
        try {
          await apiClient.post(
            `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/claim`,
            { device_event_id: eventId } // MOB-STW-02
          );
        } catch (err: unknown) {
          const msg =
            (err as { response?: { data?: { error?: string } } })
              ?.response?.data?.error ?? '';
          if (!msg.includes('already') && !msg.includes('in_progress'))
            return 'Failed to claim task. Try again.';
        }
        setTasks(prev =>
          prev.map((t, i) =>
            i === currentIndex
              ? { ...t, location_code: data.location_code, status: 'in_progress' }
              : t
          )
        );
        await setPhase('product_scan', {
          confirmedLocation: data.location_code,
          currentIndex,
          remainingQty,
          resolvedUnitId: null,
        });
      } catch {
        return 'Location scan failed. Try again.';
      }
    },
    [currentTask, currentIndex, remainingQty, newEventId, setPhase]
  );

  // ── Product scan resolve ──────────────────────────────────────────────────
  const handleProductResolve = useCallback(
    async (raw: string): Promise<string | void> => {
      if (!currentTask) return 'No active task.';
      try {
        const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
          scanned_value: raw,
        });
        if (!resolved?.lasyncro_variant_id)
          return 'Barcode not recognised. Try scanning again.';
        if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id)
          return 'Wrong product — does not match this stow task.';

        await setPhase('qty_confirm', {
          confirmedLocation,
          currentIndex,
          remainingQty,
          resolvedUnitId: resolved.lasyncro_unit_id ?? null, // MOB-STW-01/08
        });
      } catch {
        return 'Product scan failed. Try again.';
      }
    },
    [currentTask, confirmedLocation, currentIndex, remainingQty, setPhase]
  );

  // ── Submit stow ───────────────────────────────────────────────────────────
  const submitStow = useCallback(
    async (qty: number, exceptionsFiled = false) => {
      if (!currentTask) return;
      setSubmitting(true);
      try {
        const eventId = newEventId(); // MOB-STW-02
        const { data: confirmData } = await apiClient.post(
          `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/confirm`,
          {
            quantity_placed:  qty,
            lasyncro_unit_id: resolvedUnitId, // MOB-STW-01
            device_event_id:  eventId,        // MOB-STW-02
          }
        );
        // bin_over_capacity advisory (MOB-STW-03)
        if (confirmData?.bin_over_capacity) {
          Alert.alert(
            'Bin over capacity',
            'This bin is now over its capacity limit. A supervisor task has been created.'
          );
          void apiClient
            .post('/api/v1/wms/problem-center', {
              source:              'stow',
              issue_type:          'bin_over_capacity',
              stow_task_id:        currentTask.stow_task_id,
              lasyncro_variant_id: currentTask.lasyncro_variant_id,
            })
            .catch(() => {/* non-fatal */});
        }
        const newRemaining = remainingQty - qty;
        if (newRemaining > 0 && !exceptionsFiled) {
          await setPhase('location_scan', {
            confirmedLocation: null,
            currentIndex,
            remainingQty:   newRemaining,
            resolvedUnitId: null,
          });
        } else {
          await advanceToNext(currentIndex + 1, tasks);
        }
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Stow confirm failed.';
        if (msg.includes('not in progress') || msg.includes('completed')) {
          await advanceToNext(currentIndex + 1, tasks);
        } else {
          Alert.alert('Error', msg);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      currentTask, resolvedUnitId, remainingQty, currentIndex,
      tasks, newEventId, setPhase, advanceToNext,
    ]
  );

  // ── Qty confirm handler ───────────────────────────────────────────────────
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
      setShortfallModal({ qty, shortfall, reportedExceptions: [] });
      setSelectedExType('');
      setExQtyInput(String(shortfall));
      return;
    }
    await submitStow(qty);
  }, [currentTask, qtyInput, remainingQty, submitStow]);

  // ── Shortfall exception confirm (custom modal) ────────────────────────────
  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallModal || !currentTask || !selectedExType) return;
    const exQty = parseInt(exQtyInput, 10);
    if (isNaN(exQty) || exQty <= 0 || exQty > shortfallModal.shortfall) {
      Alert.alert('Invalid', `Enter between 1 and ${shortfallModal.shortfall}.`);
      return;
    }
    setSubmitting(true);
    try {
      const eventId = newEventId(); // MOB-STW-02
      const { data: probData } = await apiClient.post(
        `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/exception`,
        {
          exception_type:   selectedExType,
          quantity:         exQty,
          lasyncro_unit_id: resolvedUnitId, // MOB-STW-01
          device_event_id:  eventId,        // MOB-STW-02
          notes:            'Reported during stow qty confirm',
        }
      );
      // Problem Center POST (MOB-STW-04)
      void apiClient
        .post('/api/v1/wms/problem-center', {
          source:              'stow',
          source_exception_id: probData?.exception_id,
          lasyncro_variant_id: currentTask.lasyncro_variant_id,
        })
        .catch(() => {/* non-fatal */});

      if (selectedExType !== 'item_missing') {
        Alert.alert(
          '⚠ Place in Problem Bin',
          `Label ${probData.prob_label ?? 'PROB-?'} — place in ${
            probData.problem_bin ?? 'the PROBLEM BIN'
          } before continuing.`,
          [{ text: 'Got it' }]
        );
      }
      const newShortfall = shortfallModal.shortfall - exQty;
      const newReported  = [
        ...shortfallModal.reportedExceptions,
        { type: selectedExType, qty: exQty, probLabel: probData.prob_label ?? 'PROB-?' },
      ];
      if (newShortfall > 0) {
        setShortfallModal(prev =>
          prev ? { ...prev, shortfall: newShortfall, reportedExceptions: newReported } : null
        );
        setSelectedExType('');
        setExQtyInput('');
      } else {
        setShortfallModal(null);
        await submitStow(shortfallModal.qty, true);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to report exception.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    shortfallModal, currentTask, selectedExType, exQtyInput,
    resolvedUnitId, newEventId, submitStow,
  ]);

  // ── Scan-phase exception via ProblemSheet (MOB-STW-04) ───────────────────
  const handleScanExceptionReport = useCallback(
    async (type: string, qty: number): Promise<string | void> => {
      if (!currentTask) return 'No active task.';
      try {
        const eventId = newEventId(); // MOB-STW-02
        const { data: probData } = await apiClient.post(
          `/api/v1/wms/stow-tasks/${currentTask.stow_task_id}/exception`,
          {
            exception_type:   type,
            quantity:         qty,
            lasyncro_unit_id: resolvedUnitId, // MOB-STW-01
            device_event_id:  eventId,        // MOB-STW-02
            notes:            'Reported during stow',
          }
        );
        // Problem Center POST (MOB-STW-04)
        void apiClient
          .post('/api/v1/wms/problem-center', {
            source:              'stow',
            source_exception_id: probData?.exception_id,
            lasyncro_variant_id: currentTask.lasyncro_variant_id,
          })
          .catch(() => {/* non-fatal */});
        pendingExQtyRef.current = qty;
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Failed to report exception.';
        return msg;
      }
    },
    [currentTask, resolvedUnitId, newEventId]
  );

  // Called when ProblemSheet closes — advance state based on reported qty
  const handleScanProblemClose = useCallback(async () => {
    const qty = pendingExQtyRef.current;
    pendingExQtyRef.current = 0;
    setProblemSheetVisible(false);
    if (qty <= 0) return; // closed without reporting
    const newRemaining = remainingQty - qty;
    if (newRemaining <= 0) {
      await advanceToNext(currentIndex + 1, tasks);
    } else {
      await setPhase('location_scan', {
        confirmedLocation: null,
        currentIndex,
        remainingQty:   newRemaining,
        resolvedUnitId: null,
      });
    }
  }, [remainingQty, currentIndex, tasks, setPhase, advanceToNext]);

  // ── NodeTrack nodes ───────────────────────────────────────────────────────
  const trackNodes: TrackNode[] = [
    {
      id:       'location',
      label:    (phase === 'product_scan' || phase === 'qty_confirm')
                  ? (confirmedLocation ?? '—')
                  : (currentTask?.location_code ?? 'Location'),
      sublabel: 'Bin barcode',
      state:    phase === 'location_scan'                              ? 'active'
              : (phase === 'product_scan' || phase === 'qty_confirm') ? 'done'
              : 'pending',
    },
    {
      id:       'product',
      label:    currentTask?.variant_title ?? currentTask?.sku ?? 'Product',
      sublabel: 'Product barcode',
      state:    phase === 'product_scan' ? 'active'
              : phase === 'qty_confirm'  ? 'done'
              : 'pending',
    },
  ];

  // ── Loading / restoring guard ─────────────────────────────────────────────
  if (isRestoring || (loading && phase !== 'summary' && phase !== 'complete')) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  if (phase === 'summary') {
    return (
      <Screen>
        <AppHeader showLogo />
        <Divider />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
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
                onPress={() => void setPhase('location_scan', {
                  confirmedLocation: null,
                  currentIndex:      0,
                  remainingQty:      tasks[0]?.quantity ?? 0,
                  resolvedUnitId:    null,
                })}
                variant="primary"
              />
            </View>
          </>
        )}
      </Screen>
    );
  }

  // ── COMPLETE ──────────────────────────────────────────────────────────────
  if (phase === 'complete') {
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
  if (phase === 'location_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => void setPhase('summary', {}) }}
        />
        <NodeTrack nodes={trackNodes} />
        <View style={{ flex: 1 }}>
          <View style={styles.contextBlock}>
            <Text style={styles.contextLabel}>Stowing</Text>
            <Text style={styles.contextValue} numberOfLines={2}>
              {currentTask.variant_title ?? currentTask.sku ?? '—'}
            </Text>
            <Text style={styles.contextSub}>
              {remainingQty} of {currentTask.quantity} units remaining
            </Text>
          </View>
        </View>
        <ScanDock
          hint="Point camera at bin barcode or type location code"
          onResolve={handleLocationResolve}
        />
        <TouchableOpacity
          style={styles.reportProblemRow}
          onPress={() => setProblemSheetVisible(true)}
        >
          <Ionicons name="warning-outline" size={16} color={colors.ink3} />
          <Text style={styles.reportProblemText}>Report problem</Text>
        </TouchableOpacity>
        <ProblemSheet
          visible={problemSheetVisible}
          onClose={() => void handleScanProblemClose()}
          exceptions={STOW_EXCEPTIONS}
          onReport={handleScanExceptionReport}
          lasyncroVariantId={currentTask.lasyncro_variant_id}
          source="stow"
          defaultQty={1}
        />
      </Screen>
    );
  }

  // ── PRODUCT SCAN ──────────────────────────────────────────────────────────
  if (phase === 'product_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => void setPhase('summary', {}) }}
        />
        <NodeTrack nodes={trackNodes} />
        <View style={{ flex: 1 }}>
          <View style={styles.contextBlock}>
            <Text style={styles.contextLabel}>Product</Text>
            <Text style={styles.contextValue} numberOfLines={2}>
              {currentTask.variant_title ?? currentTask.sku ?? '—'}
            </Text>
            {currentTask.sku && (
              <Text style={styles.contextSub}>{currentTask.sku}</Text>
            )}
            <Text style={styles.contextSub}>{remainingQty} units</Text>
          </View>
        </View>
        <ScanDock
          hint="Point camera at product barcode"
          onResolve={handleProductResolve}
        />
        <TouchableOpacity
          style={styles.reportProblemRow}
          onPress={() => setProblemSheetVisible(true)}
        >
          <Ionicons name="warning-outline" size={16} color={colors.ink3} />
          <Text style={styles.reportProblemText}>Report problem</Text>
        </TouchableOpacity>
        <ProblemSheet
          visible={problemSheetVisible}
          onClose={() => void handleScanProblemClose()}
          exceptions={STOW_EXCEPTIONS}
          onReport={handleScanExceptionReport}
          lasyncroVariantId={currentTask.lasyncro_variant_id}
          source="stow"
          defaultQty={1}
        />
      </Screen>
    );
  }

  // ── QTY CONFIRM ───────────────────────────────────────────────────────────
  if (phase === 'qty_confirm') {
    return (
      <Screen>
        <AppHeader
          title={`Stow · ${currentIndex + 1}/${tasks.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => void setPhase('summary', {}) }}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.stepBanner, { borderLeftColor: colors.success }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
            <Text style={[styles.stepBannerText, { color: colors.success }]}>
              CONFIRM QUANTITY
            </Text>
          </View>
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
          <View style={styles.qtyActions}>
            <Button
              label={submitting ? 'Confirming…' : 'Confirm stow'}
              onPress={() => void handleQtyConfirm()}
              variant="primary"
            />
            <Button
              label="Back to product scan"
              onPress={() => void setPhase('product_scan', {
                confirmedLocation,
                currentIndex,
                remainingQty,
                resolvedUnitId: null,
              })}
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : 'height'}>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              {shortfallModal && (
                <>
                  <Text style={styles.modalTitle}>
                    {shortfallModal.shortfall} unit
                    {shortfallModal.shortfall > 1 ? 's' : ''} unaccounted
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {shortfallModal.reportedExceptions.length > 0
                      ? `${shortfallModal.reportedExceptions.reduce((s, e) => s + e.qty, 0)} explained. What about the rest?`
                      : `You placed ${shortfallModal.qty} of ${remainingQty}. What happened to the rest?`
                    }
                  </Text>
                  {shortfallModal.reportedExceptions.map((ex, i) => (
                    <View key={i} style={styles.reportedEx}>
                      <Text style={styles.reportedExText}>
                        ✓ {ex.qty} × {ex.type} → {ex.probLabel}
                      </Text>
                    </View>
                  ))}
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
                    style={[
                      styles.modalConfirm,
                      (!selectedExType || submitting) && styles.modalConfirmDisabled,
                    ]}
                    onPress={() => void handleShortfallConfirm()}
                    disabled={!selectedExType || submitting}
                  >
                    <Text style={styles.modalConfirmText}>
                      {submitting ? 'Processing…' : 'Report & continue'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.miscountBtn}
                    onPress={() => {
                      setShortfallModal(null);
                      void submitStow(remainingQty);
                    }}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Summary
  summaryRow:   { justifyContent: 'space-around', paddingVertical: spacing.md },
  summaryItem:  { alignItems: 'center', gap: spacing.xs },
  summaryValue: { color: colors.accent, fontSize: font.size.lg, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs },
  list:         { padding: spacing.md, paddingBottom: 120, gap: spacing.sm },
  taskCard:     { gap: spacing.xs },
  taskTitle:    { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  taskMeta:     { color: colors.ink3, fontSize: font.size.sm },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  // Shared
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText:    { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  emptyText:    { color: colors.ink3, fontSize: font.size.md, textAlign: 'center' },
  backLink:     { marginTop: spacing.lg, padding: spacing.md },
  backLinkText: { color: colors.ink3, fontSize: font.size.sm },
  // Complete
  completeIcon:    { fontSize: 64, color: colors.success, marginBottom: spacing.md },
  completeTitle:   { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  completeSub:     { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  completeBtn:     {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  // Scan phases — context block
  contextBlock: { padding: spacing.lg, gap: spacing.xs },
  contextLabel: {
    color: colors.ink3, fontSize: font.size.xs,
    fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  contextValue: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  contextSub:   { color: colors.ink3, fontSize: font.size.sm },
  // Scan phases — Report Problem
  reportProblemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  reportProblemText: { color: colors.ink3, fontSize: font.size.sm },
  // Qty confirm — step banner
  stepBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderLeftWidth: 3, backgroundColor: colors.bg2,
  },
  stepBannerText: {
    fontSize: font.size.sm, fontWeight: font.weight.bold,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  // Qty confirm — fields
  qtySection:      { padding: spacing.lg, gap: spacing.xs },
  qtySectionLabel: {
    color: colors.ink3, fontSize: font.size.xs,
    fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  qtySectionValue: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  qtySectionSub:   { color: colors.ink3, fontSize: font.size.sm },
  qtyInputSection: { padding: spacing.lg, gap: spacing.md },
  qtyQuestion:     { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  qtyRow:          { alignItems: 'center', gap: spacing.md },
  qtyInput: {
    flex: 1, backgroundColor: colors.bg3, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.ink, fontSize: font.size.xxl, fontWeight: font.weight.bold,
    textAlign: 'center',
  },
  qtyRemaining: { color: colors.ink3, fontSize: font.size.md },
  partialNote:  { color: colors.info, fontSize: font.size.sm },
  qtyActions: {
    padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.rule,
    backgroundColor: colors.bg, marginTop: 'auto',
  },
  // Shortfall modal
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
  modalTitle:    { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  modalSubtitle: { color: colors.ink3, fontSize: font.size.sm, lineHeight: 18 },
  reportedEx: {
    backgroundColor: colors.successGhost, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.successBorder,
  },
  reportedExText:     { color: colors.success, fontSize: font.size.sm },
  exceptionGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  exceptionGridItem: {
    width: '30%', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.rule,
    gap: spacing.xs,
  },
  exceptionGridItemSelected:  { borderColor: colors.accent, backgroundColor: colors.accentGhost },
  exceptionGridLabel:         { color: colors.ink3, fontSize: font.size.xs, textAlign: 'center' },
  exceptionGridLabelSelected: { color: colors.accent, fontWeight: font.weight.semibold },
  exQtyRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  modalConfirmText:     { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  miscountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md,
  },
  miscountText: { color: colors.ink3, fontSize: font.size.sm },
});
