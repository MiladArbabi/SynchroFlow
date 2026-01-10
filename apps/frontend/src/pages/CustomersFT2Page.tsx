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

const __DEV__ = import.meta.env.DEV;

export default function CustomersFT2Page() {
  const snapshotQuery = useCustomersFt2Snapshot(true);

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

  return <CustomersModuleFT2 {...props} />;
}