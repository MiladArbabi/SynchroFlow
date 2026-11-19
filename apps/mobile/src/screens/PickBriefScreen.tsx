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
// ONLINE-ONLY (SF-PICK-ASSIGN-01 C008, supersedes DECISION-F for Pick):
//   /pick/scan goes through offlineQueue.submitScanOnline() and advances only
//   on the server's confirmation. No answer → "Connection lost": Picking pauses
//   on the same step, nothing is queued, and recovery re-reads ownership and
//   the remaining work before resuming at a fresh location scan.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  Alert, TouchableOpacity, ScrollView, TextInput, Image,
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
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = {
  lasyncro_line_item_id: string;
  lasyncro_variant_id:   string;
  lasyncro_order_id:     string;
  /** GH-1049: exact physical pick task; absent on legacy batches. */
  reservation_allocation_id?: string | null;
  /** Order-line SKU snapshot. */
  sku:                   string | null;
  /** SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — the allocation variant's current SKU. */
  variant_sku?:          string | null;
  title:                 string;
  /** SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — the /line-items payload's own name fields. */
  product_title?:        string | null;
  variant_title?:        string | null;
  barcode?: string | null;
  image_url?: string | null;
  quantity:              number;
  location_code:         string;
  /** SF-PICK-LOCATION-TRUTH-01: false when location_code is not a pick bin (blocked stop). */
  location_pickable?:    boolean;
  /** SF-PICK-LOCATION-TRUTH-01: false for warehouse-root stock — no location label to scan. */
  location_scan_required?: boolean;
  /**
   * SF-PICK-LOCATION-TRUTH-01: units that must each be identified by their own
   * LSU label (eligible labelled units at the location, capped at quantity).
   * The server re-checks on every write.
   */
  unit_scan_required?:   number;
  /** SF-PICK-UX-ADAPTIVE-01-ACTIONABLE-ID-001 — one eligible LSU for this task (display only, never verification). */
  scan_unit_id?:         string | null;
};

/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — product name · variant from the
 * server payload (`product_title`; `title` for payloads that carry it). Shopify's
 * single-variant placeholder is not a variant name. Nothing is invented.
 */
function productName(item: LineItem): string {
  const name = item.product_title?.trim() || item.title?.trim() || '';
  const variant = item.variant_title?.trim();
  return variant && variant !== 'Default Title' ? `${name} · ${variant}` : name;
}

/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — same precedence as web
 * pickDisplaySku: order-line snapshot when populated, else the variant's
 * current SKU, else none. Never invented.
 */
function displaySku(item: LineItem): string | null {
  return item.sku?.trim() || item.variant_sku?.trim() || null;
}

/** SF-PICK-LOCATION-TRUTH-01 — server refusals of the scanned unit labels (nothing recorded). */
const UNIT_IDENTITY_CODES = new Set(['PICK_UNIT_IDENTITY_REQUIRED', 'PICK_UNIT_IDENTITY_MISMATCH']);
/** Unit statuses that can still be on a shelf (received at root, or stowed). */
// 'picked' is passed to the server: a unit a quantity Pick settled by count may
// still be physically here, and only the server can reverify it
// (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001) or refuse it.
const PICKABLE_UNIT_STATUSES = new Set(['received', 'stowed', 'picked']);
const taskKeyOf = (li: LineItem): string => li.reservation_allocation_id ?? li.lasyncro_line_item_id;
/**
 * SF-PICK-LOCATION-TRUTH-01 — the resolver's own exact-unit answer is the only
 * unit identity. Every other method (EAN/UPC, SKU, LSP, external id) attaches a
 * unit the server chose, so it never names a picked unit — whatever the raw
 * text looked like.
 */
const scannedUnitIdentity = (resolved: {
  resolution_method?: string;
  lasyncro_unit_id?: string | null;
}): string | null =>
  resolved.resolution_method === 'unit_barcode' ? resolved.lasyncro_unit_id ?? null : null;

// SF-PICK-ASSIGN-01: 'custody_ack' — a takeover with picked units confirms the
// tote before any scan; restored like an execution phase.
type ScreenPhase = 'brief' | 'custody_ack' | 'location_scan' | 'product_scan' | 'summary' | 'complete';

const ACTIVE_PHASES: readonly ScreenPhase[] = ['custody_ack', 'location_scan', 'product_scan'];

/** SF-PICK-ASSIGN-01 — server refusals meaning this device no longer owns the batch. */
const OWNERSHIP_LOST_CODES = new Set([
  'PICK_OWNERSHIP_REVOKED', 'PICK_GENERATION_STALE', 'PICK_GENERATION_REQUIRED', 'PICK_BATCH_NOT_PICKING',
]);
/** C003 — a restored session cannot re-verify ownership offline; nothing is claimed or queued. */
const RESUME_OFFLINE_MESSAGE = 'Reconnect to resume this batch — ownership can’t be confirmed offline.';
/** C008 — Pick v1 requires a working backend connection. */
const PICK_CONNECTION_LOST = 'PICK_CONNECTION_LOST';
const CONNECTION_LOST_SCAN_MESSAGE = 'No connection — this scan was not recorded.';
const PAUSED_SCAN_MESSAGE = 'Picking is paused until the connection returns. This scan was not recorded.';
const IN_FLIGHT_SCAN_MESSAGE = 'Still confirming the previous scan.';
/** Recovery probe cadence while disconnected (in addition to app foreground). */
const RECONNECT_PROBE_MS = 5_000;
/** No HTTP answer at all (as opposed to a server refusal). */
const noAnswer = (err: unknown): boolean => !(err as { response?: unknown })?.response;

type BatchOwnership = {
  status: string;
  picked_by: number | null;
  picker_name?: string | null;
  assigned_operator_id?: number | null;
  recovery_eligible?: boolean;
  idle_minutes?: number | null;
  units_picked?: number;
};

