import { ProductCrossDomainAlignmentIntelligence } from './ProductCrossDomainAlignmentIntelligence.types';
import { ProductCrossDomainAlignmentFT2Exposure } from './ProductCrossDomainAlignmentFtep.types';

export function buildProductCrossDomainAlignmentFtep(
  intelligence: ProductCrossDomainAlignmentIntelligence
): ProductCrossDomainAlignmentFT2Exposure {
  return { alignment: intelligence.alignment };
}