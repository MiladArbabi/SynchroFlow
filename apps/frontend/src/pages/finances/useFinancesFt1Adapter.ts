// apps/frontend/src/finances/useFinancesFt1Adapter.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FinancesModuleProps } from '@lasyncro/finances';

/**
 * FT1 Finances Adapter (LOCKED)
 * --------------------------
 * Pure mapping function:
 * onboarding-readiness payload → FinancesModuleProps
 *
 * - NO hooks
 * - NO lifecycle logic
 * - NO loading logic
 * - NO FT inference
 *
 * Backend is the source of truth.
 */

export function mapFinancesFt1Props(
  readinessData: any
): FinancesModuleProps {
  const financesModule = readinessData?.modules?.find(
    (m: any) => m.moduleId === 'finances'
  );

  const signals = financesModule?.signals ?? [];
  const get = (name: string) =>
    signals.find((s: any) => s.name === name)?.value;

  const transactionCount = get('finances.transactionCount');
  const costDataReady = get('finances.costDataReady');
  const baseSignalsReady = get('finances.baseSignalsReady');

  return {
    transactionCount:
      transactionCount === undefined ? null : Number(transactionCount),
    costDataReady:
      costDataReady === undefined ? null : Boolean(costDataReady),
    baseSignalsReady:
      baseSignalsReady === undefined ? null : Boolean(baseSignalsReady),
  };
}
