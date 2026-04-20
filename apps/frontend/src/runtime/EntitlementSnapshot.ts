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
export {};
//# sourceMappingURL=EntitlementSnapshot.js.map