import {
  PanelRow,
  PanelFooter,
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
  /**
   * PANEL CONTENT ONLY
   * ------------------
   * Container ownership moved to FT2Panel.
   * This component now renders rows only.
   */
  return (
    <>
      <PanelRow
        label="Total orders"
        value={orders.total}
      />

      <PanelRow
        label="Fulfilled orders"
        value={orders.fulfilled}
      />

      <PanelRow
        label="Unfulfilled orders"
        value={orders.unfulfilled}
      />

      <PanelRow
        label="Constrained orders"
        value={orders.constrained}
      />

      <PanelFooter
        line1="> LIFETIME OPERATIONAL STATE"
        line2="> NON-TEMPORAL, EXECUTION-BASED"
      />
    </>
  );
}
