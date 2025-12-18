//apps/frontend/src/activation/configs/orders.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',

  identity: {
    title: 'Orders',
    subtitle: 'Where profit leaks',
  },

  blindness: {
    content: (
      <div style={{ opacity: 0.75 }}>
        <strong>Order #4832</strong>
        <div>Net margin: ⚫ Unknown</div>
      </div>
    ),
  },

  absenceProof: {
    content: <>This order could be losing money. You wouldn’t know.</>,
  },

  valueAfterActivation: {
    content: <>Once connected, money-losing orders are identified automatically.</>,
  },

  primaryCTA: {
    label: 'Connect Shopify Store',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'No customer PII stored',
      'Encrypted end-to-end',
      'Disconnect anytime',
    ],
  },

  postActivation: {
    content: (
      <>
        Orders are approved every day.
        Activation only determines whether those decisions are informed.
      </>
    ),
  },
};
