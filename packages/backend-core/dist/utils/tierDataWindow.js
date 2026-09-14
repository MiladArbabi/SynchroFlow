// Tier-aware historical visibility boundary.
//
// MON-REM-01B:
// The visibility horizon comes from @lasyncro/commercial-policy.
// This utility never deletes historical data; it only returns the earliest
// date the current tier may query.
import { standardLimits } from '@lasyncro/commercial-policy';
/**
 * Returns the earliest visible historical date for a tier.
 *
 * Current horizons:
 * Starter: 30 days
 * Core:    90 days
 * Growth:  365 days
 * Scale:   730 days
 */
export function tierDataWindowSince(tier) {
    const { historyDays } = standardLimits(tier);
    const since = new Date();
    since.setDate(since.getDate() - historyDays);
    since.setHours(0, 0, 0, 0);
    return since;
}
