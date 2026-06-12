// apps/mobile/src/screens/PickBriefScreen.tsx
//
// MOB-PICK-01 — merged PickBriefScreen + ScanScreen, re-composed onto §10.7 shell
// ---------------------------------------------------------------------------------
// FIXES:
//   MOB-PCK-01   lasyncro_unit_id captured from resolver + threaded to /pick/scan
//   MOB-PCK-02   Line items re-fetched on mount (not stale route params)
//   MOB-PCK-04   Location scan via /api/v1/wms/location/resolve (server-side)
//   MOB-PCK-05   Client-side variant check removed; server rejects mismatches
//   MOB-PCK-06   lasyncro_unit_id in /pick/scan POST body
//   MOB-PCK-07   device_event_id on /pick/scan and /exception
//   MOB-PCK-09   WorkflowStep removed; ScanDock + NodeTrack inside SessionShell
//   MOB-PCK-11   ProblemSheet replaces Alert.alert exception pattern
//   MOB-PCK-12   ProblemSheet available at location_scan phase
//   MOB-PCK-13   Summary phase added before pick-complete
//   MOB-PCK-14   Two-file split merged into one screen
// STRUCTURAL (via SessionShell):
//   MOB-PCK-08   AsyncStorage persistence + resume
//   MOB-PCK-10   Back guard on active phases
// OFFLINE (DECISION-F):
//   /pick/scan routed through offlineQueue.submitScan()

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  Alert, TouchableOpacity, ScrollView,
  AppState,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import {
  Screen, Card, Button, Badge, Row, Divider, AppHeader,
  SessionShell, useSession,
  ScanDock, NodeTrack, ProblemSheet,
} from '../ui';
import type { TrackNode, ExceptionItem } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = {
  lasyncro_line_item_id: string;
  lasyncro_variant_id:   string;
  lasyncro_order_id:     string;
  sku:                   string | null;
  title:                 string;
  quantity:              number;
  location_code:         string;
};

type ScreenPhase = 'brief' | 'location_scan' | 'product_scan' | 'summary' | 'complete';

const ACTIVE_PHASES: readonly ScreenPhase[] = ['location_scan', 'product_scan'];

const PICK_EXCEPTIONS: ExceptionItem[] = [
  { type: 'item_missing',     label: 'Item missing', icon: 'search-outline'          },
  { type: 'short_pick',       label: 'Short pick',   icon: 'remove-circle-outline'   },
  { type: 'product_defect',   label: 'Damaged',      icon: 'hammer-outline'          },
  { type: 'packaging_defect', label: 'Packaging',    icon: 'cube-outline'            },
  { type: 'wrong_item',       label: 'Wrong item',   icon: 'swap-horizontal-outline' },
];

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function PickBriefScreen() {
  const route = useRoute<TaskStackScreenProps<'PickBrief'>['route']>();
  const { task } = route.params;
  return (
    <SessionShell
      sessionKey={`pick:${task.id}`}
      initialPhase="brief"
      activePhases={ACTIVE_PHASES}
    >
      <PickBriefInner task={task} />
    </SessionShell>
  );
}

// ─── Inner ────────────────────────────────────────────────────────────────────

