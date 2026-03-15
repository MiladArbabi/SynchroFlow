import { FT2Panel, PanelRow,PanelFooter } from '@lasyncro/ui-ft2';

/**
 * OrdersDecisionBrief
 * -------------------
 * Pure render component.
 *
 * CONTRACT:
 * - Receives fully derived decision snapshot via props.
 * - No data fetching.
 * - No lifecycle awareness.
 * - Backend remains authoritative.
 */
export interface OrdersDecisionBriefProps {
  span?: number;
  ready_to_ship: number;
  awaiting_customer: number;
  inventory_blocked_revenue: string | number;
  manual_review: string | number;
}

export function OrdersDecisionBrief({
  span = 1,
  ready_to_ship,
  inventory_blocked_revenue,
  awaiting_customer,
  manual_review,
}: OrdersDecisionBriefProps) {
  return (
    <FT2Panel title="Execution Pipline" span={span}>

      <PanelRow
        label="Ready to Ship"
        value={ready_to_ship}
      />

      <PanelRow
        label="Blocked by Inventory"
        value={inventory_blocked_revenue}
      />

      <PanelRow
        label="Awaiting Customer "
        value={awaiting_customer}
      />

      <PanelRow
        label="Manual Review "
        value={manual_review}
      />

      <PanelFooter
        line1="> BACKEND-DERIVED RISK SNAPSHOT"
        line2="> ORDERING AUTHORITATIVE"
      />
    </FT2Panel>
  );
}