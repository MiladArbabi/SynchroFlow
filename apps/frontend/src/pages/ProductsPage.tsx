// apps/frontend/src/pages/ProductsPage.tsx
//
// ProductsPage
// ------------
// Lifecycle-agnostic Products surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Render FT1 or FT2 Products modules based on available data
// - Remain silent about lifecycle state in user-facing UI

import { ProductsModule, ProductsModuleFT2 } from '@lasyncro/products';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useProductsFt2Snapshot } from './products/useProductsFt2Snapshot';

import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { mapProductsFt2Props } from './products/useProductsFt2Adapter';

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
   */
  const onIntent = useProductsAhaAdapter();

  /**
   * Data gating
   */
  const ft1Enabled = !!shopId;
  const ft2Enabled = !!shopId;

  /**
   * FT2 snapshot (authoritative)
   */
  const ft2Query = useProductsFt2Snapshot(ft2Enabled);

  /**
   * FT1 onboarding readiness
   */
  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * FT2 rendering path (authoritative)
   */
  if (ft2Query.isSuccess) {
    if (__DEV__) {
      console.debug('[ProductsPage][FT2] rendering ProductsModuleFT2', {
        snapshot: ft2Query.data,
      });
    }

    const ft2Props = mapProductsFt2Props(ft2Query.data);
    return <ProductsModuleFT2 {...ft2Props} />;
  }

  /**
   * FT2 loading (neutral)
   */
  if (ft2Query.isLoading) {
    if (__DEV__) {
      console.debug('[ProductsPage][FT2] awaiting snapshot');
    }
    return <div>Loading products…</div>;
  }

  /**
   * Missing shopId (neutral fallback)
   */
  if (!shopId) {
    return <div>Products unavailable</div>;
  }

  /**
   * FT1 readiness loading
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[ProductsPage][FT1] awaiting onboarding readiness');
    }
    return <div>Loading products…</div>;
  }

  /**
   * FT1 rendering path
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