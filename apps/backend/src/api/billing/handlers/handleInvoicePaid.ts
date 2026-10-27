// FI-002 — Stripe paid-cycle usage rotation.
//
// Invoice-level period_start/period_end are not subscription-cycle authority.
// Only a paid renewal invoice with an attributable, non-prorated base-price
// subscription line can advance the allowance boundary.
//
// Lock order is deliberately 91002 -> 91001, matching the canonical
// subscription-transition -> usage-rotation order.

import type { Knex } from 'knex';
import type { WebhookEnvelope } from '../../webhooks/types.js';
import { isValidTier } from '@lasyncro/backend-core/config/tiers.js';
import {
  resolveStripePriceIdentity,
} from '../../../services/billing/providerPriceResolver.service.js';

const TRANSITION_LOCK = 91002;
const USAGE_LOCK = 91001;

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return stripeId(value.id);
  }
  return null;
}

function periodSeconds(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`[billing][invoice_paid] invalid ${label}`);
  }
  return value;
}

export async function handleInvoicePaid(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const shopId = envelope.shopId;
  const invoice = envelope.rawPayload as Record<string, any>;

  if (
    !shopId ||
    envelope.integration !== 'stripe' ||
    envelope.eventType !== 'invoice.payment_succeeded' ||
    envelope.verified !== true
  ) {
    throw new Error('[billing][invoice_paid] invalid verified envelope');
  }

  if (
    !invoice ||
    invoice.status !== 'paid' ||
    invoice.billing_reason !== 'subscription_cycle'
  ) {
    throw new Error('[billing][invoice_paid] not a paid renewal cycle');
  }

  const customerId = stripeId(invoice.customer);
  const invoiceSubscriptionId = stripeId(invoice.subscription);
  const parentSubscriptionId = stripeId(
    invoice.parent?.subscription_details?.subscription
  );

  if (
    !customerId ||
    (!invoiceSubscriptionId && !parentSubscriptionId) ||
    (
      invoiceSubscriptionId &&
      parentSubscriptionId &&
      invoiceSubscriptionId !== parentSubscriptionId
    )
  ) {
    throw new Error('[billing][invoice_paid] ambiguous invoice identity');
  }

  const subscriptionId =
    parentSubscriptionId ?? invoiceSubscriptionId!;

  const metadataShopId =
    invoice.metadata?.shopId ?? invoice.metadata?.shop_id;

  if (
    metadataShopId !== undefined &&
    String(metadataShopId) !== String(shopId)
  ) {
    throw new Error('[billing][invoice_paid] shop attribution mismatch');
  }

  if (
    !Array.isArray(invoice.lines?.data) ||
    invoice.lines.has_more === true
  ) {
    throw new Error('[billing][invoice_paid] incomplete invoice lines');
  }

  const candidates = invoice.lines.data.filter((line: any) =>
    line?.parent?.type === 'subscription_item_details' &&
    line.parent.subscription_item_details?.proration === false &&
    stripeId(line.parent.subscription_item_details?.subscription) ===
      subscriptionId
  );

  const baseLines = candidates.filter((line: any) => {
    const priceId = stripeId(line?.pricing?.price_details?.price);

    if (!priceId) {
      throw new Error('[billing][invoice_paid] missing line price');
    }

    // Unknown prices fail closed through the canonical resolver.
    const price = resolveStripePriceIdentity(priceId);
    return price.itemKind === 'base';
  });

  if (baseLines.length !== 1) {
    throw new Error('[billing][invoice_paid] ambiguous base-price line');
  }

  const line = baseLines[0];

  const startSeconds = periodSeconds(
    line.period?.start,
    'service period start'
  );
  const endSeconds = periodSeconds(
    line.period?.end,
    'service period end'
  );

  if (endSeconds <= startSeconds) {
    throw new Error('[billing][invoice_paid] invalid period ordering');
  }

  const periodStart = new Date(startSeconds * 1000);
  const periodEnd = new Date(endSeconds * 1000);

  // Serialize against both subscription transitions and usage writers.
  // Acquiring these in reverse order could deadlock FI-001 reconciliation.
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [
    TRANSITION_LOCK,
    shopId,
  ]);

  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [
    USAGE_LOCK,
    shopId,
  ]);

  const sub = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first(
      'tier',
      'status',
      'billing_provider',
      'stripe_customer_id',
      'stripe_subscription_id',
      'current_period_start'
    )
    .forUpdate();

  if (
    !sub ||
    sub.billing_provider !== 'stripe' ||
    sub.stripe_customer_id !== customerId ||
    sub.stripe_subscription_id !== subscriptionId ||
    !['active', 'past_due'].includes(sub.status)
  ) {
    throw new Error('[billing][invoice_paid] subscription authority mismatch');
  }

  const rawTier = sub.tier;

  if (!isValidTier(rawTier) || rawTier === 'starter') {
    throw new Error('[billing][invoice_paid] no eligible paid tier');
  }

  const basePriceId = stripeId(line.pricing.price_details.price)!;
  const priceIdentity = resolveStripePriceIdentity(basePriceId);

  if (priceIdentity.tier !== rawTier) {
    throw new Error('[billing][invoice_paid] tier price mismatch');
  }

  // A delayed invoice is historical evidence, not reset authority.
  if (
    sub.current_period_start &&
    new Date(sub.current_period_start).getTime() >
      periodStart.getTime()
  ) {
    return;
  }

  const existing = await trx('shop_usage_metrics')
    .where({ shop_id: shopId })
    .whereNull('period_ends_at')
    .orderBy('period_starts_at', 'desc')
    .first('id', 'period_starts_at');

  if (existing) {
    const openStart = new Date(existing.period_starts_at).getTime();

    // Replay or out-of-order invoice: preserve existing counters.
    if (openStart >= periodStart.getTime()) {
      return;
    }

    await trx('shop_usage_metrics')
      .where({ id: existing.id, shop_id: shopId })
      .whereNull('period_ends_at')
      .update({
        period_ends_at: periodStart,
        updated_at: new Date(),
      });
  }

  await trx('shop_usage_metrics').insert({
    shop_id: shopId,
    tier_at_period_start: rawTier,
    period_starts_at: periodStart,
    period_ends_at: null,
    ingested_orders: 0,
    shipped_orders: 0,
    storage_bytes: 0,
    barcodes_generated: 0,
    pruned_rows: 0,
  });

  console.info('[billing][invoice_paid] paid cycle rotated', {
    shopId,
    invoiceId: stripeId(invoice.id),
    subscriptionId,
    periodStart,
    periodEnd,
    eventId: envelope.eventId,
  });
}
