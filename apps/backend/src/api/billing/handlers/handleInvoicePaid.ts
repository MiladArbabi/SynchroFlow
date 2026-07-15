// apps/backend/src/api/billing/handlers/handleInvoicePaid.ts
//
// Handles: invoice.payment_succeeded
//
// Responsibility:
//   1. Close the current open billing period in shop_usage_metrics
//   2. Open a new period with zeroed counters + tier snapshot
//
// HARD RULES:
//   - Idempotent: if a current open period already has period_starts_at
//     matching current_period_start, skip (already reset for this cycle)
//   - Never delete closed periods — immutable audit trail
//   - shopId resolved from subscription metadata; fail loud if missing
//
// ISS-RLS3: trx REQUIRED — now uses the router's tenant-scoped trx
// directly instead of opening a redundant inner db.transaction(). The
// tier read below was verified NOT to have been RLS-blind (shop_subscriptions
// has a split SELECT policy per RLS_blueprint.md §4), but is converted
// to trx anyway for consistency with the rest of this handler.
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { isValidTier } from '@lasyncro/backend-core/config/tiers.js';
export async function handleInvoicePaid(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const invoice = envelope.rawPayload as any;
  const shopId = envelope.shopId;
  if (!shopId) {
    console.error('[billing][invoice_paid] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][invoice_paid] shopId required');
  }
  // Resolve new period boundaries from invoice
  const periodStart = invoice?.period_start
    ? new Date(invoice.period_start * 1000)
    : new Date();
  const periodEnd = invoice?.period_end
    ? new Date(invoice.period_end * 1000)
    : null;
  // Read current tier for period snapshot
  const sub = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');
  const rawTier = sub?.tier ?? 'starter';
  const tier = isValidTier(rawTier) ? rawTier : 'starter';
  // Idempotency: skip if open period already starts at this period_start
  const existing = await trx('shop_usage_metrics')
    .where({ shop_id: shopId })
    .whereNull('period_ends_at')
    .first('id', 'period_starts_at');
  if (
    existing &&
    existing.period_starts_at &&
    new Date(existing.period_starts_at).getTime() === periodStart.getTime()
  ) {
    console.info('[billing][invoice_paid] period already reset — skipping', { shopId, periodStart });
    return;
  }
  // 1. Close current open period
  if (existing) {
    await trx('shop_usage_metrics')
      .where({ id: existing.id })
      .update({ period_ends_at: periodStart, updated_at: new Date() });
  }
  // 2. Open new period
  await trx('shop_usage_metrics').insert({
    shop_id: shopId,
    tier_at_period_start: tier,
    period_starts_at: periodStart,
    period_ends_at: null,
    ingested_orders: 0,
    shipped_orders: 0,
    specter_sessions: 0,
    storage_bytes: 0,
    barcodes_generated: 0,
    pruned_rows: 0,
  });
  console.info('[billing][invoice_paid] billing period reset', {
    shopId,
    tier,
    periodStart,
    periodEnd,
    eventId: envelope.eventId,
  });
}
