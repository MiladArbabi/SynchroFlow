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

import type { OperationalSignal } from '../../contracts/operationalSignals.js';

export type OperationalControlSnapshot = {
  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;
  orders_at_sla_risk: number;
  pending_fulfillment: number;
};

export function mapOperationalSignals(
  snapshot: OperationalControlSnapshot
): OperationalSignal[] {

  const signals: OperationalSignal[] = [];

  /**
   * Critical incident
   * -----------------
   * Inventory blocking order fulfillment.
   */
  if (snapshot.queue_awaiting_inventory > 0) {
    signals.push({
    id: 'inventory-shortage',
    severity: 'critical',
    title: 'Inventory shortage',
    impact:
      snapshot.queue_awaiting_inventory === 1
        ? '1 order affected'
        : `${snapshot.queue_awaiting_inventory} orders affected`,

    /**
     * Metadata enables progressive disclosure inside the
     * Operations Queue surface.
     */
    metadata: {
      queue: 'awaiting_inventory',
      affectedOrders: snapshot.queue_awaiting_inventory,
    },

    /**
     * Inline actions operate on a single signal cluster.
     */
    actions: [
      {
        id: 'inspect_inventory_block',
        label: 'Inspect',
        actionType: 'open_inventory_blocked_orders',
      },
    ],

    /**
     * Batch actions operate on multiple underlying orders.
     */
    batchActions: [
      {
        id: 'notify_supplier',
        label: 'Notify',
        actionType: 'notify_inventory_supplier',
      },
    ],
  });
  }

  /**
   * Operational bottleneck
   * ----------------------
   * Orders approaching SLA breach.
   */
  if (snapshot.orders_at_sla_risk > 0) {
    signals.push({
      id: 'sla-risk',
      severity: 'warning',
      title: 'SLA risk',
      impact: `${snapshot.orders_at_sla_risk} orders nearing deadline`,

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
          actionType: 'prioritize_orders',
        },
      ],
    });
  }

  /**
   * Payment / fraud review queue
   */
  if (snapshot.queue_manual_review > 0) {
    signals.push({
      id: 'payment-review',
      severity: 'warning',
      title: 'Payment / fraud review',
      impact: `${snapshot.queue_manual_review} orders awaiting verification`,

      metadata: {
        queue: 'manual_review',
        affectedOrders: snapshot.queue_manual_review,
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

  /**
   * Work queue
   * ----------
   * Orders ready for fulfillment.
   */
  if (snapshot.queue_ready_to_ship > 0) {
    signals.push({
      id: 'ready-to-ship',
      severity: 'info',
      title: 'Ready to ship',
      impact: `${snapshot.queue_ready_to_ship} orders awaiting fulfillment`,

      metadata: {
        queue: 'ready_to_ship',
        affectedOrders: snapshot.queue_ready_to_ship,
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

  /**
   * Customer dependency
   */
  if (snapshot.queue_awaiting_customer > 0) {
    signals.push({
      id: 'awaiting-customer',
      severity: 'info',
      title: 'Awaiting customer',
      impact: `${snapshot.queue_awaiting_customer} orders waiting on response`,

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
    });
  }

  /**
   * Fulfillment backlog
   */
  if (snapshot.pending_fulfillment > 0) {
    signals.push({
      id: 'pending-fulfillment',
      severity: 'info',
      title: 'Pending fulfillment',
      impact: `${snapshot.pending_fulfillment} orders`,

      metadata: {
        queue: 'pending_fulfillment',
        affectedOrders: snapshot.pending_fulfillment,
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

  return signals;
}