// apps/backend/src/services/orders-operator/OrdersOperatorSummary.provider.ts

import { getOrdersOperatorFacts, type OrdersOperatorFacts } from './OrdersOperatorFacts.service.js';

/**
 * OrdersOperatorSummary
 * ---------------------
 * Response contract for GET /api/v1/modules/order-nexus/operator-summary
 *
 * Rules:
 * - No FTEP constraints — this is a direct operator surface
 * - Raw counts and named entities only
 * - Every field must answer a question the operator actually asks
 * - null = data not available (never omit fields)
 */
export interface OrdersOperatorSummary {
  /**
   * Constraint breakdown
   * --------------------
   * How many orders are stuck and by what type.
   * Drives the primary operator action (fix inventory / contact customer / resolve operational).
   */
  constraintCounts: {
    inventory: number;
    customer: number;
    operational: number;
  };

  /**
   * Top blocking type
   * -----------------
   * The single dominant blocker across all constrained orders.
   * Sourced from orders_operational_control_snapshot.top_blocking_type.
   */
  topBlockingType: string | null;

  /**
   * Aging orders (named, actionable)
   * --------------------------------
   * Unfulfilled orders older than 48h — the ones the operator needs to act on today.
   * Includes external order ID for direct lookup in the store.
   */
  agingOrders: Array<{
    lasyncro_order_id: string;
    externalOrderId: string | null;
    ageHours: number;
    isShippingSlaBreached: boolean;
    constraintType: string | null;
  }>;

  /**
   * Queue counts
   * ------------
   * Operational workload — how many orders need what action right now.
   * Sourced from the latest orders_operational_control_snapshot.
   */
  queueCounts: {
    readyToShip: number;
    awaitingInventory: number;
    awaitingCustomer: number;
    manualReview: number;
  };
}

/**
 * getOrdersOperatorSummary
 * ------------------------
 * Orchestrates operator facts into the operator summary response.
 *
 * This provider is intentionally thin — all computation lives in
 * OrdersOperatorFacts.service.ts. This layer only maps the contract.
 */
export async function getOrdersOperatorSummary(
  shopId: number
): Promise<OrdersOperatorSummary> {
  const facts: OrdersOperatorFacts = await getOrdersOperatorFacts(shopId);

  return {
    constraintCounts: facts.constraintCounts,
    topBlockingType: facts.topBlockingType,
    agingOrders: facts.agingOrders,
    queueCounts: facts.queueCounts,
  };
}