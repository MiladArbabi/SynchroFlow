// apps/frontend/src/activation/hooks/useSyncStepMachine.ts

/**
 * useSyncStepMachine
 * --------------------------------------------------
 * Responsibility:
 * - Map backend status → UI step progression
 * - Handle sequencing + synthetic step
 * - Control progress + teaser + reassurance
 *
 * NOTE:
 * - No network calls
 * - Pure orchestration layer
 */

import { useEffect, useState } from 'react';

/**
 * UX timing configuration
 * Centralized to eliminate magic numbers
 */
const UX_TIMINGS = {
  TEASER_DELAY_MS: 800,
  REASSURANCE_DELAY_MS: 60000,
};

type StepState = 'pending' | 'active' | 'done';

interface SyncCounts {
  orders: number;
  variants: number;
  customers: number;
}

/**
 * Explicit return contract — prevents shape drift
 */
interface SyncStepMachineResult {
  stepStates: StepState[];
  activeStepIndex: number;
  progressWidth: number;
  showTeaser: boolean;
  showReassurance: boolean;
  isError: boolean; // always present
}

interface SyncProgress {
  current: number;
  total: number;
  percentage: number;
}

/**
 * EXPLICIT STATE MACHINE
 * --------------------------------------------------
 * Deterministic mapping:
 * backend status → phase → UI
 *
 * No queues, no hidden transitions.
 */

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
    case 'PENDING': return 'CONNECTING';
    case 'SYNCING_PRODUCTS': return 'IMPORTING_PRODUCTS';
    case 'SYNCING_ORDERS':
    case 'SYNCING_INVENTORY':
    case 'SYNCING_SHOP': return 'IMPORTING_ORDERS';
    case 'FAILED': return 'ERROR';
    case 'COMPLETING': return 'FINALIZING';
    case 'COMPLETED': return 'DONE';
    default: return 'CONNECTING';
  }
}

export function useSyncStepMachine(
  status: string,
  counts: SyncCounts,
  totalSteps: number,
  progress?: SyncProgress | null
): SyncStepMachineResult {
  // instrumentation: single source of truth for UI state
  // console.debug('[SyncPhase]', phase);

  const [processingVisible, setProcessingVisible] = useState(false);
  const [showTeaser, setShowTeaser] = useState(false);
  const [showReassurance, setShowReassurance] = useState(false);
  // minimum display guard for connecting step (prevents flash)
  const [connectingReady, setConnectingReady] = useState(false);
  
    let phase = mapStatusToPhase(status);

    // hold connecting visually until minimum duration passes
    if (!connectingReady && phase !== 'CONNECTING') {
        phase = 'CONNECTING';
    }

    // elevate synthetic processing into explicit phase
    // ensures single source of truth (no UI-only hidden state)
    if (processingVisible && phase === 'IMPORTING_ORDERS') {
        phase = 'PROCESSING';
    }

    // synthetic step (controlled, isolated)
    /**
     * processing becomes visible when meaningful data exists
     * removes arbitrary timing dependency
     */
    useEffect(() => {
    if (phase === 'IMPORTING_ORDERS' && counts.orders > 0) {
        setProcessingVisible(true);
    } else {
        setProcessingVisible(false);
    }
    }, [phase, counts.orders]);

  useEffect(() => {
  if (phase !== 'CONNECTING') return;

  const t = setTimeout(() => setConnectingReady(true), 3000); // UX floor
  return () => clearTimeout(t);
}, [phase]);

  // teaser on completion
  useEffect(() => {
    if (phase === 'DONE') {
      const t = setTimeout(() => setShowTeaser(true), UX_TIMINGS.TEASER_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // reassurance
  useEffect(() => {
    const t = setTimeout(() => setShowReassurance(true), UX_TIMINGS.REASSURANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // active step index (deterministic)
  let activeStepIndex = 0;

  switch (phase) {
    case 'CONNECTING': activeStepIndex = 0; break;
    case 'IMPORTING_PRODUCTS': activeStepIndex = 1; break;
    case 'IMPORTING_ORDERS': activeStepIndex = 2; break;
    case 'PROCESSING': activeStepIndex = 3; break;
    case 'FINALIZING': activeStepIndex = 4; break;
    case 'DONE': activeStepIndex = 4; break;
  }

  if (phase === 'ERROR') {
    return {
        stepStates: Array(totalSteps).fill('pending'),
        activeStepIndex: -1,
        progressWidth: 0,
        showTeaser: false,
        showReassurance: false,
        isError: true, // instrumentation flag
    };
    }

  const stepStates: StepState[] = Array.from({ length: totalSteps }, (_, i) => {
    if (i < activeStepIndex) return 'done';
    if (i === activeStepIndex) return 'active';
    return 'pending';
  });

  // prefer backend truth when available
  const progressWidth = progress?.percentage
    ? progress.percentage
    : ((activeStepIndex + 1) / totalSteps) * 100;

    // console.debug('[Progress]', progressWidth, progress);

  return {
    stepStates,
    activeStepIndex,
    progressWidth,
    showTeaser,
    showReassurance,
    isError: false, // explicit
  };
}