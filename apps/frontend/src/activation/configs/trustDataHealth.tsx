// apps/frontend/src/activation/configs/trustDataHealth.tsx

import type { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';

/**
 * Trust Data Health — FT_MINUS_ONE activation surface
 *
 * Purpose:
 * - Establish epistemic baseline
 * - Make uncertainty explicit
 * - Block all activation actions
 *
 * This surface MUST:
 * - Render in FT_MINUS_ONE only
 * - Never unlock modules
 * - Never guide user action
 */
export const trustDataHealthActivationConfig: ActivationSurfaceProps = {
  moduleId: 'trust',

  identity: {
    title: 'Data trust is not yet established',
    subtitle:
      'Before any insights can be trusted, the system must observe what actually exists.',
  },

  blindness: {
    subject: 'System observability',
    dimension: 'Data reliability',
    status: 'insufficient-data',
  },

  absenceProof: {
    riskStatement:
      'What appears missing may be unobserved. What appears present may be incomplete.',
  },

  valueAfterActivation: {
    outcome:
      'Trust becomes defensible only after real ingestion behavior is observed.',
  },

  /**
   * FT_MINUS_ONE CTA
   * ----------------
   * - User-initiated lifecycle promotion
   * - Triggers FT0 sync → FT1
   * - No guarantees, only consent to observe
   */
  primaryCTA: {
    label: 'Begin trust assessment',
    actionId: 'connect-store',
},

  trust: {
    bullets: [
      'No data is altered at this stage.',
      'No assumptions are made.',
      'Observation precedes interpretation.',
    ],
  },

  postActivation: {
    reflection:
      'Trust is not granted. It is observed.',
  },
};