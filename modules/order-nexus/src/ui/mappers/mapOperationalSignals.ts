/**
 * Operational Signal Mapper
 * -------------------------
 *
 * Transforms snapshot fields from the Orders FT2 snapshot
 * into OperationalSignal objects used by the Operations Queue UI.
 *
 * Data lineage
 * ------------
 *
 * orders_operational_control_snapshot
 * ↓
 * FT2 resolver
 * ↓
 * OrdersModuleFT2 props
 * ↓
 * mapOperationalSignals()
 * ↓
 * OperationsQueueSection
 */

import type { 
  OperationalSignal, 
  OperationalSignalLifecycle, 
  OperationalSignalSeverity 
} from '../../contracts/operationalSignals.js';

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
  PENDING_FULFILLMENT: 'pending-fulfillment'
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

export type OperationalControlSnapshot = {
  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;
  orders_at_sla_risk: number;
  pending_fulfillment: number;

  /**
   * ORDER AGING INTELLIGENCE
   * ------------------------
   * Derived by reconciliation projection.
   * Used to detect orders stuck in fulfillment pipeline.
   */
  aging_24h: number;
  aging_48h: number;
  aging_72h_plus: number;

  /**
   * OPERATIONAL EXCEPTIONS
   * ----------------------
   * Orders with fulfillment or carrier anomalies.
   * Derived by reconciliation projection.
   */
  exception_orders: number;

  /**
   * PAYMENT BLOCKAGE
   * ----------------
   * Orders awaiting payment confirmation or retry.
   * Derived by reconciliation projection.
   */
  pending_payment: number;

  /**
   * CONSTRAINT INTELLIGENCE
   * -----------------------
   * Orders blocked by system constraints
   * (inventory, operational, or customer).
   *
   * Projection source:
   * orders_operational_control_snapshot.constrained_orders
   */
  constrained_orders: number;

  /**
   * PARTIAL FULFILLMENT OPPORTUNITY
   * --------------------------------
   * Orders containing both:
   * - available inventory
   * - out-of-stock items
   *
   * Allows warehouse to ship partial orders.
   * Derived by reconciliation projection.
   */
  partial_fulfillment_opportunity: number;
};

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
  queue_manual_review: 'signal',
  queue_awaiting_inventory: 'signal',
  queue_ready_to_ship: 'signal',
  queue_awaiting_customer: 'signal',

  orders_at_sla_risk: 'signal',

  /**
   * Fulfillment backlog signal
   * --------------------------
   * Snapshot field:
   * orders_operational_control_snapshot.pending_fulfillment
   *
   * Consumed by signal:
   * SIGNAL_IDS.PENDING_FULFILLMENT
   */
  pending_fulfillment: 'signal',
  pending_payment: 'signal',

  aging_24h: 'signal',
  aging_48h: 'signal',
  aging_72h_plus: 'signal',

  exception_orders: 'signal',

  constrained_orders: 'signal',

  partial_fulfillment_opportunity: 'signal'
};

  /**
   * SIGNAL DETECTION REGISTRY
   * -------------------------
   * Tracks first detection timestamp for signal clusters.
   *
   * Frozen container prevents accidental reassignment
   * while still allowing Map entry mutation.
   */
  const signalDetectionRegistry = Object.freeze(
    new Map<string, string>()
  );

  /**
   * SIGNAL LIFECYCLE REGISTRY
   * -------------------------
   * Maintains lifecycle transitions for active signals.
   */
  const signalLifecycleRegistry = Object.freeze(
    new Map<string, OperationalSignalLifecycle>()
  );

  /**
   * SIGNAL RESOLUTION REGISTRY
   * --------------------------
   * Tracks resolved signals for delayed cleanup.
   */
  const signalResolvedAtRegistry = Object.freeze(
    new Map<string, number>()
  );

/**
 * Metric warning registry
 * -----------------------
 * Tracks previously emitted metric anomalies so we
 * avoid repeating identical warnings across snapshot
 * refresh cycles.
 *
 * Module-scope by design.
 */
const metricWarningRegistry = new Set<string>();

/**
 * Signal identity
 * ----------------
 * Signals are namespaced by module to prevent
 * lifecycle registry collisions across modules.
 *
 * Format:
 * orders:<signal-type>
 */
function signalId(type: string): string {
  return `orders:${type}`;
}

