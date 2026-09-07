import type { CapabilityId } from '@lasyncro/commercial-policy';

interface CapabilityPresentation {
  featureName: string;
  benefits: string[];
}

/** Frontend presentation only; access remains governed by canonical AccessDecision. */
export const CAPABILITY_PRESENTATION: Partial<Record<CapabilityId, CapabilityPresentation>> = {
  'purchasing.sourcing': {
    featureName: 'Sourcing',
    benefits: [
      'Prioritize sourcing work from current inventory demand',
      'Compare supplier recommendations by product',
      'Use supplier-product preferences',
      'Accumulate reorder quantities against MOQ',
    ],
  },
};

export function getCapabilityPresentation(capabilityId?: CapabilityId): CapabilityPresentation | undefined {
  return capabilityId ? CAPABILITY_PRESENTATION[capabilityId] : undefined;
}
