// @lasyncro/commercial-policy — the pure access-decision model + evaluator.
//
// evaluateAccess() is a total pure function. No env, no DB, no framework,
// no time. Given a requirement and a fully-resolved context it returns a
// discriminated decision. Callers NEVER infer the denial reason.
import { tierAtLeast } from './tiers.js';
import { modulesForTier } from './modules.js';
import { flagsForTier } from './features.js';
const ALLOW = Object.freeze({ allowed: true, reason: 'ALLOWED' });
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
export function evaluateAccess(requirement, context) {
    const req = requirement ?? {};
    if (req.minimumTier && !tierAtLeast(context.tier, req.minimumTier)) {
        return { allowed: false, reason: 'TIER_TOO_LOW', requiredTier: req.minimumTier };
    }
    if (req.moduleId && !context.modules.has(req.moduleId)) {
        return { allowed: false, reason: 'MODULE_NOT_INCLUDED', requiredModule: req.moduleId };
    }
    if (req.feature && !context.flags.has(req.feature)) {
        return { allowed: false, reason: 'FEATURE_NOT_INCLUDED', requiredFeature: req.feature };
    }
    if (req.action) {
        const permitted = context.allowedActions?.has(req.action) ?? false;
        if (!permitted) {
            return { allowed: false, reason: 'ROLE_FORBIDDEN', requiredAction: req.action };
        }
    }
    return ALLOW;
}
/** Context for a shop on `tier` holding exactly that tier's standard grants. */
export function standardContextForTier(tier) {
    return { tier, modules: modulesForTier(tier), flags: flagsForTier(tier) };
}
