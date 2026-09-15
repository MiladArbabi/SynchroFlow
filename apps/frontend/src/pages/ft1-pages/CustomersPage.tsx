// apps/frontend/src/pages/CustomersPage.tsx
//
// CustomersPage
// -------------
// Lifecycle-agnostic Customers surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Remain silent about lifecycle state in user-facing UI
export default function CustomersPage() {
  return <div>Customers unavailable</div>;
}
