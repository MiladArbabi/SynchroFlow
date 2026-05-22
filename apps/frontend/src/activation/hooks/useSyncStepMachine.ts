/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/activation/hooks/useSyncStepMachine.ts
//
// Responsibility:
// - Map backend status → UI step progression with minimum per-step display times
// - Handle synthetic PROCESSING step
// - Control teaser + reassurance timing
//
// ARCHITECTURE: Phase walking is driven by a single imperative timer loop
// (walkRef) that reads latest target via a ref. This isolates timing from
// React's render cycle — poll re-renders never interfere with pending timers.

import { useEffect, useRef, useState } from 'react';

const UX_TIMINGS = {
  TEASER_DELAY_MS:      800,
  REASSURANCE_DELAY_MS: 60000,
};

// Minimum display time per phase — controls pacing of the sync animation
const PHASE_MIN_DURATION: Partial<Record<SyncPhase, number>> = {
  CONNECTING:         2500,
  IMPORTING_PRODUCTS: 1800,
  IMPORTING_ORDERS:   8000,   // longest — most events happen here
  PROCESSING:         5000,   // calculating margin — feels substantial
  FINALIZING:         3000,
};

const getMinDuration = (phase: SyncPhase) => PHASE_MIN_DURATION[phase] ?? 2000;

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

  // ── Display phase — what the UI shows ─────────────────────────────────────
  const [displayPhase, setDisplayPhase] = useState<SyncPhase>('CONNECTING');

  // ── Refs — readable inside timer closures without stale value risk ─────────
  const displayPhaseRef   = useRef<SyncPhase>('CONNECTING');
  const latestStatusRef   = useRef<string>(status);
  const processingRef     = useRef<boolean>(false);
  const walkingRef        = useRef<boolean>(false);
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── UX signals ────────────────────────────────────────────────────────────
  const [showTeaser, setShowTeaser]           = useState(false);
  const [showReassurance, setShowReassurance] = useState(false);

  // ── Keep refs current on every render ─────────────────────────────────────
  latestStatusRef.current = status;

  // ── Synthetic PROCESSING step ──────────────────────────────────────────────
  useEffect(() => {
    const rawPhase = mapStatusToPhase(status);
    if (rawPhase === 'IMPORTING_ORDERS' && counts.orders > 0) {
      processingRef.current = true;
    } else if (rawPhase !== 'IMPORTING_ORDERS') {
      processingRef.current = false;
    }
  }, [status, counts.orders]);

  // ── Compute current target index from latest status ───────────────────────
  const getTargetIndex = () => {
    let p = mapStatusToPhase(latestStatusRef.current);
    if (processingRef.current && p === 'IMPORTING_ORDERS') p = 'PROCESSING';
    return PHASE_ORDER.indexOf(p);
  };

  // ── Advance one step, then schedule the next ───────────────────────────────
  const scheduleNextStep = () => {
    const currentIndex = PHASE_ORDER.indexOf(displayPhaseRef.current);
    const targetIndex  = getTargetIndex();

    if (currentIndex >= targetIndex) {
      // Reached target — stop walking
      walkingRef.current = false;
      timerRef.current   = null;
      return;
    }

    const minDur = getMinDuration(displayPhaseRef.current);

    timerRef.current = setTimeout(() => {
      const currIdx = PHASE_ORDER.indexOf(displayPhaseRef.current);
      const tgtIdx  = getTargetIndex();

      if (currIdx < tgtIdx) {
        const next = PHASE_ORDER[currIdx + 1];
        if (next) {
          displayPhaseRef.current = next;
          setDisplayPhase(next);        // trigger re-render
        }
      }
      scheduleNextStep();              // chain next step
    }, minDur);
  };

  // ── Start the walk when status first advances past CONNECTING ──────────────
  useEffect(() => {
    const targetIndex = getTargetIndex();

    if (targetIndex <= PHASE_ORDER.indexOf(displayPhaseRef.current)) return;
    if (walkingRef.current) return; // already walking — loop reads latest via ref

    walkingRef.current = true;
    scheduleNextStep();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]); // status is the only meaningful trigger — counts/progress don't affect timing

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ── Teaser after DONE ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'COMPLETED') return;
    const t = setTimeout(() => setShowTeaser(true), UX_TIMINGS.TEASER_DELAY_MS);
    return () => clearTimeout(t);
  }, [status]);

  // ── Reassurance after 60s ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setShowReassurance(true), UX_TIMINGS.REASSURANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // ── Error state ───────────────────────────────────────────────────────────
  if (displayPhase === 'ERROR') {
    return {
      stepStates:      Array(totalSteps).fill('pending'),
      activeStepIndex: -1,
      progressWidth:   0,
      showTeaser:      false,
      showReassurance: false,
      isError:         true,
    };
  }

  // ── Active step index ──────────────────────────────────────────────────────
  let activeStepIndex = 0;
  switch (displayPhase) {
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
  // Progress bar driven by UI step index — 20% per step regardless of backend percentage
  const progressWidth = ((activeStepIndex + 1) / totalSteps) * 100;

  return {
    stepStates,
    activeStepIndex,
    progressWidth,
    showTeaser,
    showReassurance,
    isError: false,
  };
}