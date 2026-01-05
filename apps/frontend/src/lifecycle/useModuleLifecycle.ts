//apps/frontend/src/lifecycle/useModuleLifecycle.ts
import { useShopLifecycle } from './ShopLifecycleContext';
import { UIModulePhase } from './types';

export function useModuleLifecycle(): { phase: UIModulePhase } {
  const { phase: shopPhase } = useShopLifecycle();

  if (
    import.meta.env.DEV &&
    shopPhase !== 'FT1_READY' &&
    shopPhase !== 'FT2_READY'
  ) {
    throw new Error(
      `[useModuleLifecycle] Module mounted outside FT1_READY / FT2_READY. Current phase: ${shopPhase}`
    );
  }

  if (shopPhase === 'FT2_READY') {
    return { phase: 'FT2_READY' };
  }

  return { phase: 'FT1_CORE' };
}
