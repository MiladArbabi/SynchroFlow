/**
 * SLA Risk Signal Builder
 * -----------------------
 *
 * Constructs the operational signal representing
 * orders approaching fulfillment SLA breach.
 *
 * This module only builds the signal object.
 * Lifecycle, detection timestamps, and ordering
 * remain managed by the signal engine.
 */
import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

export function createSlaRiskSignal(
  snapshot: { orders_at_sla_risk: number },
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

    title: 'SLA risk',

    impact:
      snapshot.orders_at_sla_risk === 1
        ? '1 order nearing deadline'
        : `${snapshot.orders_at_sla_risk} orders nearing deadline`,

    metadata: {
      queue: 'sla_risk',
      affectedOrders: snapshot.orders_at_sla_risk,
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
        actionType: 'prioritize_stuck_orders',
      },
    ],
  };
}