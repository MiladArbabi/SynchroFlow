import { LifecycleState, initialLifecycleState } from './lifecycleTypes';

type Input = {
  bootResolved: boolean;
  integrationExists: boolean;
};

export function deriveInitialLifecycleState(
  shopId: number | null,
  input: Input
): LifecycleState {
  if (!shopId) return initialLifecycleState;

  const ft2Sealed =
    localStorage.getItem(`shop:${shopId}:ft2-seen`) === 'true';

  const ft1Sealed =
    localStorage.getItem(`shop:${shopId}:ft1-seen`) === 'true';

  // 🔒 FT2 DOMINATES EVERYTHING
  if (ft2Sealed && input.bootResolved && input.integrationExists) {
    return {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT2: true,
      hasLatchedFT1: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };
  }

  // FT1 (only if FT2 not sealed)
  if (ft1Sealed && input.bootResolved && input.integrationExists) {
    return {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };
  }

  return initialLifecycleState;
}