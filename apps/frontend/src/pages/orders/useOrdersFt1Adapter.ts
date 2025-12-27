/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/orders/useOrdersFt1Adapter.ts

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import type { OrdersModuleProps } from '@lasyncro/order-nexus';

/**
 * FT1 Orders Adapter
 * ------------------
 * Pure mapping layer:
 * onboarding-readiness API → OrdersModuleProps
 *
 * NO business logic
 * NO scenario inference
 * NO lifecycle interpretation
 */

export function useOrdersFt1Adapter(
  enabled: boolean,
  shopId: number
): OrdersModuleProps {
  const query = useOnboardingReadiness(enabled, shopId);
    
  const data = query.data;
  const orderModule = data?.modules?.find(
    (m: any) => m.moduleId === 'order-nexus'
  );

  const signals = orderModule?.signals ?? [];

  const get = (name: string) =>
  signals.find((s: any) => s.name === name)?.value;

  const ordersKnown = get('orderNexus.ordersKnown') === true;
  const rawOrders = get('orderNexus.ordersIngested');

  const ordersIngested =
    !ordersKnown || rawOrders === undefined
      ? null
      : Number(rawOrders);

  const props: OrdersModuleProps = {
    ordersIngested,
    missingCostCount: Number(get('orderNexus.missingCostCount') ?? 0),
    hasNegativeMarginOrder: Boolean(
      get('orderNexus.hasNegativeMarginOrder') ?? false
    ),
  };

  if (import.meta.env.DEV) {
    console.debug('[OrdersFT1Adapter]', {
      ordersKnown,
      rawOrders,
      ordersIngested,
    });
  }

  if (import.meta.env.DEV) {
      console.debug('[OrdersFT1Adapter] raw readiness data', data);

    if (!orderModule) {
      console.warn('[OrdersFT1Adapter] order-nexus module missing', {
        modules: data?.modules?.map((m: any) => m.moduleId),
      });
    } else {
      console.debug('[OrdersFT1Adapter] resolved props', props);
    }
  }

  if (import.meta.env.DEV) {
    console.debug('[OrdersFT1Adapter] query state', {
        enabled,
        shopId,
        status: query.status,
        isFetching: query.isFetching,
        isError: query.isError,
        data: query.data,
    });
    }

  return props;
}
