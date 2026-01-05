//apps/frontend/src/pages/OrdersPage.tsx
import { OrdersModule, OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { mapOrdersFt2Props } from './orders/useOrdersFt2Adapter';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';

export default function OrdersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useOrderNexusAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';

  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  // ---- FT2 routing ----
  if (isFt2) {
    /**
     * FT2 Orders wiring
     * -----------------
     * No backend snapshot is wired yet.
     * We intentionally pass an empty snapshot to:
     * - preserve null semantics
     * - exercise the FT2 adapter
     * - avoid inventing data sources
     */
    const ft2Props = mapOrdersFt2Props({});
    return <OrdersModuleFT2 {...ft2Props} />;
  }

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
