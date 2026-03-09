import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

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
  critical_orders_count: number;
  negative_margin_orders_count: number;
  sla_breached_count: number;
  inventory_blocked_revenue: string | number;
  refund_exposure: string | number;
}

export function OrdersDecisionBrief({
  critical_orders_count,
  negative_margin_orders_count,
  sla_breached_count,
  inventory_blocked_revenue,
  refund_exposure,
}: OrdersDecisionBriefProps) {
  return (
    <>

      <PanelRow
        label="Critical orders"
        value={critical_orders_count}
      />

      <PanelRow
        label="Negative margin orders"
        value={negative_margin_orders_count}
      />

      <PanelRow
        label="SLA breached orders"
        value={sla_breached_count}
      />

      <PanelRow
        label="Inventory blocked revenue"
        value={inventory_blocked_revenue}
      />

      <PanelRow
        label="Refund exposure"
        value={refund_exposure}
      />

      <PanelFooter
        line1="> BACKEND-DERIVED RISK SNAPSHOT"
        line2="> ORDERING AUTHORITATIVE"
      />
    </>
  );
}