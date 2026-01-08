// apps/backend/src/services/shop-resolution.service.ts

/**
 * Shop Resolution Service
 * =======================
 *
 * SINGLE responsibility:
 *   Resolve the authoritative shop_id for a given authenticated user.
 *
 * This service exists to:
 * - Centralize shop resolution logic
 * - Decouple controllers from schema details
 * - Enable a clean transition from:
 *     users.shop_id  ➜  shop_memberships
 *
 * ⚠️ Controllers MUST NOT:
 *   - Query users.shop_id directly
 *   - Infer shop ownership or roles
 *
 * All such logic belongs here.
 */

import db from "api-src/db";

/**
 * Resolve the active shop_id for a user.
 *
 * Current behavior (Sprint 1):
 * - Reads from users.shop_id (legacy coupling)
 *
 * Future behavior (Sprint 2+):
 * - Resolve via shop_memberships
 * - Enforce role / activation / lifecycle rules
 *
 * @param userId Authenticated user id (hard invariant)
 * @returns shop_id or null if unresolved
 */
export async function resolveShopIdForUser(
  userId: number
): Promise<number | null> {
  // ─────────────────────────────────────────────────────────────
  // 🔒 Hard invariants
  // ─────────────────────────────────────────────────────────────

  if (!Number.isInteger(userId)) {
    throw new Error(
      'SHOP_RESOLUTION_INVARIANT_VIOLATION: invalid userId'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 🟡 Legacy resolution path (Sprint 1)
  // ─────────────────────────────────────────────────────────────
  // NOTE:
  // - This is intentionally dumb.
  // - Do NOT add role logic here yet.
  // - Do NOT infer ownership.
  //
  // This path will be removed once shop_memberships is authoritative.

  const row = await db('users')
    .where({ id: userId })
    .first<{ shop_id: number | null }>('shop_id');

  if (!row || typeof row.shop_id !== 'number') {
    return null;
  }

  return row.shop_id;
}

/**
 * STRICT variant of shop resolution.
 *
 * Use this when the endpoint MUST have a shop context.
 * Example:
 * - dashboard
 * - analytics
 * - integrations
 *
 * @throws if shop_id cannot be resolved
 */
export async function requireShopIdForUser(
  userId: number
): Promise<number> {
  const shopId = await resolveShopIdForUser(userId);

  if (typeof shopId !== 'number') {
    throw new Error(
      'SHOP_CONTEXT_REQUIRED: user has no resolved shop'
    );
  }

  return shopId;
}


/**
 * FUTURE EXTENSION POINTS (INTENTIONAL NO-OPS)
 * -------------------------------------------
 *
 * These are documented now to prevent ad-hoc logic later.
 *
 * Planned additions:
 * - resolveActiveShopForUser(userId, options)
 * - resolveShopAndRoleForUser(userId)
 * - enforceShopRole(userId, shopId, requiredRole)
 *
 * DO NOT implement prematurely.
 */