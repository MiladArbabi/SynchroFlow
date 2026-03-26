// apps/frontend/src/lifecycle/types.ts
/**
 * ⚠️ ARCHITECTURE RULE
 * --------------------
 * - FT1 = lifecycle phase (from backend)
 * - FT1_READY = UI-derived readiness state (must NOT come from reducer)
 */
export type UILifecyclePhase =
  | 'FT_MINUS_ONE'        // CTA required (connect / activate)
  | 'FT0_SYNCING'         // blocking sync modal
  | 'FT0_PREPARING'       // activated but not ready
  | 'FT1'                // lifecycle only (no readiness assumption)
  | 'FT1_READY'           // usable, diagnostic truth
  | 'FT2_READY';          // full technical capability

export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_PREPARING'
  | 'FT1_READY'
  | 'FT2_READY';

export type UIModulePhase =
  | 'FT1_CORE'
  | 'FT2_READY'
  | 'FT2_PAYWALL';