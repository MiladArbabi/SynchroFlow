import { InfoBlock, InfoBlockRow, InfoBlockFooter } from '@lasyncro/ui-ft2';

/**
 * OperationsQueueSection
 * ----------------------
 * Operational execution surface replacing Priority Stack.
 *
 * DATA SOURCE
 * orders_operational_control_snapshot
 *
 * DESIGN RULES
 * - No order ranking
 * - No health scores
 * - Display operational signals only
 * - Signals represent clusters of operational work
 */

export interface OperationsQueueSectionProps {
  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;

  orders_at_sla_risk: number;
  pending_fulfillment: number;
}

export function OperationsQueueSection({
  queue_manual_review,
  queue_awaiting_inventory,
  queue_ready_to_ship,
  queue_awaiting_customer,
  orders_at_sla_risk,
  pending_fulfillment,
}: OperationsQueueSectionProps) {

  return (
    <InfoBlock title="Operations queue">

      {queue_awaiting_inventory > 0 && (
        <InfoBlockRow
          label="🚨 Inventory shortage"
          value={`${queue_awaiting_inventory} orders blocked`}
        />
      )}

      {orders_at_sla_risk > 0 && (
        <InfoBlockRow
          label="⚠️ SLA risk"
          value={`${orders_at_sla_risk} orders nearing deadline`}
        />
      )}

      {queue_manual_review > 0 && (
        <InfoBlockRow
          label="⚠️ Payment / fraud review"
          value={`${queue_manual_review} orders awaiting verification`}
        />
      )}

      {queue_ready_to_ship > 0 && (
        <InfoBlockRow
          label="ℹ️ Ready to ship"
          value={`${queue_ready_to_ship} orders awaiting fulfillment`}
        />
      )}

      {queue_awaiting_customer > 0 && (
        <InfoBlockRow
          label="ℹ️ Awaiting customer"
          value={`${queue_awaiting_customer} orders waiting on response`}
        />
      )}

      {pending_fulfillment > 0 && (
        <InfoBlockRow
          label="ℹ️ Pending fulfillment"
          value={`${pending_fulfillment} orders`}
        />
      )}

      <InfoBlockFooter
        line1="> OPERATIONAL SIGNAL CLUSTERS"
        line2="> SOURCE: orders_operational_control_snapshot"
      />

    </InfoBlock>
  );
}