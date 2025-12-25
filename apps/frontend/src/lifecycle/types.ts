// apps/frontend/src/lifecycle/types.ts

export type UILifecyclePhase =
  | 'FT_MINUS_ONE'        // CTA required (connect / activate)
  | 'FT0_SYNCING'         // blocking sync modal
  | 'FT0_PREPARING'       // activated but not ready
  | 'FT1_READY'           // usable, unpaid
  | 'FT2_PAYWALL';        // gated by payment

export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_PREPARING'
  | 'FT1_READY';