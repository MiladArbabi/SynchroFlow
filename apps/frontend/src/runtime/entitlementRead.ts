// entitlementRead
// ---------------
// Canonical entitlement read helper.
//
// Rules:
// - Reads ONLY from EntitlementSnapshot
// - Snapshot must be resolved upstream
// - No lifecycle logic
// - No UI decisions
//
// This is the ONLY place allowed to combine
// module + flag entitlement checks.

// apps/frontend/src/runtime/entitlementRead.ts
import type { EntitlementSnapshot } from './EntitlementSnapshot';

/**
 * Canonical entitlement read helper.
 * Read-only. No lifecycle, pricing, or role semantics.
 */
export function hasEntitlement(
  snapshot: EntitlementSnapshot,
  key: string
): boolean {
  return snapshot.modules.has(key) || snapshot.flags.has(key);
}