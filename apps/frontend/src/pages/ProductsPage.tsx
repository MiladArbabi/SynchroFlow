// apps/frontend/src/pages/ProductsPage.tsx
import ProductsModule from '@lasyncro/products';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapProductsFt1Props } from './products/useProductsFt1Adapter';
import { useProductsAhaAdapter } from 'wiring/productsAhaAdapter';

export default function ProductsPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useProductsAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

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