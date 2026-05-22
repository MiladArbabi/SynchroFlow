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

const PHASE_ORDER: SyncPhase[] = [
  'CONNECTING',
  'IMPORTING_PRODUCTS',
  'IMPORTING_ORDERS',
  'PROCESSING',
  'FINALIZING',
  'DONE',
];

export function useSyncStepMachine(
  status: string,
  counts: SyncCounts,
  totalSteps: number,
  progress?: SyncProgress | null
): SyncStepMachineResult {

  // ── Timing gate: enforces minimum display per step ────────────────────────
  const [gatedPhase, setGatedPhase]           = useState<SyncPhase>('CONNECTING');

  // ── Synthetic PROCESSING step: activates when orders start arriving ───────
  const [processingVisible, setProcessingVisible] = useState(false);

  // ── UX signals ────────────────────────────────────────────────────────────
  const [showTeaser, setShowTeaser]           = useState(false);
  const [showReassurance, setShowReassurance] = useState(false);

  // ── connectingReady: prevents flash-through on fast syncs ─────────────────
  const [connectingReady, setConnectingReady] = useState(false);

  const targetPhaseRef = useRef<SyncPhase>('CONNECTING');

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

  let targetPhase = mapStatusToPhase(status);
  if (!connectingReady && targetPhase !== 'CONNECTING') targetPhase = 'CONNECTING';
  if (processingVisible && targetPhase === 'IMPORTING_ORDERS') targetPhase = 'PROCESSING';

  // Keep ref in sync — lets useEffect read latest targetPhase without it being a dependency
  targetPhaseRef.current = targetPhase;

  // Step 4: walk through phases sequentially — never skip, always show each step
  // Even if backend jumps from CONNECTING → DONE in 2s, UI walks each step with min dwell
  useEffect(() => {
    const currentIndex = PHASE_ORDER.indexOf(gatedPhase);
    const targetIndex  = PHASE_ORDER.indexOf(targetPhaseRef.current);

    // Already at or past target — nothing to do
    if (currentIndex >= targetIndex) return;

    // Advance one step at a time with minimum dwell
    const nextPhase = PHASE_ORDER[currentIndex + 1];
    if (!nextPhase) return;

    const minDur = gatedPhase === 'CONNECTING'
      ? UX_TIMINGS.CONNECTING_FLOOR_MS
      : UX_TIMINGS.MIN_STEP_DURATION_MS;

    const t = setTimeout(() => {
      // Re-check at fire time — target may have moved further
      setGatedPhase(nextPhase);
    }, minDur);

    return () => clearTimeout(t);
  }, [gatedPhase]); // targetPhase intentionally read via ref — prevents timer restart on backend updates

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