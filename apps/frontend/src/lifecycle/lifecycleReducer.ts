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

    /**
     * ❌ REMOVED: boot cannot mutate lifecycle state
     */
    case 'BOOT_RESOLVED':
      console.warn('[IGNORED_EVENT]', { type: 'BOOT_RESOLVED' });
      return state;

    /**
     * ❌ REMOVED: state reset via BOOT_UNRESOLVED
     * -----------------------------------------
     * Lifecycle must not be reset from frontend.
     */
    case 'BOOT_UNRESOLVED':
      console.warn('[IGNORED_EVENT]', { type: 'BOOT_UNRESOLVED' });
      return state;

    /* -------------------------------------------------- */
    /* Integration lifecycle                              */
    /* -------------------------------------------------- */

    /**
     * ❌ REMOVED: integration cannot mutate lifecycle
     */
    case 'INTEGRATION_CREATED': {
      console.warn('[IGNORED_EVENT]', { type: 'INTEGRATION_CREATED' });
      return state;
    }

    /**
     * ❌ REMOVED: state reset via INTEGRATION_DELETED
     * ----------------------------------------------
     * Lifecycle must remain backend-controlled.
     */
    case 'INTEGRATION_DELETED':
      console.warn('[IGNORED_EVENT]', { type: 'INTEGRATION_DELETED' });
      return state;

    /* -------------------------------------------------- */
    /* Backend authoritative phase sync                   */
    /* -------------------------------------------------- */

    case 'BACKEND_PHASE_SYNC': {
      /**
       * 🔥 DERIVE INTEGRATION EXISTENCE FROM BACKEND PHASE
       * --------------------------------------------------
       * integrationExists MUST reflect real lifecycle progression.
       *
       * Rule:
       * - FT_MINUS_ONE → no integration
       * - ANY other phase → integration exists
       *
       * This replaces broken frontend assumptions.
       */
      const integrationExists = event.phase !== 'FT_MINUS_ONE';

      return {
        ...state,
        phase: event.phase,
        integrationExists,
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
   * ❌ REMOVED: frontend lifecycle mutation (FT1)
   * -------------------------------------------
   * FT1 must come ONLY from backend phase sync.
   */
  case 'FT1_BACKEND_COMPLETE': {
    console.warn('[IGNORED_EVENT]', { type: 'FT1_BACKEND_COMPLETE' });
    return state;
  }

  /* -------------------------------------------------- */
    /* FT2 restore / promotion                            */
    /* -------------------------------------------------- */

    /**
     * ❌ REMOVED: frontend lifecycle mutation (FT2)
     * -------------------------------------------
     * FT2 must come ONLY from backend phase sync.
     */
    case 'FT2_BACKEND_COMPLETE': {
      console.warn('[IGNORED_EVENT]', { type: 'FT2_BACKEND_COMPLETE' });
      return state;
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
