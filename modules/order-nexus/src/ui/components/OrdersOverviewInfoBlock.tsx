import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type OrdersOverviewInfoBlockProps = {
  orders: {
    fulfilled: number | null;
    active: number | null;
    added: number | null;
  };
  incomingDiff: string | null;
};

export function OrdersOverviewInfoBlock({
  orders,
  incomingDiff,
}: OrdersOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Orders overview">
      <InfoBlockRow
        label="Fulfilled orders"
        value={orders.fulfilled}
      />

      <InfoBlockRow
        label="Unfulfilled orders"
        value={orders.active}
      />

      <InfoBlockRow
        label="Orders added"
        value={orders.added}
        diff={incomingDiff}
      />

      <InfoBlockFooter
        line1="> ORDER OBLIGATIONS SHOWN"
        line2="> VALUE AND EXECUTION DETAILED ELSEWHERE"
      />
    </InfoBlock>
  );
}
