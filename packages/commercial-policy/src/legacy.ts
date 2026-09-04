// @lasyncro/commercial-policy — FROZEN legacy compatibility shape.
//
// `LEGACY_TIER_CONFIG` reproduces backend-core's historical `TIER_CONFIG`
// byte-for-byte. It exists ONLY so `@lasyncro/backend-core` can re-export a
// stable object for its ~20 existing consumers WITHOUT backend-core owning
// independent commercial values.
//
// Do NOT evolve this shape in P0-A1. Forward truth lives in tiers.ts /
// modules.ts / features.ts / limits.ts. The single deliberate divergence is
// `suppliers-portal` (Starter-standard forward, absent from the legacy seed
// lists) — see COMMERCIAL-ACCESS-ARCH-01 §19. Consumers migrate in P0-A2/A3.

import type { Tier } from './tiers.js';
import { PLAN_LIMITS, PLAN_PRICING_CENTS } from './limits.js';
import { LEGACY_MODULES_BY_TIER } from './modules.js';

export interface LegacyTierConfig {
  monthlyPriceCents: number;
  seatLimit: number;
  monthlyOrderCap: number;
  shippedOrderCap: number;
  specterSessionCap: number;
  modules: readonly string[];
  flags: readonly string[];
}

const LEGACY_STARTER_FLAGS: readonly string[] = [];
const LEGACY_CORE_FLAGS: readonly string[] = [...LEGACY_STARTER_FLAGS];
const LEGACY_GROWTH_FLAGS: readonly string[] = [
  ...LEGACY_CORE_FLAGS,
  'orders.advanced_filters',
  'customers.segmentation',
  'exports.column_selection',
  'specter.full_capture',
  'returns.analysis',
  'problem-center.analytics',
];
const LEGACY_SCALE_FLAGS: readonly string[] = [...LEGACY_GROWTH_FLAGS];

export const LEGACY_FLAGS_BY_TIER: Readonly<Record<Tier, readonly string[]>> = Object.freeze({
  starter: LEGACY_STARTER_FLAGS,
  core: LEGACY_CORE_FLAGS,
  growth: LEGACY_GROWTH_FLAGS,
  scale: LEGACY_SCALE_FLAGS,
});

function build(tier: Tier): LegacyTierConfig {
  const l = PLAN_LIMITS[tier];
  return {
    monthlyPriceCents: PLAN_PRICING_CENTS[tier],
    seatLimit: l.seatLimit,
    monthlyOrderCap: l.monthlyOrderCap,
    shippedOrderCap: l.shippedOrderCap,
    specterSessionCap: l.specterSessionCap,
    modules: LEGACY_MODULES_BY_TIER[tier],
    flags: LEGACY_FLAGS_BY_TIER[tier],
  };
}

export const LEGACY_TIER_CONFIG: Readonly<Record<Tier, LegacyTierConfig>> = Object.freeze({
  starter: build('starter'),
  core: build('core'),
  growth: build('growth'),
  scale: build('scale'),
});
