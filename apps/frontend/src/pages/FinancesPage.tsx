// apps/frontend/src/pages/FinancesPage.tsx
//
// FinancesPage
// ------------
// Lifecycle-agnostic Finances surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Render FT1 or FT2 Finances modules based on available data
// - Remain silent about lifecycle state in user-facing UI

import { FinancesModule, FinancesModuleFT2 } from '@lasyncro/finances';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useFinancesFt2Snapshot } from './finances/useFinancesFt2Snapshot';

import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { mapFinancesFt2Props } from './finances/useFinancesFt2Adapter';

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
   */
  const onIntent = useFinancesAhaAdapter();

  /**
   * Data gating
   */
  const ft1Enabled = !!shopId;
  const ft2Enabled = !!shopId;

  /**
   * FT2 snapshot (authoritative)
   */
  const ft2Query = useFinancesFt2Snapshot(ft2Enabled);

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
      console.debug('[FinancesPage][FT2] rendering FinancesModuleFT2', {
        snapshot: ft2Query.data,
      });
    }

    const ft2Props = mapFinancesFt2Props(ft2Query.data);
    return <FinancesModuleFT2 {...ft2Props} />;
  }

  /**
   * FT2 loading (neutral)
   */
  if (ft2Query.isLoading) {
    if (__DEV__) {
      console.debug('[FinancesPage][FT2] awaiting snapshot');
    }
    return <div>Loading finances…</div>;
  }

  /**
   * Missing shopId (neutral fallback)
   */
  if (!shopId) {
    return <div>Finances unavailable</div>;
  }

  /**
   * FT1 readiness loading
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[FinancesPage][FT1] awaiting onboarding readiness');
    }
    return <div>Loading finances…</div>;
  }

  /**
   * FT1 rendering path
   */
  const financesProps = mapFinancesFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[FinancesPage][FT1] rendering FinancesModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <FinancesModule
      {...financesProps}
      onIntent={onIntent}
    />
  );
}