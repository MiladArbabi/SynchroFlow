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

   const orderCount = get('finances.orderCount');
  const productCount = get('finances.productCount');
  const baseSignalsReady = get('finances.baseSignalsReady');

  return {
    orderCount: orderCount === undefined ? null : Number(orderCount),
    productCount: productCount === undefined ? null : Number(productCount),
    baseSignalsReady:
      baseSignalsReady === undefined ? null : Boolean(baseSignalsReady),
  };
}
