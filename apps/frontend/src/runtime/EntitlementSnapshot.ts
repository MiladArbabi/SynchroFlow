// EntitlementSnapshot
// -------------------
// Canonical, immutable view of resolved entitlements.
//
// Design invariants:
// - Read-only by contract
// - O(1) membership checks via Set.has()
// - Represents facts, not inferred permissions
//
// Consumers MUST:
// - Treat this as authoritative
// - Never mutate or derive new meaning


// apps/frontend/src/runtime/EntitlementSnapshot.ts
export interface EntitlementSnapshot {
  shopId: number | null;
  modules: ReadonlySet<string>;
  flags: ReadonlySet<string>;
}