import type { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

export const financesActivationConfig: ActivationSurfaceProps = {
  moduleId: 'finances',

  identity: {
    title: 'Finances',
    subtitle: 'Margin accuracy cannot be verified',
  },

  blindness: {
    subject: 'Cost assumptions',
    dimension: 'margin correctness',
    status: 'unverified',
  },

  absenceProof: {
    riskStatement:
      'Margin decisions rely on assumptions that cannot be audited.',
  },

  valueAfterActivation: {
    outcome:
      'Cost assumptions become verifiable and enforceable.',
  },

  primaryCTA: {
    label: 'Verify Cost Assumptions',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No order recalculation',
      'No changes without approval',
      'Versioned cost models',
      'Full audit trail',
    ],
  },

  postActivation: {
    reflection:
     'Financial decisions ongoing. LaSyncro ensures verifiability.'
  },
};
