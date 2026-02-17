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
export declare function resolveShopContextForUser(userId: number): Promise<ResolvedShopContext | null>;
/**
 * Resolve shop_id ONLY.
 *
 * Use when:
 * - Role is irrelevant
 * - You only need a shop boundary
 *
 * @returns shopId | null
 */
export declare function resolveShopIdForUser(userId: number): Promise<number | null>;
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
export declare function requireShopContextForUser(userId: number): Promise<ResolvedShopContext>;
/**
 * STRICT shop_id-only variant.
 *
 * Convenience wrapper for legacy call sites.
 */
export declare function requireShopIdForUser(userId: number): Promise<number>;
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
