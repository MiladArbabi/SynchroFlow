// modules/shared/src/contracts/finances-intelligence.ts
//
// Canonical cross-module contract for Finances Intelligence trust signals.
// Originally lived inline in two places (the frontend hook and the
// finances module's prop types) — moved here 2026-06-24 per the UX-sweep
// TECH-DEBT note in finances-module-architecture.md §10. Both the
// Intelligence hook and the Margin module's ProfitTrustPanel consume this
// shape; keep it as the single source of truth.
export {};
