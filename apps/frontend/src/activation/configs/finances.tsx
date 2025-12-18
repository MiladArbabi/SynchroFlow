/// apps/frontend/src/activation/configs/finances.tsx
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const financesActivationConfig: ActivationSurfaceProps = {
  moduleId: 'finances',

  identity: {
    title: 'Finances',
    subtitle: 'You cannot distinguish correct margins from incorrect ones.',
  },

  blindness: {
    content: (
      <>
        Shipping costs, payment fees, taxes, and overhead are applied without verification.
      </>
    ),
  },

  absenceProof: {
    content: (
      <>
        Every margin decision relies on assumptions you cannot audit.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Cost assumptions become verifiable, versioned, and enforceable.
      </>
    ),
  },

  primaryCTA: {
    label: 'Verify Cost Assumptions',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No order recalculation',
      'No changes without approval',
      'Versioned cost models',
      'Full audit trail',
    ],
  },

  postActivation: {
    content: (
      <>
        Decisions are already being made. Activation only determines whether they are informed.
      </>
    ),
  },
};
