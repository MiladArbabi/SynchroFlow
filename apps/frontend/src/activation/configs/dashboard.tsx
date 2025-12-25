//apps/frontend/src/activation/configs/dashboard.tsx

import { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';

export const dashboardActivationConfig: ActivationSurfaceProps = {
  moduleId: 'dashboard',

  identity: {
    title: 'Your dashboard isn’t ready yet',
    subtitle: 'We need your store data first'
  },

  blindness: {
    subject: 'Business performance',
    dimension: 'Visibility',
    status: 'not-visible'
  },

  absenceProof: {
    riskStatement:
      'Without data, decisions are being made blindly.'
  },

  valueAfterActivation: {
    outcome:
      'Once connected, we’ll prepare insights tailored to your store.'
  },

  primaryCTA: {
    label: 'Connect your store',
    actionId: 'connect-store'
  },

  trust: {
    bullets: [
      'No changes made without your consent',
      'Secure, read-only access'
    ]
  },

  postActivation: {
    reflection:
      'Preparing your dashboard…'
  }
};
