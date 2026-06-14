import type { Tier } from '../config/tiers.js';
/**
 * Returns the earliest date boundary for order queries for a given tier.
 * Returns null for unlimited access (Growth/Scale).
 */
export declare function tierDataWindowSince(tier: Tier): Date | null;
