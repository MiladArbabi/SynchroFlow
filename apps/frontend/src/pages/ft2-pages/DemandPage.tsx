// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { PlanGate } from '../../components/PlanGate';
import { useWarehouseGrid, useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const { data: gridData } = useWarehouseGrid();
  const { data: occupancyData } = useWarehouseGridOccupancy(!!gridData);

  return (
    // TIER GATE: demand.forecasting requires 'growth' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="demand.forecasting">
      <DemandModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        currency={{ displayCurrency, locale, rates }}
        gridLocations={gridData?.locations}
        gridOccupancy={occupancyData?.occupancy}
      />
    </PlanGate>
  );
}