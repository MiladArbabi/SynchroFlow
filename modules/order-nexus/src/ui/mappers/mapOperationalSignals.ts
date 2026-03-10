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

export type OperationalControlSnapshot = {
  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;
  orders_at_sla_risk: number;
  pending_fulfillment: number;
};

/**
 * Signal detection registry
 *
 * Maintains first detection timestamp for
 * operational signal clusters.
 *
 * This prevents signal age from resetting
 * on every snapshot refresh.
 */
const signalDetectionRegistry = new Map<string, string>();

/**
 * Lifecycle registry
 *
 * Preserves lifecycle state across snapshot refreshes
 * while a signal remains active.
 */
const signalLifecycleRegistry = new Map<string, OperationalSignalLifecycle>();

/**
 * Tracks when signals entered RESOLVED state.
 * Used to prune lifecycle registry after a safe window.
 */
const signalResolvedAtRegistry = new Map<string, number>();

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
  const current = signalLifecycleRegistry.get(type);

  const order = {
    NEW: 1,
    ACKNOWLEDGED: 2,
    IN_PROGRESS: 3,
    RESOLVED: 4,
  };

  if (!current || order[lifecycle] >= order[current]) {
    signalLifecycleRegistry.set(type, lifecycle);
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
   * Prevents repeated console warnings for the same metric issue.
   */
  const metricWarningRegistry = new Set<string>();

  /**
   * Prevent diagnostic registry from growing indefinitely.
   */
  const MAX_WARNING_REGISTRY_SIZE = 100;

  /**
   * Emits a warning once per unique key.
   * Registry size is bounded to prevent memory growth.
   */
  function warnOnce(key: string, message: string, payload: unknown) {

    if (metricWarningRegistry.has(key)) return;

    if (metricWarningRegistry.size >= MAX_WARNING_REGISTRY_SIZE) {
      metricWarningRegistry.clear();
    }

    metricWarningRegistry.add(key);

    console.warn(message, payload);
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
  };

  const signals: OperationalSignal[] = [];

  /**
   * Tracks signal types present in this snapshot.
   */
  const activeSignalTypes = new Set<string>();

  /**
   * Ensures a signal type is only emitted once per snapshot.
   * Prevents accidental duplicate signals during mapper evolution.
   */
  function registerSignalType(type: string): boolean {
    if (activeSignalTypes.has(type)) {
      return false;
    }

    activeSignalTypes.add(type);
    return true;
  }

  /**
   * Returns stable detection timestamp for a signal type.
   */
  function getDetectedAt(type: string): string {
    if (!signalDetectionRegistry.has(type)) {
      signalDetectionRegistry.set(type, new Date().toISOString());
    }

    return signalDetectionRegistry.get(type)!;
  }

  /**
   * Returns stable lifecycle state for a signal.
   */
  function getLifecycle(type: string): OperationalSignalLifecycle {
    if (!signalLifecycleRegistry.has(type)) {
      signalLifecycleRegistry.set(type, 'NEW');
    }

    return signalLifecycleRegistry.get(type)!;
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

  const ageMinutes =
    (evaluationTime - new Date(detectedAt).getTime()) / 60000;

  if (severity === 'info' && ageMinutes >= 15) {
    return 'warning';
  }

  if (severity === 'warning' && ageMinutes >= 30) {
    return 'critical';
  }

  return severity;
}

  /**
   * Stable signal identity
   *
   * Signals represent operational clusters,
   * not individual events. Therefore the ID
   * must remain stable across snapshots so
   * React reconciliation and UI state remain stable.
   */
  function signalId(type: string) {
    return type;
  }

  /**
   * Critical incident
   * -----------------
   * Inventory blocking order fulfillment.
   */
  if (safeSnapshot.queue_awaiting_inventory > 0) {
    const detectedAt = getDetectedAt('inventory-shortage');
      /**
       * Emit signal only on first registration.
       * registerSignalType() returns TRUE when the signal
       * type has not yet been emitted during this snapshot cycle.
       */
      if (registerSignalType('inventory-shortage')) {
        signals.push({
        id: signalId('inventory-shortage'),
        severity: escalateSeverity('critical', detectedAt),
        detectedAt,
        lifecycle: getLifecycle('inventory-shortage'),
        title: 'Inventory shortage',
        impact:
          safeSnapshot.queue_awaiting_inventory === 1
            ? '1 order affected'
            : `${safeSnapshot.queue_awaiting_inventory} orders affected`,

        /**
         * Metadata enables progressive disclosure inside the
         * Operations Queue surface.
         */
        metadata: {
          queue: 'awaiting_inventory',
          affectedOrders: safeSnapshot.queue_awaiting_inventory,
        },

        /**
         * Inline actions operate on a single signal cluster.
         */
        actions: [
          {
            id: 'inspect_inventory_block',
            label: 'Inspect Orders',
            actionType: 'open_inventory_blocked_orders',
          },
        ],

        /**
         * Batch actions operate on multiple underlying orders.
         */
        batchActions: [
          {
            id: 'notify_supplier',
            label: 'Notify Supplier',
            actionType: 'notify_inventory_supplier',
          },
        ],
      });
    }
  }

  /**
   * Operational bottleneck
   * ----------------------
   * Orders approaching SLA breach.
   */
  if (safeSnapshot.orders_at_sla_risk > 0) {
    const detectedAt = getDetectedAt('sla-risk');
    if (registerSignalType('sla-risk')) {
      signals.push({
        id: signalId('sla-risk'),
        severity: escalateSeverity('warning', detectedAt),
        detectedAt,
        lifecycle: getLifecycle('sla-risk'),
        title: 'SLA risk',
        impact: `${safeSnapshot.orders_at_sla_risk} orders nearing deadline`,

        metadata: {
          queue: 'sla_risk',
          affectedOrders: safeSnapshot.orders_at_sla_risk,
        },

        actions: [
          {
            id: 'inspect_sla_orders',
            label: 'Review orders',
            actionType: 'open_sla_risk_orders',
          },
        ],

        batchActions: [
          {
            id: 'prioritize_orders',
            label: 'Prioritize fulfillment',
            actionType: 'prioritize_orders',
          },
        ],
      });
    }
  }

  /**
   * Payment / fraud review queue
   */
  if (safeSnapshot.queue_manual_review > 0) {
    const detectedAt = getDetectedAt('payment-review');
    if (registerSignalType('payment-review')) {
      signals.push({
        id: signalId('payment-review'),
        severity: escalateSeverity('warning', detectedAt),
        lifecycle: getLifecycle('payment-review'),
        detectedAt,
        title: 'Payment / fraud review',
        impact: `${safeSnapshot.queue_manual_review} orders awaiting verification`,

        metadata: {
          queue: 'manual_review',
          affectedOrders: safeSnapshot.queue_manual_review,
        },

        actions: [
          {
            id: 'review_payments',
            label: 'Review orders',
            actionType: 'open_manual_review_orders',
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
  if (safeSnapshot.queue_ready_to_ship > 0) {
    const detectedAt = getDetectedAt('ready-to-ship');
    if (registerSignalType('ready-to-ship')) {
      signals.push({
        id: signalId('ready-to-ship'),
        severity: escalateSeverity('info', detectedAt),
        lifecycle: getLifecycle('ready-to-ship'),
        detectedAt,
        title: 'Ready to ship',
        impact: `${safeSnapshot.queue_ready_to_ship} orders awaiting fulfillment`,

        metadata: {
          queue: 'ready_to_ship',
          affectedOrders: safeSnapshot.queue_ready_to_ship,
        },

        batchActions: [
          {
            id: 'print_labels',
            label: 'Print labels',
            actionType: 'print_shipping_labels',
          },
        ],
      });
    }
  }

  /**
   * Customer dependency
   */
  if (safeSnapshot.queue_awaiting_customer > 0) {
    const detectedAt = getDetectedAt('awaiting-customer');
    if (registerSignalType('awaiting-customer')) {
      signals.push({
        id: signalId('awaiting-customer'),
        severity: escalateSeverity('info', detectedAt),
        lifecycle: getLifecycle('awaiting-customer'),
        detectedAt,
        title: 'Awaiting customer',
        impact: `${safeSnapshot.queue_awaiting_customer} orders waiting on response`,

        metadata: {
          queue: 'awaiting_customer',
          affectedOrders: safeSnapshot.queue_awaiting_customer,
        },

        actions: [
          {
            id: 'contact_customer',
            label: 'Contact customer',
            actionType: 'contact_customer',
          },
        ],
      });
    }
  }

  /**
   * Fulfillment backlog
   */
  if (safeSnapshot.pending_fulfillment > 0) {
    const detectedAt = getDetectedAt('pending-fulfillment');
    if (registerSignalType('pending-fulfillment')) {
      signals.push({
        id: signalId('pending-fulfillment'),
        severity: escalateSeverity('info', detectedAt),
        lifecycle: getLifecycle('pending-fulfillment'),
        detectedAt,
        title: 'Pending fulfillment',
        impact: `${safeSnapshot.pending_fulfillment} orders`,

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

  for (const [key, resolvedAt] of signalResolvedAtRegistry.entries()) {
    if (evaluationTime - resolvedAt > RESOLUTION_RETENTION_MS) {
      signalResolvedAtRegistry.delete(key);
      signalLifecycleRegistry.delete(key);
    }
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