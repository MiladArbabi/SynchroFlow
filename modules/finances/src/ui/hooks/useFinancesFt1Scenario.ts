//modules/finances/src/ui/hooks/useFinancesFt1Scenario.ts
export type FinancesFt1Scenario =
  | 'LOADING'
  | 'NO_BASE_DATA'
  | 'PARTIAL_DATA'
  | 'HEALTHY';

type UseFinancesFt1ScenarioInput = {
  orderCount: number | null;
  productCount: number | null;
  baseSignalsReady: boolean | null;
};

export function useFinancesFt1Scenario(
  input: UseFinancesFt1ScenarioInput
): FinancesFt1Scenario {
  const { orderCount, productCount, baseSignalsReady } = input;

  if (orderCount === null || productCount === null || baseSignalsReady === null) {
    return 'LOADING';
  }

  if (orderCount === 0 || productCount === 0) {
    return 'NO_BASE_DATA';
  }

  if (!baseSignalsReady) {
    return 'PARTIAL_DATA';
  }

  return 'HEALTHY';
}