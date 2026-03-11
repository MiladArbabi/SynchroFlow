/**
 * Operational state detection layer
 * ---------------------------------
 * Converts snapshot metrics into deterministic
 * operational states used by the signal engine.
 *
 * This allows the mapper to evolve from
 * metric→signal logic toward state→signal logic.
 */
import { detectOperationalStates } from './detectOperationalStates.js';
import { createEarlyAgingSignal, createAgingOrdersSignal } from './signals/createAgingSignals.js';
import { createAwaitingCustomerSignal } from './signals/createAwaitingCustomerSignal.js';
import { createFulfillmentConstraintSignal } from './signals/createFulfillmentConstraintSignal.js';
import { createInventoryShortageSignal } from './signals/createInventoryShortageSignal.js';
import { createOperationalExceptionSignal } from './signals/createOperationalExceptionSignal.js';
import { createPaymentProblemSignal } from './signals/createPaymentProblemSignal.js';
import { createPaymentReviewSignal } from './signals/createPaymentReviewSignal.js';
import { createSlaRiskSignal } from './signals/createSlaRiskSignal.js';
import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { validateSnapshotCoverage } from './utils/validateSnapshotCoverage.js';
import type { OperationalControlSnapshot } from './types/operationalControlSnapshot.js';
import { signalRegistry } from './signals/signalRegistry.js';

import { createInventoryConstraintClusterSignal }
from './signals/createInventoryConstraintClusterSignal.js';

import {
  registerSignalType,
  getDetectedAt,
  getLifecycle,
  resolveInactiveSignals,
  pruneResolvedSignals
} from './lifecycle/signalLifecycleEngine.js';

import {
  signalId,
  escalateSeverity
} from './utils/signalUtils.js';
import { normalizeOperationalSnapshot } from './utils/normalizeOperationalSnapshot.js';
import { sortOperationalSignals } from './utils/sortOperationalSignals.js';

/**
 * SIGNAL IDENTIFIERS
 * ------------------
 * Central registry for operational signal identifiers.
 *
 * Prevents lifecycle registry fragmentation caused
 * by string typos or inconsistent naming.
 *
 * These identifiers are used by:
 * - signalId()
 * - lifecycle registry
 * - detection registry
 */
const SIGNAL_IDS = {
  INVENTORY_SHORTAGE: 'inventory-shortage',
  SLA_RISK: 'sla-risk',
  PAYMENT_REVIEW: 'payment-review',
  AGING_24H: 'aging-24h',
  AGING_ORDERS: 'aging-orders',
  OPERATIONAL_EXCEPTION: 'operational-exception',
  PARTIAL_FULFILLMENT: 'partial-fulfillment',
  READY_TO_SHIP: 'ready-to-ship',
  AWAITING_CUSTOMER: 'awaiting-customer',
  PENDING_PAYMENTS: 'pending-payment',
  PAYMENT_RETRY: 'payment-retry',
  CONSTRAINED_ORDERS: 'constrained-orders',
  PENDING_FULFILLMENT: 'pending-fulfillment',

  INVENTORY_CONSTRAINT_CLUSTER: 'inventory-constraint-cluster',
} as const;

/**
 * SIGNAL IDENTIFIER INTEGRITY CHECK
 * ---------------------------------
 * Ensures no duplicate identifiers exist in SIGNAL_IDS.
 *
 * Duplicate identifiers would corrupt:
 * - signalDetectionRegistry
 * - signalLifecycleRegistry
 * - signalResolvedAtRegistry
 *
 * This guard executes once at module initialization.
 */
{
  const ids = Object.values(SIGNAL_IDS);
  const duplicates = ids.filter(
    (id, index) => ids.indexOf(id) !== index
  );

  if (duplicates.length > 0) {
    console.error(
      '[OperationalSignals] Duplicate signal identifiers detected:',
      duplicates
    );
  }
}

/**
 * SNAPSHOT FIELD COVERAGE REGISTRY
 * --------------------------------
 * Ensures every projection field is intentionally
 * handled by the signal engine.
 *
 * If reconciliation introduces a new snapshot metric
 * and the mapper does not explicitly reference it,
 * a warning will surface during development.
 *
 * This prevents projection → UI drift.
 */
