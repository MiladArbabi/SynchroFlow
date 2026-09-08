// apps/backend/src/api/billing/handlers/handleSubscriptionDeleted.ts
//
// Handles: customer.subscription.deleted
//
// Responsibility:
//   - Mark shop_subscriptions status as 'canceled'
//   - Does NOT revoke entitlements (handled by separate revocation flow)
//   - Logs loud for ops visibility
//
// ISS-RLS3/4: trx REQUIRED — previously used bare db import, exposed
// to the same RLS-blind pattern confirmed on handleSubscriptionUpsert.ts.
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { captureEvent } from '../../../utils/analytics.js';
import { getTierConfig, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementRevocationService } from '../../../services/entitlement-revocation.service.js';
import { transitionShopSubscription } from '../../../services/billing/subscriptionTransition.service.js';
export async function handleSubscriptionDeleted(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const sub = envelope.rawPayload as any;
  const shopId = envelope.shopId;
  if (!shopId) {
    console.error('[billing][subscription_deleted] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][subscription_deleted] shopId required');
  }
  const canceledAt = sub?.canceled_at ? new Date(sub.canceled_at * 1000) : new Date();

  // SHB-14b: capture prior tier before overwrite — mirrors ISS-C19's
  // downgrade-diff pattern in handleSubscriptionUpsert. Hard delete is
  // unambiguously terminal, so unlike that handler there is no "same tier
  // or upgrade" case to guard against — any priorTier other than starter
  // itself always has something to revoke.
  const priorRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');
  const priorTier = priorRow?.tier as Tier | undefined;

  // SHB-14: hard delete is unambiguously terminal — force starter here too,
  // since this handler previously left tier untouched entirely, relying on
  // handleSubscriptionUpsert to have already caught it (it hadn't).
  // BILL-ENTITLEMENT-01: tier + status are entitlement-authoritative, so this
  // terminal downgrade goes through the canonical transition service.
  // canceled_at is an accompanying non-authoritative field, written in the
  // same statement exactly as before.
  //
  // The old "no subscription row" guard was `updated === 0`; it is now the
  // absence of priorRow, which is the same condition read one statement
  // earlier. A cancellation must never CREATE a subscription row.
  if (!priorRow) {
    // Non-fatal: shop may not have a subscription row if never activated
    console.warn('[billing][subscription_deleted] no subscription row found for shop', { shopId, eventId: envelope.eventId });
    return;
  }

  await transitionShopSubscription(
    {
      shopId,
      to: { tier: 'starter', status: 'canceled' },
      fields: { canceled_at: canceledAt },
      source: 'stripe_webhook',
      reason: 'customer.subscription.deleted',
      actorType: 'stripe',
      actingProvider: 'stripe',
      externalEventId: envelope.eventId,
      idempotencyKey: envelope.eventId,
      occurredAt: envelope.receivedAt,
    },
    trx
  );

  // SHB-14b: revoke whatever the prior paid tier granted that starter does
  // not. No re-seed call needed — starter modules were already granted
  // additively at signup and are never touched by upgrade/downgrade flows.
  if (priorTier && priorTier !== 'starter') {
    const priorTierConfig = getTierConfig(priorTier);
    const starterTierConfig = getTierConfig('starter' as Tier);
    const starterModuleSet = new Set(starterTierConfig.modules);
    const starterFlagSet = new Set(starterTierConfig.flags);
    const modulesToRevoke = priorTierConfig.modules.filter((m) => !starterModuleSet.has(m));
    const flagsToRevoke = priorTierConfig.flags.filter((f) => !starterFlagSet.has(f));

    if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
      await EntitlementRevocationService.revokeEntitlements({
        shopId,
        scope: {
          modules: modulesToRevoke as string[],
          flags: flagsToRevoke as string[],
        },
        reason: `subscription_deleted:${priorTier}->starter`,
      });
      console.log('[billing][subscription_deleted] entitlements revoked', {
        shopId,
        priorTier,
        modulesToRevoke,
        flagsToRevoke,
      });
    }
  }

  console.log('[billing][subscription_deleted] complete', { shopId, canceledAt, eventId: envelope.eventId });
  /**
   * PH-03: subscription_cancelled — fires when Stripe confirms cancellation.
   * Critical churn signal — pair with paywall_hit and trial_expired
   * in PostHog to understand full churn journey.
   */
  captureEvent({
    shopId,
    event: 'subscription_cancelled',
    properties: {
      canceled_at: canceledAt.toISOString(),
    },
  });
}
