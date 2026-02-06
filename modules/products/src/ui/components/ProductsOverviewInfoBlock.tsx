import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ProductsOverviewInfoBlockProps = {
  productsObserved: number | null;
  activeProducts: number | null;
  inactiveOrArchivedProducts: number | null;
};

export function ProductsOverviewInfoBlock({
  productsObserved,
  activeProducts,
  inactiveOrArchivedProducts,
}: ProductsOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Products overview">
      <InfoBlockRow
        label="Products detected"
        value={productsObserved}
      />

      <InfoBlockRow
        label="Active products"
        value={activeProducts}
      />

      <InfoBlockRow
        label="Inactive or archived"
        value={inactiveOrArchivedProducts}
      />

      <InfoBlockFooter
        line1="> CATALOG PRESENCE SNAPSHOT"
        line2="> STRUCTURAL REALITY ONLY"
      />
    </InfoBlock>
  );
}
