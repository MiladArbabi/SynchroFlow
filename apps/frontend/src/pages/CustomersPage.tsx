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
// - Remain silent about lifecycle state in user-facing UI

import { SpecterModule } from '@lasyncro/specter';
import { useAuth } from 'contexts/AuthContext';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
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

  /**
   * FT1 onboarding readiness
   */
  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

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