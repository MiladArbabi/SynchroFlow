// apps/frontend/src/pages/ProductsPage.tsx
import { ProductsModule, ProductsModuleFT2 } from '@lasyncro/products';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { mapProductsFt2Props } from './products/useProductsFt2Adapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';

export default function ProductsPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useProductsAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  if (isFt2) {
    /**
     * FT2 Products wiring
     * ------------------
     * No backend snapshot is wired yet.
     * We intentionally pass an empty snapshot to:
     * - preserve null semantics
     * - exercise the FT2 adapter
     * - avoid inventing data sources
     */
    const ft2Props = mapProductsFt2Props({});
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