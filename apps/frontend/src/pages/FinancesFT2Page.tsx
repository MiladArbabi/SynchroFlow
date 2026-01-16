// apps/frontend/src/pages/FinancesFT2Page.tsx
//
// FinancesFT2Page
// ---------------
// FT2-only Finances observability surface.

import { useState } from 'react';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';

import { FinancesModuleFT2 } from '@lasyncro/finances';
import { useFinancesFt2Snapshot } from './finances/useFinancesFt2Snapshot';
import { mapFinancesFt2Props } from './finances/useFinancesFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function FinancesFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_7_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useFinancesFt2Snapshot(range);

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

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <FinancesModuleFT2 {...props} />
    </>
  );
}
