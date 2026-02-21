import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type OrdersOverviewInfoBlockProps = {
  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    constrained: number | null;
  };
};

export function OrdersOverviewInfoBlock({
  orders,
}: OrdersOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Orders overview">

      <InfoBlockRow
        label="Total orders"
        value={orders.total}
      />

      <InfoBlockRow
        label="Fulfilled orders"
        value={orders.fulfilled}
      />

      <InfoBlockRow
        label="Unfulfilled orders"
        value={orders.unfulfilled}
      />

      <InfoBlockRow
        label="Constrained orders"
        value={orders.constrained}
      />

      <InfoBlockFooter
        line1="> LIFETIME OPERATIONAL STATE"
        line2="> NON-TEMPORAL, EXECUTION-BASED"
      />
    </InfoBlock>
  );
}