/**
 * Lifecycle transition handler
 *
 * Allows UI action handlers to move signals
 * through the operational lifecycle.
 */
export function updateSignalLifecycle(
  type: string,
  lifecycle: OperationalSignalLifecycle
) {
  /**
   * Lifecycle transition guard
   *
   * Prevents invalid lifecycle regressions.
   */
  const key = signalId(type);
  const current = signalLifecycleRegistry.get(key);

  const order = {
    NEW: 1,
    ACKNOWLEDGED: 2,
    IN_PROGRESS: 3,
    RESOLVED: 4,
  };

  if (!current || order[lifecycle] >= order[current]) {
    signalLifecycleRegistry.set(key, lifecycle);
  }
}

export function mapOperationalSignals(
  snapshot: OperationalControlSnapshot
): OperationalSignal[] {

  /**
   * Snapshot evaluation timestamp.
   *
   * Ensures all age calculations within this mapping
   * cycle use a consistent time reference.
   */
  const evaluationTime = Date.now();

  /**
   * Upper bound guard for snapshot metrics.
   *
   * Prevents unrealistic queue sizes caused by
   * upstream data corruption.
   */
  const MAX_QUEUE_METRIC = 100000;

  /**
   * Prevent diagnostic registry from growing indefinitely.
   */
  const MAX_WARNING_REGISTRY_SIZE = 100;

  /**
   * warnOnce()
   * ----------
   * Emits diagnostics for malformed snapshot metrics.
   *
   * Behavior:
   * - First occurrence → full warning emitted.
   * - Subsequent occurrences → suppression notice emitted.
   *
   * This prevents log spam while preserving observability
   * of repeated upstream data corruption.
   */
  function warnOnce(key: string, message: string, payload: unknown) {

    const alreadySeen = metricWarningRegistry.has(key);
    if (!alreadySeen) {
      if (metricWarningRegistry.size >= MAX_WARNING_REGISTRY_SIZE) {
        console.warn(
          '[OperationalSignals] metricWarningRegistry capacity reached — registry cleared'
        );
        metricWarningRegistry.clear();
      }

      metricWarningRegistry.add(key);
      console.warn(message, payload);

    } else {
      /**
       * Explicit suppression signal
       * ---------------------------
       * Avoids silent diagnostic suppression.
       */
      console.debug(
        '[OperationalSignals] duplicate metric warning suppressed',
        { key }
      );
    }
  }

  /**
   * Normalizes snapshot metrics.
   *
   * Ensures:
   * - numeric values
   * - non-negative counts
   *
   * Emits diagnostics if upstream data is malformed.
   */
  function safeMetric(value: unknown): number {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      warnOnce(
        `invalid-${value}`,
        '[OperationalSignals] Invalid snapshot metric',
        { value }
      );
      return 0;
    }

    if (n < 0) {
      warnOnce(
        `negative-${value}`,
        '[OperationalSignals] Negative snapshot metric',
        { value }
      );
      return 0;
    }

    if (n > MAX_QUEUE_METRIC) {
      warnOnce(
        `excessive-${n}`,
        '[OperationalSignals] Excessive snapshot metric',
        { value: n }
      );
      return MAX_QUEUE_METRIC;
    }
    return n;
  }

  /**
   * Snapshot normalization
   *
   * Ensures all queue metrics are valid non-negative numbers.
   * Prevents mapper failures from malformed resolver input.
   */
  const safeSnapshot: OperationalControlSnapshot = {
    queue_manual_review: safeMetric(snapshot.queue_manual_review),
    queue_awaiting_inventory: safeMetric(snapshot.queue_awaiting_inventory),
    queue_ready_to_ship: safeMetric(snapshot.queue_ready_to_ship),
    queue_awaiting_customer: safeMetric(snapshot.queue_awaiting_customer),
    orders_at_sla_risk: safeMetric(snapshot.orders_at_sla_risk),
    pending_fulfillment: safeMetric(snapshot.pending_fulfillment),

    aging_24h: safeMetric(snapshot.aging_24h),
    aging_48h: safeMetric(snapshot.aging_48h),
    aging_72h_plus: safeMetric(snapshot.aging_72h_plus),
    exception_orders: safeMetric(snapshot.exception_orders),
    constrained_orders: safeMetric(snapshot.constrained_orders),
    pending_payment: safeMetric(snapshot.pending_payment),
    partial_fulfillment_opportunity: safeMetric(snapshot.partial_fulfillment_opportunity)
  };

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

  /**
   * SNAPSHOT COVERAGE VALIDATION
   * ----------------------------
   * Detect projection fields that are not declared
   * in the coverage registry.
   *
   * IMPORTANT
   * ---------
   * This intentionally avoids Node globals (process.env)
   * because this module executes in the browser runtime.
   */
  Object.keys(snapshot).forEach((key) => {
    if (!(key in SNAPSHOT_FIELD_COVERAGE)) {
      console.warn(
        `[OperationalSignals] Snapshot field "${key}" is not registered in SNAPSHOT_FIELD_COVERAGE`
      );
    }
  });

  const signals: OperationalSignal[] = [];

  /**
   * Tracks signal types present in this snapshot.
   */
  const activeSignalTypes = new Set<string>();

  /**
   * Duplicate signal guard
   * ----------------------
   * Ensures each signal type is emitted only once
   * per snapshot evaluation cycle.
   *
   * Uses the raw signal type rather than the namespaced
   * signal ID to keep mapper logic stable even if
   * signalId() implementation evolves.
   */
  function registerSignalType(type: string): boolean {

    const normalizedType = signalId(type);

    if (activeSignalTypes.has(normalizedType)) {
      return false;
    }

    activeSignalTypes.add(normalizedType);
    return true;
  }

  /**
   * Returns stable detection timestamp for a signal type.
   */
  function getDetectedAt(type: string): string {
    const key = signalId(type);
    if (!signalDetectionRegistry.has(key)) {
      signalDetectionRegistry.set(key, new Date().toISOString());
    }
    return signalDetectionRegistry.get(key)!;
  }

  /**
   * Returns stable lifecycle state for a signal.
   */
  function getLifecycle(type: string): OperationalSignalLifecycle {
    const key = signalId(type);

    if (!signalLifecycleRegistry.has(key)) {
      signalLifecycleRegistry.set(key, 'NEW');
    }

    return signalLifecycleRegistry.get(key)!;
  }

  /**
 * Escalates signal severity based on age.
 *
 * Prevents operational issues from staying hidden
 * when they remain unresolved for long periods.
 */
