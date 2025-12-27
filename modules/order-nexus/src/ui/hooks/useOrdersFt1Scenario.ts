//apps/frontend/src/modules/orders/hooks/useOrdersFt1Scenario.ts
export type OrdersFt1Scenario =
  | 'NO_ORDERS'
  | 'LOSS'
  | 'UNCERTAIN'
  | 'HEALTHY';

type UseOrdersFt1ScenarioInput = {
  ordersIngested: number;
  hasNegativeMarginOrder: boolean;
  missingCostCount: number;
};

export function useOrdersFt1Scenario(
  input: UseOrdersFt1ScenarioInput,
): OrdersFt1Scenario {
  const { ordersIngested, hasNegativeMarginOrder, missingCostCount } = input;

  if (ordersIngested === 0) return 'NO_ORDERS';
  if (hasNegativeMarginOrder === true) return 'LOSS';
  if (missingCostCount > 0) return 'UNCERTAIN';
  return 'HEALTHY';
}
