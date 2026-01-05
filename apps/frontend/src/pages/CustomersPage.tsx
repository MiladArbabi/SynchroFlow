import { SpecterModule, SpecterModuleFT2 } from '@lasyncro/specter';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapSpecterFt1Props } from './customers/useSpecterFt1Adapter';
import { useSpecterAhaAdapter } from 'wiring/specterAhaAdapter';

export default function CustomersPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;
  const onIntent = useSpecterAhaAdapter();

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  if (isFt2) {
    return <SpecterModuleFT2 />;
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
