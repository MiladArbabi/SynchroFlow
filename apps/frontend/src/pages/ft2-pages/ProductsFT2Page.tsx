// apps/frontend/src/pages/ft2-pages/ProductsFT2Page.tsx
//
// ProductsFT2Page
// ---------------
// Products module — FT2 observability + operator summary surface.
import { ProductsModuleFT2 } from '@lasyncro/products';
import { useProductsFt2Snapshot } from '../products/useProductsFt2Snapshot';
import { mapProductsFt2Props } from '../products/useProductsFt2Adapter';
import { useProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import type { ProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import { useState } from 'react';
import {
  FT2DateRangeBar,
  type FT2DateRange,
} from '@lasyncro/ui-ft2';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';

const __DEV__ = import.meta.env.DEV;

export default function ProductsFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useProductsFt2Snapshot(range);
  const operatorQuery = useProductsOperatorSummary(range);
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[ProductsFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading product insights…</div>;
  }

  const props = mapProductsFt2Props(snapshotQuery.data);
  const operatorSummary: ProductsOperatorSummary | null =
    operatorQuery.isSuccess ? operatorQuery.data : null;

  if (__DEV__) {
    console.debug('[ProductsFT2Page] rendering ProductsModuleFT2', { props, operatorSummary });
  }

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />
      <ProductsModuleFT2 
        {...props}
        operatorSummary={operatorSummary} 
        currency={{ displayCurrency, locale, rates }} />
    </>
  );
}