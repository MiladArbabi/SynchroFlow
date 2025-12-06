// apps/frontend/src/types/onboarding.ts
// Shared FT0 onboarding state machine for dashboard flows.

export type Ft0Phase =
  | 'PRE_CONNECT'
  | 'CONNECTING'
  | 'SYNCING'
  | 'POST_SYNC_SKELETON'
  | 'STEADY_STATE';
