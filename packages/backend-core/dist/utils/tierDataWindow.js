// packages/backend-core/src/utils/tierDataWindow.ts
//
// Tier-aware data window utility.
// Returns the earliest date a shop can query order data from.
//
// Starter: 90 days (aligns with Shopify's own history window)
// Core:    365 days (12 months)
// Growth:  null (unlimited)
// Scale:   null (unlimited)
//
// Applied at the query layer — never deletes data.
// Upgrade immediately unlocks the full window.
const WINDOW_DAYS = {
    starter: 90,
    core: 365,
    growth: null,
    scale: null,
};
/**
 * Returns the earliest date boundary for order queries for a given tier.
 * Returns null for unlimited access (Growth/Scale).
 */
export function tierDataWindowSince(tier) {
    const days = WINDOW_DAYS[tier];
    if (days === null)
        return null;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    return since;
}
