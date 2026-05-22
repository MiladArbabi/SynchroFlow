// apps/frontend/src/activation/hooks/useSyncStepMachine.ts
//
// Responsibility:
// - Map backend status → UI step progression with minimum per-step display times
// - Handle synthetic PROCESSING step
// - Control teaser + reassurance timing
//
// NOTE: No network calls. Pure orchestration layer.

import { useEffect, useRef, useState } from 'react';

const UX_TIMINGS = {
  CONNECTING_FLOOR_MS:  2500,   // minimum time on connecting step
  MIN_STEP_DURATION_MS: 1800,   // minimum time each subsequent step stays visible
  TEASER_DELAY_MS:      800,    // delay before teaser appears after DONE
  REASSURANCE_DELAY_MS: 60000,  // show reassurance after 60s total
};

type StepState = 'pending' | 'active' | 'done';

interface SyncCounts {
  orders:    number;
  variants:  number;
  customers: number;
}

interface SyncProgress {
  current:    number;
  total:      number;
  percentage: number;
}

interface SyncStepMachineResult {
  stepStates:      StepState[];
  activeStepIndex: number;
  progressWidth:   number;
  showTeaser:      boolean;
  showReassurance: boolean;
  isError:         boolean;
}

type SyncPhase =
  | 'CONNECTING'
  | 'IMPORTING_PRODUCTS'
  | 'IMPORTING_ORDERS'
  | 'PROCESSING'
  | 'ERROR'
  | 'FINALIZING'
  | 'DONE';

function mapStatusToPhase(status: string): SyncPhase {
  switch (status) {
    case 'PENDING':           return 'CONNECTING';
    case 'SYNCING_PRODUCTS':  return 'IMPORTING_PRODUCTS';
    case 'SYNCING_ORDERS':
    case 'SYNCING_INVENTORY':
    case 'SYNCING_SHOP':      return 'IMPORTING_ORDERS';
    case 'FAILED':            return 'ERROR';
    case 'COMPLETING':        return 'FINALIZING';
    case 'COMPLETED':         return 'DONE';
    default:                  return 'CONNECTING';
  }
}

export function useSyncStepMachine(
  status: string,
  counts: SyncCounts,
  totalSteps: number,
  progress?: SyncProgress | null
): SyncStepMachineResult {

  // ── Timing gate: enforces minimum display per step ────────────────────────
  const [gatedPhase, setGatedPhase]           = useState<SyncPhase>('CONNECTING');
  const phaseFirstSeenRef                     = useRef<Partial<Record<string, number>>>({});

  // ── Synthetic PROCESSING step: activates when orders start arriving ───────
  const [processingVisible, setProcessingVisible] = useState(false);

  // ── UX signals ────────────────────────────────────────────────────────────
  const [showTeaser, setShowTeaser]           = useState(false);
  const [showReassurance, setShowReassurance] = useState(false);

  // ── connectingReady: prevents flash-through on fast syncs ─────────────────
  const [connectingReady, setConnectingReady] = useState(false);

  // Step 1: enforce minimum connecting floor
  useEffect(() => {
    const t = setTimeout(() => setConnectingReady(true), UX_TIMINGS.CONNECTING_FLOOR_MS);
    return () => clearTimeout(t);
  }, []); // runs once on mount

  // Step 2: activate synthetic PROCESSING step when orders arrive
  useEffect(() => {
    const rawPhase = mapStatusToPhase(status);
    if (rawPhase === 'IMPORTING_ORDERS' && counts.orders > 0) {
      setProcessingVisible(true);
    } else if (rawPhase !== 'IMPORTING_ORDERS') {
      setProcessingVisible(false);
    }
  }, [status, counts.orders]);

  // Step 3: compute rawPhase with gates applied
  let rawPhase = mapStatusToPhase(status);
  if (!connectingReady && rawPhase !== 'CONNECTING') rawPhase = 'CONNECTING';
  if (processingVisible && rawPhase === 'IMPORTING_ORDERS') rawPhase = 'PROCESSING';

  // Step 4: enforce minimum display time per phase before advancing gatedPhase
  useEffect(() => {
    if (!phaseFirstSeenRef.current[rawPhase]) {
      phaseFirstSeenRef.current[rawPhase] = Date.now();
    }
    const seenAt  = phaseFirstSeenRef.current[rawPhase] ?? Date.now();
    const elapsed = Date.now() - seenAt;
    const minDur  = rawPhase === 'CONNECTING'
      ? UX_TIMINGS.CONNECTING_FLOOR_MS
      : UX_TIMINGS.MIN_STEP_DURATION_MS;

    if (elapsed >= minDur) {
      setGatedPhase(rawPhase);
    } else {
      const remaining = minDur - elapsed;
      const t = setTimeout(() => setGatedPhase(rawPhase), remaining);
      return () => clearTimeout(t);
    }
  }, [rawPhase]);

  // Step 5: teaser after DONE
  useEffect(() => {
    if (status !== 'COMPLETED') return;
    const t = setTimeout(() => setShowTeaser(true), UX_TIMINGS.TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [status]);

  // Step 6: reassurance after 60s regardless of phase
  useEffect(() => {
    const t = setTimeout(() => setShowReassurance(true), UX_TIMINGS.REASSURANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // ── Error state ───────────────────────────────────────────────────────────
  if (gatedPhase === 'ERROR') {
    return {
      stepStates:      Array(totalSteps).fill('pending'),
      activeStepIndex: -1,
      progressWidth:   0,
      showTeaser:      false,
      showReassurance: false,
      isError:         true,
    };
  }

  // ── Active step index (deterministic from gatedPhase) ────────────────────
  let activeStepIndex = 0;
  switch (gatedPhase) {
    case 'CONNECTING':         activeStepIndex = 0; break;
    case 'IMPORTING_PRODUCTS': activeStepIndex = 1; break;
    case 'IMPORTING_ORDERS':   activeStepIndex = 2; break;
    case 'PROCESSING':         activeStepIndex = 3; break;
    case 'FINALIZING':         activeStepIndex = 4; break;
    case 'DONE':               activeStepIndex = 4; break;
  }

  // ── Step states ───────────────────────────────────────────────────────────
  const stepStates: StepState[] = Array.from({ length: totalSteps }, (_, i) => {
    if (i < activeStepIndex) return 'done';
    if (i === activeStepIndex) return 'active';
    return 'pending';
  });

  // ── Progress ──────────────────────────────────────────────────────────────
  const progressWidth = progress?.percentage
    ? progress.percentage
    : ((activeStepIndex + 1) / totalSteps) * 100;

  return {
    stepStates,
    activeStepIndex,
    progressWidth,
    showTeaser,
    showReassurance,
    isError: false,
  };
}