import Stripe from 'stripe';
import { withTenant } from '@lasyncro/backend-core/db.js';
import type { WebhookEnvelope } from '../../api/webhooks/types.js';
import type { SubscriptionTransitionInput } from './subscriptionTransition.service.js';

type Expected = NonNullable<SubscriptionTransitionInput['expectedCurrent']>;
interface StripeAuthority {
  shopId: number;
  eventId: string;
  ignored: boolean;
  expectedCurrent: Expected;
  subscription?: Stripe.Subscription;
}

// Only this pre-transaction provider boundary can issue authority. Missing
// attribution (including a router-caught provider error) always fails closed.
const issued = new WeakSet<object>();
function issue(authority: StripeAuthority): StripeAuthority {
  Object.freeze(authority.expectedCurrent);
  Object.freeze(authority);
  issued.add(authority);
  return authority;
}
export function requireStripeSubscriptionAuthority(envelope: WebhookEnvelope, value: unknown): StripeAuthority {
  const authority = value as StripeAuthority | undefined;
  if (!authority || !issued.has(authority) || authority.shopId !== envelope.shopId || authority.eventId !== envelope.eventId) {
    throw new Error('[stripe-authority] verified pre-transaction authority required');
  }
  return authority;
}
function id(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value) return id(value.id);
  return null;
}

/** Reads release their transaction before any SDK request. No receipt-order LWW. */
export async function attributeStripeSubscription(envelope: WebhookEnvelope): Promise<StripeAuthority> {
  const shopId = envelope.shopId;
  const notification = envelope.rawPayload as Record<string, any>;
  const subscriptionId = id(notification?.id);
  const customerId = id(notification?.customer);
  if (!shopId || envelope.verified !== true || !subscriptionId || !customerId ||
      (notification.metadata?.shopId !== undefined && notification.metadata.shopId !== String(shopId))) {
    throw new Error('[stripe-authority] invalid verified subscription notification');
  }

  const observed = await withTenant(shopId, async trx => {
    const current = await trx('shop_subscriptions').where({ shop_id: shopId })
      .first('*', trx.raw('updated_at::text AS stripe_state_version'));
    // A verified, successfully processed Checkout receipt is establishment
    // evidence, not the state oracle. Re-fetch that session before using it.
    const checkout = current?.stripe_subscription_id === subscriptionId ? undefined :
      await trx('integration_webhook_events')
        .where({ shop_id: shopId, integration: 'stripe', event_type: 'checkout.session.completed', verified: true, processing_status: 'processed' })
        .whereRaw("payload->>'subscription' = ?", [subscriptionId])
        .whereRaw("payload->>'customer' = ?", [customerId])
        .whereRaw("payload->>'mode' = 'subscription'")
        .first('payload');
    return { current, checkout };
  });
  const { current, checkout } = observed;
  const expectedCurrent: Expected = current ? {
    exists: true, tier: current.tier, status: current.status, billingProvider: current.billing_provider,
    stripeSubscriptionId: current.stripe_subscription_id, stripeCustomerId: current.stripe_customer_id,
    billingInterval: current.billing_interval, extraSeats: current.extra_seats,
    trialEndsAt: current.trial_ends_at,
    currentPeriodStart: current.current_period_start,
    currentPeriodEnd: current.current_period_end,
    // Equality token, never ordering authority; keep PostgreSQL precision.
    stripeStateVersion: current.stripe_state_version,
  } : { exists: false };
  const base = { shopId, eventId: envelope.eventId, expectedCurrent };

  if (current && current.billing_provider !== 'stripe') throw new Error('[stripe-authority] foreign billing provider');
  if (current?.stripe_customer_id && current.stripe_customer_id !== customerId) throw new Error('[stripe-authority] customer mismatch');
  const establishment = !current?.stripe_customer_id || current.stripe_subscription_id !== subscriptionId;
  if (establishment && !checkout) {
    // An obsolete ID cannot be promoted by its own delayed notification.
    if (current?.stripe_subscription_id) return issue({ ...base, ignored: true });
    throw new Error('[stripe-authority] verified checkout relationship required');
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('[stripe-authority] Stripe credentials unavailable');
  const stripe = new Stripe(key, { apiVersion: '2026-06-24.dahlia', timeout: 5000, maxNetworkRetries: 0 });
  if (establishment) {
    const sessionId = id(checkout?.payload?.id);
    if (!sessionId) throw new Error('[stripe-authority] invalid checkout receipt');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== 'subscription' || session.status !== 'complete' ||
        !['paid', 'no_payment_required'].includes(session.payment_status) ||
        id(session.customer) !== customerId || id(session.subscription) !== subscriptionId ||
        session.metadata?.shopId !== String(shopId)) throw new Error('[stripe-authority] replacement not authorized');
    // A historical checkout must not resurrect an obsolete subscription.
    // Refuse ambiguous/truncated provider results rather than selecting by time.
    const candidates = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const eligible = candidates.data.filter(sub => ['active', 'trialing', 'past_due'].includes(sub.status));
    if (candidates.has_more || eligible.length !== 1 || eligible[0].id !== subscriptionId ||
        id(eligible[0].customer) !== customerId) throw new Error('[stripe-authority] current subscription authority ambiguous');
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.id !== subscriptionId || id(subscription.customer) !== customerId ||
      (subscription.metadata?.shopId !== undefined && subscription.metadata.shopId !== String(shopId))) {
    throw new Error('[stripe-authority] provider relationship mismatch');
  }
  return issue({ ...base, ignored: false, subscription });
}
