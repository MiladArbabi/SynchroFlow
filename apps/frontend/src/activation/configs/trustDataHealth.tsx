// apps/frontend/src/activation/configs/trustDataHealth.tsx

import { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';

export const trustDataHealthActivationConfig: ActivationSurfaceProps = {
  moduleId: 'trust-data-health',

  identity: {
    title: 'Data trust is not yet established',
    subtitle:
      'The system has not observed enough real behavior to defend claims about your data.',
  },

  blindness: {
    subject: 'Data reality',
    dimension: 'Observability',
    status: 'insufficient-data',
  },

  absenceProof: {
    riskStatement:
      'Incomplete ingestion can look identical to real-world absence.',
  },

  valueAfterActivation: {
    outcome:
      'Once ingestion stabilizes, gaps and silence become distinguishable.',
  },

  // 🚫 No CTA in FT_MINUS_ONE
  primaryCTA: undefined,

  // ✅ REQUIRED
  trust: {
    bullets: [
      'No data is hidden.',
      'No assumptions are made.',
      'Silence is treated as unknown, not zero.',
    ],
  },

  postActivation: {
    reflection:
      'Trust emerges only after behavior is observed over time.',
  },
};
