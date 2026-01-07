import { SpecterModule } from '@lasyncro/specter';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
import { useSpecterAhaAdapter } from 'wiring/specterAhaAdapter';

import { CustomersModuleFT2 } from '@lasyncro/customers';
import { mapCustomersFt2Props } from './customers/useCustomersFt2Adapter';
import { useCustomersFt2Snapshot } from './customers/useCustomersFt2Snapshot';

export default function CustomersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useSpecterAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';
  
  const enabled = isFt1 && !!shopId;
  const ft2Enabled = isFt2 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  /**
   * FT2 Customers Snapshot (Authoritative)
   * ------------------------------------
   * Hook MUST be called unconditionally (React rules).
   * Fetching is gated strictly via `ft2Enabled`.
   *
   * Guarantees:
   * - No fetch outside FT2_READY
   * - Backend owns period
   * - No inference or defaults here
   */
  const ft2Query = useCustomersFt2Snapshot(ft2Enabled);

  if (isFt2) {
    console.debug('[CustomersPage][FT2] awaiting FT2 snapshot', {
        phase,
        shopId,
      });

    if (!ft2Query.isSuccess) {
      return <div>Loading customer observability…</div>;
    }

    const ft2Props = mapCustomersFt2Props(ft2Query.data);

    console.debug('[CustomersPage][FT2] rendering CustomersModuleFT2', {
      snapshot: ft2Query.data,
    });

    return <CustomersModuleFT2 {...ft2Props} />;
  }

  if (!isFt1) {
    return <div>Customers not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Customers not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading customer signals…</div>;
  }

  const specterProps = mapSpecterFt1Props(readinessQuery.data);

  return <SpecterModule {...specterProps} onIntent={onIntent} />;
}
