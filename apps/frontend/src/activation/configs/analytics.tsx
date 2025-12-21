import { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

export const analyticsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'analytics',

  identity: {
    title: 'InsightCore',
    subtitle: 'Why performance changed',
  },

  blindness: {
    subject: 'Business performance',
    dimension: 'root cause of change',
    status: 'not-visible',
  },

  absenceProof: {
    riskStatement:
      'Revenue, margins, and returns change without a clear explanation.',
  },

  valueAfterActivation: {
    outcome:
      'The primary driver behind performance changes is identified.',
  },

  primaryCTA: {
    label: 'Fix Operational Blindspots',
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
    reflection:
      'Causes surface when evidence exists. Unknowns remain unknown without proof.',
  },
};
