import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',

  identity: {
    title: 'Orders',
  },

  blindness: {
    content: (
      <>
        Right now, profitable and unprofitable orders are indistinguishable.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        This order could be losing money. You wouldn’t know.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, money-losing orders are identified automatically.
      </>
    ),
  },

  primaryCTA: {
    label: 'Connect Shopify Store',
    onActivate: () => {
      /* wired by gate */
    },
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
};
