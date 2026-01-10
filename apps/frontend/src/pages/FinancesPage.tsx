// apps/frontend/src/pages/FinancesPage.tsx
//
// FinancesPage
// ------------
// Lifecycle-agnostic Finances surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - This page MUST NOT render FT2 modules
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Render FT1 Finances module only
// - Gate data fetching via explicit booleans
// - Remain silent about lifecycle state in user-facing UI

import { FinancesModule } from '@lasyncro/finances';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { useFinancesAhaAdapter } from 'wiring/financesAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function FinancesPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   */
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  /**
   * Intents
   * -------
   * Always instantiated; no lifecycle branching allowed.
   */
  const onIntent = useFinancesAhaAdapter();

  /**
   * FT1 data gating
   * ---------------
   * Lifecycle validity is assumed if this page is mounted.
   */
  const ft1Enabled = !!shopId;

  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * Missing shopId
   * --------------
   * Not a lifecycle error.
   */
  if (!shopId) {
    return <div>Finances unavailable</div>;
  }

  /**
   * FT1 loading
   * -----------
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[FinancesPage][FT1] awaiting onboarding readiness');
    }

    return <div>Loading finances…</div>;
  }

  /**
   * FT1 rendering path
   * ------------------
   */
  const props = mapFinancesFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[FinancesPage][FT1] rendering FinancesModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <FinancesModule
      {...props}
      onIntent={onIntent}
    />
  );
}