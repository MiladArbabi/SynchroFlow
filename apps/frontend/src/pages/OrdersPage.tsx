// apps/frontend/src/pages/OrdersPage.tsx

import OrdersModule from '@lasyncro/order-nexus';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { useOrdersFt1Adapter } from './orders/useOrdersFt1Adapter';

export default function OrdersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  const isFt1 = phase === 'FT1_READY';
  const enabled = isFt1 && !!shopId;

  // ✅ ALL hooks called unconditionally
  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  const ordersProps = useOrdersFt1Adapter(
    enabled,
    shopId ?? 0
  );

  console.debug('[OrdersPage]', {
    phase,
    shopId,
    enabled,
    readinessStatus: readinessQuery.status,
  });

  // ⬇️ Rendering logic ONLY
  if (!isFt1) {
    return <div>Orders not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Orders not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading orders…</div>;
  }

  return <OrdersModule {...ordersProps} />;
}
