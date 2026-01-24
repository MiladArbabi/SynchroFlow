import { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

export const customersActivationConfig: ActivationSurfaceProps = {
  moduleId: 'customers',

  identity: {
    title: 'Customers',
    subtitle: 'Who creates value and who creates risk',
  },

  blindness: {
    subject: 'Customer activity',
    dimension: 'profitability and risk',
    status: 'not-visible',
  },

  absenceProof: {
    riskStatement:
      'You treat costly and profitable customers the same.',
  },

  valueAfterActivation: {
    outcome:
      'Customer behaviors create operational risk become visible.',
  },

  primaryCTA: {
    label: 'Reveal Customer Risk',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'Events only, not identities',
      'No personal data stored',
      'Encrypted end-to-end',
      'Disconnect anytime',
    ],
  },

  postActivation: {
    reflection:
      'Behavioral signals emerge live. LaSyncro quantifies risk instantly.'
  },
};
