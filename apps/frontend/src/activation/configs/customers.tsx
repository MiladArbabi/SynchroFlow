//apps/frontend/src/activation/configs/customers.ts
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const customersActivationConfig: ActivationSurfaceProps = {
  moduleId: 'customers',

  identity: {
    title: 'Customers',
  },

  blindness: {
    content: (
      <>
        You don’t know which customers actually drive your revenue.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        High-value and low-value customers look the same right now.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, customer value and behavior become visible automatically.
      </>
    ),
  },

  primaryCTA: {
    label: 'Connect Shopify',
    actionId: 'connect-store'
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'Disconnect anytime',
      'Encrypted end-to-end',
      'Verified permissions',
    ],
  },

  postActivation: {
    content: (
      <>
        Orders are approved every day. Activation only determines whether those
        decisions are informed.
      </>
    ),
  },
};
