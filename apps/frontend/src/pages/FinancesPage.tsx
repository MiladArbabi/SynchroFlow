// apps/frontend/src/pages/FinancesPage.tsx
import FinancesModule from '@lasyncro/finances';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapFinancesFt1Props } from './finances/useFinancesFt1Adapter';
import { useFinancesAhaAdapter } from 'wiring/financesAhaAdapter';

export default function FinancesPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useFinancesAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

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
