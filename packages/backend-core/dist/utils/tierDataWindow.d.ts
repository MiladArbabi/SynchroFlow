import type { Tier } from '../config/tiers.js';
/**
 * Returns the earliest visible historical date for a tier.
 *
 * Current horizons:
 * Starter: 30 days
 * Core:    90 days
 * Growth:  365 days
 * Scale:   730 days
 */
export declare function tierDataWindowSince(tier: Tier): Date;
