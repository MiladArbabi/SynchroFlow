/**
 * Awaiting Customer Signal Builder
 * --------------------------------
 *
 * Constructs the operational signal representing
 * orders blocked because customer action is required.
 *
 * Lifecycle, escalation, and ordering remain
 * controlled by the signal engine.
 */

import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

export function createAwaitingCustomerSignal(
  snapshot: { queue_awaiting_customer: number },
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

    title: 'Awaiting customer response',

    impact:
      snapshot.queue_awaiting_customer === 1
        ? '1 order blocked'
        : `${snapshot.queue_awaiting_customer} orders blocked`,

    metadata: {
      queue: 'awaiting_customer',
      affectedOrders: snapshot.queue_awaiting_customer,
    },

    actions: [
      {
        id: 'contact_customer',
        label: 'Contact customer',
        actionType: 'contact_customer',
      },
    ],
  };
}