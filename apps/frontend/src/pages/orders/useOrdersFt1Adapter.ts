//apps/frontend/src/pages/orders/useOrdersFt1Adapter.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { OrdersModuleProps } from '@lasyncro/order-nexus';

/**
 * FT1 Orders Adapter (LOCKED)
 * --------------------------
 * Pure mapping function:
 * onboarding-readiness payload → OrdersModuleProps
 *
 * - NO hooks
 * - NO lifecycle logic
 * - NO loading logic
 * - NO FT inference
 *
 * Backend is the source of truth.
 */

export function mapOrdersFt1Props(
  readinessData: any
): OrdersModuleProps {
  const orderModule = readinessData?.modules?.find(
    (m: any) => m.moduleId === 'order-nexus'
  );

  const signals = orderModule?.signals ?? [];
  const get = (name: string) =>
    signals.find((s: any) => s.name === name)?.value;

  /* const ordersKnown = get('orderNexus.ordersKnown') === true; */
  const rawOrders = get('orderNexus.ordersIngested');

  return {
    ordersIngested:
      rawOrders === undefined ? null : Number(rawOrders),

    missingCostCount: Number(get('orderNexus.missingCostCount') ?? 0),

    hasNegativeMarginOrder: Boolean(
      get('orderNexus.hasNegativeMarginOrder') ?? false
    ),
  };
}