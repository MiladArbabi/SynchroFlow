import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVATION_TIMING } from '../activationMotionTokens';

export type SyncExperiencePhase =
  | 'SYNCING'
  | 'POST_SYNC_RESOLVE'
  | 'COMPLETION_TRANSITION'
  | 'READY_TO_ENTER'
  | 'INTERRUPTED';

export interface SyncExperienceSnapshot {
  phase: SyncExperiencePhase;
  syncComplete: boolean;
  syncFailed: boolean;
  syncCompletedAtMs: number | null;
  dwellSatisfied: boolean;
  /**
   * Real sync is complete AND the first-run dwell/resolve contract permits
   * completion. This is the gate for finishing DISPLAY progress to 100 and for
   * offering the non-blocking "Enter workspace" chip. It is a projection of the
   * real-sync + experience-buffer clocks — never an authority of its own.
   */
  completionEligible: boolean;
  resolveStartedAtMs: number | null;
  resolveTimeoutExpired: boolean;
  completionTransitionDone: boolean;
  canExitSync: boolean;
  showCompletionTransition: boolean;
  readyToEnter: boolean;
  veryLongSync: boolean;
}

export interface SyncExperienceTimelineInput {
  isFirstActivation: boolean;
  syncStatus: string;
  sceneSettled: boolean;
  mountedAtMs: number;
  nowMs: number;
  syncCompletedAtMs: number | null;
  resolveStartedAtMs?: number | null;
  transitionStartedAtMs?: number | null;
  timingScale?: number;
}

export interface FirstRunSyncExperienceOptions {
  isFirstActivation: boolean;
  syncStatus: string;
  sceneSettled: boolean;
  timingScale?: number;
  /**
   * Optional virtual elapsed time already spent in this experience.
   * Used by deterministic preview/test harnesses only.
   * Production callers omit this and retain the normal wall-clock lifecycle.
   */
  initialElapsedMs?: number;
}

export function isSyncComplete(status: string): boolean {
  return status === 'COMPLETED';
}

export function isSyncFailure(status: string): boolean {
  return status === 'FAILED' || status === 'ERROR';
}

function normalizeScale(scale: number | undefined) {
  return scale && scale > 0 ? scale : 1;
}

function scaledDuration(durationMs: number, scale: number | undefined) {
  return Math.max(1, Math.round(durationMs / normalizeScale(scale)));
}

function scaledElapsed(elapsedMs: number | undefined, scale: number | undefined) {
  return Math.max(0, Math.round((elapsedMs ?? 0) / normalizeScale(scale)));
}

export function deriveSyncExperienceSnapshot(
  input: SyncExperienceTimelineInput
): SyncExperienceSnapshot {
  const minDwellMs = scaledDuration(ACTIVATION_TIMING.MIN_FIRST_RUN_DWELL_MS, input.timingScale);
  const maxResolveMs = scaledDuration(ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS, input.timingScale);
  const transitionMs = scaledDuration(ACTIVATION_TIMING.COMPLETION_TRANSITION_MS, input.timingScale);
  const veryLongMs = scaledDuration(ACTIVATION_TIMING.VERY_LONG_THRESHOLD_MS, input.timingScale);
  const syncComplete = isSyncComplete(input.syncStatus) || input.syncCompletedAtMs !== null;
  const syncFailed = isSyncFailure(input.syncStatus);
  const syncCompletedAtMs = input.syncCompletedAtMs;
  const dwellDeadlineMs = input.isFirstActivation
    ? input.mountedAtMs + minDwellMs
    : input.mountedAtMs;
  const dwellSatisfied = input.nowMs >= dwellDeadlineMs;
  const resolveStartedAtMs = input.resolveStartedAtMs ?? null;
  const transitionStartedAtMs = input.transitionStartedAtMs ?? null;
  const resolveElapsedMs =
    syncCompletedAtMs === null
      ? 0
      : Math.max(0, input.nowMs - Math.max(syncCompletedAtMs, dwellDeadlineMs));
  const resolveTimeoutExpired =
    resolveStartedAtMs !== null
      ? input.nowMs - resolveStartedAtMs >= maxResolveMs
      : resolveElapsedMs >= maxResolveMs;
  const completionEligible =
    syncComplete &&
    !syncFailed &&
    syncCompletedAtMs !== null &&
    dwellSatisfied;
  const canExitSync =
    completionEligible &&
    (input.sceneSettled || resolveTimeoutExpired);
  const completionTransitionDone =
    transitionStartedAtMs !== null &&
    input.nowMs - transitionStartedAtMs >= transitionMs;
  const veryLongSync =
    !syncComplete &&
    !syncFailed &&
    input.nowMs - input.mountedAtMs >= veryLongMs;

  let phase: SyncExperiencePhase = 'SYNCING';
  if (syncFailed) {
    phase = 'INTERRUPTED';
  } else if (completionTransitionDone) {
    phase = 'READY_TO_ENTER';
  } else if (transitionStartedAtMs !== null || canExitSync) {
    phase = 'COMPLETION_TRANSITION';
  } else if (syncComplete && dwellSatisfied) {
    phase = 'POST_SYNC_RESOLVE';
  }

  return {
    phase,
    syncComplete,
    syncFailed,
    syncCompletedAtMs,
    dwellSatisfied,
    completionEligible,
    resolveStartedAtMs,
    resolveTimeoutExpired,
    completionTransitionDone,
    canExitSync,
    showCompletionTransition: phase === 'COMPLETION_TRANSITION' || phase === 'READY_TO_ENTER',
    readyToEnter: phase === 'READY_TO_ENTER',
    veryLongSync,
  };
}

