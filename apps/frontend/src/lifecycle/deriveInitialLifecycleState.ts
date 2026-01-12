import { LifecycleState, initialLifecycleState } from './lifecycleTypes';

export function deriveInitialLifecycleState(
  shopId: number | null
): LifecycleState {
  if (!shopId) return initialLifecycleState;

  const ft2Sealed =
    localStorage.getItem(`shop:${shopId}:ft2-seen`) === 'true';

  const ft1Sealed =
    localStorage.getItem(`shop:${shopId}:ft1-seen`) === 'true';

  // 🔒 FT2 dominates everything at hydration
  if (ft2Sealed) {
    return {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      hasLatchedFT2: true,
      hasLatchedFT1: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };
  }

  // 🔒 FT1 hydrates directly when sealed
  if (ft1Sealed) {
    return {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      hasLatchedFT1: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };
  }

  return initialLifecycleState;
}
