// modules/order-nexus/src/ui/pages/OrdersModule.tsx

import { useOrdersFt1Scenario } from '../hooks/useOrdersFt1Scenario';

export interface OrdersModuleProps {
  ordersIngested: number;
  hasNegativeMarginOrder: boolean;
  missingCostCount: number;
}

export default function OrdersModule(props: OrdersModuleProps) {
  const scenario = useOrdersFt1Scenario(props);
  console.debug('[OrdersModule] props', props);

  switch (scenario) {
    case 'NO_ORDERS':
      return <section data-testid="orders-ft1-no-orders">No orders yet</section>;
    case 'LOSS':
      return <section data-testid="orders-ft1-loss">Loss detected</section>;
    case 'UNCERTAIN':
      return <section data-testid="orders-ft1-uncertain">Missing costs</section>;
    case 'HEALTHY':
      return <section data-testid="orders-ft1-healthy">Orders healthy</section>;
  }
}