// apps/backend/src/services/billing/subscriptionTransition.service.ts
//
// BILL-ENTITLEMENT-01 / P0-B2 — canonical commercial subscription transition.
// ============================================================================
// THE ONE place allowed to mutate entitlement-authoritative subscription state:
//
//     shop_subscriptions.tier
//     shop_subscriptions.status
//     shop_subscriptions.billing_provider
//
// Every change to those three columns produces an append-only provenance row
// in shop_subscription_transitions (migration 0167) recording the complete
// before -> after triple plus who/what/why. Nine runtime writers previously
// mutated them directly, leaving entitlement changes unattributable.
//
// The architecture boundary is enforced by
// tests/contract/commercial-subscription-writer-boundary.contract.test.ts.
//
// WHAT THIS SERVICE DOES NOT DO
//   It does not normalize source-specific semantics. Stripe cancellation and
//   Shopify force-downgrade record status 'canceled'; trial expiry records
//   'active'. Those differences are the callers' product semantics and are
//   recorded verbatim, not harmonized here.
//
//   It does not grant or revoke entitlements. Callers keep their existing
//   EntitlementsService / EntitlementRevocationService behaviour unchanged.
//
//   It is not an overage/preference writer. allow_overage and
//   stripe_customer_id-only writes are non-authoritative and stay outside this
//   boundary by design.

import type { Knex } from 'knex';

/**
 * Namespace for the per-shop transaction advisory lock. Distinct from
 * usagePeriod.service.ts's 91001 so a usage-period rotation and a subscription
 * transition never serialize against each other unnecessarily.
 */
const SUBSCRIPTION_TRANSITION_LOCK_NAMESPACE = 91002;

const LEDGER_TABLE = 'shop_subscription_transitions';
const SUBSCRIPTION_TABLE = 'shop_subscriptions';

/**
 * Column defaults declared by migration 0090. Used ONLY on the creation path,
 * for authoritative dimensions the caller did not specify, so the ledger's
 * to_* values always describe the row that actually exists.
 */
const CREATION_DEFAULTS = {
  tier: 'starter',
  status: 'trialing',
  billingProvider: 'stripe',
} as const;

export type ProviderId = 'stripe' | 'shopify';

export type AuthoritativeState = {
  tier: string;
  status: string;
  billingProvider: string;
};

export interface SubscriptionTransitionInput {
  shopId: number;

  /**
   * Requested after-state. An OMITTED key means "leave that authoritative
   * dimension unchanged" — it is not the same as passing the current value,
   * and on the creation path an omitted key falls back to the column default.
   */
  to: {
    tier?: string;
    status?: string;
    billingProvider?: string;
  };

  /**
   * Accompanying NON-authoritative subscription columns written in the same
   * statement (billing_interval, period bounds, seats, trial window, provider
   * handles, ...). These never produce a ledger row on their own.
   */
  fields?: Record<string, unknown>;

  // Mandatory provenance. Enforced NOT NULL by the ledger schema.
  source: string;
  reason: string;
  actorType: string;

  actorId?: string | null;
  externalEventId?: string | null;

  /**
   * When non-null, the transition is applied at most once per shop. Uniqueness
   * is scoped to (shop_id, idempotency_key) by a partial unique index; the
   * per-shop advisory lock below makes the pre-check race-free rather than
   * best-effort.
   */
  idempotencyKey?: string | null;

  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;

  /**
   * BILL-ENTITLEMENT-01 / P0-B3 — provider ownership.
   *
   * The provider whose event is driving this transition. Normal Stripe webhook
   * callers declare 'stripe'; normal Shopify webhook/reconciliation callers
   * declare 'shopify'.
   *
   * OMITTED means "not a provider event" (auth registration, the trial-expiry
   * worker, system corrections). Those keep their pre-P0-B3 behaviour exactly
   * and are never treated as foreign-provider events.
   */
  actingProvider?: ProviderId;