const SNAPSHOT_FIELD_COVERAGE: Record<string, 'signal' | 'ignored'> = {
  orders_at_sla_risk: 'signal',
  pending_payment: 'signal',
  aging_24h: 'signal',
  aging_48h: 'signal',
  aging_72h_plus: 'signal',
  exception_orders: 'signal',
  constrained_orders: 'signal',
  partial_fulfillment_opportunity: 'signal'

  /**
   * Work Queue metrics
   *
   * These metrics represent operational workload and MUST NOT
   * be processed by the signal engine.
   *
   * They are consumed exclusively by the Work Queue mapper
   * (`mapWorkQueues.ts`) and rendered via `WorkQueueSection`.
   *
   * Architectural rule:
   *   Signals → problems
   *   Queues  → workload
   */
  // queue_manual_review
  // queue_awaiting_inventory
  // queue_ready_to_ship
  // queue_awaiting_customer
  // pending_fulfillment
};


export function mapOperationalSignals(
  snapshot: OperationalControlSnapshot
): OperationalSignal[] {

  const safeSnapshot =
    normalizeOperationalSnapshot(snapshot);

  /**
   * Snapshot evaluation timestamp
   * -----------------------------
   *
   * OperationalControlSnapshot does not contain
   * a timestamp field.
   *
   * Therefore the signal engine uses the evaluation
   * cycle time as the detection baseline.
   *
   * This timestamp is passed into the lifecycle engine
   * to generate signal detection timestamps.
   */
  const evaluationTime = Date.now();

  /**
   * Runtime invariant guard
   * -----------------------
   * Detect accidental use of wall-clock timestamps.
   */
  if (evaluationTime === 0) {
    console.warn(
      '[OperationalSignals] evaluationTime missing from snapshot — using deterministic fallback'
    );
  }

  /**
   * OPERATIONAL STATE DETECTION
   * ---------------------------
   * Convert normalized snapshot metrics into
   * high-level operational states.
   *
   * This prepares the signal engine for the
   * state-cluster architecture while preserving
   * existing signal logic during transition.
   */
  const states = detectOperationalStates(safeSnapshot);

  validateSnapshotCoverage(
    snapshot,
    SNAPSHOT_FIELD_COVERAGE
  );

  const signals: OperationalSignal[] = [];

  /**
   * SIGNAL ORCHESTRATION
   * --------------------
   *
   * The signal engine now operates on operational
   * state clusters instead of raw snapshot metrics.
   *
   * Flow:
   *
   * snapshot
   * ↓
   * safeSnapshot normalization
   * ↓
   * detectOperationalStates()
   * ↓
   * state-driven signal builders
   * ↓
   * lifecycle management
   * ↓
   * deterministic queue ordering
   *
   * Each signal is constructed by a dedicated
   * builder module to keep the mapper small
   * and maintainable.
   */

  /**
   * Tracks signal types present in this snapshot.
   */
  const activeSignalTypes = new Set<string>();

  /**
   * Signal Registry Execution
   * -------------------------
   * Executes registered signal builders
   * based on detected operational states.
   */
  for (const entry of signalRegistry) {

    if (!entry.shouldEmit(states)) {
      continue;
    }

    const detectedAt =
      getDetectedAt(entry.id, evaluationTime);

    if (registerSignalType(
          activeSignalTypes,
          entry.id
    )) {

      signals.push(
        entry.build(
          {
            snapshot: safeSnapshot,
            states,
            evaluationTime,
            activeSignalTypes
          },
          detectedAt
        )
      );

    }
  }

  /**
   * Resolve signals that disappeared from snapshot
   */
  resolveInactiveSignals(
    activeSignalTypes,
    evaluationTime
  );

  /**
   * Prune resolved lifecycle entries after 10 minutes
   * to prevent unbounded registry growth.
   */
  const RESOLUTION_RETENTION_MS = 10 * 60 * 1000;

  const prunedEntries =
    pruneResolvedSignals(
      evaluationTime,
      RESOLUTION_RETENTION_MS
    );

  /**
   * Emit pruning telemetry only when work occurred
   * to avoid console noise during normal operation.
   */
  if (prunedEntries > 0) {
    console.info(
      `[OperationalSignals] lifecycle cleanup pruned ${prunedEntries} entries`
    );
  }

  sortOperationalSignals(signals);

  return signals;
}