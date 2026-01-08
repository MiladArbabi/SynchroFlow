// apps/frontend/src/pages/ProductsPage.tsx
import { ProductsModule, ProductsModuleFT2 } from '@lasyncro/products';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { mapProductsFt2Props } from './products/useProductsFt2Adapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';
import { useProductsFt2Snapshot } from './products/useProductsFt2Snapshot';

export default function ProductsPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useProductsAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';

  const enabled = isFt1 && !!shopId;
  const ft2Enabled = isFt2 && !!shopId;

  /**
   * FT2 Products Snapshot (Authoritative)
   * ------------------------------------
   * Hook must be called unconditionally.
   * Fetching is gated via `enabled`.
   */
  const ft2Query = useProductsFt2Snapshot(ft2Enabled);

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  if (isFt2) {
    if (!ft2Query.isSuccess) {
      console.debug('[ProductsPage][FT2] awaiting FT2 snapshot', {
        phase,
        shopId,
      });
      return <div>Loading products…</div>;
    }

   const ft2Props = mapProductsFt2Props(ft2Query.data);

    console.debug('[ProductsPage][FT2] rendering FT2 ProductsModule', {
      snapshot: ft2Query.data,
   });

    return <ProductsModuleFT2 {...ft2Props} />;
  }

  if (!isFt1) {
    return <div>Products not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Products not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading products…</div>;
  }

  const props = mapProductsFt1Props(readinessQuery.data);

  return <ProductsModule {...props} onIntent={onIntent} />;
}