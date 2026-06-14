// apps/backend/src/api/billing/stripe.meter.service.ts
//
// Stripe Meter Event Reporter
// ---------------------------
// Reports usage to Stripe Meters API for metered billing.
// Called after successful WMS pack-complete transaction.
//
// Non-fatal by design — billing failures must never block fulfillment.
// On failure: logs error, does NOT throw.
//
// Meter: mtr_61UrYp20kD4rNHkAv41755hv1pAEDVOC (event_name: 'overage')
// Triggered by: shipped_orders exceeding TIER_CONFIG[tier].shippedOrderCap
//
// Readers:
//   - wms.controller.ts (httpPackComplete)
//
// CHANGE POLICY:
//   Meter ID lives in STRIPE_METER_ID_OVERAGE env var.
//   Never hardcode meter IDs here.

import Stripe from 'stripe';
import db from '@lasyncro/backend-core/db.js';
import { getTierConfig, isValidTier } from '@lasyncro/backend-core/config/tiers.js';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('[stripe.meter] STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
}

/**
 * Reports shipped order overage units to Stripe Meter.
 * Only reports units above the tier's shippedOrderCap.
 * Safe to call on every pack-complete — exits early if no overage.
 *
 * @param shopId - shop that completed packing
 * @param newlyShipped - units shipped in this batch (already incremented in DB)
 */
export async function reportShippedOrderOverage(
  shopId: number,
  newlyShipped: number,
): Promise<void> {
  try {
    const sub = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'stripe_customer_id', 'status');

    if (!sub?.stripe_customer_id) {
      // No Stripe customer — trial or starter, no overage billing
      return;
    }

    const rawTier = sub.tier ?? 'starter';
    const tier = isValidTier(rawTier) ? rawTier : 'starter';
    const { shippedOrderCap } = getTierConfig(tier);

    // Scale tier: unlimited — never report overage
    if (!isFinite(shippedOrderCap)) return;

    // Read current period shipped_orders to calculate overage
    const usageRow = await db('shop_usage_metrics')
      .where({ shop_id: shopId })
      .whereNull('period_ends_at')
      .first('shipped_orders');

    const totalShipped = Number(usageRow?.shipped_orders ?? 0);
    const previousTotal = totalShipped - newlyShipped;

    // Units newly crossing above the cap in this batch
    const alreadyOverBefore = Math.max(0, previousTotal - shippedOrderCap);
    const nowOver = Math.max(0, totalShipped - shippedOrderCap);
    const overageUnits = nowOver - alreadyOverBefore;

    if (overageUnits <= 0) return;

    const meterId = process.env.STRIPE_METER_ID_OVERAGE;
    if (!meterId) {
      console.error('[stripe.meter] STRIPE_METER_ID_OVERAGE not set');
      return;
    }

    const stripe = getStripe();
    await stripe.billing.meterEvents.create({
      event_name: 'overage',
      payload: {
        stripe_customer_id: sub.stripe_customer_id,
        value: String(overageUnits),
      },
    });

    console.info('[stripe.meter] overage reported', {
      shopId,
      tier,
      totalShipped,
      shippedOrderCap,
      overageUnits,
    });
  } catch (err: any) {
    // Non-fatal — log and continue. Never throw from billing into fulfillment path.
    console.error('[stripe.meter] reportShippedOrderOverage failed (non-fatal)', {
      shopId,
      error: err?.message,
    });
  }
}