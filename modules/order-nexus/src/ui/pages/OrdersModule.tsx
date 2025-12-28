/**
 * OrdersModule — FT1 Diagnostic Surface
 * ------------------------------------
 * Purpose:
 * - Render the first truthful, read-only diagnostic state for Order-Nexus.
 *
 * FT1 Invariants:
 * - No data fetching
 * - No lifecycle awareness
 * - No onboarding logic
 * - No optimization or recommendations
 * - Renders exactly ONE diagnostic message based on scenario
 *
 * Scenario source of truth:
 * - useOrdersFt1Scenario(props)
 *
 * If this file starts "helping" the user, FT1 is broken.
 */

// modules/order-nexus/src/ui/pages/OrdersModule.tsx

import { useOrdersFt1Scenario } from '../hooks/useOrdersFt1Scenario';

export interface OrdersModuleProps {
  ordersIngested: number | null;
  hasNegativeMarginOrder: boolean;
  missingCostCount: number;
}

export default function OrdersModule(props: OrdersModuleProps) {
  const scenario = useOrdersFt1Scenario(props);
  console.debug('[FT1][OrderNexus][Scenario]', scenario);

  console.debug('[FT1][OrderNexus][OrdersModule] props', {
    ordersIngested: props.ordersIngested,
    hasNegativeMarginOrder: props.hasNegativeMarginOrder,
    missingCostCount: props.missingCostCount,
  });

  switch (scenario) {
    case 'NO_ORDERS':
      return (
        <section data-testid="orders-ft1-no-orders">
          No orders have been recorded yet.
        </section>
      );

    case 'LOSS':
      return (
        <section data-testid="orders-ft1-loss">
          At least one order has a negative margin based on current data.
        </section>
      );

    case 'UNCERTAIN':
      return (
        <section data-testid="orders-ft1-uncertain">
          Profitability cannot be determined yet due to missing cost data.
        </section>
      );

    case 'HEALTHY':
      return (
        <section data-testid="orders-ft1-healthy">
          No negative margins detected in the available order data.
        </section>
      );

    case 'LOADING':
      return (
        <section data-testid="orders-ft1-loading">
          Loading orders…
        </section>
      );
  }
}