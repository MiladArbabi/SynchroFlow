import { ProductCrossDomainAlignmentIntelligence } from './ProductCrossDomainAlignmentIntelligence.types';

interface BuildAlignmentInput {
  alignmentEvidencePresent: boolean | null;

  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;

  operational: {
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  freshness: {
    structural: 'fresh' | 'stale' | 'unknown';
    inventory: 'fresh' | 'stale' | 'unknown';
    sales: 'fresh' | 'stale' | 'unknown';
    fulfillment: 'fresh' | 'stale' | 'unknown';
    cost: 'fresh' | 'stale' | 'unknown';
  } | null;
}

export function buildProductCrossDomainAlignmentIntelligence(
  input: BuildAlignmentInput
): ProductCrossDomainAlignmentIntelligence {
  const {
   alignmentEvidencePresent,
   supply,
   operational,
   freshness,
 } = input;

 // GLOBAL missing-facts collapse
 if (alignmentEvidencePresent !== true) {
   return { alignment: 'unknown' };
 }

  if (!supply || !operational || !freshness) {
    return { alignment: 'unknown' };
  }

  const freshnessValues = Object.values(freshness);
  if (freshnessValues.includes('unknown')) {
    return { alignment: 'unknown' };
  }

  if (
    operational.stability === 'stable' &&
    freshnessValues.includes('stale')
  ) {
    return { alignment: 'misaligned' };
  }

  if (
    supply.replenishment === 'observable' &&
    freshness.inventory === 'stale'
  ) {
    return { alignment: 'misaligned' };
  }

  if (
    operational.stability === 'fragile' &&
    freshnessValues.every(v => v === 'fresh')
  ) {
    return { alignment: 'misaligned' };
  }

  return { alignment: 'aligned' };
}