// apps/frontend/src/lifecycle/resolveUILifecyclePhase.ts
/**
 * @deprecated
 * Lifecycle resolution is now handled explicitly
 * by ShopLifecycleShell + ModuleLifecycleShell.
 * This file will be removed after FT1 stabilization.
 */

import { UILifecyclePhase } from './types';

/**
 * Backend lifecycle phases (mirrors backend enum)
 */
export type BackendLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0'
  | 'FT1'
  | 'FT2';

/**
 * Activation surface runtime state
 */
export type ActivationState =
  | 'UNKNOWN'
  | 'INACTIVE'
  | 'ACTIVE'
  | 'SYNC_IN_PROGRESS';

/**
 * Input contract for UI lifecycle resolution
 *
 * This resolver is PURE:
 * - no side effects
 * - no fetching
 * - no UI knowledge
 */
export interface ResolveUILifecycleInput {
  /** Backend-derived lifecycle phase */
  backendPhase: BackendLifecyclePhase;

  /** Activation surface runtime state */
  activationState: ActivationState;

  /** Host-defined readiness signal (dashboard widgets, module data, etc.) */
  isReady: boolean;

  /** Optional monetization gating */
  requiresPayment?: boolean;
  hasPaidEntitlement?: boolean;
}

/**
 * resolveUILifecyclePhase
 * ----------------------
 * Canonical frontend lifecycle resolver.
 *
 * Ordering is intentional and MUST NOT be changed casually.
 */
export function resolveUILifecyclePhase(
  input: ResolveUILifecycleInput
): UILifecyclePhase {
  const {
    backendPhase,
    activationState,
    isReady,
    requiresPayment = false,
    hasPaidEntitlement = false,
  } = input;

  /**
   * 1️⃣ FT0-A — blocking sync (session-level)
   * Always wins.
   */
  if (activationState === 'SYNC_IN_PROGRESS') {
    return 'FT0_SYNCING';
  }

  /**
   * 2️⃣ FT-1 — activation required
   * Covers:
   * - backend FT_MINUS_ONE
   * - inactive activation surface
   */
  if (
    backendPhase === 'FT_MINUS_ONE' ||
    activationState === 'INACTIVE'
  ) {
    return 'FT_MINUS_ONE';
  }

  /**
   * 3️⃣ FT0-B — activated but not ready
   * Example:
   * - dashboard widgets not prepared
   * - module data not hydrated
   */
  if (!isReady) {
    return 'FT0_PREPARING';
  }

  /**
   * 4️⃣ FT2 — paywall
   * Only AFTER readiness
   */
  if (requiresPayment && !hasPaidEntitlement) {
    return 'FT2_PAYWALL';
  }

  /**
   * 5️⃣ FT1 — fully usable
   */
  return 'FT1_READY';
}
