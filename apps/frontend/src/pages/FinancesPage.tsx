// apps/frontend/src/pages/FinancesPage.tsx
import { FinancesModule, FinancesModuleFT2 } from '@lasyncro/finances';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { mapFinancesFt2Props } from './finances/useFinancesFt2Adapter';
import { useFinancesAhaAdapter } from 'wiring/financesAhaAdapter';
import { useFinancesFt2Snapshot } from './finances/useFinancesFt2Snapshot';

export default function FinancesPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useFinancesAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';

  const ft1Enabled = isFt1 && !!shopId;
  const ft2Enabled = isFt2 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  const ft2Query = useFinancesFt2Snapshot(ft2Enabled);

  // ---- FT2 routing ----
  if (isFt2) {
    if (!ft2Query.isSuccess) {
      console.debug('[FinancesPage][FT2] awaiting FT2 snapshot', {
        phase,
        shopId,
      });
      return <div>Loading finances…</div>;
    }

    const ft2Props = mapFinancesFt2Props(ft2Query.data);

    console.debug('[FinancesPage][FT2] rendering FinancesModuleFT2', {
      snapshot: ft2Query.data,
    });

    return <FinancesModuleFT2 {...ft2Props} />;
  }

  // ---- Rendering gates ONLY ----
  if (!isFt1) {
    return <div>Finances not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Finances not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading finances…</div>;
  }

  const financesProps = mapFinancesFt1Props(readinessQuery.data);

  return <FinancesModule {...financesProps} onIntent={onIntent} />;
}
