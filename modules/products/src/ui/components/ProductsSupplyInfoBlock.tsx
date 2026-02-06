import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
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
    <InfoBlock title="Supply & replenishment">
      <InfoBlockRow
        label="Replenishment observability"
        value={replenishment}
      />

      <InfoBlockRow
        label="Supply coverage"
        value={coverage}
      />

      <InfoBlockFooter
        line1="> SUPPLY SIGNALS SHOWN"
        line2="> NO FORECASTING OR OPTIMIZATION"
      />
    </InfoBlock>
  );
}
