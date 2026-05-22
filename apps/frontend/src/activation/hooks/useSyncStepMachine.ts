/* eslint-disable @typescript-eslint/no-unused-vars */
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

import { useEffect, useRef, useState } from 'react';

/**
 * UX timing configuration
 * Centralized to eliminate magic numbers
 */
const UX_TIMINGS = {
  TEASER_DELAY_MS:       800,
  REASSURANCE_DELAY_MS:  60000,
  MIN_STEP_DURATION_MS:  1800,  // minimum time each step stays visible before advancing
  CONNECTING_FLOOR_MS:   2500,  // minimum connecting step duration
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
  const [showTeaser, setShowTeaser]               = useState(false);
  const [showReassurance, setShowReassurance]     = useState(false);
  const [connectingReady, setConnectingReady]     = useState(false);
  // Track when each phase was first seen — enforces minimum display time
  const phaseFirstSeenRef = useRef<Partial<Record<string, number>>>({});
  const [gatedPhase, setGatedPhase]               = useState<SyncPhase>('CONNECTING');

  let rawPhase = mapStatusToPhase(status);
  if (!connectingReady && rawPhase !== 'CONNECTING') rawPhase = 'CONNECTING';
  if (processingVisible && rawPhase === 'IMPORTING_ORDERS') rawPhase = 'PROCESSING';

  // Record first-seen time for each raw phase
  useEffect(() => {
    if (!phaseFirstSeenRef.current[rawPhase]) {
      phaseFirstSeenRef.current[rawPhase] = Date.now();
    }
    const elapsed = Date.now() - (phaseFirstSeenRef.current[rawPhase] ?? Date.now());
    const minDuration = rawPhase === 'CONNECTING'
      ? UX_TIMINGS.CONNECTING_FLOOR_MS
      : UX_TIMINGS.MIN_STEP_DURATION_MS;

    if (elapsed >= minDuration) {
      setGatedPhase(rawPhase);
    } else {
      const remaining = minDuration - elapsed;
      const t = setTimeout(() => setGatedPhase(rawPhase), remaining);
      return () => clearTimeout(t);
    }
  }, [rawPhase]);

  const phase = gatedPhase;

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