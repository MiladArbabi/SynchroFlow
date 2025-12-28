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
import { OrderNexusDiagnosticCard } from '../components/OrderNexusDiagnosticCard';
import type { OrderNexusUiIntent } from '../intents';

export interface OrdersModuleProps {
  ordersIngested: number | null;
  hasNegativeMarginOrder: boolean;
  missingCostCount: number;
  onIntent?: (intent: OrderNexusUiIntent) => void;
}

export default function OrdersModule(props: OrdersModuleProps) {
  const scenario = useOrdersFt1Scenario(props);
  console.debug('[FT1][OrderNexus][Scenario]', scenario);

  console.debug('[FT1][OrderNexus][OrdersModule] props', {
    ordersIngested: props.ordersIngested,
    hasNegativeMarginOrder: props.hasNegativeMarginOrder,
    missingCostCount: props.missingCostCount,
  });

  const emitStartOnboarding = (taskId?: string) => {
    console.debug('[OrdersModule] emitStartOnboarding', taskId);
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'NO_ORDERS':
      return (
        <OrderNexusDiagnosticCard
          testId="orders-ft1-no-orders"
          title="No orders detected yet"
          message="We haven’t recorded any orders for this store. Once orders are synced, we can evaluate profitability risks."
          ctaLabel={props.onIntent ? "Sync orders" : undefined}
          onCtaClick={props.onIntent 
            ? () => emitStartOnboarding('connect-store') 
            : undefined
          }
        />
      );

    case 'LOSS':
      return (
        <OrderNexusDiagnosticCard
          testId="orders-ft1-loss"
          title="Profitability risk detected"
          message="One or more orders appear to be losing money based on current cost and revenue data."
          ctaLabel={props.onIntent ? "Review profitability setup" : undefined}
          onCtaClick={props.onIntent 
            ? () => emitStartOnboarding('verify-costs') 
            : undefined
          }
        />
      );

    case 'UNCERTAIN':
      return (
        <OrderNexusDiagnosticCard
          testId="orders-ft1-uncertain"
          title="Profitability cannot be determined yet"
          message="Some orders are missing cost information, which prevents accurate margin calculations."
          ctaLabel={props.onIntent ? "Complete cost setup" : undefined}
          onCtaClick={props.onIntent 
            ? () => emitStartOnboarding('add-costs') 
            : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <OrderNexusDiagnosticCard
          testId="orders-ft1-healthy"
          title="Orders look healthy"
          message="No negative margins were detected in the available order data. We’ll continue monitoring as new orders come in."
        />
      );

    case 'LOADING':
      return (
        <OrderNexusDiagnosticCard
          testId="orders-ft1-loading"
          title="Analyzing order data…"
          message="We’re validating order data to determine profitability signals."
        />
      );
  }
}