function PickBriefInner({ task }: { task: { id: string; title: string } }) {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const { phase, phaseData, setPhase, newEventId, clearSession, isRestoring } =
    useSession();

  // ── Persisted phase data ──────────────────────────────────────────────────
  const currentIndex      = (phaseData.currentIndex      as number)        ?? 0;
  const confirmedLocation = (phaseData.confirmedLocation as string | null) ?? null;

  // ── Transient state ───────────────────────────────────────────────────────
  const [lineItems,   setLineItems]   = useState<LineItem[]>([]);
  const [batchStatus, setBatchStatus] = useState<string>('pending');
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [claiming,    setClaiming]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  // ProblemSheet
  const [problemSheetVisible, setProblemSheetVisible] = useState(false);
  const pendingExQtyRef = useRef<number>(0);

  const currentItem = lineItems[currentIndex] ?? null;

  // ── Offline queue subscription (DECISION-F) ───────────────────────────────
  useEffect(() => {
    const unsub = offlineQueue.subscribe((count) => setQueuedCount(count));
    void offlineQueue.flush();

    // Flush on app foreground — covers connectivity restore without NetInfo dependency
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void offlineQueue.flush();
    });

    return () => {
      unsub();
      appStateSub.remove();
    };
  }, []);

  // ── Load line items — always fresh (MOB-PCK-02) ───────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lineRes, batchRes] = await Promise.all([
        apiClient.get(`/api/v1/wms/batch/${task.id}/line-items`),
        apiClient.get('/api/v1/wms/batches'),
      ]);
      setLineItems(lineRes.data.line_items ?? []);
      const batch = (batchRes.data.batches ?? []).find(
        (b: { pick_batch_id: string; status: string }) => b.pick_batch_id === task.id
      );
      if (batch) setBatchStatus(batch.status);
    } catch {
      setError('Failed to load batch details.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  // ── Advance to next item or summary ──────────────────────────────────────
  const advanceToNext = useCallback(
    async (nextIdx: number) => {
      if (nextIdx >= lineItems.length) {
        await setPhase('summary', { currentIndex: nextIdx, confirmedLocation: null });
      } else {
        await setPhase('location_scan', {
          currentIndex:      nextIdx,
          confirmedLocation: null,
        });
      }
    },
    [lineItems.length, setPhase]
  );

  // ── Claim batch ───────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    setClaiming(true);
    try {
      const eventId = newEventId();
      await apiClient.post(`/api/v1/wms/batch/${task.id}/claim`, {
        device_event_id: eventId,
      });
      await setPhase('location_scan', { currentIndex: 0, confirmedLocation: null });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to claim batch.';
      Alert.alert('Cannot claim', msg);
    } finally {
      setClaiming(false);
    }
  }, [task.id, newEventId, setPhase]);

  // ── Location scan resolve (MOB-PCK-04: server-side resolve) ──────────────
  const handleLocationResolve = useCallback(
    async (raw: string): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      try {
        const { data } = await apiClient.post('/api/v1/wms/location/resolve', {
          scanned_value: raw,
        });
        if (!data?.location_code)
          return 'Location not recognised. Try scanning the bin barcode.';
        const expected = currentItem.location_code ?? 'ROOT';
        if (data.location_code.toUpperCase() !== expected.toUpperCase())
          return `Wrong location — expected ${expected}.`;
        await setPhase('product_scan', {
          currentIndex,
          confirmedLocation: data.location_code,
        });
      } catch {
        return 'Location scan failed. Try again.';
      }
    },
    [currentItem, currentIndex, setPhase]
  );

  // ── Product scan resolve ──────────────────────────────────────────────────
  const handleProductResolve = useCallback(
    async (raw: string, method?: string): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      setSubmitting(true);
      try {
        const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
          scanned_value: raw,
        });
        if (!resolved?.lasyncro_variant_id)
          return 'Barcode not recognised. Try scanning again.';
        // MOB-PCK-05: server rejects variant mismatches; client check removed
        const eventId = newEventId(); // MOB-PCK-07
        const submitError = await offlineQueue.submitScan({
          deviceEventId: eventId,
          url: '/api/v1/wms/pick/scan',
          body: {
            pick_batch_id:          task.id,
            lasyncro_line_item_id:  currentItem.lasyncro_line_item_id,
            lasyncro_variant_id:    resolved.lasyncro_variant_id,
            lasyncro_unit_id:       resolved.lasyncro_unit_id ?? null,
            location_code:          currentItem.location_code,
            quantity_confirmed:     currentItem.quantity,
            device_event_id:        eventId,
            scan_source:            method ?? 'camera',
          },
        });
        if (submitError) return submitError; // HTTP validation error
        // undefined = success or offline-queued → advance optimistically
        await advanceToNext(currentIndex + 1);
      } catch (err: unknown) {
        return (
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Product scan failed. Try again.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [currentItem, currentIndex, task.id, newEventId, advanceToNext]
  );

  // ── Exception report via ProblemSheet (MOB-PCK-11/12) ────────────────────
  const handleExceptionReport = useCallback(
    async (type: string, qty: number): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      try {
        const eventId = newEventId(); // MOB-PCK-07
        const { data: probData } = await apiClient.post(
          `/api/v1/wms/batch/${task.id}/exception`,
          {
            lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
            lasyncro_variant_id:   currentItem.lasyncro_variant_id,
            exception_type:        type,
            stage:                 'pick',
            quantity_required:     currentItem.quantity,
            quantity_found:        currentItem.quantity - qty,
            device_event_id:       eventId,
          }
        );
        void apiClient
          .post('/api/v1/wms/problem-center', {
            lasyncro_variant_id: currentItem.lasyncro_variant_id,
            quantity:            qty,
            exception_type:      type,
            source:              'pick',
            source_exception_id: probData?.exception_id ?? task.id,
          })
          .catch(() => {/* non-fatal */});
        pendingExQtyRef.current = qty;
      } catch (err: unknown) {
        return (
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Failed to report exception.'
        );
      }
    },
    [currentItem, task.id, newEventId]
  );

  const handleProblemClose = useCallback(async () => {
    const qty = pendingExQtyRef.current;
    pendingExQtyRef.current = 0;
    setProblemSheetVisible(false);
    if (qty <= 0) return;
    await advanceToNext(currentIndex + 1);
  }, [currentIndex, advanceToNext]);

  // ── Complete pick (MOB-PCK-13: via summary phase) ─────────────────────────
  const handlePickComplete = useCallback(async () => {
    setSubmitting(true);
    try {
      const eventId = newEventId();
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pick-complete`, {
        device_event_id: eventId,
      });
      await clearSession();
      await setPhase('complete', {});
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to complete pick.';
      Alert.alert('Cannot complete', msg);
    } finally {
      setSubmitting(false);
    }
  }, [task.id, newEventId, clearSession, setPhase]);

  // ── NodeTrack ─────────────────────────────────────────────────────────────
  const trackNodes: TrackNode[] = [
    {
      id:       'location',
      label:    phase === 'product_scan'
                  ? (confirmedLocation ?? '—')
                  : (currentItem?.location_code ?? 'Location'),
      sublabel: 'Bin barcode',
      state:    phase === 'location_scan' ? 'active'
              : phase === 'product_scan'  ? 'done'
              : 'pending',
    },
    {
      id:       'product',
      label:    currentItem?.title ?? 'Product',
      sublabel: currentItem?.sku   ?? undefined,
      state:    phase === 'product_scan' ? 'active' : 'pending',
    },
  ];

  // ── Offline banner ────────────────────────────────────────────────────────
  const OfflineBanner = queuedCount > 0 ? (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.bg} />
      <Text style={styles.offlineBannerText}>
        {queuedCount} scan{queuedCount > 1 ? 's' : ''} queued — will sync when online
      </Text>
    </View>
  ) : null;

  // ── Restoring guard ───────────────────────────────────────────────────────
  if (isRestoring) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  // ── BRIEF ─────────────────────────────────────────────────────────────────
  if (phase === 'brief') {
    const totalUnits = lineItems.reduce((s, li) => s + li.quantity, 0);
    const locations  = [...new Set(lineItems.map(li => li.location_code))];
    return (
      <Screen>
        <Row style={styles.briefHeader}>
          <Text style={styles.briefTitle}>Pick brief</Text>
          <Badge
            label={
              batchStatus === 'pick_complete' ? 'PICK COMPLETE' :
              batchStatus === 'picking'       ? 'IN PROGRESS'   :
              batchStatus === 'packing'       ? 'PACKING'       :
              batchStatus === 'pack_complete' ? 'PACKED'        : 'PENDING'
            }
            variant={
              batchStatus === 'pick_complete' || batchStatus === 'pack_complete' ? 'success' :
              batchStatus === 'picking'       || batchStatus === 'packing'       ? 'warning' : 'info'
            }
          />
        </Row>
        <Divider />
        <View style={styles.briefSummary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{lineItems.length}</Text>
            <Text style={styles.summaryLabel}>Lines</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalUnits}</Text>
            <Text style={styles.summaryLabel}>Units</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{locations.length}</Text>
            <Text style={styles.summaryLabel}>Locations</Text>
          </View>
        </View>
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
        ) : (
          <FlatList
            data={lineItems}
            keyExtractor={item => item.lasyncro_line_item_id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Card style={styles.lineCard}>
                <Text style={styles.location}>{item.location_code}</Text>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                {item.sku && <Text style={styles.sku}>{item.sku}</Text>}
                <Text style={styles.qty}>Qty: {item.quantity}</Text>
              </Card>
            )}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          />
        )}
        {!loading && !error && (
          <View style={styles.actions}>
            {batchStatus === 'pick_complete' || batchStatus === 'pack_complete' ? (
              <Button
                label="Pick complete ✓"
                onPress={() => navigation.goBack()}
                variant="ghost"
              />
            ) : batchStatus === 'picking' ? (
              <Button
                label="Continue picking"
                onPress={() => void setPhase('location_scan', {
                  currentIndex: 0, confirmedLocation: null,
                })}
                variant="primary"
              />
            ) : (
              <Button
                label={claiming ? 'Claiming…' : 'Claim & start picking'}
                onPress={() => void handleClaim()}
                variant="primary"
              />
            )}
            <Button
              label="Back"
              onPress={() => navigation.goBack()}
              variant="ghost"
              style={{ marginTop: spacing.xs }}
            />
          </View>
        )}
      </Screen>
    );
  }

  // ── SUMMARY (MOB-PCK-13) ──────────────────────────────────────────────────
  if (phase === 'summary') {
    return (
      <Screen>
        <AppHeader title={`Pick · ${task.title}`} showLogo={false} />
        {OfflineBanner}
        <View style={styles.summaryHeadBlock}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>All items picked</Text>
          <Text style={styles.completeSub}>
            {lineItems.length} line{lineItems.length !== 1 ? 's' : ''} confirmed.
            {'\n'}Review and mark complete.
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {lineItems.map(item => (
            <Card key={item.lasyncro_line_item_id} style={styles.lineCard}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                  {item.sku && <Text style={styles.sku}>{item.sku}</Text>}
                  <Text style={styles.qty}>
                    Qty: {item.quantity} · {item.location_code}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              </Row>
            </Card>
          ))}
        </ScrollView>
        <View style={styles.actions}>
          <Button
            label={submitting ? 'Completing…' : 'Complete pick'}
            onPress={() => void handlePickComplete()}
            variant="primary"
          />
        </View>
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
          <Text style={styles.completeTitle}>Pick complete</Text>
          <Text style={styles.completeSub}>
            {lineItems.length} line{lineItems.length !== 1 ? 's' : ''} confirmed.
            {'\n'}Batch is ready for packing.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Back to tasks</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (!currentItem) return null;

  // ── LOCATION SCAN ─────────────────────────────────────────────────────────
  if (phase === 'location_scan') {
    return (
      <Screen>
        <AppHeader
          title={`Pick · ${currentIndex + 1}/${lineItems.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => void setPhase('brief', {}) }}
        />
        {OfflineBanner}
        <NodeTrack nodes={trackNodes} />
        <View style={{ flex: 1 }}>
          <View style={styles.contextBlock}>
            <Text style={styles.contextLabel}>Next item</Text>
            <Text style={styles.contextValue} numberOfLines={2}>{currentItem.title}</Text>
            {currentItem.sku && <Text style={styles.contextSub}>{currentItem.sku}</Text>}
            <Text style={styles.contextSub}>Qty: {currentItem.quantity}</Text>
          </View>
        </View>
        <ScanDock
          hint="Point camera at bin barcode"
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
          onClose={() => void handleProblemClose()}
          exceptions={PICK_EXCEPTIONS}
          onReport={handleExceptionReport}
          lasyncroVariantId={currentItem.lasyncro_variant_id}
          source="pick"
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
          title={`Pick · ${currentIndex + 1}/${lineItems.length}`}
          rightAction={{ icon: 'close-outline', onPress: () => void setPhase('brief', {}) }}
        />
        {OfflineBanner}
        <NodeTrack nodes={trackNodes} />
        <View style={{ flex: 1 }}>
          <View style={styles.contextBlock}>
            <Text style={styles.contextLabel}>Location confirmed</Text>
            <Text style={styles.contextValue}>{confirmedLocation}</Text>
            <Text style={styles.contextSub}>Scan the product barcode</Text>
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
          onClose={() => void handleProblemClose()}
          exceptions={PICK_EXCEPTIONS}
          onReport={handleExceptionReport}
          lasyncroVariantId={currentItem.lasyncro_variant_id}
          source="pick"
          defaultQty={1}
        />
      </Screen>
    );
  }

  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  // Brief
  briefHeader: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md,
    justifyContent: 'space-between', alignItems: 'center',
  },
  briefTitle:  { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  briefSummary: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: spacing.lg, paddingHorizontal: spacing.md,
  },
  summaryItem:  { alignItems: 'center', gap: spacing.xs },
  summaryValue: { color: colors.accent, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.sm },
  list:         { padding: spacing.md, paddingBottom: 120, gap: spacing.sm },
  lineCard:     { gap: spacing.xs },
  location: {
    color: colors.accent, fontSize: font.size.xs,
    fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  itemTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.medium },
  sku:       { color: colors.ink3, fontSize: font.size.sm },
  qty:       { color: colors.ink3, fontSize: font.size.sm },
  actions: {
    padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.rule, backgroundColor: colors.bg,
  },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  // Summary / Complete
  summaryHeadBlock: { alignItems: 'center', padding: spacing.lg, paddingBottom: 0 },
  completeIcon:  { fontSize: 48, color: colors.success, marginBottom: spacing.sm },
  completeTitle: {
    color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs,
  },
  completeSub: {
    color: colors.ink3, fontSize: font.size.md, textAlign: 'center',
    lineHeight: 22, marginBottom: spacing.lg,
  },
  completeBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  // Scan phases
  contextBlock: { padding: spacing.lg, gap: spacing.xs },
  contextLabel: {
    color: colors.ink3, fontSize: font.size.xs,
    fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  contextValue: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  contextSub:   { color: colors.ink3, fontSize: font.size.sm },
  reportProblemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.rule,
  },
  reportProblemText: { color: colors.ink3, fontSize: font.size.sm },
  // Offline banner
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, backgroundColor: colors.warning,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  offlineBannerText: { color: colors.bg, fontSize: font.size.xs, fontWeight: font.weight.semibold },
});