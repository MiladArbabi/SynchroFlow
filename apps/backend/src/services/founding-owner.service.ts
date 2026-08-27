// apps/backend/src/services/founding-owner.service.ts

/**
 * FOUNDING OWNER RESOLUTION (CANONICAL)
 * --------------------------------------
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 1.
 *
 * Extracted unchanged from orders.create.ts's original inline query.
 * Resolves the shop's founding owner — the earliest 'owner' membership,
 * ordered by created_at then id for determinism when multiple owner rows
 * share a timestamp.
 *
 * Lifecycle is shop-scoped but permanently anchored to the founding owner
 * (LIFECYCLE-ID-01). Every caller that performs the FIRST lifecycle
 * transition for a shop MUST resolve the owner through this one function —
 * do not inline this query at a second call site. Do not iterate
 * shop_memberships elsewhere for lifecycle-anchoring purposes.
 *
 * Throws if no owner membership exists — a fatal invariant violation, not
 * a recoverable case.
 */
import { Knex } from 'knex';

export async function resolveFoundingOwner(
  shopId: number,
  trx: Knex.Transaction
): Promise<number> {
  const foundingOwner = await trx('shop_memberships')
    .where({ shop_id: shopId, role: 'owner' })
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .first<{ user_id: number }>('user_id');

  if (!foundingOwner?.user_id) {
    throw new Error(`LIFECYCLE_FOUNDING_OWNER_MISSING: shopId=${shopId}`);
  }

  return foundingOwner.user_id;
}
