import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ReturnsOverviewInfoBlockProps = {
  returnedRevenue: number | null;
  returnedUnits: number | null;
  affectedOrders: number | null;
};

export function ReturnsOverviewInfoBlock({
  returnedRevenue,
  returnedUnits,
  affectedOrders,
}: ReturnsOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Returns overview">
      <InfoBlockRow
        label="Returned revenue"
        value={
          returnedRevenue != null
            ? `-${returnedRevenue.toFixed(2)}`
            : null
        }
      />

      <InfoBlockRow
        label="Returned units"
        value={returnedUnits}
      />

      <InfoBlockRow
        label="Orders affected"
        value={affectedOrders}
      />

      <InfoBlockFooter
        line1="> POST-FULFILLMENT REGRESSION"
        line2="> DOES NOT BLOCK EXECUTION"
      />
    </InfoBlock>
  );
}
