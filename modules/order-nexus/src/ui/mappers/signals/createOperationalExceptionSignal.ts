/**
 * Operational Exception Signal Builder
 * ------------------------------------
 *
 * Constructs the operational signal representing
 * fulfillment or processing anomalies detected
 * by the reconciliation projection.
 *
 * Lifecycle, escalation, and ordering are handled
 * by the main signal engine.
 */

import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

export function createOperationalExceptionSignal(
  snapshot: { exception_orders: number },
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

    title: 'Operational exception detected',

    impact:
      snapshot.exception_orders === 1
        ? '1 order needs intervention'
        : `${snapshot.exception_orders} orders need intervention`,

    metadata: {
      exception_orders: snapshot.exception_orders,
    },

    actions: [
      {
        id: 'inspect_exception_orders',
        label: 'Inspect orders',
        actionType: 'inspect_exception_orders',
      },
    ],

    batchActions: [
      {
        id: 'contact_warehouse',
        label: 'Contact warehouse',
        actionType: 'contact_warehouse',
      },
    ],
  };
}