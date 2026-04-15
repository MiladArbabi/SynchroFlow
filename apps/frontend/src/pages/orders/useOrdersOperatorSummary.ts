// apps/frontend/src/pages/orders/useOrdersOperatorSummary.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * OrdersOperatorSummary
 * ---------------------
 * Mirrors the backend OrdersOperatorSummary response contract exactly.
 * See: services/orders-operator/OrdersOperatorSummary.provider.ts
 *
 * Rules:
 * - No inference, no defaults beyond undefined→null
 * - All fields optional to tolerate partial backend responses
 */
export interface OrdersOperatorSummary {
  /**
   * How many orders are stuck by each constraint type.
   * Drives the primary operator action label.
   */
  constraintCounts?: {
    inventory: number;
    customer: number;
    operational: number;
  };

  /**
   * The single dominant blocker across all constrained orders.
   * null = no snapshot available or no active constraints.
   */
  topBlockingType?: string | null;

  /**
   * Unfulfilled orders older than 48h — named and actionable.
   * externalOrderId allows direct lookup in the operator's store.
   */
  agingOrders?: Array<{
    lasyncro_order_id: string;
    externalOrderId: string | null;
    ageHours: number;
    isShippingSlaBreached: boolean;
    constraintType: string | null;
  }>;

  /**
   * Operational workload queues — how many orders need what action.
   * Sourced from the latest orders_operational_control_snapshot.
   */
  queueCounts?: {
    readyToShip: number;
    awaitingInventory: number;
    awaitingCustomer: number;
    manualReview: number;
  };
}

/**
 * useOrdersOperatorSummary
 * ------------------------
 * Fetches the operator summary for the Orders module.
 *
 * Rules:
 * - Loads independently from the FT2 snapshot
 * - Page renders FT2 data immediately; operator data when ready
 * - No params — shop-scoped by auth context on the backend
 * - Read-only, no transformation
 */
export function useOrdersOperatorSummary() {
  return useQuery<OrdersOperatorSummary>({
    queryKey: ['order-nexus', 'operator-summary'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/operator-summary'
      );
      return data;
    },
  });
}