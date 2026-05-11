//apps/frontend/src/activation/configs/orders.tsx
import type { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

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
      /**
       * FT2 UI CONTRACT:
       * ----------------
       * Orders FT2 does not explain outcomes or imply detection.
       * Language must remain observational and non-semantic.
       */
      'Orders with economically negative outcomes may be visible.',
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
      'Orders approved daily. LaSyncro verifies decision quality.'
  },
};

