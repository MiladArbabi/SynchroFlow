// apps/frontend/src/pages/ProductsFT2Page.tsx
//
// ProductsFT2Page
// ---------------
// FT2-only Products observability surface.

import { ProductsModuleFT2 } from '@lasyncro/products';
import { useProductsFt2Snapshot } from './products/useProductsFt2Snapshot';
import { mapProductsFt2Props } from './products/useProductsFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function ProductsFT2Page() {
  const snapshotQuery = useProductsFt2Snapshot(true);

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

  return <ProductsModuleFT2 {...props} />;
}