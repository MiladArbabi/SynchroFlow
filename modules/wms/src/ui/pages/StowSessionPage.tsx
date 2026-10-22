// modules/wms/src/ui/pages/StowSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip,
  TextField, useTheme, CircularProgress, IconButton,
  alpha,
} from '@mui/material';
import {
  CheckCircle,
  MapPin,
  Package,
  ArrowLeft,
} from 'lucide-react';
import type {
  WmsStowTask,
  WmsStowConfirmResult,
} from './WmsModuleFT2.js';

/**
 * STOW SESSION PAGE — WEB-STOW-UNIT-01 / STOW-SPLIT-01 / STOW-UX-SCAN-RAIL-01
 * / STOW-ACTIVE-LOCATION-01
 * -----------------------------------------------------
 * Location-first flow with a mutable, sticky active bin:
 *
 *   brief → location_scan → item_scan ↺ → complete
 *
 * STOW-ACTIVE-LOCATION-01 superseded "one Stow task = one immutable
 * destination": currentTask.location_code / confirmedLocation is the
 * CURRENT / most-recently-activated destination, not a frozen one. While a
 * task is active (item_scan), scanning a different valid bin switches the
 * active destination for units confirmed AFTER that point — see
 * handleItemScan below. It does not rewrite where already-committed units
 * physically are; that exact history remains in inventory_movements /
 * inventory_units.current_location_code and is surfaced task-wide by the
 * activity panel, never bin-scoped.
 *
 * STOW-SPLIT-01 — every accepted physical-unit scan commits exactly one unit.
 * There is intentionally no quantity-confirm or review phase: the successful
 * scanner event itself is the operator's placement confirmation.
 */

export type BarcodeResolveResult = {
  lasyncro_variant_id: string;
  lasyncro_unit_id?: string;
  unit_status?: string;
};

/** Canonical placement projection — see stow.service.ts#getStowTaskPlacements. */
export type StowPlacement = {
  lasyncro_unit_id: string;
  lasyncro_variant_id: string;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  location_code: string;
  operator_id: number | null;
  operator_name: string | null;
  occurred_at: string;
};

export interface StowSessionPageProps {
  initialTaskId: string;
  initialStep?: 'location' | null;
  currentUserId?: number | null;
  onComplete: () => void;
  /**
   * STOW-SESSION-TRANSITION-01 — the single source of truth for "which task
   * is active and what phase is it in", reported to the parent with the
   * EXACT task ID it applies to. This replaces the earlier `onStepChange?:
   * (step) => void`, whose implicit subject was always whatever task ID the
   * parent's own closure happened to capture — correct for a same-task step
   * change, but silently wrong the moment advanceToNext() moves the session
   * to a different task, since the parent had no way to learn the new ID.
   * Called both for a same-task phase change and for an automatic task
   * transition; the parent must persist taskId as the new canonical active
   * session identity (URL + activeSession state) on every call, never derive
   * it from a previously captured value.
   */
  onActiveTaskChange?: (taskId: string, step: 'location' | null) => void;
  onFetchTasks: () => Promise<WmsStowTask[]>;
  onResolveLocation: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignLocation: (taskId: string, locationCode: string) => Promise<void>;
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (scannedValue: string) => Promise<BarcodeResolveResult | null>;
  onConfirmStow: (
    taskId: string,
    quantityPlaced: number,
    lasyncroUnitId?: string
  ) => Promise<WmsStowConfirmResult>;
  /** STOW-UX-SCAN-RAIL-01 — canonical current-bin activity trace, task-scoped. */
  onFetchPlacements?: (taskId: string) => Promise<StowPlacement[]>;
}

// STOW-SPLIT-01 — only phases that remain reachable in the per-unit scanner
// workflow are represented. Dead quantity/review states are deliberately
// removed so UI state cannot transition back into the retired workflow.
type Phase =
  | 'brief'
  | 'item_scan'
  | 'location_scan'
  | 'complete';

type StowOperatorErrorContext = 'item_scan' | 'location_scan';

// STOW-SPLIT-01 — transient feedback is reserved for meaningful operational
// events: a committed unit, a physical bin switch, or scanner-busy protection.
// Stable location state belongs to the persistent banner instead of being
// repeated after every successful location scan.
type StowScanFeedback = {
  severity: 'success' | 'info';
  message: string;
};

function triggerLabel(trigger: string): string {
  if (trigger === 'inbound_stock') return 'Inbound receive';
  if (trigger === 'order_cancelled_mid_pick') return 'Cancelled pick';
  if (trigger === 'return_restock') return 'Return restock';
  if (trigger === 'problem_center') return 'Problem center';
  return trigger.replace(/_/g, ' ');
}

/** STOW-UX-SCAN-RAIL-01 — visual shortening only; full LSU stays accessible
 * via the `title` attribute on the element rendering this string. */
function shortenLsu(lasyncroUnitId: string): string {
  return lasyncroUnitId.length > 13
    ? `${lasyncroUnitId.slice(0, 10)}…`
    : lasyncroUnitId;
}

