// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { PlanGate } from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { INVENTORY_MODULE_TABS } from './inventoryModuleTabs';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    // TIER GATE: demand.forecasting requires 'growth' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="demand.forecasting">
      <ModuleTabBar tabs={INVENTORY_MODULE_TABS} />
      <DemandModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        currency={{ displayCurrency, locale, rates }}
      />
    </PlanGate>
  );
}