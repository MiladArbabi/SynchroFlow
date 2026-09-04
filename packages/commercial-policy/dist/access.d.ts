import type { Tier } from './tiers.js';
export interface AccessRequirement {
    /** Canonical ModuleId the shop must have been granted. */
    moduleId?: string;
    /** Minimum tier. Omitted => no tier wall (Starter+). */
    minimumTier?: Tier;
    /** Canonical FeatureKey that must be included for the shop's tier. */
    feature?: string;
    /** Action the user must be permitted to perform (role/permission layer). */
    action?: string;
    /** Never true for an active capability — guarded by A1-C15. */
    openDecision?: boolean;
}
export interface AccessContext {
    tier: Tier;
    /** Modules effectively granted to the shop. */
    modules: ReadonlySet<string>;
    /** Feature flags effectively granted to the shop. */
    flags: ReadonlySet<string>;
    /** Optional: shop membership roles of the acting user. */
    roles?: readonly string[];
    /**
     * Optional: the fully-resolved set of actions the user may perform.
     * When a requirement has an `action`, the caller MUST supply this — the
     * commercial-policy package does not own the shop-configurable role→action
     * map. Absent + action required => fail closed (ROLE_FORBIDDEN).
     */
    allowedActions?: ReadonlySet<string>;
}
export type AccessReason = 'ALLOWED' | 'TIER_TOO_LOW' | 'MODULE_NOT_INCLUDED' | 'FEATURE_NOT_INCLUDED' | 'ROLE_FORBIDDEN';
export interface AccessDecision {
    allowed: boolean;
    reason: AccessReason;
    requiredTier?: Tier;
    requiredModule?: string;
    requiredFeature?: string;
    requiredAction?: string;
}
/**
 * Pure access decision. Evaluation precedence, FIRST FAILURE WINS:
 *   1. minimumTier   -> TIER_TOO_LOW
 *   2. moduleId      -> MODULE_NOT_INCLUDED
 *   3. feature       -> FEATURE_NOT_INCLUDED
 *   4. action        -> ROLE_FORBIDDEN
 *
 * A nullish/empty requirement means "no gate" => ALLOWED.
 * Scale can never be denied TIER_TOO_LOW for a standard lower-tier requirement.
 */
export declare function evaluateAccess(requirement: AccessRequirement | null | undefined, context: AccessContext): AccessDecision;
/** Context for a shop on `tier` holding exactly that tier's standard grants. */
export declare function standardContextForTier(tier: Tier): AccessContext;
