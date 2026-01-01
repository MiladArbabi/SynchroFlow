//modules/finances/src/ui/hooks/useFinancesFt1Scenario.ts
export type FinancesFt1Scenario =
  | 'LOADING'
  | 'NO_TRANSACTIONS'
  | 'NO_COSTS'
  | 'HEALTHY';

type UseFinancesFt1ScenarioInput = {
  transactionCount: number | null;
  costDataReady: boolean | null;
  baseSignalsReady: boolean | null;
};

export function useFinancesFt1Scenario(
  input: UseFinancesFt1ScenarioInput
): FinancesFt1Scenario {
  const { transactionCount, costDataReady, baseSignalsReady } = input;

  if (
    transactionCount === null ||
    costDataReady === null ||
    baseSignalsReady === null
  ) {
    return 'LOADING';
  }

  if (transactionCount === 0) {
    return 'NO_TRANSACTIONS';
  }

  if (!costDataReady) {
    return 'NO_COSTS';
  }

  return 'HEALTHY';
}