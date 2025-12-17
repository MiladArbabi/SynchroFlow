import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',

  identity: {
    title: 'Orders',
  },

  blindness: {
    content: (
      <>
        <div style={{ opacity: 0.7 }}>
          <strong>Order #4832</strong>
          <div>Margin: ⚫ Unknown</div>
          <div>Reason:</div>
          <ul>
            <li>Shipping cost missing</li>
            <li>Payment fees unaccounted</li>
            <li>True product cost unavailable</li>
          </ul>
        </div>
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

  postActivation: {
    content: (
      <>
        Orders sync → margins compute → loss-making orders appear automatically
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
};
