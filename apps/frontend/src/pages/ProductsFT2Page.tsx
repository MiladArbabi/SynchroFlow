// apps/frontend/src/pages/ProductsFT2Page.tsx
//
// ProductsFT2Page
// ---------------
// FT2-only Products observability surface.

import { ProductsModuleFT2 } from '@lasyncro/products';
import { useProductsFt2Snapshot } from './products/useProductsFt2Snapshot';
import { mapProductsFt2Props } from './products/useProductsFt2Adapter';
import { useState } from 'react';
import {
  FT2DateRangeBar,
  type FT2DateRange,
} from '@lasyncro/ui-ft2';

const __DEV__ = import.meta.env.DEV;

export default function ProductsFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_7_days',
    from: new Date().toISOString(),
    to: new Date().toISOString(),
  });

  const snapshotQuery = useProductsFt2Snapshot(range);

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[ProductsFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading product insights…</div>;
  }

  const props = mapProductsFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[ProductsFT2Page] rendering ProductsModuleFT2', props);
  }

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <ProductsModuleFT2 {...props} />
    </>
  );
}