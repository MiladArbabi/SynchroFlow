/**
 * Operational State Detection
 * ---------------------------
 *
 * Converts raw snapshot metrics into high-level
 * operational states used by the signal engine.
 *
 * IMPORTANT
 * ---------
 * This layer performs NO signal construction.
 *
 * Responsibilities:
 * - Interpret snapshot metrics
 * - Detect operational situations
 * - Return deterministic state flags
 *
 * This enables the signal engine to operate on
 * state clusters instead of individual metrics.
 */

import type { OperationalControlSnapshot } from './types/operationalControlSnapshot.js';

export type OperationalStates = {

  /**
   * Inventory blocking order fulfillment
   */
  inventoryShortage: boolean;

  /**
   * Inventory constraint cluster
   *
   * Represents inventory-driven fulfillment blockage.
   *
   * Derived from:
   * - queue_awaiting_inventory
   * - constrained_orders
   * - partial_fulfillment_opportunity
   */
  inventoryConstraintCluster: boolean;

  /**
   * Orders approaching SLA breach
   */
  slaRisk: boolean;

  /**
   * Orders awaiting manual payment review
   */
  paymentReview: boolean;

  /**
   * Failed payment requiring retry
   */
  paymentProblem: boolean;

  /**
   * Orders blocked by operational constraints
   */
  fulfillmentConstraint: boolean;

  /**
   * Orders stuck beyond normal fulfillment window
   */
  agingOrders: boolean;

  /**
   * System or fulfillment exceptions detected
   */
  operationalException: boolean;

  /**
   * Orders waiting on customer input
   */
  awaitingCustomer: boolean;

  /**
   * Early aging signal (24h)
   */
  earlyAging: boolean;
};

/**
 * Detect operational states from snapshot metrics.
 *
 * This function must remain deterministic.
 * No time-based logic or side effects allowed.
 */
export function detectOperationalStates(
  snapshot: OperationalControlSnapshot
  
): OperationalStates {

  return {

    inventoryShortage:
      snapshot.queue_awaiting_inventory > 0,

    inventoryConstraintCluster:
      snapshot.queue_awaiting_inventory > 0 ||
      snapshot.constrained_orders > 0 ||
      snapshot.partial_fulfillment_opportunity > 0,

    slaRisk:
      snapshot.orders_at_sla_risk > 0,

    paymentReview:
      snapshot.queue_manual_review > 0,

    paymentProblem:
      snapshot.pending_payment > 0,

    fulfillmentConstraint:
      snapshot.constrained_orders > 0,

    agingOrders:
      snapshot.aging_48h > 0 ||
      snapshot.aging_72h_plus > 0,

    operationalException:
      snapshot.exception_orders > 0,

    awaitingCustomer:
      snapshot.queue_awaiting_customer > 0,

    earlyAging:
      snapshot.aging_24h > 0
  };
}