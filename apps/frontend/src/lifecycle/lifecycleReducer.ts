//apps/frontend/src/lifecycle/lifecycleReducer.ts
import {
  LifecycleEvent,
  LifecycleState,
  initialLifecycleState,
} from './lifecycleTypes';

export function lifecycleReducer(
  state: LifecycleState = initialLifecycleState,
  event: LifecycleEvent
): LifecycleState {
  let nextState: LifecycleState;

  // FT2 is terminal — no further transitions allowed
  if (state.hasLatchedFT2) {
    return state;
  }

  /**
   * 🚫 ARCHITECTURE RULE — NO SYNC-DRIVEN LIFECYCLE
   * ----------------------------------------------
   * FT0 must come from backend lifecycle only.
   *
   * Removed events:
   * (Previously removed: sync-driven lifecycle events)
   *
   * If FT0 is needed → implement in backend lifecycle projection.
   */

  switch (event.type) {
    /* -------------------------------------------------- */
    /* Boot resolution                                    */
    /* -------------------------------------------------- */

    case 'BOOT_RESOLVED':
      nextState = {
        ...state,
        bootResolved: true,
      };
      break;

    case 'BOOT_UNRESOLVED':
      // BOOT_UNRESOLVED is only valid before FT1 is latched
      if (state.hasLatchedFT1) {
        return state;
      }
      nextState = initialLifecycleState;
      break;

    /* -------------------------------------------------- */
    /* Integration lifecycle                              */
    /* -------------------------------------------------- */

    case 'INTEGRATION_CREATED': {
      // Integration existence is NOT lifecycle authority
      // Lifecycle phase must come from backend only
      return {
        ...state,
        integrationExists: true,
      };
    }

    case 'INTEGRATION_DELETED':
      nextState = {
        ...initialLifecycleState,
        bootResolved: state.bootResolved,
      };
    
    break;

    /* -------------------------------------------------- */
    /* Backend authoritative phase sync                   */
    /* -------------------------------------------------- */

    case 'BACKEND_PHASE_SYNC': {
      /**
       * 🔒 SINGLE SOURCE OF TRUTH
       * Backend defines lifecycle phase.
       * Frontend MUST mirror it exactly.
       */
      return {
        ...state,
        phase: event.phase,
      };
    }
    

    /* -------------------------------------------------- */
    /* FT0 dwell                                          */
    /* -------------------------------------------------- */

    case 'FT0_DWELL_ELAPSED': {
      // Dwell is UX-only, never lifecycle authority
    return {
      ...state,
      ft0DwellCompleted: true,
    };
  }

  /**
  * ✅ Lifecycle authority (backend-driven)
  *
  * FT1 means:
  * - Lifecycle progressed
  * - NOT necessarily ready for FT2
  *
  * Readiness MUST NOT be encoded here.
  */
  case 'FT1_BACKEND_COMPLETE': {
    return {
      ...state,
      phase: 'FT1', // ← pure lifecycle phase
      hasLatchedFT1: true,
    };
  }

  /* -------------------------------------------------- */
    /* FT2 restore / promotion                            */
    /* -------------------------------------------------- */

    case 'FT2_BACKEND_COMPLETE': {
      // FT2 is authoritative and terminal — no guards
      return {
        ...state,
        phase: 'FT2_READY',
        hasLatchedFT2: true,
      };
    }

    /* -------------------------------------------------- */
    default:
      nextState = state;
  }

  if (import.meta.env?.DEV) {
    console.debug('[lifecycleReducer]', {
      event,
      prev: state,
      next: nextState,
    });
  }

  return nextState;
}
