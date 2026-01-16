// apps/frontend/src/pages/CustomersFT2Page.tsx
//
// CustomersFT2Page
// ----------------
// FT2-only Customers observability surface.
//
// HARD CONTRACT:
// - MUST render CustomersModuleFT2 only
// - MUST NOT render FT1 modules
// - MUST NOT infer lifecycle
// - MUST assume FT2 routing is authoritative

import { CustomersModuleFT2 } from '@lasyncro/customers';
import { useCustomersFt2Snapshot } from './customers/useCustomersFt2Snapshot';
import { mapCustomersFt2Props } from './customers/useCustomersFt2Adapter';

import { useState } from 'react';
import { FT2DateRange, FT2DateRangeBar } from '@lasyncro/ui-ft2';

const __DEV__ = import.meta.env.DEV;

export default function CustomersFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_7_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useCustomersFt2Snapshot(range);

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[CustomersFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading customer insights…</div>;
  }

  const props = mapCustomersFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[CustomersFT2Page] rendering CustomersModuleFT2', props);
  }

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <CustomersModuleFT2 {...props} />
    </>
  );
}