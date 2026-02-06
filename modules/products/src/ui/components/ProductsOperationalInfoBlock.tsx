import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ProductsOperationalInfoBlockProps = {
  inventory: 'ok' | 'gaps' | 'unknown' | null;
  fulfillment: 'visible' | 'missing' | 'unknown' | null;
  stability: 'stable' | 'fragile' | 'unknown' | null;
};

export function ProductsOperationalInfoBlock({
  inventory,
  fulfillment,
  stability,
}: ProductsOperationalInfoBlockProps) {
  return (
    <InfoBlock title="Operational visibility">
      <InfoBlockRow
        label="Inventory visibility"
        value={inventory}
      />

      <InfoBlockRow
        label="Fulfillment visibility"
        value={fulfillment}
      />

      <InfoBlockRow
        label="Operational stability"
        value={stability}
      />

      <InfoBlockFooter
        line1="> OPERATIONAL SIGNALS SHOWN"
        line2="> EXECUTION DETAILS SHOWN ELSEWHERE"
      />
    </InfoBlock>
  );
}
