//apps/frontend/src/activation/configs/orders.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',

  identity: {
    title: 'Orders',
  },

  blindness: {
    content: (
      <div style={{ opacity: 0.75 }}>
        <strong>Order #4832</strong>
        <div>Revenue: $128.00</div>
        <div>Costs:</div>
        <ul>
          <li>⚫ Product cost</li>
          <li>⚫ Shipping</li>
          <li>⚫ Payment fees</li>
        </ul>
        <div style={{ marginTop: 8 }}>
          <strong>Net margin: ⚫ Unknown</strong>
        </div>
      </div>
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
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'Disconnect anytime',
      'No customer PII stored',
      'Encrypted end-to-end',
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