const responseCode = (err: unknown): string | null => {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : null;
};

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

  const { userId } = useAuth();

  // ── Persisted phase data ──────────────────────────────────────────────────
  const currentIndex      = (phaseData.currentIndex      as number)        ?? 0;
  const confirmedLocation = (phaseData.confirmedLocation as string | null) ?? null;

  // SF-PICK-ASSIGN-01 — ownership generation from claim. setPhase replaces
  // phaseData, so every transition goes through go(), which carries it.
  const generationRef = useRef<string | null>(
    typeof phaseData.generation === 'string' ? phaseData.generation : null,
  );
  useEffect(() => {
    if (typeof phaseData.generation === 'string') generationRef.current = phaseData.generation;
  }, [phaseData.generation]);
  const go = useCallback(
    (next: ScreenPhase, data: Record<string, unknown> = {}) =>
      setPhase(next, { ...data, generation: generationRef.current }),
    [setPhase],
  );

  // ── Transient state ───────────────────────────────────────────────────────
  const [lineItems,   setLineItems]   = useState<LineItem[]>([]);
  const [batchStatus, setBatchStatus] = useState<string>('pending');
  const [batchInfo,   setBatchInfo]   = useState<BatchOwnership | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [claiming,    setClaiming]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  // SF-PICK-UX-ADAPTIVE-01-FINALIZE-001 — server-confirmed outcomes of this session (same basis as web).
  const sessionTotalsRef = useRef({ picked: 0, short: 0, flagged: 0 });
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizeInFlightRef = useRef(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [queueStorageError, setQueueStorageError] = useState(false);
  const [queueAuthPaused, setQueueAuthPaused] = useState(false);

  // C008 — online-only Pick. connectionLost pauses every scan until the
  // server answers again; the ref is the synchronous gate for scan handlers.
  const [connectionLost, setConnectionLost] = useState(false);
  const connectionLostRef = useRef(false);
  const markConnectionLost = useCallback(() => {
    connectionLostRef.current = true;
    setConnectionLost(true);
  }, []);
  /** Synchronous lock: one product confirmation at a time (rapid scans are dropped). */
  const scanInFlightRef = useRef(false);
  /** Scan identity per pick task, reused when the same task is retried. */
  const pendingScanRef = useRef<{ task: string; eventId: string } | null>(null);

  // ProblemSheet
  const [problemSheetVisible, setProblemSheetVisible] = useState(false);
  const pendingExQtyRef = useRef<number>(0);

  const currentItem = lineItems[currentIndex] ?? null;
  const currentTaskKey = currentItem ? taskKeyOf(currentItem) : null;

  // SF-PICK-LOCATION-TRUTH-01 — unit labels scanned for the current task. Held
  // in memory only: nothing is recorded (or counted as picked) until the
  // server confirms the Pick. Cleared whenever the task or phase changes.
  const scannedUnitIdsRef = useRef<string[]>([]);
  const [scannedUnitCount, setScannedUnitCount] = useState(0);
  const [productVerified, setProductVerified] = useState(false);
  const [quantityPicked, setQuantityPicked] = useState('0');
  const lastScanMethodRef = useRef<string | undefined>(undefined);
  // The server's current label count for a task, re-read after an identity refusal.
  const [unitsRequiredOverride, setUnitsRequiredOverride] = useState<{ task: string; n: number } | null>(null);
  const resetLabels = useCallback(() => {
    scannedUnitIdsRef.current = [];
    setScannedUnitCount(0);
    setProductVerified(false);
    setQuantityPicked('0');
  }, []);
  // SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — one label verifies the
  // product/location; the rest of the quantity is counted (server-settled).
  const unitsToIdentify = currentItem
    ? Math.min(
        1,
        currentItem.quantity,
        Math.max(0, Number(
          unitsRequiredOverride?.task === currentTaskKey
            ? unitsRequiredOverride.n
            : currentItem.unit_scan_required ?? 0,
        ) || 0),
      )
    : 0;
  const labelsComplete = unitsToIdentify > 0 && scannedUnitCount >= unitsToIdentify;
  // Warehouse-root stock has no location label: the product scan comes first.
  const currentUnbinned = currentItem?.location_scan_required === false && currentItem?.location_pickable !== false;

  const labelScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const scope = phase === 'product_scan' ? currentTaskKey : null;
    if (labelScopeRef.current !== scope) {
      labelScopeRef.current = scope;
      resetLabels();
    }
  }, [phase, currentTaskKey, resetLabels]);

  // ── Offline queue subscription (DECISION-F) ───────────────────────────────
  useEffect(() => {
    const unsub = offlineQueue.subscribe((count, _online, rejected, status) => {
      setQueuedCount(count);
      setRejectedCount(rejected ?? 0);
      // C006 (REVIEW-004 HIGH-1/2, MEDIUM-4): truthful queue state.
      setQueueStorageError(Boolean(status?.storageError));
      setQueueAuthPaused(Boolean(status?.authPaused));
    });
    offlineQueue.getRejected()
      .then((r) => setRejectedCount(r.length))
      .catch(() => setQueueStorageError(true));
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
      if (batch) {
        setBatchStatus(batch.status);
        setBatchInfo(batch as BatchOwnership);
      }
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
        await go('summary', { currentIndex: nextIdx, confirmedLocation: null });
      } else {
        await go('location_scan', {
          currentIndex:      nextIdx,
          confirmedLocation: null,
        });
      }
    },
    [lineItems.length, go]
  );

  // ── Claim / continue / take over (SF-PICK-ASSIGN-01) ─────────────────────
  // One path for every entry: the claim is idempotent for the current owner
  // (returns the current generation), first-to-claim / assignee-only for
  // pending work, and an idle-gated takeover otherwise. The server decides.
  const claim = useCallback(async () => {
    const { data } = await apiClient.post(`/api/v1/wms/batch/${task.id}/claim`, {
      device_event_id: newEventId(),
    });
    generationRef.current = typeof data?.pick_claim_generation === 'string' ? data.pick_claim_generation : null;
    return data as { custody_ack_required?: boolean; units_picked?: number };
  }, [task.id, newEventId]);

  const handleClaim = useCallback(async () => {
    setClaiming(true);
    try {
      const result = await claim();
      if (result.custody_ack_required) {
        await go('custody_ack', { currentIndex: 0, confirmedLocation: null, unitsPicked: result.units_picked ?? 0 });
      } else {
        await go('location_scan', { currentIndex: 0, confirmedLocation: null });
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to claim batch.';
      Alert.alert('Cannot start', msg);
      void load();
    } finally {
      setClaiming(false);
    }
  }, [claim, go, load]);

  /**
   * The current generation. C003 (REVIEW-001 M2): a restored session without
   * one re-reads it through the read-only GET pick-session, which answers only
   * the current owner and never claims or takes over. Only the explicit
   * Start / Take over action (handleClaim) calls POST /claim. Offline with no
   * generation, the write is refused visibly instead of guessing.
   */
  // C010 (REVIEW-006 F1) — without a held generation the device asks the
  // server (so offline stays a visible connection refusal), but never adopts
  // what comes back: the answer is PICK_GENERATION_REQUIRED either way, and
  // the operator re-enters through the explicit Start / Continue claim.
  const ensureGeneration = useCallback(async (): Promise<string> => {
    if (generationRef.current) return generationRef.current;
    try {
      await apiClient.get(`/api/v1/wms/batch/${task.id}/pick-session`);
    } catch (err: unknown) {
      if ((err as { response?: unknown })?.response) throw err; // server refusal → caller handles
      throw { connectionLost: true, response: { data: { error: RESUME_OFFLINE_MESSAGE } } };
    }
    throw { response: { status: 409, data: { code: 'PICK_GENERATION_REQUIRED', error: RESUME_OFFLINE_MESSAGE } } };
  }, [task.id]);

  /**
   * SF-PICK-ASSIGN-01 — this device no longer owns the batch: forget the
   * persisted session (including confirmed location and generation) and leave.
   * Returns true when the refusal was handled here.
   */
  const handleOwnershipRefusal = useCallback(async (code: string | null): Promise<boolean> => {
    if (code === 'PICK_GENERATION_REQUIRED') {
      generationRef.current = null;
      await clearSession();
      Alert.alert(
        'Reopen this batch',
        'This device can’t confirm it still holds the batch. Your confirmed picks are kept. Open the batch again to continue.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
      return true;
    }
    if (code && OWNERSHIP_LOST_CODES.has(code)) {
      generationRef.current = null;
      await clearSession();
      Alert.alert(
        'Batch reassigned',
        'Another picker now owns this batch. Your confirmed picks are kept. Hand any items you picked to the new picker or your supervisor.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
      return true;
    }
    if (code === 'PICK_CUSTODY_ACK_REQUIRED') {
      await go('custody_ack', { currentIndex, confirmedLocation: null, unitsPicked: batchInfo?.units_picked ?? 0 });
      return true;
    }
    return false;
  }, [clearSession, navigation, go, currentIndex, batchInfo?.units_picked]);

  const handleCustodyAck = useCallback(async () => {
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/custody-ack`, {
        pick_claim_generation: await ensureGeneration(),
      });
      // Fresh location verification: never resume from a stored location.
      await go('location_scan', { currentIndex, confirmedLocation: null });
    } catch (err: unknown) {
      if (await handleOwnershipRefusal(responseCode(err))) return;
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not confirm. Try again.';
      Alert.alert('Cannot continue', msg);
    } finally {
      setSubmitting(false);
    }
  }, [task.id, ensureGeneration, go, currentIndex, handleOwnershipRefusal]);

  // ── Location scan resolve (MOB-PCK-04: server-side resolve) ──────────────
  const handleLocationResolve = useCallback(
    async (raw: string): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      if (connectionLostRef.current) return PAUSED_SCAN_MESSAGE;
      // SF-PICK-LOCATION-TRUTH-01 — a stop that is not a pick bin fails closed.
      if (currentItem.location_pickable === false) {
        return `${currentItem.location_code} is not a pick bin. Stow this stock into a pick bin, then use Report problem.`;
      }
      try {
        const { data } = await apiClient.post('/api/v1/wms/location/resolve', {
          scanned_value: raw,
        });
        if (!data?.location_code)
          return 'Location not recognised. Try scanning the bin barcode.';
        const expected = currentItem.location_code ?? 'ROOT';
        if (data.location_code.toUpperCase() !== expected.toUpperCase())
          return `Wrong location — expected ${expected}.`;
        await go('product_scan', {
          currentIndex,
          confirmedLocation: data.location_code,
        });
      } catch (err: unknown) {
        if (noAnswer(err)) {
          markConnectionLost();
          return CONNECTION_LOST_SCAN_MESSAGE;
        }
        return 'Location scan failed. Try again.';
      }
    },
    [currentItem, currentIndex, go, markConnectionLost]
  );

  // SF-PICK-LOCATION-TRUTH-01 — warehouse-root stock is never in a bin, so
  // there is no location label to scan: the stop starts at the product scan.
  useEffect(() => {
    if (phase === 'location_scan' && currentUnbinned) {
      void go('product_scan', { currentIndex, confirmedLocation: null });
    }
  }, [phase, currentUnbinned, currentIndex, go]);

  /**
   * SF-PICK-LOCATION-TRUTH-01 — after an identity refusal, re-read this task's
   * label count from the server (read-only). Matched by task identity, never
   * by index, so the screen position is untouched.
   */
  const refreshUnitsRequired = useCallback(async (key: string) => {
    try {
      const { data } = await apiClient.get(`/api/v1/wms/batch/${task.id}/line-items`);
      const fresh = ((data?.line_items ?? []) as LineItem[]).find((li) => taskKeyOf(li) === key);
      if (fresh) setUnitsRequiredOverride({ task: key, n: Math.max(0, Number(fresh.unit_scan_required ?? 0) || 0) });
    } catch {
      // Keep the current count; the server re-checks every write.
    }
  }, [task.id]);

  /**
   * One /pick/scan submission (online only, C008). `identity` is exactly what
   * the operator scanned: a list of LSU labels, or one LSU / none on the
   * product-only path. Nothing is inferred on the device. Returns an inline
   * message, or undefined once the server has confirmed and the screen moved on.
   */
  const sendPick = useCallback(
    async (
      variantId: string,
      identity: { lasyncro_unit_id: string | null } | { lasyncro_unit_ids: string[] },
      method?: string,
    ): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      // MOB-PCK-07 / C008: one scan identity per pick task, reused on retry
      // (the server's own idempotency is keyed on the task, not this id).
      const taskKey = taskKeyOf(currentItem);
      if (pendingScanRef.current?.task !== taskKey) {
        pendingScanRef.current = { task: taskKey, eventId: newEventId() };
      }
      const eventId = pendingScanRef.current.eventId;
      const submitError = await offlineQueue.submitScanOnline({
        deviceEventId: eventId,
        url: '/api/v1/wms/pick/scan',
        body: {
          pick_batch_id:          task.id,
          lasyncro_line_item_id:  currentItem.lasyncro_line_item_id,
          lasyncro_variant_id:    variantId,
          ...identity,
          // SF-PICK-ASSIGN-01 C007 (REVIEW-005 H-1): the exact physical pick
          // task on screen. Required by the server for allocation-backed
          // batches; absent (undefined, dropped from JSON) on legacy tasks.
          // Never derived or substituted on the device.
          reservation_allocation_id:
            currentItem.reservation_allocation_id ?? undefined,
          location_code:          currentItem.location_code,
          quantity_confirmed:     currentItem.quantity,
          device_event_id:        eventId,
          scan_source:            method ?? 'camera',
          // SF-PICK-ASSIGN-01 — ownership generation fence.
          pick_claim_generation:  await ensureGeneration(),
        },
      });
      if (submitError) {
        if (submitError.code === PICK_CONNECTION_LOST) {
          markConnectionLost();
          return CONNECTION_LOST_SCAN_MESSAGE;
        }
        if (await handleOwnershipRefusal(submitError.code)) return;
        if (submitError.code && UNIT_IDENTITY_CODES.has(submitError.code)) {
          // Nothing was recorded. Start the labels over against the server's count.
          resetLabels();
          await refreshUnitsRequired(taskKey);
          return `${submitError.error} Label cleared — scan the unit label again.`;
        }
        return submitError.error; // server answer: not confirmed
      }
      // undefined = confirmed by the server → advance
      pendingScanRef.current = null;
      sessionTotalsRef.current.picked += currentItem.quantity;
      await advanceToNext(currentIndex + 1);
    },
    [currentItem, currentIndex, task.id, newEventId, advanceToNext, ensureGeneration, handleOwnershipRefusal, markConnectionLost, resetLabels, refreshUnitsRequired]
  );

  // ── Product scan resolve ──────────────────────────────────────────────────
  const handleProductResolve = useCallback(
    async (raw: string, method?: string): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      // C008 — a disconnected scan is never sent or treated as confirmed.
      if (connectionLostRef.current) return PAUSED_SCAN_MESSAGE;
      // Synchronous duplicate guard (state is not an atomic lock).
      if (scanInFlightRef.current) return IN_FLIGHT_SCAN_MESSAGE;
      scanInFlightRef.current = true;
      setSubmitting(true);
      try {
        let resolved:
          | { lasyncro_variant_id?: string; lasyncro_unit_id?: string; resolution_method?: string }
          | undefined;
        try {
          ({ data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
            scanned_value: raw,
          }));
        } catch (err: unknown) {
          if (noAnswer(err)) {
            markConnectionLost();
            return CONNECTION_LOST_SCAN_MESSAGE;
          }
          throw err;
        }
        if (!resolved?.lasyncro_variant_id)
          return 'Barcode not recognised. Try scanning again.';

        // SF-PICK-LOCATION-TRUTH-01 — only a scanned LSU label is a unit
        // identity, as decided by the resolver (resolution_method
        // 'unit_barcode'), never by the raw text. The resolver attaches some
        // available unit to a product barcode (EAN/SKU/LSP); that unit was
        // chosen by the server, never by the operator, so it is never sent.
        const scannedLabel = scannedUnitIdentity(resolved);

        // Labelled stock: one unit label verifies the product/location (QUANTITY-CUSTODY-001).
        const identified = scannedUnitIdsRef.current;
        if (unitsToIdentify > 0) {
          if (identified.length >= unitsToIdentify) {
            return 'All labels are scanned. Tap Confirm pick.';
          }
          if (!scannedLabel) return 'Scan the unit label (LSU-…) on the item.';
          if (resolved.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
            return `Wrong item — this label is another product.`;
          }
          if (identified.includes(scannedLabel)) return `Label already scanned.`;
          // Early feedback only; the server re-checks every identity on confirm.
          const unitStatus = (resolved as { unit_status?: string }).unit_status;
          if (unitStatus && !PICKABLE_UNIT_STATUSES.has(unitStatus)) {
            return `This unit is already ${unitStatus.replace(/_/g, ' ')} — it can't be picked. Scan another label.`;
          }
          const unitLocation = (resolved as { current_location_code?: string | null }).current_location_code;
          if (unitStatus === 'stowed' && unitLocation && unitLocation !== currentItem.location_code) {
            return `This unit is stowed in ${unitLocation}, not here. Scan another label.`;
          }
          const next = [...identified, scannedLabel];
          scannedUnitIdsRef.current = next;
          setScannedUnitCount(next.length);
          setQuantityPicked(String(next.length));
          lastScanMethodRef.current = method;
          // Single labelled unit: the label scan is the pick (auto-confirm).
          if (next.length === unitsToIdentify && unitsToIdentify === 1 && currentItem.quantity === 1) {
            return await sendPick(resolved.lasyncro_variant_id, { lasyncro_unit_ids: next }, method);
          }
          return; // progress shown; Confirm pick once every label is scanned
        }

        // Multi-unit product picks reveal a count in this same screen.
        if (currentItem.quantity > 1) {
          if (resolved.lasyncro_variant_id !== currentItem.lasyncro_variant_id) return 'Wrong item — barcode does not match.';
          if (scannedLabel) return 'Scan the product barcode. Unit picking requires server-confirmed label requirements.';
          lastScanMethodRef.current = method;
          setProductVerified(true);
          return;
        }
        return await sendPick(resolved.lasyncro_variant_id, { lasyncro_unit_id: scannedLabel }, method);
      } catch (err: unknown) {
        if ((err as { connectionLost?: boolean })?.connectionLost) markConnectionLost();
        if (await handleOwnershipRefusal(responseCode(err))) return;
        return (
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Product scan failed. Try again.'
        );
      } finally {
        scanInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [currentItem, unitsToIdentify, sendPick, handleOwnershipRefusal, markConnectionLost]
  );

  // SF-PICK-LOCATION-TRUTH-01 — explicit confirmation once every label is
  // scanned (several labels, or labels plus unlabelled units).
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const handleConfirmLabels = useCallback(async () => {
    if (!currentItem || (!labelsComplete && !productVerified)) return;
    const picked = unitsToIdentify === currentItem.quantity ? currentItem.quantity : Number(quantityPicked);
    if (!quantityPicked.trim() || !Number.isInteger(picked) || picked < scannedUnitIdsRef.current.length || picked < 0 || picked > currentItem.quantity) {
      setConfirmError('Enter a whole quantity between the scanned labels and the required quantity.');
      return;
    }
    if (connectionLostRef.current) { setConfirmError(PAUSED_SCAN_MESSAGE); return; }
    if (scanInFlightRef.current) return;
    if (picked < currentItem.quantity) { setProblemSheetVisible(true); return; }
    scanInFlightRef.current = true;
    setSubmitting(true);
    setConfirmError(null);
    try {
      const message = await sendPick(
        currentItem.lasyncro_variant_id,
        unitsToIdentify > 0 ? { lasyncro_unit_ids: [...scannedUnitIdsRef.current] } : { lasyncro_unit_id: null },
        lastScanMethodRef.current,
      );
      if (message) setConfirmError(message);
    } catch (err: unknown) {
      if ((err as { connectionLost?: boolean })?.connectionLost) markConnectionLost();
      if (await handleOwnershipRefusal(responseCode(err))) return;
      setConfirmError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Confirm failed. Try again.',
      );
    } finally {
      scanInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [currentItem, labelsComplete, productVerified, quantityPicked, unitsToIdentify, sendPick, handleOwnershipRefusal, markConnectionLost]);
  useEffect(() => { setConfirmError(null); }, [currentTaskKey]);

  // ── C008 — automatic recovery after a lost connection ────────────────────
  // Only a server answer ends the pause. Ownership is re-read through the
  // read-only pick-session (never a claim), the remaining work is reloaded
  // from the server, and work resumes at a fresh location scan.
  const resumeInFlightRef = useRef(false);
  const tryResume = useCallback(async () => {
    if (!connectionLostRef.current || resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    try {
      let session: { pick_claim_generation?: unknown; custody_ack_required?: unknown };
      let items: LineItem[];
      // C010 (REVIEW-006 F1) — verify the generation this device HOLDS.
      const held = generationRef.current;
      try {
        ({ data: session } = await apiClient.get(
          `/api/v1/wms/batch/${task.id}/pick-session`,
          held ? { headers: { 'X-Pick-Claim-Generation': held } } : undefined,
        ));
        const lineRes = await apiClient.get(`/api/v1/wms/batch/${task.id}/line-items`);
        items = lineRes.data?.line_items ?? [];
      } catch (err: unknown) {
        if (noAnswer(err)) return;                       // still disconnected
        const code = responseCode(err);
        if (code && OWNERSHIP_LOST_CODES.has(code)) {
          connectionLostRef.current = false;
          setConnectionLost(false);
          await handleOwnershipRefusal(code);
        }
        return;                                          // other answers: stay paused, retry later
      }
      if (!held || session?.pick_claim_generation !== held) {
        // Missing or different generation: never adopted. End the session.
        connectionLostRef.current = false;
        setConnectionLost(false);
        await handleOwnershipRefusal(held ? 'PICK_GENERATION_STALE' : 'PICK_GENERATION_REQUIRED');
        return;
      }
      pendingScanRef.current = null;
      setLineItems(items);
      connectionLostRef.current = false;
      setConnectionLost(false);
      if (session.custody_ack_required === true) {
        await go('custody_ack', { currentIndex: 0, confirmedLocation: null, unitsPicked: batchInfo?.units_picked ?? 0 });
      } else if (items.length === 0) {
        await go('summary', { currentIndex: 0, confirmedLocation: null });
      } else {
        await go('location_scan', { currentIndex: 0, confirmedLocation: null });
      }
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [task.id, go, handleOwnershipRefusal, batchInfo?.units_picked]);

  useEffect(() => {
    if (!connectionLost) return;
    const probe = setInterval(() => { void tryResume(); }, RECONNECT_PROBE_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void tryResume(); });
    return () => {
      clearInterval(probe);
      sub.remove();
    };
  }, [connectionLost, tryResume]);

  // ── Exception report via ProblemSheet (MOB-PCK-11/12) ────────────────────
  const handleExceptionReport = useCallback(
    async (type: string, qty: number): Promise<string | void> => {
      if (!currentItem) return 'No active item.';
      try {
        const eventId = newEventId(); // MOB-PCK-07
        /**
         * GH-1049 — one report, physical truth only.
         *
         * ProblemSheet's stepper is "Quantity affected", i.e. the units that
         * are NOT in the operator's hand. quantity_found is therefore what was
         * actually found: the full shortfall for every non-short_pick outcome,
         * and required minus affected for a short pick.
         *
         * The server creates the linked Problem Center task in the same
         * transaction — the client no longer POSTs a standalone incident, and
         * the old probData?.exception_id read (a field this endpoint never
         * returned) is gone with it.
         */
        const quantityFound =
          type === 'short_pick'
            ? Math.max(0, currentItem.quantity - qty)
            : 0;
        // SF-PICK-LOCATION-TRUTH-01 — the found units carry exactly the labels
        // already scanned; nothing is inferred for the rest.
        const labels = [...scannedUnitIdsRef.current];
        if (type === 'short_pick' && labels.length > quantityFound) {
          return `You scanned ${labels.length} label${labels.length === 1 ? '' : 's'}. ` +
            `Report at most ${currentItem.quantity - labels.length} affected.`;
        }
        const foundUnitIds = quantityFound > 0 ? labels : [];

        await apiClient.post(
          `/api/v1/wms/batch/${task.id}/exception`,
          {
            lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
            lasyncro_variant_id:   currentItem.lasyncro_variant_id,
            reservation_allocation_id:
              currentItem.reservation_allocation_id ?? undefined,
            exception_type:        type,
            stage:                 'pick',
            quantity_required:     currentItem.quantity,
            quantity_found:        quantityFound,
            device_event_id:       eventId,
            pick_claim_generation: await ensureGeneration(),
            ...(foundUnitIds.length > 0 ? { lasyncro_unit_ids: foundUnitIds } : {}),
          }
        );
        pendingExQtyRef.current = qty;
        // Server accepted the exception: found units are picked, the rest is short and flagged.
        sessionTotalsRef.current.picked += quantityFound;
        sessionTotalsRef.current.short += currentItem.quantity - quantityFound;
        sessionTotalsRef.current.flagged += 1;
      } catch (err: unknown) {
        if (await handleOwnershipRefusal(responseCode(err))) {
          setProblemSheetVisible(false);
          return;
        }
        const code = responseCode(err);
        if (code && UNIT_IDENTITY_CODES.has(code)) {
          // Nothing was recorded. Re-read the label count so the product scan
          // asks for labels; a refused label set is started over.
          if (code === 'PICK_UNIT_IDENTITY_MISMATCH') resetLabels();
          await refreshUnitsRequired(taskKeyOf(currentItem));
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Unit labels not accepted.';
          return `${msg} Close this, scan the unit label on one item you found, then report again.`;
        }
        return (
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ?? 'Failed to report exception.'
        );
      }
    },
    [currentItem, task.id, newEventId, ensureGeneration, handleOwnershipRefusal, resetLabels, refreshUnitsRequired]
  );

  const handleProblemClose = useCallback(async () => {
    const qty = pendingExQtyRef.current;
    pendingExQtyRef.current = 0;
    setProblemSheetVisible(false);
    if (qty <= 0) return;
    await advanceToNext(currentIndex + 1);
  }, [currentIndex, advanceToNext]);

  // ── Complete pick ─────────────────────────────────────────────────────────
  // SF-PICK-UX-ADAPTIVE-01-FINALIZE-001 — the existing pick-complete operation runs
  // automatically, once, when the last outcome is server-settled ('summary' is now a
  // transient finalizing state, not a confirmation screen). 'complete' renders only after
  // the server accepts. A retry after a lost answer is answered authoritatively by the
  // ownership fence: PICK_BATCH_NOT_PICKING + status 'pick_complete' = already committed.
  const handlePickComplete = useCallback(async () => {
    if (finalizeInFlightRef.current) return;
    finalizeInFlightRef.current = true;
    setSubmitting(true);
    setFinalizeError(null);
    try {
      const eventId = newEventId();
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pick-complete`, {
        device_event_id: eventId,
        pick_claim_generation: await ensureGeneration(),
      });
      generationRef.current = null;
      await clearSession();
      await setPhase('complete', {});
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { code?: string; status?: string; error?: string } } })?.response?.data;
      if (data?.code === 'PICK_BATCH_NOT_PICKING' && data?.status === 'pick_complete') {
        generationRef.current = null;
        await clearSession();
        await setPhase('complete', {});
        return;
      }
      if (await handleOwnershipRefusal(responseCode(err))) return;
      setFinalizeError(data?.error ?? 'Finishing the pick failed. Retry when the connection is restored.');
    } finally {
      finalizeInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [task.id, newEventId, clearSession, setPhase, ensureGeneration, handleOwnershipRefusal]);
  const autoFinalizeArmedRef = useRef(true);
  useEffect(() => {
    if (phase !== 'summary') { autoFinalizeArmedRef.current = true; return; }
    if (!autoFinalizeArmedRef.current) return;
    autoFinalizeArmedRef.current = false;
    void handlePickComplete();
  }, [phase, handlePickComplete]);

  // ── NodeTrack ─────────────────────────────────────────────────────────────
  const trackNodes: TrackNode[] = [
    {
      id:       'location',
      label:    currentUnbinned
                  ? 'Not in a bin'
                  : phase === 'product_scan'
                  ? (confirmedLocation ?? '—')
                  : (currentItem?.location_code ?? 'Location'),
      sublabel: currentUnbinned ? 'No location scan' : 'Bin barcode',
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
  // SF-PICK-ASSIGN-01 — refused offline scans are kept for review, never dropped.
  const reviewRejectedScans = useCallback(async () => {
    let rejected: Awaited<ReturnType<typeof offlineQueue.getRejected>>;
    try {
      rejected = await offlineQueue.getRejected();
    } catch {
      Alert.alert(
        'Scan records unavailable',
        'This phone cannot read its saved scans right now. Keep any unconfirmed items aside and ask your supervisor to check the batch.',
      );
      return;
    }
    if (rejected.length === 0) return;
    // C005 (REVIEW-003 LOW-3): say why each scan needs review and what to do.
    // C011 (NEW-1): a fence refusal or an unreplayable historical scan may
    // already be recorded — it is never described as "not recorded".
    const lines = rejected.map((r) => {
      const batch = String((r.body as { pick_batch_id?: unknown })?.pick_batch_id ?? '').slice(0, 8).toUpperCase();
      if (r.code && OWNERSHIP_LOST_CODES.has(r.code)) {
        return `• Batch ${batch}: batch reassigned — do not re-scan. It may already be recorded; hand the items to the new picker or your supervisor.`;
      }
      if (r.reason === 'already_recorded_by_other') {
        return `• Batch ${batch}: already recorded by another picker — do not re-scan. Give the item to your supervisor.`;
      }
      if (r.reason === 'outcome_uncertain' || r.code === 'PICK_CUSTODY_ACK_REQUIRED') {
        return `• Batch ${batch}: may already be recorded — do not re-scan. Ask your supervisor to check the batch.`;
      }
      if (r.reason === 'server_error_retries_exhausted') {
        // C012: a 5xx may come after the scan committed — never ask for a re-scan.
        return `• Batch ${batch}: the server did not answer for over 10 minutes, so it may already be recorded — do not re-scan. Ask your supervisor to check the batch.`;
      }
      return `• Batch ${batch}: refused by the server (${r.error ?? r.status}) — review it with your supervisor before re-scanning.`;
    }).join('\n');
    Alert.alert(
      `${rejected.length} scan${rejected.length > 1 ? 's need' : ' needs'} review`,
      `${lines}\n\nKeep those items aside until each one is resolved.`,
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Reviewed — dismiss',
          onPress: () => {
            void (async () => {
              // C011 (NEW-1): the queue records the review on the server before
              // removing a scan that may already be recorded; on failure the
              // scan stays on this phone and the remaining ones are not touched.
              let removed = 0;
              try {
                for (const r of rejected) {
                  await offlineQueue.dismissRejected(r.deviceEventId);
                  removed += 1;
                }
              } catch (err: unknown) {
                const kind = (err as { kind?: unknown })?.kind;
                // C012: after a part-way failure, say exactly what was removed and what is kept.
                const left = rejected.length - removed;
                const kept = removed === 0
                  ? `The scan${left > 1 ? 's are' : ' is'} kept on this phone.`
                  : `${removed} of ${rejected.length} reviewed scans were removed; the other ${left} ${left > 1 ? 'are' : 'is'} kept on this phone.`;
                // C012 (LOW-2): only PickReviewNotRecordedError carries a review
                // `kind`. Anything else (e.g. QueueStorageError) failed on this
                // phone — possibly after the server recorded the review — so it
                // must not be reported as an unrecorded review.
                if (kind !== 'offline' && kind !== 'auth' && kind !== 'server') {
                  Alert.alert(
                    'Scan kept on this phone',
                    `This phone could not finish updating its saved scans. ${kept} Try again; if it keeps failing, ask your supervisor to check the batch. Do not re-scan these items.`,
                  );
                } else {
                  Alert.alert(
                    'Review not recorded',
                    kind === 'offline'
                      ? `No connection — the review was not recorded. ${kept} Try again when connected.`
                      : kind === 'auth'
                        ? `Sign in again — the review was not recorded. ${kept}`
                        : `The review could not be recorded. ${kept} Try again in a moment; if it keeps failing, ask your supervisor to check the batch. Do not re-scan these items.`,
                  );
                }
              }
              try {
                setRejectedCount((await offlineQueue.getRejected()).length);
              } catch {
                // The banner keeps its last count; the next review reports unreadable records.
              }
            })();
          },
        },
      ],
    );
  }, []);

  const OfflineBanner = connectionLost || queuedCount > 0 || rejectedCount > 0 || queueStorageError || queueAuthPaused ? (
    <>
      {connectionLost && (
        <View style={styles.connectionLostBlock} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Row style={{ alignItems: 'center', gap: spacing.xs }}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.bg} />
            <Text style={styles.connectionLostTitle}>Connection lost</Text>
          </Row>
          <Text style={styles.offlineBannerText}>Picking is paused. Your confirmed progress is saved.</Text>
          <Row style={{ alignItems: 'center', gap: spacing.xs }}>
            <ActivityIndicator size="small" color={colors.bg} />
            <Text style={styles.offlineBannerText}>Waiting for connection…</Text>
          </Row>
        </View>
      )}
      {queueStorageError && (
        <View style={styles.offlineBanner}>
          <Ionicons name="warning-outline" size={14} color={colors.bg} />
          <Text style={styles.offlineBannerText}>
            Scans can't be saved on this phone right now — keep unconfirmed items aside
          </Text>
        </View>
      )}
      {queueAuthPaused && queuedCount > 0 && (
        <View style={styles.offlineBanner}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.bg} />
          <Text style={styles.offlineBannerText}>
            Sign in again to sync {queuedCount} saved scan{queuedCount > 1 ? 's' : ''} — they are kept on this phone
          </Text>
        </View>
      )}
      {queuedCount > 0 && !queueAuthPaused && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.bg} />
          <Text style={styles.offlineBannerText}>
            {queuedCount} scan{queuedCount > 1 ? 's' : ''} queued — will sync when online
          </Text>
        </View>
      )}
      {rejectedCount > 0 && (
        <TouchableOpacity style={styles.offlineBanner} onPress={() => void reviewRejectedScans()} accessibilityRole="button">
          <Ionicons name="alert-circle-outline" size={14} color={colors.bg} />
          <Text style={styles.offlineBannerText}>
            {rejectedCount} scan{rejectedCount > 1 ? 's need' : ' needs'} review — tap to review
          </Text>
        </TouchableOpacity>
      )}
    </>
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
            ) : batchStatus === 'picking' && batchInfo?.picked_by === userId ? (
              // SF-PICK-ASSIGN-01 — resume through the owner's idempotent claim,
              // which re-reads the current ownership generation.
              <Button
                label={claiming ? 'Resuming…' : 'Continue picking'}
                onPress={() => void handleClaim()}
                variant="primary"
              />
            ) : batchStatus === 'picking' && batchInfo?.recovery_eligible ? (
              <Button
                label={claiming ? 'Taking over…' : `Take over from ${batchInfo.picker_name ?? 'picker'}`}
                onPress={() => void handleClaim()}
                variant="primary"
              />
            ) : batchStatus === 'picking' ? (
              <Text style={styles.sku}>
                Being picked by {batchInfo?.picker_name ?? 'another operator'}
              </Text>
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

  // ── CUSTODY ACK (SF-PICK-ASSIGN-01) ──────────────────────────────────────
  if (phase === 'custody_ack') {
    const alreadyPicked = Number(phaseData.unitsPicked ?? batchInfo?.units_picked ?? 0);
    return (
      <Screen>
        <AppHeader title={`Pick · ${task.title}`} showLogo={false} />
        {OfflineBanner}
        <View style={styles.summaryHeadBlock}>
          <Text style={styles.completeTitle}>Confirm picked items</Text>
          <Text style={styles.completeSub}>
            {alreadyPicked} unit{alreadyPicked === 1 ? ' was' : 's were'} already picked by the previous picker.
            {'\n'}Collect the tote or items from them, then confirm.
            {'\n'}You will scan the next location label to continue.
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label={submitting ? 'Confirming…' : 'I have the picked items'}
            onPress={() => void handleCustodyAck()}
            variant="primary"
          />
          <Button
            label="Back"
            onPress={() => navigation.goBack()}
            variant="ghost"
            style={{ marginTop: spacing.xs }}
          />
        </View>
      </Screen>
    );
  }

  // ── FINALIZING (FINALIZE-001: replaces the MOB-PCK-13 summary/confirm screen) ──
  if (phase === 'summary') {
    return (
      <Screen>
        <AppHeader title={`Pick · ${task.title}`} showLogo={false} />
        {OfflineBanner}
        <View style={styles.center}>
          {finalizeError ? (
            <>
              <Text style={styles.errorText} accessibilityRole="alert">{finalizeError}</Text>
              <TouchableOpacity
                style={styles.completeBtn}
                disabled={submitting}
                onPress={() => void handlePickComplete()}
                accessibilityRole="button"
              >
                <Text style={styles.completeBtnText}>{submitting ? 'Finishing pick…' : 'Retry finishing pick'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.completeSub} testID="pick-finalizing" accessibilityLiveRegion="polite">Finishing pick…</Text>
          )}
        </View>
      </Screen>
    );
  }

  // ── COMPLETE — shown only after the server accepted completion ────────────
  if (phase === 'complete') {
    const t = sessionTotalsRef.current;
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>Pick complete</Text>
          <Text style={styles.completeSub} testID="pick-complete-totals">
            {`Picked ${t.picked} · Short ${t.short} · Flagged ${t.flagged}`}
          </Text>
          <Text style={styles.completeSub} testID="pick-pack-readiness">
            {t.flagged > 0
              ? `Batch ready for pack. ${t.flagged} item${t.flagged === 1 ? '' : 's'} reported — routed to Problem Center.`
              : 'Batch ready for pack.'}
            {'\n'}Totals cover this session. Packing is done at the Pack station.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Return to Operations</Text>
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
          serverOwnsProblemTask
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
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.contextBlock}>
            <Text style={styles.contextLabel}>{currentUnbinned ? 'Not in a bin' : 'Location confirmed'}</Text>
            {!currentUnbinned && <Text style={styles.contextValue}>{confirmedLocation}</Text>}
            {/* SF-PICK-UX-ADAPTIVE-01-ACTIONABLE-ID-001 — the card shows the complete, real identifier the
                server accepts for this task: the product barcode, or one eligible LSU from the server
                (scan_unit_id). Display only — any other eligible LSU is still scannable; once a label is
                scanned the verified LSU replaces it. Full value, wraps, never truncated. */}
            <View testID="pick-product-card">
              {currentItem.image_url && <Image source={{ uri: currentItem.image_url }} accessibilityLabel={productName(currentItem)} style={{ width: 64, height: 64 }} />}
              <Text style={styles.contextValue} testID="pick-product-name">{productName(currentItem)}</Text>
              {displaySku(currentItem) ? <Text style={styles.contextSub} testID="pick-product-sku">SKU: {displaySku(currentItem)}</Text> : null}
              {unitsToIdentify > 0 ? (
                labelsComplete ? (
                  // QUANTITY-UX-001 — the scanned (verified) LSU replaces the suggestion, green ✓; not a commitment.
                  <Text style={styles.contextSub} testID="pick-product-accepted-identifier" accessibilityLiveRegion="polite">
                    {'Unit label: '}<Text style={[styles.scanTarget, styles.scanAccepted]} testID="pick-scan-accepted">{`✓ ${scannedUnitIdsRef.current[0]}`}</Text>
                  </Text>
                ) : currentItem.scan_unit_id?.trim() ? (
                  <Text style={styles.contextSub} testID="pick-product-accepted-identifier">
                    {'Unit label: '}<Text style={styles.scanTarget} testID="pick-scan-target">{currentItem.scan_unit_id.trim()}</Text>
                  </Text>
                ) : null
              ) : currentItem.barcode !== undefined ? (
                <Text style={styles.contextSub} testID="pick-product-barcode">
                  {'Barcode: '}{currentItem.barcode?.trim()
                    ? (productVerified
                      ? <Text style={[styles.scanTarget, styles.scanAccepted]} testID="pick-scan-accepted">{`✓ ${currentItem.barcode.trim()}`}</Text>
                      : <Text style={styles.scanTarget} testID="pick-scan-target">{currentItem.barcode.trim()}</Text>)
                    : 'Not assigned'}
                </Text>
              ) : null}
              <Text style={styles.contextSub}>Quantity: {currentItem.quantity}</Text>
            </View>
            {unitsToIdentify > 0 ? null : (
              <Text style={styles.contextSub}>Scan the product barcode</Text>
            )}
            {currentItem.quantity > 1 && unitsToIdentify < currentItem.quantity && (labelsComplete || productVerified) && (
              // QUANTITY-UX-001 — [ − ] [ n   out of N ] [ + ] on one centre line, one height;
              // "out of N" is fixed text inside the field, never part of the value.
              <View style={styles.qtyRow} testID="pick-qty-row">
                <TouchableOpacity
                  accessibilityRole="button" accessibilityLabel="Remove one unit"
                  disabled={submitting || connectionLost || (Number(quantityPicked) || 0) <= scannedUnitIdsRef.current.length}
                  onPress={() => { setQuantityPicked(String(Math.max(scannedUnitIdsRef.current.length, (Number(quantityPicked) || 0) - 1))); setConfirmError(null); }}
                  style={styles.qtyStep}
                ><Text style={styles.qtyStepText}>−</Text></TouchableOpacity>
                <View style={styles.qtyField}>
                  <TextInput
                    accessibilityLabel="Quantity picked"
                    accessibilityHint={`out of ${currentItem.quantity}`}
                    keyboardType="number-pad"
                    autoFocus
                    value={quantityPicked}
                    onChangeText={value => { setQuantityPicked(value.replace(/[^0-9]/g, '')); setConfirmError(null); }}
                    editable={!submitting && !connectionLost}
                    style={styles.qtyInput}
                  />
                  <Text style={styles.qtySuffix} testID="pick-qty-out-of" accessible={false}>{`out of ${currentItem.quantity}`}</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button" accessibilityLabel="Add one unit"
                  disabled={submitting || connectionLost || (Number(quantityPicked) || 0) >= currentItem.quantity}
                  onPress={() => { setQuantityPicked(String(Math.min(currentItem.quantity, (Number(quantityPicked) || 0) + 1))); setConfirmError(null); }}
                  style={styles.qtyStep}
                ><Text style={styles.qtyStepText}>+</Text></TouchableOpacity>
              </View>
            )}
            {confirmError && <Text style={styles.errorText} accessibilityRole="alert">{confirmError}</Text>}
          </View>
        </ScrollView>
        {(labelsComplete || productVerified) && (
          <View style={styles.actions}>
            <Button
              label={submitting ? 'Confirming…' : unitsToIdentify < currentItem.quantity && Number(quantityPicked) < currentItem.quantity ? `Report ${quantityPicked || 0} of ${currentItem.quantity}` : `Confirm pick (${currentItem.quantity})`}
              onPress={() => void handleConfirmLabels()}
              disabled={submitting || connectionLost}
              variant="primary"
            />
          </View>
        )}
        {/* SCAN-INPUT-VISIBILITY-001 — after a valid LSU/EAN scan with quantity > 1 the scanner
            (camera and HID wedge) is hidden: only the stepper and Confirm remain. A refusal that
            clears the label, or the next item, brings it back. */}
        {!(currentItem.quantity > 1 && unitsToIdentify < currentItem.quantity && (labelsComplete || productVerified)) && (
          <ScanDock
            hint={unitsToIdentify > scannedUnitCount ? 'Point camera at unit label' : 'Point camera at product barcode'}
            onResolve={handleProductResolve}
          />
        )}
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
          serverOwnsProblemTask
          key={currentTaskKey}
          defaultQty={Math.max(1, currentItem.quantity - Number(quantityPicked || 0))}
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
  // ACTIONABLE-ID-001 — the identifier to scan: prominent, full value, wraps.
  // QUANTITY-UX-001 — the identifier keeps the neighbouring detail size; full value, wraps.
  scanTarget:   { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.bold, flexShrink: 1 },
  scanAccepted: { color: colors.ok },
  qtyRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  qtyStep:      { width: 58, height: 58, borderWidth: 1, borderColor: colors.ink3, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  qtyStepText:  { color: colors.ink, fontSize: 28 },
  qtyField:     { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.ink3, borderRadius: radius.md, paddingHorizontal: spacing.md },
  qtyInput:     { flex: 1, color: colors.ink, fontSize: 24, padding: 0 },
  qtySuffix:    { color: colors.ink3, fontSize: font.size.sm },
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
  // C008 — one persistent block, no dialogs.
  connectionLostBlock: {
    gap: spacing.xs, backgroundColor: colors.warning,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  connectionLostTitle: { color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.bold },
});