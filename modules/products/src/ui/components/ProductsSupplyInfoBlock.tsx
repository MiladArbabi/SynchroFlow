import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

type ProductsSupplyInfoBlockProps = {
  replenishment: 'observable' | 'missing' | 'unknown' | null;
  coverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
};

export function ProductsSupplyInfoBlock({
  replenishment,
  coverage,
}: ProductsSupplyInfoBlockProps) {
  return (
    <>
      <PanelRow
        label="Replenishment observability"
        value={replenishment}
      />

      <PanelRow
        label="Supply coverage"
        value={coverage}
      />

      <PanelFooter
        line1="> SUPPLY SIGNALS SHOWN"
        line2="> NO FORECASTING OR OPTIMIZATION"
      />
    </>
  );
}
