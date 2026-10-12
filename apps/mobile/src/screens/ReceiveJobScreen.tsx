// apps/mobile/src/screens/ReceiveJobScreen.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  Alert, ScrollView, TouchableOpacity, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider, AppHeader, SessionShell, useSession } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerView, type BarcodeScanEvent } from '../ui';
import { useAuth } from '../hooks/useAuth';

type ReceiveJobLine = {
  receive_job_line_id: string;
  lasyncro_variant_id: string;
  sku: string | null;
  variant_title: string | null;
  description: string | null;
  quantity_expected: number;
  quantity_accepted: number;
  quantity_rejected: number;
  quantity_missing?: number | null;
  quantity_deferred?: number | null;
  quantity_sellable_provisional?: number | null;
  reported_problems?: Array<{ exception_type: string; quantity_affected: number; counts_toward_shortfall: boolean }>;
  inspection_complete: boolean;
};

type ReceiveJob = {
  receive_job_id: string;
  status: string;
  assigned_operator_id: number | null;
  supplier_name: string;
  total_variants: number;
  total_units: number;
};

type ExceptionEntry = {
  exception_type: string;
  quantity: number;
  prob_label?: string;
};

type LineState = {
  input: string;           // what operator typed
  exceptions: ExceptionEntry[];
  confirmed: boolean;
};

type ScreenPhase = 'brief' | 'inspect' | 'scan' | 'summary' | 'closed';
type InspectMode = 'count' | 'scan';