function escalateSeverity(
  severity: OperationalSignalSeverity,
  detectedAt: string
): OperationalSignalSeverity {

  /**
   * Timestamp guard
   * ---------------
   * Prevents corrupted detection timestamps from
   * breaking severity escalation logic.
   */
  const detectedTime = new Date(detectedAt).getTime();

  if (!Number.isFinite(detectedTime)) {
    console.warn(
      '[OperationalSignals] Invalid detectedAt timestamp',
      { detectedAt }
    );
    return severity;
  }

  const ageMinutes =
    (evaluationTime - detectedTime) / 60000;

  if (severity === 'info' && ageMinutes >= 15) {
    return 'warning';
  }

  if (severity === 'warning' && ageMinutes >= 30) {
    return 'critical';
  }

  return severity;
}

  /**
   * STATE-DRIVEN SIGNAL
   * -------------------
   * Inventory shortage is now emitted from the
   * operational state layer rather than directly
   * from snapshot metrics.
   *
   * This is the first migration step toward the
   * state-cluster signal architecture.
   */
  if (states.inventoryShortage) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.INVENTORY_SHORTAGE);
      /**
       * Emit signal only on first registration.
       * registerSignalType() returns TRUE when the signal
       * type has not yet been emitted during this snapshot cycle.
       */
      if (registerSignalType(SIGNAL_IDS.INVENTORY_SHORTAGE)) {
        signals.push(
        createInventoryShortageSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.INVENTORY_SHORTAGE),
          escalateSeverity('critical', detectedAt),
          signalId(SIGNAL_IDS.INVENTORY_SHORTAGE)
        )
      );
    }
  }

  /**
   * STATE-DRIVEN SIGNAL
   * -------------------
   * SLA risk is emitted from the operational
   * state detection layer rather than directly
   * from snapshot metrics.
   *
   * This continues the transition from
   * metric-driven signals to state-cluster signals.
   */
  if (states.slaRisk) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.SLA_RISK);
    if (registerSignalType(SIGNAL_IDS.SLA_RISK)) {
      signals.push(
        createSlaRiskSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.SLA_RISK),
          escalateSeverity('critical', detectedAt),
          signalId(SIGNAL_IDS.SLA_RISK)
        )
      );
    }
  }

  /**
   * Payment / fraud review queue
   */
  if (states.paymentReview) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.PAYMENT_REVIEW);
    if (registerSignalType(SIGNAL_IDS.PAYMENT_REVIEW)) {
      signals.push(
        createPaymentReviewSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.PAYMENT_REVIEW),
          escalateSeverity('warning', detectedAt),
          signalId(SIGNAL_IDS.PAYMENT_REVIEW)
        )
      );
    }
  };

  /**
   * Customer dependency
   */
  if (states.awaitingCustomer) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.AWAITING_CUSTOMER);
    if (registerSignalType(SIGNAL_IDS.AWAITING_CUSTOMER)) {
      signals.push(
        createAwaitingCustomerSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.AWAITING_CUSTOMER),
          escalateSeverity('info', detectedAt),
          signalId(SIGNAL_IDS.AWAITING_CUSTOMER)
        )
      );
    }
  }

  /**
   * STATE-DRIVEN SIGNAL
   * -------------------
   * Early aging detection now originates from the
   * operational state layer rather than raw metrics.
   */
  if (states.earlyAging) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.AGING_24H);

    if (registerSignalType(SIGNAL_IDS.AGING_24H)) {
      signals.push(
        createEarlyAgingSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.AGING_24H),
          escalateSeverity('info', detectedAt),
          signalId(SIGNAL_IDS.AGING_24H)
        )
      );
    }
  };

  /**
   * STATE-DRIVEN SIGNAL
   * -------------------
   * Aging orders are emitted from the operational
   * state detection layer to ensure consistent
   * state-cluster signal generation.
   */
  if (states.agingOrders) {

    const affected =
      safeSnapshot.aging_48h + safeSnapshot.aging_72h_plus;

    const detectedAt = getDetectedAt(SIGNAL_IDS.AGING_ORDERS);

    if (registerSignalType(SIGNAL_IDS.AGING_ORDERS)) {

      signals.push(
        createAgingOrdersSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.AGING_ORDERS),
          escalateSeverity('critical', detectedAt),
          signalId(SIGNAL_IDS.AGING_ORDERS)
        )
      );
    }
  }

  /**
   * OPERATIONAL EXCEPTIONS
   * ----------------------
   * Orders experiencing carrier, fulfillment,
   * or processing anomalies.
   *
   * Derived from snapshot exception_orders.
   */
  if (states.operationalException) {

    const detectedAt = getDetectedAt(SIGNAL_IDS.OPERATIONAL_EXCEPTION);

    if (registerSignalType(SIGNAL_IDS.OPERATIONAL_EXCEPTION)) {

      signals.push(
        createOperationalExceptionSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.OPERATIONAL_EXCEPTION),
          escalateSeverity('critical', detectedAt),
          signalId(SIGNAL_IDS.OPERATIONAL_EXCEPTION)
        )
      );
    }
  }

  /**
   * ORDER CONSTRAINTS
   * -----------------
   * Orders blocked by operational constraints
   * such as inventory, customer issues,
   * or fulfillment blockers.
   *
   * Projection source:
   * orders_operational_control_snapshot.constrained_orders
   */
  if (states.fulfillmentConstraint) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.CONSTRAINED_ORDERS);

    if (registerSignalType(SIGNAL_IDS.CONSTRAINED_ORDERS)) {
      signals.push(
        createFulfillmentConstraintSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.CONSTRAINED_ORDERS),
          escalateSeverity('warning', detectedAt),
          signalId(SIGNAL_IDS.CONSTRAINED_ORDERS)
        )
      );
    }
  }

  /**
   * PAYMENT SIGNAL CONSOLIDATION
   * ----------------------------
   * Payment lifecycle signals must be unified into a
   * single operational signal cluster.
   *
   * The "Payment retry required" signal represents the
   * actionable operational state.
   *
   * The previous "Payment pending" signal caused duplicate
   * signals from the same metric (pending_payment).
   *
   * This block is intentionally disabled to preserve code
   * history while preventing duplicate payment signals.
   */
  if (states.paymentProblem) {

    const detectedAt = getDetectedAt(SIGNAL_IDS.PAYMENT_RETRY);

    if (registerSignalType(SIGNAL_IDS.PAYMENT_RETRY)) {

      signals.push(
        createPaymentProblemSignal(
          safeSnapshot,
          detectedAt,
          getLifecycle(SIGNAL_IDS.PAYMENT_RETRY),
          escalateSeverity('critical', detectedAt),
          signalId(SIGNAL_IDS.PAYMENT_RETRY)
        )
      );
    }
  }

