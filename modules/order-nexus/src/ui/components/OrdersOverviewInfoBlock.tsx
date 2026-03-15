import { FT2Panel, PanelRow, PanelFooter } from '@lasyncro/ui-ft2';

type OrdersOverviewInfoBlockProps = {
  span?: number;
  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    constrained: number | null;
  };
};

export function OrdersOverviewInfoBlock({
  span = 1,
  orders,
}: OrdersOverviewInfoBlockProps) {
  /**
   * PANEL CONTENT ONLY
   * ------------------
   * Container ownership moved to FT2Panel.
   * This component now renders rows only.
   */
  return (
    <FT2Panel title="Operational Metrics" span={span}>
      <PanelRow
        label="Total orders"
        value={orders.total}
      />

      <PanelRow
        label="Fulfilled"
        value={orders.fulfilled}
      />

      <PanelRow
        label="Unfulfilled"
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
    </FT2Panel>
  );
}
