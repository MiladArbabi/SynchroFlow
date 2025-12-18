//apps/frontend/src/activation/configs/products.tsx

import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const productsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'products',

  identity: {
    title: 'Products',
  },

  blindness: {
    content: (
      <>
        You don’t have a clear view of your product catalog or true product data.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Costs, variants, and inventory signals are currently disconnected.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, products are synced, normalized, and ready for analysis.
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