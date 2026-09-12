import { EntityDetailModal } from '@lasyncro/shared/ui';

import { useProductsCatalog } from '../products/useProductsCatalog';
import { VariantDetailModalBody } from './VariantDetailModalBody';

interface VariantDetailModalHostProps {
  variantId: string | null;
  onClose: () => void;
}

export function VariantDetailModalHost({
  variantId,
  onClose,
}: VariantDetailModalHostProps) {
  const catalogQuery = useProductsCatalog();
  const variant =
    variantId != null
      ? catalogQuery.data?.variants.find(
          (item) => item.lasyncro_variant_id === variantId,
        ) ?? null
      : null;

  const title =
    variant == null
      ? ''
      : variant.variant_title &&
          variant.variant_title !== 'Default Title'
        ? `${variant.product_title ?? 'Unknown product'} · ${variant.variant_title}`
        : variant.product_title ?? 'Unknown product';

  return (
    <EntityDetailModal
      entityId={variant?.lasyncro_variant_id ?? null}
      onClose={onClose}
      title={title}
      subtitle={variant?.sku ? `SKU ${variant.sku}` : 'No SKU'}
      maxWidth="xl"
    >
      {variant && (
        <VariantDetailModalBody variant={variant} />
      )}
    </EntityDetailModal>
  );
}
