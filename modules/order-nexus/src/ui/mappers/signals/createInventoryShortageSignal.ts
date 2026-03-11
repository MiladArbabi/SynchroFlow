/**
 * Inventory Shortage Signal Builder
 * ---------------------------------
 *
 * Constructs the operational signal representing
 * orders blocked due to missing inventory.
 *
 * IMPORTANT
 * ---------
 * This module only builds the signal object.
 * Lifecycle, detection timestamps, and sorting
 * remain controlled by the main signal engine.
 */

import type {
  OperationalSignal,
  OperationalSignalLifecycle,
  OperationalSignalSeverity
} from '../../../contracts/operationalSignals.js';

export function createInventoryShortageSignal(
  snapshot: { queue_awaiting_inventory: number },
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

    title: 'Inventory shortage',

    impact:
      snapshot.queue_awaiting_inventory === 1
        ? '1 order affected'
        : `${snapshot.queue_awaiting_inventory} orders affected`,

    metadata: {
      queue: 'awaiting_inventory',
      affectedOrders: snapshot.queue_awaiting_inventory,
    },

    actions: [
      {
        id: 'inspect_inventory_block',
        label: 'Inspect Orders',
        actionType: 'open_inventory_blocked_orders',
      },
    ],

    batchActions: [
      {
        id: 'notify_supplier',
        label: 'Notify Supplier',
        actionType: 'notify_inventory_supplier',
      },
      {
        id: 'split_shipments',
        label: 'Split shipments',
        actionType: 'split_shipments',
      },
    ],
  };
}