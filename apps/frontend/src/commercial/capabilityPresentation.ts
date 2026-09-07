import type { CapabilityId } from '@lasyncro/commercial-policy';

interface CapabilityPresentation {
  featureName: string;
  benefits: string[];
}

/** Frontend presentation only; access remains governed by canonical AccessDecision. */
export const CAPABILITY_PRESENTATION: Partial<Record<CapabilityId, CapabilityPresentation>> = {
  'demand.forecasting': {
    featureName: 'Demand',
    benefits: [
      'Identify SKUs at critical stockout risk',
      'Prioritize reorders using recent sales velocity and days of stock',
      'See suggested reorder quantities for urgent products',
      'Move from demand signals directly into purchasing and warehouse context',
    ],
  },
  'warehouse.floor_planning': {
    featureName: 'Floor Planning',
    benefits: [
      'Map warehouse bins, zones, and current occupancy',
      'See where a product is stored across warehouse locations',
      'Create and manage warehouse zones and locations',
      'Generate and print location and product barcode labels',
    ],
  },
  'warehouse.analytics': {
    featureName: 'Warehouse Analytics',
    benefits: [
      'Track operator pace and accuracy across pick and pack',
      'Monitor pipeline velocity, throughput, and aging work in progress',
      'Identify exception-heavy operators and SKUs',
      'Understand warehouse cost and capacity signals',
    ],
  },
  'returns.analysis': {
    featureName: 'Supplier Ratings',
    benefits: [
      'Compare suppliers by return rate across received stock',
      'Spot suspect batches with unusually high return rates',
      'See returned vs received units and affected SKUs',
      'Identify suppliers that may need a credit or quality review',
    ],
  },
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
