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
      nextState = initialLifecycleState;
      break;

    /* -------------------------------------------------- */
    /* Integration lifecycle                              */
    /* -------------------------------------------------- */

    case 'INTEGRATION_CREATED':
      nextState = {
        ...state,
        integrationExists: true,
      };
      break;

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
      if (state.ft0DwellCompleted) return state;

      return {
        ...state,
        ft0DwellCompleted: true,
      };
    }

    /* -------------------------------------------------- */
    /* FT1 promotion                                      */
    /* -------------------------------------------------- */

    case 'FT1_BACKEND_COMPLETE': {
      if (
        !state.bootResolved ||
        !state.integrationExists ||
        !state.ft0DwellCompleted
      ) {
        return state;
      }

      nextState = {
        ...state,
        phase: 'FT1_READY',
        hasLatchedFT1: true,
      };
      break;
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