const EXCEPTION_TYPES = [
  { type: 'deferred', label: 'Later delivery', icon: 'time-outline' },
  { type: 'missing_item', label: 'Missing now', icon: 'help-outline' },
  { type: 'defect', label: 'Damaged', icon: 'hammer-outline' },
  { type: 'packaging_damage', label: 'Packaging', icon: 'cube-outline' },
  { type: 'wrong_item', label: 'Wrong item', icon: 'swap-horizontal-outline' },
  { type: 'wrong_quantity', label: 'Wrong qty', icon: 'calculator-outline' },
  { type: 'wrong_variant', label: 'Wrong variant', icon: 'git-branch-outline' },
  { type: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
] as const;

function ReceiveJobScreenInner({ task }: { task: import('../navigation/types').TaskStackParamList['ReceiveJob']['task'] }) {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const { newEventId } = useSession();
  const pendingEvents = useRef(new Map<string, string>());
  const postReceiveEvent = useCallback(async (url: string, payload: object, allocationIndex = 0) => {
    const key = JSON.stringify([url, payload, allocationIndex]);
    const deviceEventId = pendingEvents.current.get(key) ?? newEventId();
    pendingEvents.current.set(key, deviceEventId);
    // Retain successful allocation IDs too: a subsequent failed inspect must
    // replay the same evidence rather than issue another supplier incident.
    await apiClient.post(url, { ...payload, device_event_id: deviceEventId });
  }, [newEventId]);
  // GH-1241 S3-A1 — one pending count confirmation per line, separate from the
  // evidence events above. Its event is replayed only by a network retry of
  // that same confirmation: the backend permanently refuses a consumed event
  // once it is no longer the line's active count, so every new count intent
  // (a recount, or a retry after a definitive refusal) needs a new event.
  const pendingCountConfirmations = useRef(new Map<string, { quantity: number; eventId: string }>());
  const confirmLineCount = useCallback(async (lineId: string, quantity: number) => {
    const pending = pendingCountConfirmations.current.get(lineId);
    const eventId = pending?.quantity === quantity ? pending.eventId : newEventId();
    pendingCountConfirmations.current.set(lineId, { quantity, eventId });
    try {
      await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/lines/${lineId}/confirm-count`, {
        quantity_confirmed: quantity, device_event_id: eventId,
      });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== undefined && status >= 400 && status < 500) pendingCountConfirmations.current.delete(lineId);
      throw err;
    }
    pendingCountConfirmations.current.delete(lineId);
  }, [newEventId, task.id]);
  // A count-changing draft voids the confirmation server-side.
  const releaseChangedCountConfirmation = useCallback((lineId: string, quantity: number) => {
    if (pendingCountConfirmations.current.get(lineId)?.quantity !== quantity) {
      pendingCountConfirmations.current.delete(lineId);
    }
  }, []);
  const { userId } = useAuth();

  const [job, setJob] = useState<ReceiveJob | null>(null);
  const [lines, setLines] = useState<ReceiveJobLine[]>([]);
  const [lineStates, setLineStates] = useState<Record<string, LineState>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenPhase, setScreenPhase] = useState<ScreenPhase>('brief');
  const [claiming, setClaiming] = useState(false);
  const [inspectMode, setInspectMode] = useState<InspectMode>('count');
  const [scanCounts, setScanCounts] = useState<Record<string, number>>({});

  // Shortfall modal
  const [shortfallModal, setShortfallModal] = useState<{
    line: ReceiveJobLine;
    accepted: number;
    totalShortfall: number;
    remainingShortfall: number;
    reportedExceptions: ExceptionEntry[];
  } | null>(null);
  const [selectedExceptionType, setSelectedExceptionType] = useState('');
  const [exceptionQtyInput, setExceptionQtyInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/suppliers/receive-jobs/${task.id}`);
      setJob(data.job);
      const fetchedLines: ReceiveJobLine[] = data.lines ?? [];
      setLines(fetchedLines);

      const init: Record<string, LineState> = {};
      for (const line of fetchedLines) {
        init[line.receive_job_line_id] = {
          input: line.inspection_complete ? String(line.quantity_accepted) : line.quantity_sellable_provisional != null ? String(line.quantity_sellable_provisional) : '',
          exceptions: [
            ...(line.reported_problems ?? []).filter((e) => e.counts_toward_shortfall).map((e) => ({ exception_type: e.exception_type, quantity: Number(e.quantity_affected) })),
            ...(Number(line.quantity_deferred ?? 0) > 0 ? [{ exception_type: 'deferred', quantity: Number(line.quantity_deferred) }] : []),
          ],
          confirmed: line.inspection_complete,
        };
      }
      setLineStates(init);
    } catch {
      setError('Failed to load receive job.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  const handleClaim = useCallback(async (mode: InspectMode = 'count') => {
    if (!job) return;

    if (job.assigned_operator_id == null) {
      Alert.alert('Receive not assigned', 'This Receive job must be assigned before it can be started.');
      return;
    }

    if (job.assigned_operator_id !== userId) {
      Alert.alert('Assigned to another operator', 'Only the assigned operator can run this Receive job.');
      return;
    }

    if (job.status === 'in_progress' || job.status === 'inspection') {
      setInspectMode(mode);
      setScreenPhase(mode === 'scan' ? 'scan' : 'inspect');
      return;
    }

    setClaiming(true);
    try {
      await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/claim`);
      setJob(prev => prev ? { ...prev, status: 'in_progress' } : prev);
      setInspectMode(mode);
      setScreenPhase(mode === 'scan' ? 'scan' : 'inspect');
    } catch (err: any) {
      const code = err?.response?.data?.error;

      if (code === 'JOB_NOT_ASSIGNED') {
        Alert.alert('Receive not assigned', 'This Receive job must be assigned before it can be started.');
      } else if (code === 'JOB_CLAIMED_BY_OTHER') {
        Alert.alert('Assigned to another operator', 'Only the assigned operator can run this Receive job.');
      } else {
        Alert.alert('Error', 'Failed to start Receive.');
      }
    } finally {
      setClaiming(false);
    }
  }, [job, task.id, userId]);

  // Confirm a line — called after operator types qty and taps Confirm
  const handleConfirmLine = useCallback(async (line: ReceiveJobLine) => {
    const state = lineStates[line.receive_job_line_id];
    const inputVal = state.input.trim();

    if (!inputVal) {
      Alert.alert('Enter quantity', 'How many units are good to go?');
      return;
    }

    const accepted = parseInt(inputVal, 10);
    if (isNaN(accepted) || accepted < 0) {
      Alert.alert('Invalid', 'Enter a valid number.');
      return;
    }
    if (accepted > line.quantity_expected) {
      Alert.alert('Too many', `Cannot accept more than expected (${line.quantity_expected}).`);
      return;
    }

    const shortfall = line.quantity_expected - accepted;

    if (shortfall > 0) {
      const existing = lineStates[line.receive_job_line_id]?.exceptions ?? [];
      const accounted = existing.reduce((n, e) => n + e.quantity, 0);
      if (accounted > shortfall) { Alert.alert('Reconciliation required', 'The count conflicts with recorded delivery evidence.'); return; }
      if (accounted === shortfall) { await submitLineInspection(line, accepted, shortfall, null, existing); return; }
      setShortfallModal({
        line,
        accepted,
        totalShortfall: shortfall,
        remainingShortfall: shortfall - accounted,
        reportedExceptions: existing,
      });
      setSelectedExceptionType('');
      setExceptionQtyInput(String(shortfall));
      return;
    }

    // All good — confirm directly
    await submitLineInspection(line, accepted, 0, null);
  }, [lineStates]);

  // Submit line inspection to backend
  const submitLineInspection = useCallback(async (
    line: ReceiveJobLine,
    accepted: number,
    shortfall: number,
    exceptionType: string | null,
    preReportedExceptions?: ExceptionEntry[],
  ) => {
    setSubmitting(true);
    try {
      let exceptions: ExceptionEntry[] = preReportedExceptions ?? [];

      // Persist supplier evidence only; physical recovery capture belongs to S4.
      if (shortfall > 0 && exceptionType && !preReportedExceptions) {
        if (exceptionType === 'deferred') {
          releaseChangedCountConfirmation(line.receive_job_line_id, accepted);
          await apiClient.patch(`/api/v1/suppliers/receive-jobs/${task.id}/lines/${line.receive_job_line_id}/progress`, {
            quantity_sellable_provisional: accepted, quantity_deferred: shortfall, reconciliation_required: true,
          });
        } else {
          await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${task.id}/exception`, {
            lasyncro_variant_id: line.lasyncro_variant_id, receive_job_line_id: line.receive_job_line_id,
            exception_type: exceptionType, quantity_affected: shortfall, accounting_role: 'shortfall',
            notes: `${shortfall} units reported during receive`,
          });
        }
        exceptions = [{ exception_type: exceptionType, quantity: shortfall }];
      }
      const quantityMissing = exceptions.filter((e) => e.exception_type === 'missing_item').reduce((n, e) => n + e.quantity, 0);
      const quantityDeferred = exceptions.filter((e) => e.exception_type === 'deferred').reduce((n, e) => n + e.quantity, 0);
      const quantityRejected = exceptions.filter((e) => !['missing_item', 'deferred'].includes(e.exception_type)).reduce((n, e) => n + e.quantity, 0);
      // GH-1241 S3-A1 — the backend accepts units only against the operator's
      // persisted physical count. Every caller passes a typed count or the
      // number of physically scanned units, never an expected quantity.
      await confirmLineCount(line.receive_job_line_id, accepted);
      await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${task.id}/inspect`, {
        lasyncro_variant_id: line.lasyncro_variant_id, receive_job_line_id: line.receive_job_line_id,
        quantity_accepted: accepted, quantity_rejected: quantityRejected,
        quantity_missing: quantityMissing, quantity_deferred: quantityDeferred,
      });

      // Update local state
      setLineStates(prev => ({
        ...prev,
        [line.receive_job_line_id]: {
          ...prev[line.receive_job_line_id],
          confirmed: true,
          input: String(accepted),
          exceptions,
        },
      }));

      setLines(prev => prev.map(l =>
        l.receive_job_line_id === line.receive_job_line_id
          ? { ...l, inspection_complete: true, quantity_accepted: accepted, quantity_rejected: quantityRejected, quantity_missing: quantityMissing, quantity_deferred: quantityDeferred }
          : l
      ));

      setShortfallModal(null);
      setSelectedExceptionType('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to confirm.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [task.id, postReceiveEvent, confirmLineCount, releaseChangedCountConfirmation]);

  // Handle shortfall modal confirm
  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallModal || !selectedExceptionType) return;

    const qty = parseInt(exceptionQtyInput, 10);
    if (isNaN(qty) || qty <= 0 || qty > shortfallModal.remainingShortfall) {
      Alert.alert('Invalid', `Enter between 1 and ${shortfallModal.remainingShortfall}.`);
      return;
    }

    setSubmitting(true);
    try {
      if (selectedExceptionType === 'deferred') {
        const deferred = shortfallModal.reportedExceptions.filter((e) => e.exception_type === 'deferred').reduce((n, e) => n + e.quantity, 0) + qty;
        releaseChangedCountConfirmation(shortfallModal.line.receive_job_line_id, shortfallModal.accepted);
        await apiClient.patch(`/api/v1/suppliers/receive-jobs/${task.id}/lines/${shortfallModal.line.receive_job_line_id}/progress`, {
          quantity_sellable_provisional: shortfallModal.accepted, quantity_deferred: deferred, reconciliation_required: true,
        });
      } else {
        await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${task.id}/exception`, {
          lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
          receive_job_line_id: shortfallModal.line.receive_job_line_id,
          exception_type: selectedExceptionType, quantity_affected: qty, accounting_role: 'shortfall',
          notes: `${qty} units reported during receive`,
        }, shortfallModal.reportedExceptions.length);
      }
      const newException: ExceptionEntry = { exception_type: selectedExceptionType, quantity: qty };

      const newRemaining = shortfallModal.remainingShortfall - qty;
      const newReported = [...shortfallModal.reportedExceptions, newException];

      if (newRemaining > 0) {
        // Still unaccounted — update modal for next exception
        setShortfallModal(prev => prev ? {
          ...prev,
          remainingShortfall: newRemaining,
          reportedExceptions: newReported,
        } : null);
        setSelectedExceptionType('');
        setExceptionQtyInput('');  // empty — operator must type
      } else {
        // All accounted — submit inspection
        await submitLineInspection(
          shortfallModal.line,
          shortfallModal.accepted,
          shortfallModal.totalShortfall,
          null, // exceptions already reported individually
          newReported,
        );
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [shortfallModal, selectedExceptionType, exceptionQtyInput, task.id, submitLineInspection, postReceiveEvent, releaseChangedCountConfirmation]);

  // Miscount — GH-1241 S3-A1: return to counting. Accepting every expected
  // unit without a physical count is refused by the backend; the operator
  // re-enters the counted quantity and confirms it.
  const handleMiscount = useCallback(async () => {
    if (!shortfallModal) return;
    setShortfallModal(null);
    Alert.alert('Recount', 'Enter the quantity you physically counted, then confirm the line.');
  }, [shortfallModal]);

  // Close job
  const handleClose = useCallback(async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/close`, {
        actual_delivery_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD — defaults to today; adjustable from webapp
      });
      setScreenPhase('closed');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to close job.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [task.id]);

  const confirmedCount = lines.filter(l => lineStates[l.receive_job_line_id]?.confirmed).length;
  const totalExceptions = Object.values(lineStates).reduce((s, ls) => s + ls.exceptions.length, 0);

  /**
   * RECEIVE SCAN HANDLER
   * ---------------------
   * Called by BarcodeScannerView on each confirmed scan.
   * BarcodeScannerView owns: cooldown, vibration, error display, bounds overlay.
   * This handler owns: business logic — barcode resolution, PO line matching,
   * scan count tracking, overcount confirmation, line auto-completion.
   *
   * Returns a string to show as inline error, or void on success.
   */
  const handleReceiveScan = useCallback(async (event: BarcodeScanEvent): Promise<string | void> => {
    const scannedValue = event.data;
    try {
      const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
        scanned_value: scannedValue,
      });
      if (!resolved?.lasyncro_variant_id) {
        return 'Not recognised — no product matched';
      }
      const matchedLine = lines.find(l => l.lasyncro_variant_id === resolved.lasyncro_variant_id);
      if (!matchedLine) {
        return `Not in this PO — ${resolved.sku ?? scannedValue}`;
      }
      setScanCounts(prev => {
        const current = prev[matchedLine.receive_job_line_id] ?? 0;
        const next = current + 1;
        const expected = matchedLine.quantity_expected;
        if (next > expected) {
          // Overcount — pause and confirm with operator
          Alert.alert(
            `Another ${matchedLine.sku ?? matchedLine.variant_title}?`,
            `You've already counted ${expected}. Add another?`,
            [
              { text: 'Yes — add it', onPress: () => setScanCounts(p => ({ ...p, [matchedLine.receive_job_line_id]: next })) },
              { text: 'No — report exception', onPress: () => {
                setShortfallModal({ line: matchedLine, accepted: expected, totalShortfall: 1, remainingShortfall: 1, reportedExceptions: [] });
                setSelectedExceptionType('barcode_mismatch');
                setExceptionQtyInput('1');
                setScreenPhase('inspect');
              }},
            ]
          );
          return prev;
        }
        if (next === expected) {
          // Line complete — auto-confirm and update scan count after inspection
          void submitLineInspection(matchedLine, next, 0, null).then(() => {
            setScanCounts(p => ({ ...p, [matchedLine.receive_job_line_id]: next }));
          });
          return prev;
        }
        return { ...prev, [matchedLine.receive_job_line_id]: next };
      });
    } catch {
      return 'Scan failed — check connection';
    }
  }, [lines, submitLineInspection]);
  
  if (screenPhase === 'brief') {
    return (
      <Screen>
        <AppHeader
          title="Receive Job"
          onBack={() => navigation.goBack()}
          showProfile={false}
        />
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.center}><Text style={styles.errorText}>{error}</Text></View>
        ) : job ? (
          <ScrollView contentContainerStyle={styles.briefContainer}>
            <Text style={styles.briefSupplier}>{job.supplier_name}</Text>
            <Text style={styles.briefMeta}>{job.total_variants} SKU{job.total_variants !== 1 ? 's' : ''} · {job.total_units} units expected</Text>
            <Divider />
            <Text style={styles.briefSectionTitle}>Line items</Text>
            {lines.map(line => (
              <Card key={line.receive_job_line_id} style={styles.briefLineCard}>
                <Text style={styles.briefLineName} numberOfLines={1}>{line.variant_title ?? line.sku ?? line.description ?? '—'}</Text>
                <Text style={styles.briefLineMeta}>{line.sku ? `SKU: ${line.sku} · ` : ''}{line.quantity_expected} units expected</Text>
              </Card>
            ))}
            {job.assigned_operator_id == null ? (
              <Text style={[styles.briefMeta, { marginTop: spacing.lg }]}>
                Dispatch needed · This Receive job must be assigned before it can start.
              </Text>
            ) : job.assigned_operator_id !== userId ? (
              <Text style={[styles.briefMeta, { marginTop: spacing.lg }]}>
                Assigned to another operator · Only the assigned operator can run this Receive.
              </Text>
            ) : (
              <>
                <Button
                  label={
                    claiming
                      ? 'Starting…'
                      : job.status === 'in_progress' || job.status === 'inspection'
                        ? 'Resume Receive · Scan items'
                        : 'Claim & Start Receive · Scan items'
                  }
                  onPress={() => void handleClaim('scan')}
                  variant="primary"
                  style={{ marginTop: spacing.lg }}
                  disabled={claiming}
                />
                <Button
                  label={
                    claiming
                      ? 'Starting…'
                      : job.status === 'in_progress' || job.status === 'inspection'
                        ? 'Resume Receive · Count by hand'
                        : 'Claim & Start Receive · Count by hand'
                  }
                  onPress={() => void handleClaim('count')}
                  variant="secondary"
                  style={{ marginTop: spacing.sm }}
                  disabled={claiming}
                />
              </>
            )}
          </ScrollView>
        ) : null}
      </Screen>
    );
  }

  // ── CLOSED ────────────────────────────────────────────────────────────────
  if (screenPhase === 'closed') {
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>Receive complete</Text>
          <Text style={styles.completeSub}>
            Unit labels (LSU-) generated for all accepted items.{'\n'}
            {totalExceptions > 0
              ? `${totalExceptions} delivery allocation${totalExceptions > 1 ? 's' : ''} recorded.\n`
              : ''}
            Stow tasks created — ready to put away.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Back to tasks</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  if (screenPhase === 'summary') {
    const totalAccepted = lines.reduce((s, l) => s + (l.quantity_accepted || 0), 0);
    const totalRejected = lines.reduce((s, l) => s + (l.quantity_rejected || 0), 0);

    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Ready to close</Text>
          <Text style={styles.summarySupplier}>{job?.supplier_name}</Text>
        </View>
        <Divider />

        <Row style={styles.summaryStats}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalAccepted}</Text>
            <Text style={styles.statLabel}>Accepted</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, totalRejected > 0 && { color: colors.error }]}>
              {totalRejected}
            </Text>
            <Text style={styles.statLabel}>Rejected</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, totalExceptions > 0 && { color: colors.warning }]}>
              {totalExceptions}
            </Text>
            <Text style={styles.statLabel}>Exceptions</Text>
          </View>
        </Row>
        <Divider />

        <ScrollView contentContainerStyle={styles.summaryList}>
          {lines.map(line => {
            const state = lineStates[line.receive_job_line_id];
            return (
              <View key={line.receive_job_line_id} style={styles.summaryCard}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.summaryVariant} numberOfLines={1}>
                    {line.variant_title ?? line.sku ?? line.description ?? '—'}
                  </Text>
                  <Badge
                    label={line.quantity_rejected > 0 ? `${line.quantity_accepted}✓ ${line.quantity_rejected}✗` : `${line.quantity_accepted} ✓`}
                    variant={line.quantity_rejected > 0 ? 'warning' : 'success'}
                  />
                </Row>
                {state?.exceptions.map((ex, i) => (
                  <Text key={i} style={styles.summaryException}>
                    {ex.quantity} × {ex.exception_type === 'deferred' ? 'Later delivery' : ex.exception_type}
                  </Text>
                ))}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={submitting ? 'Closing…' : 'Close & generate barcodes'}
            onPress={() => void handleClose()}
            variant="primary"
          />
          <Button
            label="Back to inspection"
            onPress={() => setScreenPhase('inspect')}
            variant="ghost"
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </Screen>
    );
  }

  // ── SCAN ─────────────────────────────────────────────────────────────────
  if (screenPhase === 'scan') {
    const totalConfirmed = lines.filter(l => lineStates[l.receive_job_line_id]?.confirmed).length;
    const allConfirmed = totalConfirmed === lines.length;

    return (
      <BarcodeScannerView
          hint="Scan product barcode"
          onScan={handleReceiveScan}
          overlay={
            <View style={{
              backgroundColor: colors.bg,
              borderTopWidth: 1,
              borderTopColor: colors.rule,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
              maxHeight: 240,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ color: colors.ink3, fontSize: font.size.xs, fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {totalConfirmed} of {lines.length} lines complete
                </Text>
                <TouchableOpacity onPress={() => setScreenPhase('inspect')}>
                  <Text style={{ color: colors.accent, fontSize: font.size.sm }}>Switch to count</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {lines.map(line => {
                    const state = lineStates[line.receive_job_line_id];
                    const confirmed = state?.confirmed ?? false;
                    const scanCount = scanCounts[line.receive_job_line_id] ?? 0;
                    return (
                      <View key={line.receive_job_line_id} style={{
                        backgroundColor: confirmed ? colors.successGhost ?? colors.bg2 : colors.bg2,
                        borderWidth: 1,
                        borderColor: confirmed ? colors.success : colors.rule,
                        borderRadius: radius.sm,
                        padding: spacing.sm,
                        minWidth: 100,
                        alignItems: 'center',
                      }}>
                        <Text style={{ color: confirmed ? colors.success : colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold }} numberOfLines={1}>
                          {line.sku ?? line.variant_title ?? line.description ?? '—'}
                        </Text>
                        <Text style={{ color: colors.ink3, fontSize: font.size.xs, marginTop: 2 }}>
                          {confirmed ? `✓ ${line.quantity_accepted}` : `${scanCount} / ${line.quantity_expected}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
              {allConfirmed && (
                <Button
                  label="Review & close"
                  onPress={() => setScreenPhase('summary')}
                  variant="primary"
                  style={{ marginTop: spacing.md }}
                />
              )}
            </View>
          }
        />
      );
    }

  // ── INSPECT ───────────────────────────────────────────────────────────────
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
          <View style={styles.jobHeader}>
            <Text style={styles.supplierName}>{job?.supplier_name}</Text>
            <Badge
              label={`${confirmedCount}/${lines.length}`}
              variant={confirmedCount === lines.length ? 'success' : 'info'}
            />
          </View>
          <Divider />

          {inspectMode === 'count' && (
            <TouchableOpacity
              onPress={() => setScreenPhase('scan')}
              style={{ alignSelf: 'flex-end', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
            >
              <Text style={{ color: colors.accent, fontSize: font.size.sm }}>Switch to scan</Text>
            </TouchableOpacity>
          )}

          <ScrollView contentContainerStyle={styles.list}>
            {lines.map((line, idx) => {
              const state = lineStates[line.receive_job_line_id];
              if (!state) return null;

              return (
                <Card key={line.receive_job_line_id} style={styles.lineCard}>
                  {/* Line header */}
                  <Row style={styles.lineHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.variantTitle} numberOfLines={1}>
                        {line.variant_title ?? line.sku ?? line.description ?? `Item ${idx + 1}`}
                      </Text>
                      {line.sku && <Text style={styles.sku}>{line.sku}</Text>}
                    </View>
                    {state.confirmed
                      ? <Badge label="✓ Done" variant="success" />
                      : <Badge label={`of ${line.quantity_expected}`} variant="info" />
                    }
                  </Row>

                  {/* Exception entries */}
                  {state.exceptions.map((ex, i) => (
                    <View key={i} style={styles.exceptionEntry}>
                      <Row style={{ alignItems: 'center', gap: spacing.xs }}>
                        <Ionicons name="warning-outline" size={14} color={colors.warning} />
                        <Text style={styles.exceptionEntryText}>
                          {ex.quantity} × {ex.exception_type}
                        </Text>

                      </Row>
                      <Text style={styles.probInstruction}>
                        Delivery evidence recorded
                      </Text>
                    </View>
                  ))}

                  {/* Input — only if not confirmed */}
                  {!state.confirmed && (
                    <View style={styles.inputSection}>
                      <Text style={styles.inputQuestion}>
                        How many are good to go?
                      </Text>
                      <Row style={styles.inputRow}>
                        <TextInput
                          style={styles.input}
                          keyboardType="number-pad"
                          value={state.input}
                          onChangeText={(v) =>
                            setLineStates(prev => ({
                              ...prev,
                              [line.receive_job_line_id]: {
                                ...prev[line.receive_job_line_id],
                                input: v,
                              },
                            }))
                          }
                          placeholder={String(line.quantity_expected)}
                          placeholderTextColor={colors.ink4}
                          maxLength={4}
                          returnKeyType="done"
                          onSubmitEditing={() => void handleConfirmLine(line)}
                        />
                        <TouchableOpacity
                          style={[
                            styles.confirmBtn,
                            !state.input && styles.confirmBtnDisabled,
                          ]}
                          onPress={() => void handleConfirmLine(line)}
                          disabled={!state.input || submitting}
                        >
                          <Text style={styles.confirmBtnText}>Confirm</Text>
                        </TouchableOpacity>
                      </Row>
                    </View>
                  )}

                  {/* Confirmed summary */}
                  {state.confirmed && (
                    <Text style={styles.confirmedText}>
                      {line.quantity_accepted} accepted
                      {line.quantity_rejected > 0 ? ` · ${line.quantity_rejected} rejected` : ''}
                      {Number(line.quantity_missing ?? 0) > 0 ? ` · ${line.quantity_missing} missing` : ''}
                      {Number(line.quantity_deferred ?? 0) > 0 ? ` · ${line.quantity_deferred} coming later` : ''}
                    </Text>
                  )}
                </Card>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={confirmedCount === lines.length ? 'Review & close →' : `${confirmedCount}/${lines.length} confirmed`}
              onPress={() => {
                if (confirmedCount === lines.length) {
                  setScreenPhase('summary');
                } else {
                  Alert.alert('Not done yet', 'Confirm all items before reviewing.');
                }
              }}
              variant={confirmedCount === lines.length ? 'primary' : 'ghost'}
            />
          </View>
        </>
      )}

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
                  {shortfallModal.remainingShortfall} unit{shortfallModal.remainingShortfall > 1 ? 's' : ''} still unaccounted
                </Text>
                <Text style={styles.modalSubtitle}>
                  {shortfallModal.reportedExceptions.length > 0
                    ? `${shortfallModal.totalShortfall - shortfallModal.remainingShortfall} of ${shortfallModal.totalShortfall} explained. What about the rest?`
                    : `You confirmed ${shortfallModal.accepted} of ${shortfallModal.line.quantity_expected}. What happened?`
                  }
                </Text>

                {/* Reported so far */}
                {shortfallModal.reportedExceptions.map((ex, i) => (
                  <View key={i} style={styles.reportedEx}>
                    <Text style={styles.reportedExText}>
                      ✓ {ex.quantity} × {ex.exception_type === 'deferred' ? 'Later delivery' : ex.exception_type}
                    </Text>
                  </View>
                ))}

                {/* Qty for this exception */}
                <View style={styles.exQtyRow}>
                  <Text style={styles.modalLabel}>
                    How many? (max {shortfallModal.remainingShortfall})
                  </Text>
                  <TextInput
                    style={styles.exQtyInput}
                    keyboardType="number-pad"
                    value={exceptionQtyInput}
                    onChangeText={setExceptionQtyInput}
                    placeholder={String(shortfallModal.remainingShortfall)}
                    placeholderTextColor={colors.ink4}
                    maxLength={3}
                  />
                </View>

                {/* Exception type grid */}
                <View style={styles.exceptionGrid}>
                  {EXCEPTION_TYPES.map(({ type, label, icon }) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.exceptionGridItem,
                        selectedExceptionType === type && styles.exceptionGridItemSelected,
                      ]}
                      onPress={() => setSelectedExceptionType(type)}
                    >
                      <Ionicons
                        name={icon as any}
                        size={22}
                        color={selectedExceptionType === type ? colors.accent : colors.ink3}
                      />
                      <Text style={[
                        styles.exceptionGridLabel,
                        selectedExceptionType === type && styles.exceptionGridLabelSelected,
                      ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Actions */}
                <TouchableOpacity
                  style={[
                    styles.modalConfirm,
                    !selectedExceptionType && styles.modalConfirmDisabled,
                  ]}
                  onPress={() => void handleShortfallConfirm()}
                  disabled={!selectedExceptionType || submitting}
                >
                  <Text style={styles.modalConfirmText}>
                    {submitting ? 'Processing…' : `Report & confirm`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.miscountBtn}
                  onPress={() => void handleMiscount()}
                  disabled={submitting}
                >
                  <Ionicons name="refresh-outline" size={16} color={colors.ink3} />
                  <Text style={styles.miscountText}>
                    I miscounted — recount
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

const styles = StyleSheet.create({
  jobHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  supplierName: {
    color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold,
    flex: 1, marginRight: spacing.sm,
  },
  list: { padding: spacing.md, paddingBottom: 100, gap: spacing.sm },
  lineCard: { gap: spacing.sm },
  lineHeader: { justifyContent: 'space-between', alignItems: 'flex-start' },
  variantTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  sku: { color: colors.ink3, fontSize: font.size.sm, marginTop: 2 },
  exceptionEntry: {
    backgroundColor: colors.warningGhost, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.warning,
    gap: 4,
  },
  exceptionEntryText: { flex: 1, color: colors.ink2, fontSize: font.size.sm },
  probLabel: {
    backgroundColor: colors.bg3, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderWidth: 1, borderColor: colors.rule2,
  },
  probLabelText: { color: colors.accent, fontSize: font.size.xs, fontWeight: font.weight.bold },
  probInstruction: { color: colors.ink4, fontSize: font.size.xs, marginLeft: spacing.lg },
  inputSection: { gap: spacing.sm },
  inputQuestion: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  inputRow: { gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: colors.bg3, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold,
    textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: colors.accent, borderRadius: radius.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  confirmBtnDisabled: { backgroundColor: colors.bg3 },
  confirmBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  confirmedText: { color: colors.success, fontSize: font.size.sm },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  // Modal
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
  modalLabel: { color: colors.ink3, fontSize: font.size.sm, fontWeight: font.weight.medium },
  exceptionGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
  },
  exceptionGridItem: {
    width: '30%', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.rule,
    gap: spacing.xs,
  },
  exceptionGridItemSelected: {
    borderColor: colors.accent, backgroundColor: colors.accentGhost,
  },
  exceptionGridLabel: { color: colors.ink3, fontSize: font.size.xs, textAlign: 'center' },
  exceptionGridLabelSelected: { color: colors.accent, fontWeight: font.weight.semibold },
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
  // Summary
  summaryHeader: { padding: spacing.lg, paddingBottom: spacing.md },
  summaryTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summarySupplier: { color: colors.ink3, fontSize: font.size.md },
  summaryStats: { justifyContent: 'space-around', paddingVertical: spacing.md },
  statItem: { alignItems: 'center', gap: spacing.xs },
  statValue: { color: colors.accent, fontSize: font.size.xl, fontWeight: font.weight.bold },
  statLabel: { color: colors.ink3, fontSize: font.size.xs },
  summaryList: { padding: spacing.md, paddingBottom: 120, gap: spacing.sm },
  summaryCard: {
    backgroundColor: colors.bg2, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.xs,
  },
  summaryVariant: {
    color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, flex: 1,
  },
  summaryException: { color: colors.warning, fontSize: font.size.sm },
  // Complete
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  completeIcon: { fontSize: 64, color: colors.success, marginBottom: spacing.md },
  completeTitle: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  completeSub: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  completeBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  reportedEx: {
    backgroundColor: colors.successGhost, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.successBorder,
  },
  reportedExText: { color: colors.success, fontSize: font.size.sm },
  exQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exQtyInput: {
    backgroundColor: colors.bg3, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.rule2,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold,
    textAlign: 'center', width: 80,
  },
  briefContainer: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  briefSupplier: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  briefMeta: { color: colors.ink3, fontSize: font.size.sm },
  briefSectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  briefLineCard: { gap: spacing.xs },
  briefLineName: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.medium },
  briefLineMeta: { color: colors.ink3, fontSize: font.size.xs },
});

// ─── Outer wrapper — provides SessionShell (MOB-RECEIVE-01) ─────────────────
export default function ReceiveJobScreen() {
  const route = useRoute<TaskStackScreenProps<'ReceiveJob'>['route']>();
  const { task } = route.params;
  return (
    <SessionShell
      sessionKey={`receive:${task.id}`}
      initialPhase="brief"
      activePhases={['inspect', 'scan', 'summary']}
    >
      <ReceiveJobScreenInner task={task} />
    </SessionShell>
  );
}
