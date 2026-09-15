// apps/frontend/src/config/tiers.ts
//
// Frontend-local tier type.
//
// SCOPE: UI-only — tier ordering and validation.
// ENFORCEMENT (module grants, flag lists, pricing) lives exclusively
// in packages/backend-core/src/config/tiers.ts — do NOT duplicate here.
//
// CHANGE POLICY:
//   - Adding a new tier → update TIERS here as needed.
//   - Processed-order allowances must come from @lasyncro/commercial-policy.
//   - Module grants / flags → backend-core ONLY. Never add those here.

export const TIERS = ['starter', 'core', 'growth', 'scale'] as const;
export type Tier = (typeof TIERS)[number];

export function isValidTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}
