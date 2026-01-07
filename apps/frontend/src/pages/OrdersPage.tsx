//apps/frontend/src/pages/OrdersPage.tsx
import { OrdersModule, OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { mapOrdersFt2Props } from './orders/useOrdersFt2Adapter';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';
import { useOrdersFt2Snapshot } from './orders/useOrdersFt2Snapshot';

export default function OrdersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useOrderNexusAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';

  const enabled = isFt1 && !!shopId;
  const ft2Enabled = isFt2 && !!shopId;

  /**
   * FT2 Orders Snapshot (Authoritative)
   * ----------------------------------
   * Hook MUST be called unconditionally (React rules).
   * Fetching is gated strictly via `enabled`.
   *
   * Guarantees:
   * - No fetch outside FT2_READY
   * - Backend owns period
   * - No inference or defaults here
   */
  const ft2Query = useOrdersFt2Snapshot(ft2Enabled);

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  // ---- FT2 routing ----
  if (isFt2) {

    if (!ft2Query.isSuccess) {
      console.debug('[OrdersPage][FT2] awaiting FT2 snapshot', {
        phase,
        shopId,
      });
      return <div>Loading orders…</div>;
    }

    const ft2Props = mapOrdersFt2Props(ft2Query.data);

    console.debug('[OrdersPage][FT2] rendering FT2 OrdersModule', {
      snapshot: ft2Query.data,
    });
    
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
