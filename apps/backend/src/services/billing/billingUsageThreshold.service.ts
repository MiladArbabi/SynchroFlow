import { Knex } from 'knex';
import { PLAN_PROCESSED_ORDER_OVERAGE_CENTS, standardLimits, type Tier } from '@lasyncro/commercial-policy';

export type BillingUsageThreshold = 75 | 90 | 100;

export type BillingUsageNotificationIntent = {
  shopId: number;
  title: string;
  body: string;
  route: '/settings/billing';
};

const THRESHOLDS: BillingUsageThreshold[] = [75, 90, 100];

export function selectHighestBillingUsageThresholdCrossed(params: {
  previousProcessed: number;
  projectedProcessed: number;
  includedAllowance: number;
}): BillingUsageThreshold | null {
  const { previousProcessed, projectedProcessed, includedAllowance } = params;
  if (includedAllowance <= 0) return null;
  if (projectedProcessed <= previousProcessed) return null;

  let crossed: BillingUsageThreshold | null = null;
  for (const threshold of THRESHOLDS) {
    const thresholdUnits = Math.ceil((includedAllowance * threshold) / 100);
    if (previousProcessed < thresholdUnits && projectedProcessed >= thresholdUnits) {
      crossed = threshold;
    }
  }
  return crossed;
}

export function billingUsageAlertKey(
  usagePeriodId: number,
  threshold: BillingUsageThreshold,
): string {
  return `billing_usage:${usagePeriodId}:${threshold}`;
}

function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function copyForThreshold(params: {
  threshold: BillingUsageThreshold;
  used: number;
  included: number;
  rateCents: number;
}): { title: string; message: string } {
  const { threshold, used, included, rateCents } = params;
  const remaining = Math.max(0, included - used);
  const rate = formatMoney(rateCents);

  if (threshold === 75) {
    return {
      title: 'Processed-order usage reached 75%',
      message: `You've used ${used.toLocaleString('en-US')} of ${included.toLocaleString('en-US')} included processed orders. ${remaining.toLocaleString('en-US')} remain this period.`,
    };
  }

  if (threshold === 90) {
    return {
      title: 'Approaching your included allowance',
      message: `You've processed ${used.toLocaleString('en-US')} of ${included.toLocaleString('en-US')} included orders. Additional orders are $${rate} each.`,
    };
  }

  return {
    title: 'Included allowance used',
    message: `You've used your ${included.toLocaleString('en-US')} included processed orders. Processing will continue normally at $${rate} per additional order.`,
  };
}

export async function persistBillingUsageThresholdAlert(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    tier: Tier;
    usagePeriodId: number;
    previousProcessed: number;
    projectedProcessed: number;
  },
): Promise<BillingUsageNotificationIntent | null> {
  const includedAllowance = standardLimits(params.tier).shippedOrderCap;
  const rateCents = PLAN_PROCESSED_ORDER_OVERAGE_CENTS[params.tier];
  if (includedAllowance <= 0 || rateCents == null) return null;

  const threshold = selectHighestBillingUsageThresholdCrossed({
    previousProcessed: params.previousProcessed,
    projectedProcessed: params.projectedProcessed,
    includedAllowance,
  });
  if (!threshold) return null;

  const copy = copyForThreshold({
    threshold,
    used: params.projectedProcessed,
    included: includedAllowance,
    rateCents,
  });

  const inserted = await trx('alerts')
    .insert({
      shop_id: params.shopId,
      alert_key: billingUsageAlertKey(params.usagePeriodId, threshold),
      source: 'billing',
      alert_type: 'billing_usage_threshold',
      severity: threshold === 75 ? 'info' : 'warning',
      title: copy.title,
      message: copy.message,
      entity_id: String(params.usagePeriodId),
      entity_type: 'shop_usage_period',
      revenue_impact: null,
      is_active: true,
      category: 'money_margin',
      audience: 'owner',
      dismissed_at: null,
    })
    .onConflict(['shop_id', 'alert_key'])
    .ignore()
    .returning('id');

  if (inserted.length === 0) return null;

  return {
    shopId: params.shopId,
    title: copy.title,
    body: copy.message,
    route: '/settings/billing',
  };
}
