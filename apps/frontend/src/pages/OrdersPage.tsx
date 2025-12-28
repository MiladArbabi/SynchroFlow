//apps/frontend/src/pages/OrdersPage.tsx
import OrdersModule from '@lasyncro/order-nexus';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';

export default function OrdersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useOrderNexusAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  // ---- Rendering gates ONLY ----
  if (!isFt1) {
    return <div>Orders not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Orders not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading orders…</div>;
  }

  const ordersProps = mapOrdersFt1Props(readinessQuery.data);

  return <OrdersModule {...ordersProps} onIntent={onIntent} />;
}