  /**
   * Explicit, separately-authorized provider migration. Only a genuinely
   * deliberate switch may set this — an App Store install/reconnect asserting
   * Shopify ownership, or an operator-run commercial migration. It must never
   * be set by an ordinary recurring provider event.
   */
  allowProviderSwitch?: boolean;
}

export interface SubscriptionTransitionResult {
  /** True when authoritative state changed and a ledger row was written. */
  applied: boolean;
  /** True when this call created the shop_subscriptions row. */
  created: boolean;
  /** True when a non-null idempotency key had already been applied. */
  duplicate: boolean;
  /** Authoritative state before the call; null on creation. */
  from: AuthoritativeState | null;
  /** Authoritative state after the call. */
  to: AuthoritativeState;
  /** Ledger row id, or null when nothing authoritative changed. */
  transitionId: string | null;
}

/**
 * Raised when a provider event targets a tenant owned by the other provider.
 * Distinct class so callers/tests can tell an ownership refusal apart from a
 * mapping or database failure.
 */
export class ProviderOwnershipError extends Error {
  readonly shopId: number;
  readonly actingProvider: ProviderId;
  readonly currentProvider: string;

  constructor(shopId: number, actingProvider: ProviderId, currentProvider: string) {
    super(
      `[subscription-transition] provider ownership violation: shop ${shopId} is billed by ` +
        `'${currentProvider}' but a '${actingProvider}' event attempted to change ` +
        `entitlement-authoritative state. An explicit provider migration must set ` +
        `allowProviderSwitch.`
    );
    this.name = 'ProviderOwnershipError';
    this.shopId = shopId;
    this.actingProvider = actingProvider;
    this.currentProvider = currentProvider;
  }
}

interface SubscriptionRow {
  tier: string;
  status: string;
  billing_provider: string;
}

/**
 * Applies an entitlement-authoritative subscription change and records its
 * provenance, atomically, inside the caller's transaction.
 *
 * `trx` MUST be the caller's active tenant-scoped transaction. Typed as Knex
 * rather than Knex.Transaction because withTenant() currently widens its
 * runtime transaction callback (same convention as usagePeriod.service.ts).
 * The subscription mutation and the ledger INSERT share that one transaction:
 * if either fails, neither survives.
 */
