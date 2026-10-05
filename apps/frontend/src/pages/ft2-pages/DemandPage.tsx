// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useSearchParams } from 'react-router-dom';
import useConfig from '../../hooks/useConfig';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { CommercialGate } from '../../components/CommercialGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { INVENTORY_MODULE_TABS } from './inventoryModuleTabs';

export default function DemandPage() {
  const { state: { isOpsConsoleOpen } } = useConfig();
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const [searchParams] = useSearchParams();

  // Overview stock-risk decisions deep-link with ?filter=critical.
  // Honor that intent by showing only critical reorder items on arrival.
  const reorderUrgencyFilter =
    searchParams.get('filter') === 'critical' ? 'critical' : undefined;

  return (
    // COMMERCIAL-ACCESS-ARCH-01 P0-A2B: migrated from PlanGate to the
    // canonical demand.forecasting capability (Growth+) — same behaviour,
    // decision now comes from the shared commercial adapter.
    <CommercialGate capabilityId="demand.forecasting">
      <ModuleTabBar tabs={INVENTORY_MODULE_TABS} />
      <DemandModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        currency={{ displayCurrency, locale, rates}}
        reorderUrgencyFilter={reorderUrgencyFilter}
        suppressReplenishmentState={isOpsConsoleOpen}
      />
    </CommercialGate>
  );
}
