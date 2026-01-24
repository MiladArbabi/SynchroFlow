// apps/frontend/src/pages/OrdersPage.tsx
//
// OrdersPage
// ----------
// Lifecycle-agnostic Orders surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT render FT2 modules
// - FT2 routing is handled exclusively at the router level
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Remain silent about lifecycle state in user-facing UI

import { OrdersModule } from '@lasyncro/order-nexus';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { mapOrdersFt1Props } from '../orders/useOrdersFt1Adapter';
import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function OrdersPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   */
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  /**
   * Intents (side-effects)
   * ----------------------
   * Always instantiated; no lifecycle branching allowed.
   */
  const onIntent = useOrderNexusAhaAdapter();

  /**
   * FT1 data gating
   * ---------------
   * Lifecycle validity is assumed if this page is mounted.
   */
  const ft1Enabled = !!shopId;

  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * Missing shopId
   * --------------
   * Not a lifecycle error.
   */
  if (!shopId) {
    return <div>Orders unavailable</div>;
  }

  /**
   * FT1 loading
   * -----------
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[OrdersPage][FT1] awaiting onboarding readiness');
    }

    return <div>Loading orders…</div>;
  }

  /**
   * FT1 rendering path
   * ------------------
   */
  const ordersProps = mapOrdersFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[OrdersPage][FT1] rendering OrdersModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <OrdersModule
      {...ordersProps}
      onIntent={onIntent}
    />
  );
}