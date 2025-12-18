//apps/frontend/src/activation/configs/analytics.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const analyticsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'analytics',

  identity: {
    title: 'Analytics',
  },

  blindness: {
    content: (
      <>
        You cannot see performance trends, signals, or insights yet.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Without data ingestion, analytics and insights remain unavailable.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Once connected, analytics unlock automatically as data flows in.
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