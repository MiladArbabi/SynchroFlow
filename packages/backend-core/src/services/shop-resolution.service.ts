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

import db from '../db.js'

/**
 * Canonical resolved shop context.
 */
export interface ResolvedShopContext {
  shopId: number;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
}

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
export async function resolveShopContextForUser(
  userId: number
): Promise<ResolvedShopContext | null> {
  // ─────────────────────────────────────────────────────────────
  // 🔒 Hard invariants
  // ─────────────────────────────────────────────────────────────
  if (!Number.isInteger(userId)) {
    throw new Error(
      'SHOP_RESOLUTION_INVARIANT_VIOLATION: invalid userId'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 🔍 Resolve active membership
  // ─────────────────────────────────────────────────────────────
  const memberships = await db('shop_memberships')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .select<ResolvedShopContext[]>('shop_id as shopId', 'role');

  if (memberships.length === 0) {
    return null;
  }

  if (memberships.length > 1) {
    // 🚨 This is a SYSTEM INVARIANT BREACH
    // The system currently does NOT support multi-shop sessions
    throw new Error(
      'SHOP_RESOLUTION_INVARIANT_VIOLATION: multiple active shop memberships'
    );
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
export async function resolveShopIdForUser(
  userId: number
): Promise<number | null> {
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
export async function requireShopContextForUser(
  userId: number
): Promise<ResolvedShopContext> {
  const ctx = await resolveShopContextForUser(userId);

  if (!ctx) {
    throw new Error(
      'SHOP_CONTEXT_REQUIRED: user has no active shop membership'
    );
  }

  return ctx;
}

/**
 * STRICT shop_id-only variant.
 *
 * Convenience wrapper for legacy call sites.
 */
export async function requireShopIdForUser(
  userId: number
): Promise<number> {
  const ctx = await requireShopContextForUser(userId);
  return ctx.shopId;
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
