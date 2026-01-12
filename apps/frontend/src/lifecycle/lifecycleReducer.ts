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
    /* Sync lifecycle                                     */
    /* -------------------------------------------------- */

    case 'SYNC_STARTED': {
      if (state.hasSeenFT0) return state; // no regression allowed

      if (!state.bootResolved || !state.integrationExists) {
        return state;
      }

      nextState = {
        ...state,
        phase: 'FT0_SYNCING',
      };
      break;
    }

    case 'SYNC_COMPLETED': {
      if (!state.bootResolved || !state.integrationExists) {
        return state;
      }

      nextState = {
        ...state,
        phase: 'FT0_PREPARING',
        hasSeenFT0: true,
      };
      break;
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

    /* -------------------------------------------------- */
    /* FT1 promotion                                      */
    /* -------------------------------------------------- */
    case 'FT1_BACKEND_COMPLETE': {
    // Backend-confirmed lifecycle only
    return {
      ...state,
      phase: 'FT1_READY',
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
