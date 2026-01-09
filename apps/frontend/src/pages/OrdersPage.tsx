// apps/frontend/src/pages/OrdersPage.tsx
//
// OrdersPage
// ----------
// Lifecycle-agnostic Orders surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Render FT1 or FT2 Orders modules based on available data
// - Remain silent about lifecycle state in user-facing UI

import { OrdersModule, OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useOrdersFt2Snapshot } from './orders/useOrdersFt2Snapshot';

import { mapOrdersFt1Props } from './orders/useOrdersFt1Adapter';
import { mapOrdersFt2Props } from './orders/useOrdersFt2Adapter';

import { useOrderNexusAhaAdapter } from 'wiring/orderNexusAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function OrdersPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   * If missing, we render a neutral fallback.
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
   * Data gating
   * -----------
   * Fetching is explicitly gated via booleans.
   * Lifecycle is assumed to be valid if this page is mounted.
   */
  const ft1Enabled = !!shopId;
  const ft2Enabled = !!shopId;

  /**
   * FT2 snapshot (authoritative)
   * -----------------------------
   * Hook MUST be called unconditionally.
   * Fetching is strictly gated via `ft2Enabled`.
   */
  const ft2Query = useOrdersFt2Snapshot(ft2Enabled);

  /**
   * FT1 onboarding readiness
   * ------------------------
   * Used ONLY if FT2 data is not yet available.
   */
  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * FT2 rendering path
   * ------------------
   * FT2 is authoritative when snapshot exists.
   */
  // TEMPORARY: FT2 rendering inferred from snapshot presence.
  // This will be removed once ShopLifecycleGate mounts FT1 vs FT2 page trees explicitly.
  if (ft2Query.isSuccess) {
    if (__DEV__) {
      console.debug('[OrdersPage][FT2] rendering OrdersModuleFT2', {
        snapshot: ft2Query.data,
      });
    }

    const ft2Props = mapOrdersFt2Props(ft2Query.data);
    return <OrdersModuleFT2 {...ft2Props} />;
  }

  /**
   * FT2 loading (silent, neutral)
   * -----------------------------
   */
  if (ft2Query.isLoading) {
    if (__DEV__) {
      console.debug('[OrdersPage][FT2] awaiting snapshot');
    }

    return <div>Loading orders…</div>;
  }

  /**
   * Missing shopId
   * --------------
   * This is NOT a lifecycle error.
   * Render a neutral placeholder.
   */
  if (!shopId) {
    return <div>Orders unavailable</div>;
  }

  /**
   * FT1 readiness loading
   * ---------------------
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