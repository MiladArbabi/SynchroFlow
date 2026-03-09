import {
  PanelRow,
  PanelFooter,
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
    <>
      <PanelRow
        label="Products detected"
        value={productsObserved}
      />

      <PanelRow
        label="Active products"
        value={activeProducts}
      />

      <PanelRow
        label="Inactive or archived"
        value={inactiveOrArchivedProducts}
      />

      <PanelFooter
        line1="> CATALOG PRESENCE SNAPSHOT"
        line2="> STRUCTURAL REALITY ONLY"
      />
    </>
  );
}
