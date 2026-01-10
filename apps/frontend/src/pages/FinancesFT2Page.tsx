// apps/frontend/src/pages/FinancesFT2Page.tsx
//
// FinancesFT2Page
// ---------------
// FT2-only Finances observability surface.

import { FinancesModuleFT2 } from '@lasyncro/finances';
import { useFinancesFt2Snapshot } from './finances/useFinancesFt2Snapshot';
import { mapFinancesFt2Props } from './finances/useFinancesFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function FinancesFT2Page() {
  const snapshotQuery = useFinancesFt2Snapshot(true);

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[FinancesFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading finance insights…</div>;
  }

  const props = mapFinancesFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[FinancesFT2Page] rendering FinancesModuleFT2', props);
  }

  return <FinancesModuleFT2 {...props} />;
}