function formatPlacementTimestamp(occurredAt: string): string {
  return new Date(occurredAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * STOW-SPLIT-01 — backend errors are diagnostic evidence, not operator copy.
 *
 * Keep the exact technical reason in the browser console for engineering
 * diagnosis, but translate anything rendered in the workflow into:
 *   1. what happened in warehouse terms, and
 *   2. what the operator should do next.
 *
 * Unknown backend text must never leak directly into the scanner UI.
 */
function getStowOperatorError(
  err: unknown,
  context: StowOperatorErrorContext
): string {
  const responseError =
    (err as { response?: { data?: { error?: unknown } } })
      ?.response?.data?.error;

  const technicalMessage =
    typeof responseError === 'string'
      ? responseError
      : err instanceof Error
        ? err.message
        : 'Unknown stow error';

  // Engineering detail remains available without exposing implementation
  // language such as service names, database state or internal error codes.
  console.error('[STOW_UI_OPERATION_FAILED]', {
    context,
    error: technicalMessage,
  });

  const reason = technicalMessage.toLowerCase();

  if (
    reason.includes('unauthorized') ||
    reason.includes('session')
  ) {
    return 'Your session has expired. Sign in again, then reopen Stow.';
  }

  if (
    reason.includes('no active stow task') ||
    reason.includes('task not found') ||
    reason.includes('task not in progress') ||
    reason.includes('not assignable')
  ) {
    return 'This stow task is no longer available. Return to Stow and reopen the task.';
  }

  if (
    reason.includes('owned by different operator') ||
    reason.includes('different operator')
  ) {
    return 'Another operator is already working this stow task. Return to Stow and choose another task.';
  }

  if (
    reason.includes('wrong product') ||
    reason.includes('does not match this stow task')
  ) {
    return 'Wrong product. Scan a unit that matches this stow task.';
  }

  if (
    reason.includes('wrong unit') ||
    reason.includes('lsu mismatch') ||
    reason.includes('specific unit')
  ) {
    return 'Wrong unit. Scan the LSU shown for this stow task.';
  }

  if (
    reason.includes('physical unit not resolved') ||
    reason.includes('no physical units resolved')
  ) {
    return 'No available unit was found for this scan. Scan the LSU label or check that the unit is still waiting to be stowed.';
  }

  if (
    reason.includes('no active location') ||
    reason.includes('scan a bin barcode first')
  ) {
    return 'Scan a bin barcode first, then scan the unit.';
  }

  if (
    reason.includes('location not found') ||
    reason.includes('location not recognised')
  ) {
    return 'Bin not recognised. Scan the bin label again.';
  }

  if (
    reason.includes('invalid_restow_destination') ||
    reason.includes('not an active bin')
  ) {
    return 'This location cannot receive the unit. Scan another active storage bin.';
  }

  if (
    reason.includes('source equals destination') ||
    reason.includes('source and destination must differ')
  ) {
    return 'This unit is already at that location. Scan a different destination bin.';
  }

  if (
    reason.includes('barcode not recognised') ||
    reason.includes('no variant found')
  ) {
    return 'Barcode not recognised. Check the label and scan it again.';
  }

  // STOW-SPLIT-01 — fallback is intentionally actionable and generic.
  // Technical implementation details remain only in the console above.
  return context === 'location_scan'
    ? 'That bin could not be activated. Scan the bin label again or choose another active bin.'
    : 'That scan could not be completed. Check the unit label and try again.';
}

// ── Scan input ────────────────────────────────────────────────────────────────
function ScanInput({ hint, onSubmit, error, disabled = false }: {
  hint: string;
  onSubmit: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (error) setTimeout(() => inputRef.current?.focus(), 50);
  }, [error]);

  const handleSubmit = () => {
    // STOW-SPLIT-01 — never start another physical scanner action while the
    // previous one is still being saved. The page-level lock remains the
    // authoritative guard; disabling the input also makes that state visible.
    if (disabled) return;

    const val = value.trim();
    if (val) {
      onSubmit(val);
      setValue('');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <TextField
        inputRef={inputRef}
        fullWidth
        size="small"
        placeholder={hint}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
        helperText={
          disabled
            ? 'Saving scan…'
            : 'Scanner auto-submits · manual entry: press Enter'
        }
        autoComplete="off"
      />

      {value.trim() && (
        <Button
          variant="contained"
          size="small"
          onClick={handleSubmit}
          disabled={disabled}
          sx={{
            bgcolor: 'var(--accent)',
            borderRadius: '6px',
            fontWeight: 600,
            mt: '2px',
            flexShrink: 0,
          }}
        >
          Scan
        </Button>
      )}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StowSessionPage({
  initialTaskId,
  initialStep = null,
  currentUserId = null,
  onComplete,
  onActiveTaskChange,
  onFetchTasks,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onResolveBarcode,
  onConfirmStow,
  onFetchPlacements,
}: StowSessionPageProps) {
  const theme = useTheme();

  const [phase,            setPhase]            = useState<Phase>('brief');
  const [tasks,            setTasks]            = useState<WmsStowTask[]>([]);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [submitting,       setSubmitting]       = useState(false);
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [submitError,      setSubmitError]      = useState<string | null>(null);

  // STOW-SPLIT-01 — success/info feedback describes the last completed physical
  // scanner action. A new scan clears it before producing its own result.
  const [scanFeedback, setScanFeedback] = useState<StowScanFeedback | null>(null);

  // STOW-SPLIT-01 — React state alone is not an atomic scanner lock because two
  // rapid hardware scans can arrive before a rerender. This ref changes
  // synchronously and guarantees that only one scanner action runs at a time.
  const scanInFlightRef = useRef(false);

  const beginScannerAction = () => {
    if (scanInFlightRef.current) {
      // Operator-facing feedback explains what happened and what to do next;
      // the duplicate scan is deliberately not sent to inventory mutation.
      setSubmitError(null);
      setScanFeedback({
        severity: 'info',
        message:
          'The previous scan is still being saved. Wait for its confirmation, then scan again.',
      });
      return false;
    }

    scanInFlightRef.current = true;
    setSubmitting(true);
    return true;
  };

  const finishScannerAction = () => {
    scanInFlightRef.current = false;
    setSubmitting(false);
  };

  const [confirmedLocation, setConfirmedLocation] = useState<string | null>(null);

  // STOW-SPLIT-01 — this count belongs to the active physical bin, not the task.
  // It persists across task advancement while the operator stays at the same
  // location and resets only when a different bin becomes active.
  const [placedHereCount, setPlacedHereCount] = useState(0);

  // Per-unit auto-commit only needs the number of physical units still required.
  // Quantity-entry, shortfall and review state belonged to the retired bulk flow.
  const [remainingQty, setRemainingQty] = useState(0);

  // STOW-UX-SCAN-RAIL-01 — the exact LSU just committed, for the rail's
  // transient "✓ ITEM / ✓ REGISTERED" acknowledgement. Cleared at the start
  // of the next scanner action alongside scanFeedback, so the two surfaces
  // never disagree about whether a "just registered" state is showing.
  const [lastConfirmedLsu, setLastConfirmedLsu] = useState<string | null>(null);

  // STOW-UX-SCAN-RAIL-01 — current-bin activity trace, task-scoped. Read-only
  // canonical projection; never locally fabricated (no optimistic rows).
  const [placements, setPlacements] = useState<StowPlacement[]>([]);
  const [placementsError, setPlacementsError] = useState<string | null>(null);

  const currentTask = tasks[currentIndex] ?? null;

  // STOW-UX-SCAN-RAIL-01 — fetch canonical placements for the active task.
  // A read failure here is a trace-outage, not an inventory-execution outage:
  // it must never block or alter Stow scanning, only the activity panel.
  const refreshPlacements = useCallback(async (taskId: string) => {
    if (!onFetchPlacements) return;
    try {
      const rows = await onFetchPlacements(taskId);
      setPlacements(rows);
      setPlacementsError(null);
    } catch (err: unknown) {
      setPlacements([]);
      setPlacementsError(
        err instanceof Error ? err.message : 'Failed to load current-bin activity.'
      );
    }
  }, [onFetchPlacements]);

  // Task-scoped: refetch whenever the active task changes (including task
  // advancement), so Task 1's activity never leaks into Task 2's panel.
  useEffect(() => {
    if (!currentTask) {
      setPlacements([]);
      setPlacementsError(null);
      return;
    }
    void refreshPlacements(currentTask.stow_task_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTask?.stow_task_id]);

  // STOW-UX-SCAN-RAIL-01 / STOW-SESSION-TRANSITION-01 — parent adapters may
  // be recreated during normal warehouse polling/rerenders. Keep the latest
  // task-identity callback available without making callback identity a
  // session-bootstrap dependency.
  const onActiveTaskChangeRef = useRef(onActiveTaskChange);

  useEffect(() => {
    onActiveTaskChangeRef.current = onActiveTaskChange;
  }, [onActiveTaskChange]);

  // ── Load tasks ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const all = await onFetchTasks();
        const active = all.filter((task) => {
          if (task.status === 'pending') {
            return (
              task.stow_task_id === initialTaskId ||
              task.assigned_operator_id == null ||
              task.assigned_operator_id === currentUserId
            );
          }
          if (task.status === 'in_progress') {
            return (
              task.stow_task_id === initialTaskId ||
              task.claimed_by === currentUserId
            );
          }
          return false;
        });
        const tapped = active.find(t => t.stow_task_id === initialTaskId);
        const rest   = active.filter(t => t.stow_task_id !== initialTaskId);
        const ordered = tapped ? [tapped, ...rest] : active;

        setTasks(ordered);

        if (ordered.length > 0) {
          const firstTask = ordered[0];

          // STOW-SPLIT-01 — resume from committed database progress. A partially
          // completed task must not revert to its original total quantity after
          // refresh, reconnect or Fast Refresh.
          setRemainingQty(
            Math.max(
              firstTask.quantity - firstTask.quantity_placed,
              0
            )
          );

          if (tapped?.status === 'in_progress') {
            if (tapped.location_code) {
              setConfirmedLocation(tapped.location_code);
              setPlacedHereCount(tapped.quantity_placed);
              setPhase('item_scan');
              onActiveTaskChangeRef.current?.(tapped.stow_task_id, null);
            } else {
              setConfirmedLocation(null);
              setSubmitError('Scan a bin barcode first, then scan the unit.');
              setPhase('location_scan');
            }
          } else if (tapped?.status === 'pending' && initialStep === 'location') {
            setConfirmedLocation(null);
            setPlacedHereCount(0);
            setPhase('location_scan');
          } else {
            setConfirmedLocation(null);
            setPlacedHereCount(0);
            setPhase('brief');
          }
        }
      } catch (err: unknown) {
        // STOW-SPLIT-01 — session bootstrap failures must preserve the concrete
        // backend or runtime reason. A generic load error hides whether the failure
        // came from authentication, permissions, networking, or malformed data.
        const message =
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ??
          (err instanceof Error
            ? err.message
            : 'Failed to load stow tasks for an unknown reason.');

        setLoadError(message);
      } finally {
        setLoading(false);
      }
    })();
  // STOW-SESSION-TRANSITION-01 — initialTaskId/initialStep are intentionally
  // NOT dependencies here. They only need to drive bootstrap once, at the
  // mount that starts a session for a given task; the parent's own
  // component-identity rules guarantee a genuine new task selection remounts
  // this component fresh (see WmsModuleFT2's `activeSession?.type === 'stow'`
  // conditional render). Once mounted, advanceToNext() reports the new
  // active task to the parent via onActiveTaskChange purely so the parent
  // can persist identity (URL/activeSession) for REFRESH recovery — that
  // parent-state sync then echoes back down as a changed initialTaskId prop
  // on this already-mounted instance. Listing it as a dependency would
  // re-run this whole fetch-and-reconstruct effect on every automatic
  // advance, an extra "backend call merely for transition identity" that
  // could also stomp the tasks array ordering out from under the currentIndex
  // advanceToNext just set. currentUserId legitimately re-runs bootstrap
  // (e.g. auth resolving after mount); when it does, the closure below still
  // reads whatever initialTaskId/initialStep this render currently holds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // ── Advance to next task ────────────────────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const next = currentIndex + 1;

    if (next >= tasks.length) {
      setPhase('complete');
      return;
    }

    const nextTask = tasks[next];

    setCurrentIndex(next);

    setRemainingQty(
      Math.max(
        nextTask.quantity - nextTask.quantity_placed,
        0
      )
    );

    setScanFeedback(null);
    setSubmitError(null);
    setLastConfirmedLsu(null);

    // STOW-SESSION-TRANSITION-01 — Task B (nextTask), not Task A, becomes the
    // canonical active session identity the instant the session advances.
    // Report it BEFORE relying on local phase state alone, so the parent's
    // activeSession.taskId and the persisted URL never lag one task behind
    // what this component is actually rendering. No claim or inventory
    // mutation happens here — this call only carries identity/phase.

    // STOW-UX-SCAN-RAIL-01 — destination is sticky only within one Stow task.
    // A newly selected pending task must establish/scan its own destination.
    // Never carry the previous task's confirmed bin into the next task.
    if (nextTask.status === 'pending') {
      setConfirmedLocation(null);
      setPlacedHereCount(0);
      setPhase('location_scan');
      onActiveTaskChange?.(nextTask.stow_task_id, 'location');
      return;
    }

    // A task already owned by this operator may resume from its persisted
    // destination and committed progress.
    if (nextTask.status === 'in_progress' && nextTask.location_code) {
      setConfirmedLocation(nextTask.location_code);
      setPlacedHereCount(nextTask.quantity_placed);
      setPhase('item_scan');
      onActiveTaskChange?.(nextTask.stow_task_id, null);
      return;
    }

    // Defensive recovery for an impossible/incomplete in-progress state.
    setConfirmedLocation(null);
    setPlacedHereCount(nextTask.quantity_placed);
    setSubmitError('Scan a bin barcode first, then scan the unit.');
    setPhase('location_scan');
    onActiveTaskChange?.(nextTask.stow_task_id, 'location');
  }, [currentIndex, tasks, onActiveTaskChange]);

  // ── Node 1: Item scan ───────────────────────────────────────────────────────
  const handleItemScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) {
      // STOW-SPLIT-01 — scanner input without an active task is an invalid
      // session state. Fail explicitly so the operator and logs have a concrete
      // reason instead of silently discarding a physical scan.
      throw Object.assign(new Error('No active stow task.'), {
        response: {
          data: {
            error: 'Cannot scan an item because no active stow task is loaded.',
          },
        },
      });
    }

    setSubmitError(null);
    setScanFeedback(null);
    setLastConfirmedLsu(null);

    // STOW-SPLIT-01 — every new scan starts with a clean feedback surface.
    // The previous success remains visible until this point, then this scan owns
    // the next success, bin-change message or operator-friendly error.

    // STOW-SPLIT-01 — the session uses one scanner vocabulary. A bin scan
    // always takes precedence over an item scan so the operator can change
    // physical position at any point without leaving the active workflow.
    const resolvedLocation = await onResolveLocation(scannedValue);

    if (resolvedLocation?.location_code) {
      const isSameActiveLocation =
        Boolean(confirmedLocation) &&
        resolvedLocation.location_code === confirmedLocation;

      if (isSameActiveLocation) {
        // STOW-ACTIVE-LOCATION-01 — re-scanning the already-active bin is a
        // no-op: remain active, no unnecessary claim, no unnecessary
        // location mutation.
        setScanFeedback(null);
        setPhase('item_scan');
        return;
      }

      if (confirmedLocation) {
        // STOW-ACTIVE-LOCATION-01 — supersedes the earlier "one Stow task =
        // one immutable destination" rule. stow_tasks.location_code is now
        // the CURRENT / STICKY destination: the claiming operator may switch
        // it mid-task. This never rewrites where units already committed to
        // the previous bin physically are — that exact history stays in
        // inventory_movements / inventory_units.current_location_code and
        // remains visible in the task-wide activity panel. Only units
        // confirmed AFTER this point land at the new bin. Never call
        // onClaimTask or onConfirmStow here — a bin switch alone must not
        // claim again or commit any unit.
        await onAssignLocation(
          currentTask.stow_task_id,
          resolvedLocation.location_code
        );

        setTasks(prev => prev.map((task, index) =>
          index === currentIndex
            ? { ...task, location_code: resolvedLocation.location_code }
            : task
        ));

        setConfirmedLocation(resolvedLocation.location_code);
        setScanFeedback({
          severity: 'success',
          message: `${resolvedLocation.location_code} is now active`,
        });
        setPhase('item_scan');
        return;
      }

      // No active destination yet for this task — first bin scan
      // establishes and claims it (unchanged pre-claim behavior).
      if (resolvedLocation.location_code !== currentTask.location_code) {
        await onAssignLocation(
          currentTask.stow_task_id,
          resolvedLocation.location_code
        );
      }

      await onClaimTask(currentTask.stow_task_id);

      setTasks(prev => prev.map((task, index) =>
        index === currentIndex
          ? {
              ...task,
              location_code: resolvedLocation.location_code,
              status: 'in_progress',
            }
          : task
      ));

      setConfirmedLocation(resolvedLocation.location_code);
      onActiveTaskChange?.(currentTask.stow_task_id, null);

      // STOW-SPLIT-01 — the active-bin card is the authoritative destination state.
      // A physical bin switch already updates that card and resets placedHereCount,
      // so additional transient copy would only repeat information on screen.
      setPhase('item_scan');
      return;
    }

    // Location-first is an inventory-safety rule, not just presentation.
    // Never accept a physical unit when the session has no confirmed bin.
    if (!confirmedLocation) {
      throw Object.assign(new Error('No active location.'), {
        response: {
          data: {
            error: 'Scan a bin barcode first, then scan the unit.',
          },
        },
      });
    }

    // The sticky location survives task advancement, but each new task still
    // owns its persisted destination. Synchronise that destination before any
    // unit can be committed so ledger movements use the physical active bin.
    if (currentTask.location_code !== confirmedLocation) {
      await onAssignLocation(currentTask.stow_task_id, confirmedLocation);

      setTasks(prev => prev.map((task, index) =>
        index === currentIndex
          ? {
              ...task,
              location_code: confirmedLocation,
            }
          : task
      ));
    }

    // A newly auto-advanced task may still be pending even though the operator
    // and active location are unchanged. Claim it before accepting its unit.
    await onClaimTask(currentTask.stow_task_id);

    const resolved = await onResolveBarcode(scannedValue);
    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again or check the label.' } },
      });
    }
    if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong product.'), {
        response: { data: { error: 'Wrong product — does not match this stow task.' } },
      });
    }
    // INV-BLOCK-10b-LSU-01 — cancellation recovery is unit-specific.
    //
    // Scoped deliberately to order_cancelled_mid_pick: inbound stow units of
    // the same variant are fungible, and the receive→stow flow relies on a
    // generic product barcode resolving to any received sibling. Widening
    // this to all triggers would change that verified behaviour.
    //
    // Both LSUs of a variant share one shopify_barcode, so a generic scan
    // cannot discriminate them. unit_ids (now trigger-aware server-side)
    // is the task's declaration of which physical unit satisfies it. The
    // backend guard in confirmStow remains authoritative; this check exists
    // to fail fast at scan time with a message naming the required LSU.
    if (
      currentTask.trigger === 'order_cancelled_mid_pick' &&
      (currentTask.unit_ids ?? []).length > 0 &&
      (!resolved.lasyncro_unit_id ||
        !(currentTask.unit_ids ?? []).includes(resolved.lasyncro_unit_id))
    ) {
      throw Object.assign(new Error('Wrong unit.'), {
        response: {
          data: {
            error: `This task recovers a specific unit. Scan ${(currentTask.unit_ids ?? []).join(' or ')}.`,
          },
        },
      });
    }

    if (!resolved.lasyncro_unit_id) {
      // STOW-SPLIT-01 — the redesigned session is strictly per-unit. A variant-only
      // resolution is not enough to mutate inventory because every placement must
      // be attributable to one physical LSU and therefore one ledger identity.
      throw Object.assign(new Error('Physical unit not resolved.'), {
        response: {
          data: {
            error: 'No physical unit is available for this scan. Scan the LSU label or check the unit state.',
          },
        },
      });
    }

    // STOW-SPLIT-01 — one successful physical scan commits exactly one unit.
    // The page-level scanner lock remains active for this entire asynchronous
    // action and is released by the caller regardless of success or failure.
    const confirmResult = await onConfirmStow(
      currentTask.stow_task_id,
      1,
      resolved.lasyncro_unit_id
    );

    // STOW-SPLIT-01 — persisted backend progress is authoritative. Keep the local
    // task snapshot aligned with the committed cumulative quantity instead of
    // reconstructing progress from scanner-local decrements.
    setTasks(prev => prev.map((task, index) =>
      index === currentIndex
        ? {
            ...task,
            quantity_placed: confirmResult.quantity_placed,
          }
        : task
    ));

    // Update UI state only after the backend transaction succeeds. Failed writes
    // must never increment either the active-bin count or task progress.
    const nextPlacedHereCount = placedHereCount + 1;
    setPlacedHereCount(nextPlacedHereCount);

    const authoritativeRemaining = Math.max(
      confirmResult.quantity_total - confirmResult.quantity_placed,
      0
    );

    // STOW-SPLIT-01 — successful feedback acknowledges the physical scan only.
    // Active location, placed-here count and remaining quantity already have
    // dedicated persistent surfaces and must not be repeated here.
    setScanFeedback({
      severity: 'success',
      message: `Unit placed · ${resolved.lasyncro_unit_id}`,
    });
    // STOW-UX-SCAN-RAIL-01 — drives the rail's transient ✓ ITEM / ✓ REGISTERED
    // acknowledgement; only ever set after onConfirmStow has already resolved.
    setLastConfirmedLsu(resolved.lasyncro_unit_id);

    if (!confirmResult.is_fully_placed) {
      setRemainingQty(authoritativeRemaining);
      setSubmitError(null);

      // Reload canonical placements so the current-bin activity panel
      // reflects this commit — never an optimistic local row. Scoped to the
      // "more units to go" branch only: when this confirm completes the
      // task (else branch), advanceToNext changes currentTask.stow_task_id,
      // which the task-scoped effect above already refetches for. Firing
      // both here would race two concurrent fetches for two different task
      // ids against the same setPlacements call.
      void refreshPlacements(currentTask.stow_task_id);

      // Unit identity is scoped to this scanner event. Once the caller releases
      // the lock, the scanner is immediately ready for the next unit or bin.
      setPhase('item_scan');
    } else {
      // STOW-SPLIT-01 — completion is decided by the committed server result.
      // Browser-local remaining state may have been reconstructed after refresh
      // and therefore must never be authoritative for warehouse completion.
      advanceToNext();
    }
  }, [
  currentTask,
  currentIndex,
  confirmedLocation,
  placedHereCount,
  remainingQty,
  advanceToNext,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onResolveBarcode,
  onConfirmStow,
  onActiveTaskChange,
  refreshPlacements,
]);

  // ── Node 2: Location scan ───────────────────────────────────────────────────
  const handleLocationScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) {
      // STOW-SPLIT-01 — a bin must never be assigned without an identified task.
      // Throw an actionable error rather than allowing the scan to disappear.
      throw Object.assign(new Error('No active stow task.'), {
        response: {
          data: {
            error: 'Cannot activate a bin because no active stow task is loaded.',
          },
        },
      });
    }

    setSubmitError(null);
    setScanFeedback(null);

    const resolved = await onResolveLocation(scannedValue);
    if (!resolved?.location_code) {
      throw Object.assign(new Error('Location not found.'), {
        response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
      });
    }

    // STOW-SPLIT-01 — a claimed task may move between bins while units remain.
    if (resolved.location_code !== currentTask.location_code) {
      await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
    }

    // STOW-SPLIT-01 — task-location synchronisation and physical movement are
    // separate concepts. Preserve the running count when the same active bin is
    // merely being attached to a newly advanced task.
    if (
      confirmedLocation &&
      resolved.location_code !== confirmedLocation
    ) {
      setPlacedHereCount(0);
    }

    // STOW-SPLIT-01 — claimStowTask is intentionally idempotent when the same
    // operator resumes their own in-progress task. Any other claim failure is
    // meaningful and must propagate to the scanner error UI instead of being
    // silently treated as success.
    await onClaimTask(currentTask.stow_task_id);

    setTasks(prev => prev.map((t, i) =>
      i === currentIndex
        ? {
            ...t,
            location_code: resolved.location_code,
            status: 'in_progress',
          }
        : t
    ));

    setConfirmedLocation(resolved.location_code);
    onActiveTaskChange?.(currentTask.stow_task_id, null);
    // STOW-SPLIT-01 — the active-bin card immediately reflects the newly scanned
    // destination and its reset placed-here count. Do not duplicate that state
    // with a second informational message below the scanner.

    // Activating a bin is the first operational action. Once active, the next
    // required action is scanning a physical unit.
    setPhase('item_scan');
  }, [
  currentTask,
  currentIndex,
  confirmedLocation,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onActiveTaskChange,
]);

  // STOW-SPLIT-01 — task position remains useful navigation context, but workflow
  // progress is communicated by the physical bin state and remaining-unit count
  // rather than an abstract progress bar or duplicated step tracker.
  const progressLabel = currentTask
    ? `Stow ${currentIndex + 1} of ${tasks.length}`
    : '';

  const nextAction =
    phase === 'brief'
      ? 'Review task'
      : phase === 'location_scan'
        ? 'Scan destination bin'
        : phase === 'item_scan'
          ? 'Scan item'
          : 'Task complete';
  const destinationLabel =
    confirmedLocation ??
    currentTask?.location_code ??
    'Scan location';
  const taskProgressLabel = currentTask
    ? `${currentTask.quantity_placed} / ${currentTask.quantity}`
    : '0 / 0';

  const identityBanner = currentTask ? (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        borderRadius: '6px',
        bgcolor: 'background.paper',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(6, minmax(0, 1fr))' },
        gap: 1,
      }}
    >
      {[
        ['Source', triggerLabel(currentTask.trigger)],
        ['Task', tasks.length > 1 ? `${currentIndex + 1} / ${tasks.length}` : '1 / 1'],
        ['Item', currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? 'Item unavailable'],
        ['SKU', currentTask.sku ?? 'SKU unavailable'],
        ['Progress', taskProgressLabel],
        ['Destination', destinationLabel],
      ].map(([label, value]) => (
        <Box key={label} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, textTransform: 'uppercase' }}>
            {label}
          </Typography>
          <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>
            {value}
          </Typography>
        </Box>
      ))}
      <Box sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, textTransform: 'uppercase' }}>
          Next
        </Typography>
        <Typography variant="body2" noWrap sx={{ fontWeight: 700, color: 'var(--accent-text)' }}>
          {nextAction}
        </Typography>
      </Box>
    </Paper>
  ) : null;

  // STOW-UX-SCAN-RAIL-01 — LOCATION -> ITEM -> REGISTERED is the single
  // primary execution rail. "items"/"complete" test ids are preserved
  // exactly (StowSessionFocusUx.test.tsx already asserts on them) even
  // though the visible copy now reads "Item" — the id is a stable contract,
  // the label is presentation.
  const justRegistered = Boolean(lastConfirmedLsu);
  const hasStartedThisTask = Boolean(currentTask && currentTask.quantity_placed > 0);
  const registeredMeta = justRegistered
    ? `${currentTask?.product_title ?? currentTask?.sku ?? 'Item'} → ${confirmedLocation ?? ''}`
    : phase === 'complete'
      ? 'Task complete'
      : currentTask
        ? `${currentTask.quantity_placed} / ${currentTask.quantity} placed`
        : 'Waiting';

  const stageRail = (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        mb: 2,
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 1,
        bgcolor: 'background.paper',
      }}
    >
      {[
        {
          id: 'location',
          label: 'Location',
          meta: confirmedLocation ?? currentTask?.location_code ?? 'Scan destination',
          state: (phase === 'brief' || phase === 'location_scan'
            ? 'active'
            : confirmedLocation
              ? 'complete'
              : 'pending') as 'active' | 'complete' | 'pending',
          // Guidance only, never authoritative — the confirmed destination
          // always wins once it exists.
          pulse: (phase === 'brief' || phase === 'location_scan') && !confirmedLocation,
        },
        {
          id: 'items',
          label: 'Item',
          meta: justRegistered
            ? lastConfirmedLsu!
            : phase === 'item_scan'
              ? (hasStartedThisTask ? 'Scan next item' : 'Scan item')
              : phase === 'complete'
                ? 'Task complete'
                : 'Waiting',
          state: (justRegistered
            ? 'complete'
            : phase === 'item_scan'
              ? 'active'
              : phase === 'complete'
                ? 'complete'
                : 'pending') as 'active' | 'complete' | 'pending',
          pulse: phase === 'item_scan' && !justRegistered,
        },
        {
          id: 'complete',
          label: 'Registered',
          meta: registeredMeta,
          // This must only ever flip to complete after onConfirmStow has
          // actually resolved (justRegistered) — never on barcode
          // recognition alone.
          state: (justRegistered || phase === 'complete' ? 'complete' : 'pending') as 'active' | 'complete' | 'pending',
          pulse: false,
        },
      ].map((stage) => {
        const isComplete = stage.state === 'complete';
        const isActive = stage.state === 'active';
        return (
          <Box
            key={stage.id}
            data-testid={`stow-stage-${stage.id}`}
            data-state={stage.state}
            sx={{
              minWidth: 0,
              p: 1,
              borderRadius: '6px',
              bgcolor: isActive
                ? 'var(--accent-ghost)'
                : isComplete
                  ? alpha(theme.palette.success.main, 0.08)
                  : 'transparent',
              border: '0.5px solid',
              borderColor: isActive
                ? 'var(--accent-border)'
                : isComplete
                  ? theme.palette.success.main
                  : 'var(--rule)',
              animation: stage.pulse ? 'stowRailPulse 1.6s ease-in-out infinite' : 'none',
              '@keyframes stowRailPulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.6 },
              },
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 750,
                color: isComplete
                  ? 'var(--good-ink)'
                  : isActive
                    ? 'var(--accent)'
                    : 'text.secondary',
              }}
            >
              {isComplete ? '✓' : isActive ? '●' : '○'} {stage.label}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap title={stage.meta}>
              {stage.meta}
            </Typography>
          </Box>
        );
      })}
    </Paper>
  );

  // STOW-UX-SCAN-RAIL-01 / STOW-ACTIVE-LOCATION-01 — the identity banner +
  // rail already carry destination/progress state (see Section C: remove
  // duplicated active UI). This panel exists to show something the rail does
  // NOT: the canonical, server-committed history of everything registered by
  // this task. Read-only, server-authoritative — never an optimistic local
  // row, never a client-generated operator name or timestamp.
  //
  // STOW-ACTIVE-LOCATION-01 — this is task-wide, not current-bin-only: since
  // the active destination is now mutable mid-task, a row placed at a bin
  // the operator has since switched away from must still be shown here. The
  // title is deliberately neutral (not "<bin> ACTIVE") because the rows
  // below it may legitimately span more than one bin.
  const currentBinActivity = confirmedLocation ? (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: '6px' }} data-testid="stow-bin-activity">
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Stow activity · {placements.length} registered
      </Typography>

      {placementsError ? (
        <Typography variant="caption" color="text.secondary">
          Activity history is unavailable right now. Stow scanning is unaffected.
        </Typography>
      ) : placements.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No units registered here yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {placements.map((p) => (
            <Box key={p.lasyncro_unit_id}>
              <Typography variant="body2" fontWeight={600}>
                ✓ {p.product_title ?? p.variant_title ?? p.sku ?? 'Item'} ·{' '}
                <Box
                  component="span"
                  title={p.lasyncro_unit_id}
                  sx={{ fontFamily: 'monospace' }}
                >
                  {shortenLsu(p.lasyncro_unit_id)}
                </Box>{' '}
                registered in {p.location_code}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                by {p.operator_name ?? 'Unknown operator'} · {formatPlacementTimestamp(p.occurred_at)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  ) : null;

  // ── BRIEF ───────────────────────────────────────────────────────────────────
  if (phase === 'brief') {
    return (
      <Box sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress size={32} />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : tasks.length === 0 ? (
          <Alert severity="info">No stow tasks pending.</Alert>
        ) : (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={600}>Stow Session</Typography>
              <Typography variant="body2" color="text.secondary">
                Review the selected task, then scan a destination bin to claim it.
              </Typography>
            </Box>
            {identityBanner}
            {/* STOW-BRIEF-DECLUTTER-01 — the LOCATION/ITEM/REGISTERED
                execution rail (stageRail) is active-execution UI and must
                not render on Brief: execution has not started yet, so a box
                showing "Location: active" / a pulsing scan target here would
                lie about session state. identityBanner already carries the
                pre-execution summary (source, task position, product, SKU,
                progress, suggested destination); stageRail begins rendering
                again once the operator actually starts/resumes (see the
                location_scan / item_scan / complete phases below, all
                unchanged). */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              {[
                { label: 'Task',      value: `${currentIndex + 1}/${tasks.length}` },
                { label: 'Units',     value: currentTask?.quantity ?? 0 },
                { label: 'Remaining', value: remainingQty },
              ].map(({ label, value }) => (
                <Paper key={label} variant="outlined" sx={{ flex: 1, p: 2, textAlign: 'center', borderRadius: 2 }}>
                  <Typography variant="h5" fontWeight={600} color="warning.main">{value}</Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Paper>
              ))}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {(currentTask ? [currentTask] : []).map((t) => (
                <Paper key={t.stow_task_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {t.image_url ? (
                      <Box component="img" src={t.image_url} alt={t.variant_title ?? ''}
                        sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` }} />
                    ) : (
                      <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={18} color={theme.palette.text.disabled} />
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {t.product_title ?? t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8).toUpperCase()}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                      <Chip label={`${t.quantity} units`} size="small" />
                      {t.location_code
                        ? <Chip label={t.location_code} size="small" color="success" />
                        : <Chip label="No location" size="small" sx={{ bgcolor: 'var(--accent-ghost)', color: 'var(--accent-text)', border: '0.5px solid var(--accent-border)', fontWeight: 600, fontSize: 11 }} />}
                    </Box>
                  </Box>
                </Paper>
              ))}
            </Box>
            <Button
              variant="contained"
              size="large"
              fullWidth
              sx={{
                borderRadius: '6px',
                fontWeight: 600,
                bgcolor: 'var(--accent)',
                color: 'var(--accent-ink)',
                '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
              }}
              onClick={() => {
                if (currentTask) onActiveTaskChange?.(currentTask.stow_task_id, 'location');
                setPhase('location_scan');
              }}
            >
              {currentTask?.status === 'in_progress' ? 'Resume stowing' : 'Claim & start stowing'}
            </Button>
          </>
        )}
      </Box>
    );
  }

  // ── COMPLETE ─────────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center', minHeight: 400 }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h5" fontWeight={600} sx={{ mt: 2 }}>Stow complete</Typography>
        <Box sx={{ width: '100%', maxWidth: 720, mt: 2 }}>
          {stageRail}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4 }}>
          {tasks.length} SKU{tasks.length !== 1 ? 's' : ''} stowed. Inventory updated.
        </Typography>
        <Button variant="contained" size="large"
          sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          onClick={onComplete}>
          Exit Stow
        </Button>
      </Box>
    );
  }

  if (!currentTask) {
  // STOW-SPLIT-01 — reaching an active session phase without a task means the
  // UI state and loaded task queue have diverged. Do not render a blank screen:
  // surface the exact invariant failure so the operator knows why work stopped.
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="error">
        Cannot continue stowing because no active stow task is loaded.
      </Alert>
    </Box>
  );
}

// ── ITEM SCAN (Node 1) ───────────────────────────────────────────────────────
if (phase === 'item_scan') {
    return (
      <Box sx={{ p: 2 }}>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton onClick={() => setPhase('brief')} size="small">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="subtitle2" color="text.secondary">
            {progressLabel}
          </Typography>
        </Box>

        {identityBanner}
        {stageRail}

        {/* STOW-UX-SCAN-RAIL-01 (Section C) — the separate large ACTIVE
            destination card and the separate large product/action card were
            removed: identityBanner already carries destination/item/SKU and
            the rail already carries Location/Item/Registered state. */}

        <ScanInput
          hint="Scan item barcode (LSU- or product barcode)"
          error={submitError}
          disabled={submitting}
          onSubmit={(v) => {
            if (!beginScannerAction()) return;

            void handleItemScan(v)
              .catch((err: unknown) => {
                // Failed scans replace previous positive feedback with an actionable
                // operator message. Technical detail remains diagnostic only.
                setScanFeedback(null);
                setSubmitError(getStowOperatorError(err, 'item_scan'));
              })
              .finally(() => {
                finishScannerAction();
              });
          }}
        />

        {scanFeedback && (
          <Alert severity={scanFeedback.severity} sx={{ mt: 2 }}>
            {scanFeedback.message}
          </Alert>
        )}

        {submitError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {submitError}
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          {currentBinActivity}
        </Box>
      </Box>
    );
  }

  // ── LOCATION SCAN (Node 2) ───────────────────────────────────────────────────
  if (phase === 'location_scan') {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton
            // STOW-SPLIT-01 — location is the first operational step. Going back from
            // here returns to the session brief rather than exposing unit scanning
            // before a physical destination has been activated.
            onClick={() => setPhase('brief')}
            size="small"
            aria-label="Back to stow session"
          >
            <ArrowLeft size={18} />
          </IconButton>

          <Typography variant="subtitle2" color="text.secondary">
            {progressLabel}
          </Typography>
        </Box>

        {identityBanner}
        {stageRail}

        {/* STOW-UX-SCAN-RAIL-01 — the rail already shows Location as
            active/pending with a "Scan destination" prompt; no destination
            is confirmed yet in this phase, so there is nothing for the
            current-bin activity panel to show either. */}

        {/* STOW-SPLIT-01 — location is activated before any physical item scan.
            Do not show an item-confirmed state here: at this point no unit has been
            validated or committed. The suggested bin remains guidance only. */}
        {currentTask.location_code && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--accent-ghost)', borderColor: 'var(--accent-border)'}}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <MapPin size={16} color='var(--accent)' />
              <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--accent-text)' }}>
                Suggested bin: {currentTask.location_code}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
              Walk to this bin and scan its barcode to confirm.
            </Typography>
          </Paper>
        )}

        <ScanInput
          hint="Scan bin barcode or type location code"
          error={submitError}
          disabled={submitting}
          onSubmit={(v) => {
            if (!beginScannerAction()) return;

            void handleLocationScan(v)
              .catch((err: unknown) => {
                // Failed activation leaves no stale success message competing with the
                // recovery instruction shown to the operator.
                setScanFeedback(null);
                setSubmitError(getStowOperatorError(err, 'location_scan'));
              })
              .finally(() => {
                finishScannerAction();
              });
          }}
        />

        {scanFeedback && (
          <Alert severity={scanFeedback.severity} sx={{ mt: 2 }}>
            {scanFeedback.message}
          </Alert>
        )}

        {submitError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {submitError}
          </Alert>
        )}
      </Box>
    );
  }

  // STOW-SPLIT-01 — quantity confirmation was intentionally removed.
  // A successful unit scan already represents confirmation of quantity = 1.

  // STOW-SPLIT-01 — every supported operational phase returns above.
  // If execution reaches this point, the session state has diverged from the
  // declared workflow. Render the invariant failure instead of failing silently.
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="error">
        Cannot render the stow session because its workflow state is unsupported.
      </Alert>
    </Box>
  );
}
