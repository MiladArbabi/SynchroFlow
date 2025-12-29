// modules/products/src/ui/pages/ProductsPage.tsx

import { useProductsFt1Scenario } from '../hooks/useProductsFt1Scenario';
import { ProductsDiagnosticCard } from '../components/ProductsDiagnosticCard';

export interface ProductsModuleProps {
  productCount: number | null;
}

export default function ProductsModule(props: ProductsModuleProps) {
  const scenario = useProductsFt1Scenario({
    productCount: props.productCount,
  });

  switch (scenario) {
    case 'LOADING':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-loading"
          title="Analyzing product data…"
          message="We’re checking whether product information is available for this store."
        />
      );

    case 'NO_PRODUCTS':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-no-products"
          title="No products detected"
          message="We haven’t detected any products for this store. Once products are synced, SKU intelligence becomes available."
        />
      );

    case 'HEALTHY':
      return (
        <ProductsDiagnosticCard
          testId="products-ft1-healthy"
          title="Products are available"
          message="Your product catalog is available. SKU-level intelligence is ready to use."
        />
      );
  }
}
