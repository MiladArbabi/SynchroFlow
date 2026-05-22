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

  const [gatedPhase, setGatedPhase]               = useState<SyncPhase>('CONNECTING');
  const [processingVisible, setProcessingVisible]  = useState(false);
  const targetPhaseRef = useRef<SyncPhase>('CONNECTING');
  const [showTeaser, setShowTeaser]                = useState(false);
  const [showReassurance, setShowReassurance]      = useState(false);

  // Synthetic PROCESSING step: activates when orders start arriving
  useEffect(() => {
    const rawPhase = mapStatusToPhase(status);
    if (rawPhase === 'IMPORTING_ORDERS' && counts.orders > 0) {
      setProcessingVisible(true);
    } else if (rawPhase !== 'IMPORTING_ORDERS') {
      setProcessingVisible(false);
    }
  }, [status, counts.orders]);

  // Compute target phase — where backend wants us to be
  let targetPhase = mapStatusToPhase(status);
  if (processingVisible && targetPhase === 'IMPORTING_ORDERS') targetPhase = 'PROCESSING';

  // Only advance the ref — never regress. Prevents poll-driven re-renders from resetting timers.
  if (PHASE_ORDER.indexOf(targetPhase) > PHASE_ORDER.indexOf(targetPhaseRef.current)) {
    targetPhaseRef.current = targetPhase;
  }

  // Walk through phases sequentially with minimum dwell per step.
  // Never skips — even if backend jumps CONNECTING→DONE in 2s, UI walks each step.
  // CONNECTING_FLOOR_MS enforced here directly — no separate connectingReady gate needed.
  useEffect(() => {
    const currentIndex = PHASE_ORDER.indexOf(gatedPhase);
    const targetIndex  = PHASE_ORDER.indexOf(targetPhaseRef.current);

    if (currentIndex >= targetIndex) return;

    const nextPhase = PHASE_ORDER[currentIndex + 1];
    if (!nextPhase) return;

    const minDur = gatedPhase === 'CONNECTING'
      ? UX_TIMINGS.CONNECTING_FLOOR_MS
      : UX_TIMINGS.MIN_STEP_DURATION_MS;

    const t = setTimeout(() => setGatedPhase(nextPhase), minDur);
    return () => clearTimeout(t);
  }, [gatedPhase]); // targetPhase read via ref — poll re-renders never cancel the timer

  // Teaser after DONE
  useEffect(() => {
    if (status !== 'COMPLETED') return;
    const t = setTimeout(() => setShowTeaser(true), UX_TIMINGS.TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [status]);

  // Reassurance after 60s
  useEffect(() => {
    const t = setTimeout(() => setShowReassurance(true), UX_TIMINGS.REASSURANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

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

  let activeStepIndex = 0;
  switch (gatedPhase) {
    case 'CONNECTING':         activeStepIndex = 0; break;
    case 'IMPORTING_PRODUCTS': activeStepIndex = 1; break;
    case 'IMPORTING_ORDERS':   activeStepIndex = 2; break;
    case 'PROCESSING':         activeStepIndex = 3; break;
    case 'FINALIZING':         activeStepIndex = 4; break;
    case 'DONE':               activeStepIndex = 4; break;
  }

  const stepStates: StepState[] = Array.from({ length: totalSteps }, (_, i) => {
    if (i < activeStepIndex) return 'done';
    if (i === activeStepIndex) return 'active';
    return 'pending';
  });

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