function nextDeadline(
  snapshot: SyncExperienceSnapshot,
  mountedAtMs: number,
  nowMs: number,
  timingScale: number | undefined
) {
  const minDwellMs = scaledDuration(ACTIVATION_TIMING.MIN_FIRST_RUN_DWELL_MS, timingScale);
  const maxResolveMs = scaledDuration(ACTIVATION_TIMING.MAX_POST_SYNC_RESOLVE_MS, timingScale);
  const transitionMs = scaledDuration(ACTIVATION_TIMING.COMPLETION_TRANSITION_MS, timingScale);
  const veryLongMs = scaledDuration(ACTIVATION_TIMING.VERY_LONG_THRESHOLD_MS, timingScale);
  if (snapshot.syncFailed || snapshot.readyToEnter) return null;
  if (!snapshot.dwellSatisfied) {
    return mountedAtMs + minDwellMs;
  }
  if (snapshot.syncComplete && snapshot.resolveStartedAtMs !== null && !snapshot.canExitSync) {
    return snapshot.resolveStartedAtMs + maxResolveMs;
  }
  if (snapshot.showCompletionTransition && !snapshot.completionTransitionDone) {
    return nowMs + transitionMs;
  }
  if (!snapshot.syncComplete && !snapshot.veryLongSync) {
    return mountedAtMs + veryLongMs;
  }
  return null;
}

export interface FirstRunSyncExperience extends SyncExperienceSnapshot {
  /**
   * Non-blocking "Enter workspace" handler. Cancels only the remaining
   * post-sync resolve wait and enters the same canonical completion transition.
   * It does NOT touch backend/lifecycle authority, fabricate completion, or
   * navigate around required application state — it only accelerates the
   * presentation timing, and only once completion is eligible.
   */
  enterWorkspaceNow: () => void;
}

export function useFirstRunSyncExperience(
  options: FirstRunSyncExperienceOptions
): FirstRunSyncExperience {
  const mountedAtRef = useRef(Date.now());
  const syncCompletedAtRef = useRef<number | null>(null);
  const resolveStartedAtRef = useRef<number | null>(null);
  const transitionStartedAtRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(mountedAtRef.current);

  const effectiveMountedAtMs =
    mountedAtRef.current - scaledElapsed(options.initialElapsedMs, options.timingScale);

  const snapshot = useMemo(
    () =>
      deriveSyncExperienceSnapshot({
        isFirstActivation: options.isFirstActivation,
        syncStatus: options.syncStatus,
        sceneSettled: options.sceneSettled,
        mountedAtMs: effectiveMountedAtMs,
        nowMs,
        syncCompletedAtMs: syncCompletedAtRef.current,
        resolveStartedAtMs: resolveStartedAtRef.current,
        transitionStartedAtMs: transitionStartedAtRef.current,
        timingScale: options.timingScale,
      }),
    [
      nowMs,
      options.isFirstActivation,
      options.syncStatus,
      options.sceneSettled,
      options.timingScale,
      options.initialElapsedMs,
      effectiveMountedAtMs,
    ]
  );

  useEffect(() => {
    if (isSyncComplete(options.syncStatus) && syncCompletedAtRef.current === null) {
      syncCompletedAtRef.current = Date.now();
      setNowMs(Date.now());
    }
  }, [options.syncStatus]);

  useEffect(() => {
    if (snapshot.syncFailed) return;

    if (
      snapshot.syncComplete &&
      snapshot.dwellSatisfied &&
      resolveStartedAtRef.current === null
    ) {
      resolveStartedAtRef.current = Date.now();
      setNowMs(Date.now());
      return;
    }

    if (snapshot.canExitSync && transitionStartedAtRef.current === null) {
      transitionStartedAtRef.current = Date.now();
      setNowMs(Date.now());
    }
  }, [snapshot.syncComplete, snapshot.dwellSatisfied, snapshot.canExitSync, snapshot.syncFailed]);

  useEffect(() => {
    const deadline = nextDeadline(snapshot, effectiveMountedAtMs, nowMs, options.timingScale);
    if (deadline === null) return;

    const delay = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => setNowMs(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [snapshot, nowMs, effectiveMountedAtMs, options.timingScale]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const enterWorkspaceNow = useCallback(() => {
    // Presentation-only acceleration. Never bypasses lifecycle authority and
    // only ever fires once completion is genuinely eligible.
    if (!snapshotRef.current.completionEligible) return;
    if (transitionStartedAtRef.current !== null) return;
    if (resolveStartedAtRef.current === null) {
      resolveStartedAtRef.current = Date.now();
    }
    transitionStartedAtRef.current = Date.now();
    setNowMs(Date.now());
  }, []);

  return { ...snapshot, enterWorkspaceNow };
}
