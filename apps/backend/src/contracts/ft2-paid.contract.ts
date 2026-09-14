// FT2 Paid Delta Contract (SEALED v1.0)
//
// Defines additive entitlements granted when a shop upgrades
// beyond FT2-Free.
//
// HARD RULES:
// - Additive only
// - No lifecycle inference
// - No billing logic
// - No revocations

export const FT2_PAID_MODULES = [
  'wms',
] as const;

export const FT2_PAID_FLAGS = [
  'orders.advanced_filters',
] as const;
