/**
 * Fulfillment Constraint Signal Builder
 * -------------------------------------
 *
 * Constructs the operational signal representing
 * orders blocked by operational constraints such
 * as inventory, customer issues, or processing
 * blockers detected by reconciliation.
 *
 * Lifecycle, escalation, and queue ordering are
 * handled by the main signal engine.
 */

import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

export function createFulfillmentConstraintSignal(
  snapshot: { constrained_orders: number },
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

    title: 'Orders blocked by constraints',

    impact:
      snapshot.constrained_orders === 1
        ? '1 order blocked by operational constraints'
        : `${snapshot.constrained_orders} orders blocked by operational constraints`,

    metadata: {
      queue: 'constrained_orders',
      affectedOrders: snapshot.constrained_orders,
    },

    actions: [
      {
        id: 'inspect_constrained_orders',
        label: 'Inspect orders',
        actionType: 'inspect_constrained_orders',
      },
    ],
  };
}