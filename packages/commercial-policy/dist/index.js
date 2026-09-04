// packages/commercial-policy/src/index.ts
//
// @lasyncro/commercial-policy — the single, pure, isomorphic commercial-access
// spine shared by the frontend and the backend.
//
// SCOPE OF THIS FILE (P0-A0): package existence + toolchain wiring ONLY.
// It exposes a harmless resolution sentinel so every consumer (Vite, frontend
// tsc, frontend Jest, backend tsc, backend Jest, backend Node runtime, the
// contract Jest project) can prove it resolves to ONE physical package.
//
// The real commercial-policy surface — Tier, TIER_ORDER, ModuleId,
// CapabilityId, AccessRequirement, AccessDecision, evaluateAccess(), and the
// requirement registry — is implemented in P0-A1. Do NOT add any of that here.
//
// HARD CONSTRAINTS (must hold for every future addition to this package):
//   - pure TypeScript, zero runtime dependencies
//   - no React, no Express, no Knex / DB clients
//   - no browser globals, no Node-only APIs
//   - no import.meta.env, no process.env-driven behavior
//   - browser-safe AND Node-safe
/** Canonical package identity. Proves a single physical package resolves. */
export const COMMERCIAL_POLICY_PACKAGE = '@lasyncro/commercial-policy';
/**
 * Wiring sentinel — not policy. Present only so P0-A0 resolution proofs have a
 * value to assert. P0-A1 adds the real exports alongside (or replaces) this.
 */
export const COMMERCIAL_POLICY_WIRING_OK = true;
