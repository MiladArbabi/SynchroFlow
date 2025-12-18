// apps/frontend/src/activation/configs/analytics.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const analyticsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'analytics',

  identity: {
    title: 'InsightCore',
    subtitle: 'Why Performance Changed',
  },

  blindness: {
    content: (
      <>
        Performance changes.
        You don’t know why.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Revenue moves.
        Margins shift.
        Returns spike.
        Causes stay unknown.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        InsightCore isolates the primary driver behind a change.
      </>
    ),
  },

  primaryCTA: {
    label: 'Resolve Performance Blindness',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only observer',
      'Never changes numbers',
      'Canonical metrics only',
      'Encrypted access',
      'Disconnect anytime',
    ],
  },

  postActivation: {
    content: (
      <>
        Signals connect.
        Causes surface.
        Unknown stays unknown when proof is missing.
      </>
    ),
  },
};
