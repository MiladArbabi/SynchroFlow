// apps/frontend/src/pages/CustomersPage.tsx
//
// CustomersPage
// -------------
// Lifecycle-agnostic Customers surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Render FT1 or FT2 Customers modules based on available data
// - Remain silent about lifecycle state in user-facing UI

import { SpecterModule } from '@lasyncro/specter';
import { CustomersModuleFT2 } from '@lasyncro/customers';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useCustomersFt2Snapshot } from './customers/useCustomersFt2Snapshot';

import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
import { mapCustomersFt2Props } from './customers/useCustomersFt2Adapter';

import { useSpecterAhaAdapter } from 'wiring/specterAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function CustomersPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   */
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  /**
   * Intents
   */
  const onIntent = useSpecterAhaAdapter();

  /**
   * Data gating
   */
  const ft1Enabled = !!shopId;
  const ft2Enabled = !!shopId;

  /**
   * FT2 snapshot (authoritative)
   */
  const ft2Query = useCustomersFt2Snapshot(ft2Enabled);

  /**
   * FT1 onboarding readiness
   */
  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * FT2 rendering path (authoritative)
   */
  if (ft2Query.isSuccess) {
    if (__DEV__) {
      console.debug('[CustomersPage][FT2] rendering CustomersModuleFT2', {
        snapshot: ft2Query.data,
      });
    }

    const ft2Props = mapCustomersFt2Props(ft2Query.data);
    return <CustomersModuleFT2 {...ft2Props} />;
  }

  /**
   * FT2 loading (neutral)
   */
  if (ft2Query.isLoading) {
    if (__DEV__) {
      console.debug('[CustomersPage][FT2] awaiting snapshot');
    }
    return <div>Loading customers…</div>;
  }

  /**
   * Missing shopId (neutral fallback)
   */
  if (!shopId) {
    return <div>Customers unavailable</div>;
  }

  /**
   * FT1 readiness loading
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[CustomersPage][FT1] awaiting onboarding readiness');
    }
    return <div>Loading customers…</div>;
  }

  /**
   * FT1 rendering path
   */
  const specterProps = mapSpecterFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[CustomersPage][FT1] rendering SpecterModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <SpecterModule
      {...specterProps}
      onIntent={onIntent}
    />
  );
}