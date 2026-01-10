// apps/frontend/src/pages/ProductsPage.tsx
//
// ProductsPage
// ------------
// Lifecycle-agnostic Products surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - This page MUST NOT render FT2 modules
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Render FT1 Products module only
// - Gate data fetching via explicit booleans
// - Remain silent about lifecycle state in user-facing UI

import { ProductsModule } from '@lasyncro/products';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function ProductsPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   */
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  /**
   * Intents
   * -------
   * Always instantiated; no lifecycle branching allowed.
   */
  const onIntent = useProductsAhaAdapter();

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
    return <div>Products unavailable</div>;
  }

  /**
   * FT1 loading
   * -----------
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[ProductsPage][FT1] awaiting onboarding readiness');
    }

    return <div>Loading products…</div>;
  }

  /**
   * FT1 rendering path
   * ------------------
   */
  const props = mapProductsFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[ProductsPage][FT1] rendering ProductsModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <ProductsModule
      {...props}
      onIntent={onIntent}
    />
  );
}