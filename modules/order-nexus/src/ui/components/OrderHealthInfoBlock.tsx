// modules/order-nexus/src/ui/components/OrderHealthInfoBlock.tsx
//
// Phase 1 — Order Health InfoBlock
// ---------------------------------
// Deterministic display of operational health metrics.
// Pure passthrough. No computation.

import { FT2Panel, PanelRow,PanelFooter } from '@lasyncro/ui-ft2';

export interface OrderHealthInfoBlockProps {
  orders_at_sla_risk: number;
  aging_24h: number;
  aging_48h: number;
  aging_72h_plus: number;
  pending_fulfillment: number;
  pending_payment: number;
  exception_orders: number;
}

export function OrderHealthInfoBlock(
  props: OrderHealthInfoBlockProps
) {
  const {
    orders_at_sla_risk,
    aging_24h,
    aging_48h,
    aging_72h_plus,
    pending_fulfillment,
    pending_payment,
    exception_orders,
  } = props;

  return (
    <FT2Panel title="Order Health">
      <PanelRow
        label="Orders at SLA Risk"
        value={orders_at_sla_risk}
      />
      <PanelRow
        label="Aging 24h"
        value={aging_24h}
      />
      <PanelRow
        label="Aging 48h"
        value={aging_48h}
      />
      <PanelRow
        label="Aging 72h+"
        value={aging_72h_plus}
      />
      <PanelRow
        label="Pending Fulfillment"
        value={pending_fulfillment}
      />
      <PanelRow
        label="Pending Payment"
        value={pending_payment}
      />
      <PanelRow
        label="Exception Orders"
        value={exception_orders}
      />

       <PanelFooter
        line1="> HEALTH OF ORDERS"
        line2="> HOW ARE MY ORDERS DOING?"
      />
    </FT2Panel>
  );
}