export async function transitionShopSubscription(
  input: SubscriptionTransitionInput,
  trx: Knex
): Promise<SubscriptionTransitionResult> {
  const { shopId } = input;

  /**
   * Serialize per shop BEFORE reading current state.
   *
   * A row lock on shop_subscriptions is not sufficient: on the creation path
   * the row does not exist yet, so there is nothing to lock and two concurrent
   * installs could both insert. A transaction-scoped advisory lock keyed on
   * shopId covers creation and update identically, and is released on commit
   * or rollback. This is what makes the competing-transition history a serial
   * chain instead of two writers both acting on the same stale state.
   */
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [
    SUBSCRIPTION_TRANSITION_LOCK_NAMESPACE,
    shopId,
  ]);

  const current = (await trx(SUBSCRIPTION_TABLE)
    .where({ shop_id: shopId })
    .first('tier', 'status', 'billing_provider')) as SubscriptionRow | undefined;

  const from: AuthoritativeState | null = current
    ? {
        tier: current.tier,
        status: current.status,
        billingProvider: current.billing_provider,
      }
    : null;

  /**
   * PROVIDER OWNERSHIP GATE — BILL-ENTITLEMENT-01 / P0-B3.
   *
   * Enforced HERE, at the one boundary every authoritative write already goes
   * through, rather than only in individual controllers. billing.controller.ts's
   * 403 APP_STORE_MERCHANT guards remain as defence in depth on the outbound
   * side; this is the inbound guarantee.
   *
   * Runs after the advisory lock and after reading current state, so the
   * decision is made against a value no competing transition can change until
   * this transaction ends — a check-then-act race cannot let a foreign write
   * land in the gap.
   *
   * A shop with no subscription row is unowned: first-provider initialization
   * is always legitimate.
   */
  if (
    input.actingProvider !== undefined &&
    from !== null &&
    from.billingProvider !== input.actingProvider &&
    input.allowProviderSwitch !== true
  ) {
    throw new ProviderOwnershipError(shopId, input.actingProvider, from.billingProvider);
  }

  const idempotencyKey = input.idempotencyKey ?? null;

  if (idempotencyKey !== null) {
    // Race-free: the advisory lock above is held for the rest of this
    // transaction, so no competing transition for this shop can interleave
    // between this check and the INSERT below.
    const alreadyApplied = await trx(LEDGER_TABLE)
      .where({ shop_id: shopId, idempotency_key: idempotencyKey })
      .first('id', 'from_tier', 'from_status', 'from_billing_provider', 'to_tier', 'to_status', 'to_billing_provider');

    if (alreadyApplied) {
      return {
        applied: false,
        created: false,
        duplicate: true,
        from:
          alreadyApplied.from_tier === null
            ? null
            : {
                tier: alreadyApplied.from_tier,
                status: alreadyApplied.from_status,
                billingProvider: alreadyApplied.from_billing_provider,
              },
        to: {
          tier: alreadyApplied.to_tier,
          status: alreadyApplied.to_status,
          billingProvider: alreadyApplied.to_billing_provider,
        },
        transitionId: String(alreadyApplied.id),
      };
    }
  }

  const to: AuthoritativeState = {
    tier: input.to.tier ?? from?.tier ?? CREATION_DEFAULTS.tier,
    status: input.to.status ?? from?.status ?? CREATION_DEFAULTS.status,
    billingProvider:
      input.to.billingProvider ?? from?.billingProvider ?? CREATION_DEFAULTS.billingProvider,
  };

  const created = from === null;
  const authoritativeChanged =
    created ||
    from.tier !== to.tier ||
    from.status !== to.status ||
    from.billingProvider !== to.billingProvider;

  const fields = input.fields ?? {};
  const now = new Date();
  const occurredAt = input.occurredAt ?? now;

  if (created) {
    await trx(SUBSCRIPTION_TABLE).insert({
      shop_id: shopId,
      tier: to.tier,
      status: to.status,
      billing_provider: to.billingProvider,
      ...fields,
    });
  } else if (authoritativeChanged || Object.keys(fields).length > 0) {
    // Non-authoritative fields are still persisted when authoritative state is
    // unchanged — a reconciliation that only moves current_period_end must
    // land, without manufacturing a transition row for it.
    await trx(SUBSCRIPTION_TABLE)
      .where({ shop_id: shopId })
      .update({
        tier: to.tier,
        status: to.status,
        billing_provider: to.billingProvider,
        ...fields,
        updated_at: now,
      });
  }

  if (!authoritativeChanged) {
    return { applied: false, created: false, duplicate: false, from, to, transitionId: null };
  }

  /**
   * Provenance is validated by the ledger schema (source / reason / actor_type
   * are NOT NULL), deliberately NOT by a pre-check here. A missing reason must
   * abort the whole operation including the subscription mutation above —
   * short-circuiting before the write would make the atomicity guarantee
   * untested rather than enforced.
   */
  const [inserted] = await trx(LEDGER_TABLE)
    .insert({
      shop_id: shopId,
      from_tier: from?.tier ?? null,
      to_tier: to.tier,
      from_status: from?.status ?? null,
      to_status: to.status,
      from_billing_provider: from?.billingProvider ?? null,
      to_billing_provider: to.billingProvider,
      source: input.source,
      reason: input.reason,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      external_event_id: input.externalEventId ?? null,
      idempotency_key: idempotencyKey,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      occurred_at: occurredAt,
    })
    .returning('id');

  return {
    applied: true,
    created,
    duplicate: false,
    from,
    to,
    transitionId: String(inserted.id),
  };
}
