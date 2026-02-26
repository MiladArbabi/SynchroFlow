// apps/frontend/src/pages/orders/useOrdersPriorityStack.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * Decision Layer — Priority Stack
 * --------------------------------
 * Contract:
 * - Direct passthrough of backend ordering
 * - No sorting
 * - No inference
 * - Backend is authoritative
 */

export type OrderPriorityRow = {
  order_id: string;
  order_health_score: number;
  is_inventory_blocked: boolean;
  is_customer_blocked: boolean;
  is_operational_blocked: boolean;
  is_at_risk: boolean;
  fraud_score: string | null;
  return_probability: string | null;
  evaluated_at: string;
};

export function useOrdersPriorityStack() {
  return useQuery<OrderPriorityRow[]>({
    queryKey: ['orders', 'decision', 'priority-stack'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/orders/decision/priority-stack'
      );
      return data;
    },
  });
}