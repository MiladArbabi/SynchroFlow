// apps/backend/src/services/shop-resolution.service.ts
/**
 * Shop Resolution Service
 * =======================
 *
 * Authoritative resolver for shop context.
 *
 * This service is the ONLY place allowed to:
 * - Resolve shop_id for a user
 * - Resolve shop role for a user
 * - Enforce membership invariants
 *
 * ❌ Controllers MUST NOT:
 *   - Read users.shop_id
 *   - Query shop_memberships directly
 *   - Infer roles or ownership
 *
 * ✅ All shop context flows through this file.
 */
import { withTenant } from '../db.js';
import { resolveActiveShopMemberships } from './pre-tenant.service.js';
/**
 * Resolve the ACTIVE shop membership for a user.
 *
 * Rules:
 * - userId must be valid
 * - exactly ONE active membership must exist
 * - revoked memberships are ignored
 *
 * @param userId authenticated user id (HARD invariant)
 * @returns ResolvedShopContext | null
 */
export async function resolveShopContextForUser(userId) {
    // ─────────────────────────────────────────────────────────────
    // 🔒 Hard invariants
    // ─────────────────────────────────────────────────────────────
    if (!Number.isInteger(userId)) {
        throw new Error('SHOP_RESOLUTION_INVARIANT_VIOLATION: invalid userId');
    }
    // ─────────────────────────────────────────────────────────────
    // 🔍 Resolve active membership
    // ─────────────────────────────────────────────────────────────
    // Authentication starts before a tenant is known. The resolver is a narrow
    // SECURITY DEFINER function that returns membership metadata only; the
    // runtime role never receives cross-tenant table visibility.
    const memberships = await resolveActiveShopMemberships(userId);
    if (memberships.length === 0) {
        return null;
    }
    if (memberships.length > 1) {
        // 🚨 This is a SYSTEM INVARIANT BREACH
        // The system currently does NOT support multi-shop sessions
        throw new Error('SHOP_RESOLUTION_INVARIANT_VIOLATION: multiple active shop memberships');
    }
    return memberships[0];
}
/**
 * Resolve shop_id ONLY.
 *
 * Use when:
 * - Role is irrelevant
 * - You only need a shop boundary
 *
 * @returns shopId | null
 */
export async function resolveShopIdForUser(userId) {
    const ctx = await resolveShopContextForUser(userId);
    return ctx ? ctx.shopId : null;
}
/**
 * STRICT shop resolution.
 *
 * Use for endpoints that MUST have shop context.
 *
 * Example:
 * - dashboard
 * - analytics
 * - integrations
 *
 * @throws if shop context cannot be resolved
 */
export async function requireShopContextForUser(userId) {
    const ctx = await resolveShopContextForUser(userId);
    if (!ctx) {
        throw new Error('SHOP_CONTEXT_REQUIRED: user has no active shop membership');
    }
    return ctx;
}
/**
 * STRICT shop_id-only variant.
 *
 * Convenience wrapper for legacy call sites.
 */
export async function requireShopIdForUser(userId) {
    const ctx = await requireShopContextForUser(userId);
    return ctx.shopId;
}
/**
 * Resolve the active subscription tier for a shop.
 *
 * Falls back to 'starter' if no subscription row exists.
 * Never throws — degrading to free tier is always safe.
 *
 * Used by:
 *   - token.service.ts (JWT tier claim, MON-03)
 *   - require-entitlement middleware (MON-03)
 */
export async function resolveTierForShop(shopId) {
    const row = await withTenant(shopId, (trx) => trx('shop_subscriptions')
        .where({ shop_id: shopId })
        .first('tier'));
    if (!row) {
        console.warn('[shop-resolution] no subscription row for shop, defaulting to starter', { shopId });
        return 'starter';
    }
    return row.tier;
}
/**
 * FUTURE EXTENSION (DOCUMENTED, NOT IMPLEMENTED)
 * ----------------------------------------------
 *
 * Planned:
 * - resolveAllShopsForUser(userId)
 * - enforceShopRole(userId, shopId, minimumRole)
 * - switchActiveShop(userId, shopId)
 *
 * DO NOT add ad-hoc logic elsewhere.
 */