/**
 * FULFILLMENT CONSTRAINT CLUSTERING
 * ---------------------------------
 * Partial fulfillment opportunity belongs to the same
 * operational constraint cluster as "Orders blocked by constraints".
 *
 * Emitting both as independent signals increases operator
 * cognitive load and fragments the fulfillment constraint state.
 *
 * This block is temporarily disabled until the constraint
 * cluster signal is fully implemented.
 */
if (false && safeSnapshot.partial_fulfillment_opportunity > 0) {

  const detectedAt = getDetectedAt(SIGNAL_IDS.PARTIAL_FULFILLMENT);

  if (registerSignalType(SIGNAL_IDS.PARTIAL_FULFILLMENT)) {

    signals.push({
      id: signalId(SIGNAL_IDS.PARTIAL_FULFILLMENT),
      severity: escalateSeverity('warning', detectedAt),
      lifecycle: getLifecycle(SIGNAL_IDS.PARTIAL_FULFILLMENT),
      detectedAt,

      title: 'Partial fulfillment available',

      impact:
        safeSnapshot.partial_fulfillment_opportunity === 1
          ? '1 order eligible for partial shipment'
          : `${safeSnapshot.partial_fulfillment_opportunity} orders eligible for partial shipment`,

      metadata: {
        partial_fulfillment_opportunity:
          safeSnapshot.partial_fulfillment_opportunity,
      },

      actions: [
        {
          id: 'inspect_partial_orders',
          label: 'Inspect orders',
          actionType: 'inspect_partial_orders',
        },
      ],

      batchActions: [
        {
          id: 'split_shipments',
          label: 'Split shipments',
          actionType: 'split_shipments',
        },
      ],
    });
  }
}


  /**
   * QUEUE VS SIGNAL SEPARATION
   * --------------------------
   * Fulfillment backlog represents operational workload,
   * not a system alert.
   *
   * This queue will be rendered in the future Work Queue
   * surface rather than the Operational Signals surface.
   */
  if (false && safeSnapshot.pending_fulfillment > 0) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.PENDING_FULFILLMENT);
    if (registerSignalType(SIGNAL_IDS.PENDING_FULFILLMENT)) {
      signals.push({
        id: signalId(SIGNAL_IDS.PENDING_FULFILLMENT),
        severity: escalateSeverity('info', detectedAt),
        lifecycle: getLifecycle(SIGNAL_IDS.PENDING_FULFILLMENT),
        detectedAt,
        title: 'Fulfillment backlog',
        impact:
          safeSnapshot.pending_fulfillment === 1
            ? '1 order pending'
            : `${safeSnapshot.pending_fulfillment} orders pending`,

        metadata: {
          queue: 'pending_fulfillment',
          affectedOrders: safeSnapshot.pending_fulfillment,
        },

        batchActions: [
          {
            id: 'start_fulfillment',
            label: 'Fulfill',
            actionType: 'start_fulfillment_batch',
          },
        ],
      });
    }
  };

      /**
   * Payment pending queue
   * ---------------------
   * Orders awaiting payment capture or confirmation.
   *
   * Projection source:
   * orders_operational_control_snapshot.pending_payment
   *
   * NOTE
   * ----
   * This signal exists to ensure all snapshot metrics
   * emitted by reconciliation are represented in the
   * operational signal engine.
   */
  if (false && safeSnapshot.pending_payment > 0) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.PENDING_PAYMENTS);
     if (registerSignalType(SIGNAL_IDS.PENDING_PAYMENTS)) {
      signals.push({
        id: signalId(SIGNAL_IDS.PENDING_PAYMENTS),
        severity: escalateSeverity('warning', detectedAt),
        lifecycle: getLifecycle('pending-payment'),
        detectedAt,

        title: 'Payment pending',

        /**
         * Grammar guard
         * -------------
         * Ensures correct singular/plural operator messaging.
         */
        impact:
          safeSnapshot.pending_payment === 1
            ? '1 order awaiting payment'
            : `${safeSnapshot.pending_payment} orders awaiting payment`,

        metadata: {
          queue: 'pending_payment',
          affectedOrders: safeSnapshot.pending_payment,
        },

        actions: [
          {
            id: 'inspect_pending_payments',
            label: 'Inspect orders',
            actionType: 'open_pending_payment_orders',
          },
        ],
      });
    }
  }

  /**
   * Work queue
   * ----------
   * Orders ready for fulfillment.
   */
  if (false && safeSnapshot.queue_ready_to_ship > 0) {
    const detectedAt = getDetectedAt(SIGNAL_IDS.READY_TO_SHIP);
    if (registerSignalType(SIGNAL_IDS.READY_TO_SHIP)) {
      signals.push({
        id: signalId(SIGNAL_IDS.READY_TO_SHIP),
        severity: escalateSeverity('info', detectedAt),
        lifecycle: getLifecycle(SIGNAL_IDS.READY_TO_SHIP),
        detectedAt,
        title: 'Ready for fulfillment',
        impact:
          safeSnapshot.queue_ready_to_ship === 1
            ? '1 order awaiting fulfillment'
            : `${safeSnapshot.queue_ready_to_ship} orders awaiting fulfillment`,

        metadata: {
          queue: 'ready_to_ship',
          affectedOrders: safeSnapshot.queue_ready_to_ship,
        },

        batchActions: [
          /**
           * Generate pick list
           * ------------------
           * Warehouse picking must occur BEFORE
           * label generation to prevent shipment mix-ups.
           */
          {
            id: 'generate_pick_list',
            label: 'Generate pick list',
            actionType: 'generate_pick_list',
          },
        ],
      });
    }
  }

  /**
   * Resolve signals that disappeared from snapshot
   *
   * Signals that no longer appear in the snapshot
   * are considered operationally resolved.
   */
  for (const key of signalDetectionRegistry.keys()) {

    if (!activeSignalTypes.has(key)) {

      /**
       * Mark signal as resolved before cleanup
       * to preserve lifecycle telemetry.
       */
      signalLifecycleRegistry.set(key, 'RESOLVED');
      signalResolvedAtRegistry.set(key, evaluationTime);

      /**
       * Detection timestamp can be cleared once resolved.
       * Lifecycle state is intentionally preserved so
       * resolution events remain observable.
       */
      signalDetectionRegistry.delete(key);
    }
  }

  /**
   * Prune resolved lifecycle entries after 10 minutes
   * to prevent unbounded registry growth.
   */
  const RESOLUTION_RETENTION_MS = 10 * 60 * 1000;

  /**
   * Lifecycle registry pruning
   * --------------------------
   * Removes resolved signal lifecycle entries after the
   * retention window expires.
   *
   * Instrumentation is included so operators can observe
   * cleanup activity during runtime diagnostics.
   */
  let prunedEntries = 0;

  for (const [key, resolvedAt] of signalResolvedAtRegistry.entries()) {
    if (evaluationTime - resolvedAt > RESOLUTION_RETENTION_MS) {
      signalResolvedAtRegistry.delete(key);
      signalLifecycleRegistry.delete(key);
      prunedEntries++;
    }
  }

  /**
   * Emit pruning telemetry only when work occurred
   * to avoid console noise during normal operation.
   */
  if (prunedEntries > 0) {
    console.info(
      `[OperationalSignals] lifecycle cleanup pruned ${prunedEntries} entries`
    );
  }

  /**
   * Operational priority ordering
   *
   * Signals are sorted after all transformations
   * (lifecycle, escalation, timestamps) to ensure
   * queue reflects final operational severity.
   */
  const severityPriority: Record<OperationalSignalSeverity, number> = {
    critical: 1,
    warning: 2,
    info: 3,
  };

  signals.sort((a, b) => {

    const severityDiff =
      severityPriority[a.severity] - severityPriority[b.severity];

    if (severityDiff !== 0) {
      return severityDiff;
    }

    const ageDiff =
      new Date(a.detectedAt).getTime() -
      new Date(b.detectedAt).getTime();

    if (ageDiff !== 0) {
      return ageDiff;
    }

    /**
     * Final deterministic tie-breaker.
     *
     * Ensures queue order remains stable even when
     * signals share identical severity and timestamp.
     */
    return a.id.localeCompare(b.id);
  });

  return signals;
}