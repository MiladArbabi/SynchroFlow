// apps/frontend/src/onboarding/dispatchOnboardingAction.ts
import type { OnboardingAction } from '@lasyncro/shared';

export interface OnboardingActionHandlers {
  navigate: (path: string) => void;
  openModal: (modalId: string) => void;
}

/**
 * Thin adapter between backend-defined onboarding actions
 * and real UI behaviors (navigation, modals, external links).
 *
 * This is intentionally dumb: no state, no side effects beyond
 * calling the provided handlers / window.open.
 */
export function dispatchOnboardingAction(
  action: OnboardingAction | undefined,
  handlers: OnboardingActionHandlers
): void {
  if (!action || action.type === 'none') return;

  const { navigate, openModal } = handlers;

  switch (action.type) {
    case 'navigate': {
      if (action.target) {
        navigate(action.target);
      }
      return;
    }

    case 'openModal': {
      if (action.target) {
        openModal(action.target);
      }
      return;
    }

    case 'openExternal': {
      if (typeof window !== 'undefined' && action.target) {
        window.open(action.target, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    default:
      // Future-proof: if shared adds a new type and frontend isn't updated yet,
      // we fail silently instead of throwing.
      return;
  }
}
