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
import { useCustomerLtv } from '../customers/useCustomerLtv';

const __DEV__ = import.meta.env.DEV;

export default function CustomersFT2Page() {

  const ltvQuery = useCustomerLtv();

  if (__DEV__) {
    console.debug('[CustomersFT2Page] rendering CustomersModuleFT2');
  }

  return (
    <CustomersModuleFT2
      ltv={ltvQuery.data ?? null}
    />
  );
}