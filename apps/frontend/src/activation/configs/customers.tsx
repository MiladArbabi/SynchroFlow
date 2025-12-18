// apps/frontend/src/activation/configs/customers.ts

import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const customersActivationConfig: ActivationSurfaceProps = {
  moduleId: 'customers',

  identity: {
    title: 'Customers',
    subtitle: 'Who is valuable, who is not'
  },

  blindness: {
    content: (
      <>
        Right now, you cannot tell which customers are costing you money.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Costly and profitable customers are currently indistinguishable.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, Prodcuts identifies which customer behaviors create
        operational risk.
      </>
    ),
  },

  primaryCTA: {
    label: 'Reveal Customer Risk (Connect Shopify)',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No customer modifications',
      'Events only, not identities',
      'No PII stored',
      'Disconnect anytime',
      'Encrypted end-to-end',
    ],
  },

  postActivation: {
    content: (
      <>
        Customer events begin recording immediately. Behavioral patterns form as
        activity occurs. Risk signals emerge once behavior is sufficient.
      </>
    ),
  },
};
