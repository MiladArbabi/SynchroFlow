//apps/frontend/src/activation/configs/orders.tsx
import { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',

  identity: {
    title: 'Orders',
    subtitle: 'Hidden profit loss',
  },

  blindness: {
    subject: 'Order 4832',
    dimension: 'net margin',
    status: 'unknown',
  },

  absenceProof: {
    riskStatement:
      'Orders that lose money may already be approved without detection.',
  },

  valueAfterActivation: {
    outcome:
      'Orders with negative margins are identified automatically.',
  },

  primaryCTA: {
    label: 'Reveal Order Profitability',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'No customer data stored',
      'Encrypted end-to-end',
      'Disconnect anytime',
    ],
  },

  postActivation: {
    reflection:
      'Orders are approved every day. Activation determines whether those decisions are informed.',
  },
};

