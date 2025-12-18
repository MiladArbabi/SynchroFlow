//apps/frontend/src/activation/configs/finances.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const financesActivationConfig: ActivationSurfaceProps = {
  moduleId: 'finances',

  identity: {
    title: 'Finances',
  },

  blindness: {
    content: (
      <>
        Revenue, costs, and payouts are not yet visible.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Financial performance cannot be assessed without a store connection.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, financial data syncs and profitability becomes clear.
      </>
    ),
  },

  primaryCTA: {
    label: 'Connect Shopify',
    actionId: 'connect-store',
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