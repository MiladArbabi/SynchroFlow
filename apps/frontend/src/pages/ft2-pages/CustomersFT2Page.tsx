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
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { PlanGate } from '../../components/PlanGate';

export default function CustomersFT2Page() {
  const ltvQuery = useCustomerLtv();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    // TIER GATE: customers.ltv requires 'growth' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="customers.ltv">
      <CustomersModuleFT2
        ltv={ltvQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
      />
    </PlanGate>
  );
}