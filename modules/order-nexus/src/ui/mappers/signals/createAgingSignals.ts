/**
 * Aging Signal Builders
 * ---------------------
 *
 * Constructs operational signals representing
 * orders aging beyond normal fulfillment windows.
 *
 * Two escalation stages exist:
 *
 * 24h  → early warning
 * 48h+ → critical intervention
 *
 * Lifecycle, severity escalation, and ordering
 * remain managed by the signal engine.
 */

import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

/**
 * Early Aging Signal (24h)
 */
export function createEarlyAgingSignal(
  snapshot: { aging_24h: number },
  detectedAt: string,
  lifecycle: OperationalSignalLifecycle,
  severity: OperationalSignalSeverity,
  signalId: string
): OperationalSignal {

  return {
    id: signalId,
    severity,
    detectedAt,
    lifecycle,

    title: 'Orders aging beyond 24h',

    impact:
      snapshot.aging_24h === 1
        ? '1 order aging beyond 24 hours'
        : `${snapshot.aging_24h} orders aging beyond 24 hours`,

    metadata: {
      queue: 'aging_24h',
      affectedOrders: snapshot.aging_24h,
    },

    actions: [
      {
        id: 'inspect_aging_orders',
        label: 'Inspect orders',
        actionType: 'investigate_aging_orders',
      },
    ],
  };
}

/**
 * Critical Aging Signal (>48h)
 */
export function createAgingOrdersSignal(
  snapshot: { aging_48h: number; aging_72h_plus: number },
  detectedAt: string,
  lifecycle: OperationalSignalLifecycle,
  severity: OperationalSignalSeverity,
  signalId: string
): OperationalSignal {

  const affected =
    snapshot.aging_48h + snapshot.aging_72h_plus;

  return {
    id: signalId,
    severity,
    detectedAt,
    lifecycle,

    title: 'Orders unfulfilled > 48 hours',

    impact:
      affected === 1
        ? '1 order unfulfilled > 48 hours'
        : `${affected} orders unfulfilled > 48 hours`,

    metadata: {
      aging_48h: snapshot.aging_48h,
      aging_72h_plus: snapshot.aging_72h_plus,
    },

    actions: [
      {
        id: 'investigate_orders',
        label: 'Investigate orders',
        actionType: 'investigate_orders',
      },
    ],

    batchActions: [
      {
        id: 'prioritize_orders',
        label: 'Prioritize fulfillment',
        actionType: 'investigate_aging_orders',
      },
    ],
  };
}