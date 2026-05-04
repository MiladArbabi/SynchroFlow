// apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx
import { CashFlowModuleFT2 } from '@lasyncro/cashflow';
import { useCashFlow } from '../finances/useCashFlow';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { PlanGate } from '../../components/PlanGate';

export default function CashFlowPage() {
  const { data, isLoading, isError } = useCashFlow();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    // TIER GATE: cashflow.revenue_buckets requires 'core' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="cashflow.revenue_buckets">
      <CashFlowModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        currency={{ displayCurrency, locale, rates }}
      />
    </PlanGate>
  );
}