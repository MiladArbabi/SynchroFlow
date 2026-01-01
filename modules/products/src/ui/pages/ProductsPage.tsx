// modules/products/src/ui/pages/ProductsPage.tsx

import { useProductsFt1Scenario } from '../hooks/useProductsFt1Scenario';
import { ProductsDiagnosticCard } from '../components/ProductsDiagnosticCard';

export interface ProductsModuleProps {
  productCount: number | null;
  productHealthEvents: number | null;
  excludedProductCount: number | null;
  onIntent?: (intent: ProductsUiIntent) => void;
}

export type ProductsUiIntent = {
  type: 'START_ONBOARDING';
  taskId?:
    | 'add-products'
    | 'complete-product-data'
    | 'review-product-readiness';
};

export default function ProductsModule(props: ProductsModuleProps) {
  const scenario = useProductsFt1Scenario({
    productCount: props.productCount,
    productHealthEvents: props.productHealthEvents,
    excludedProductCount: props.excludedProductCount,
  });

  const emitStartOnboarding = (taskId?: ProductsUiIntent['taskId']) => {
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {

    case 'NO_PRODUCTS':
      return (
        <ProductsDiagnosticCard
         testId="products-ft1-no-products"
          title="No products available"
          message="Products analyzes product health and risk. To begin, you need products in your catalog."
          ctaLabel={props.onIntent ? 'Add products' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('add-products')
              : undefined
          }
        />
      );

    case 'PRODUCT_DATA_INCOMPLETE':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-incomplete"
          title="Product data incomplete"
          message="Your products are detected, but required data is missing. Until this is completed, product health and risk signals can’t be trusted."
          ctaLabel={props.onIntent ? 'Complete product data' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('complete-product-data')
              : undefined
          }
        />
      );

    case 'PARTIALLY_READY':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-partial"
          title="Product health partially available"
          message="Products can analyze some products, but others are excluded due to missing or unreliable data. Completing setup improves coverage."
          ctaLabel={props.onIntent ? 'Review excluded products' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('review-product-readiness')
              : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-healthy"
          title="Products are ready"
          message="Your product catalog is ready for health and risk analysis. SKU-level intelligence is now available."
        />
      );
  }
}
