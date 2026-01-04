//apps/frontend/src/lifecycle/useModuleLifecycle.ts
import { useShopLifecycle } from './ShopLifecycleContext';
import { UIModulePhase } from './types';

export function useModuleLifecycle(): { phase: UIModulePhase } {
  const { phase: shopPhase } = useShopLifecycle();

  if (import.meta.env.DEV && shopPhase !== 'FT1_READY') {
    throw new Error(
      `[useModuleLifecycle] Module mounted before FT1_READY.`
    );
  }

  return { phase: 'FT1_CORE' };
}