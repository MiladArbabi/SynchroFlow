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
      nextState = initialLifecycleState;
      break;

    /* -------------------------------------------------- */
    /* Integration lifecycle                              */
    /* -------------------------------------------------- */

    case 'INTEGRATION_CREATED': {
    // If boot is already resolved and we are still at FT-1,
    // promote directly to FT0_PREPARING (real-world synced case)
      if (state.bootResolved && state.phase === 'FT_MINUS_ONE') {
        return {
          ...state,
          integrationExists: true,
          phase: 'FT0_PREPARING',
          hasSeenFT0: true,
          ft0DwellCompleted: false,
        };
      }

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
    if (state.ft0DwellCompleted) return state;

    // If backend FT1 already arrived, promote immediately
    if (
      state.bootResolved &&
      state.integrationExists &&
      state.hasLatchedFT1
    ) {
      return {
        ...state,
        ft0DwellCompleted: true,
        phase: 'FT1_READY',
      };
    }

    return {
      ...state,
      ft0DwellCompleted: true,
    };
  }

    /* -------------------------------------------------- */
    /* FT1 promotion                                      */
    /* -------------------------------------------------- */

   case 'FT1_BACKEND_COMPLETE': {
    // Always latch backend truth
    const latchedState = {
      ...state,
      hasLatchedFT1: true,
    };

    const canPromoteToFT1 =
      latchedState.bootResolved &&
      latchedState.integrationExists &&
      (
        // Case 1: FT0 happened and dwell completed
        (latchedState.hasSeenFT0 && latchedState.ft0DwellCompleted) ||
        // Case 2: FT0 never occurred → dwell irrelevant
        (!latchedState.hasSeenFT0)
      );

    if (canPromoteToFT1) {
      return {
        ...latchedState,
        phase: 'FT1_READY',
      };
    }

    return latchedState;
  }

  /* -------------------------------------------------- */
    /* FT2 restore / promotion                            */
    /* -------------------------------------------------- */

    case 'FT2_BACKEND_COMPLETE': {
      // Backend FT2 is authoritative and terminal
      if (!state.bootResolved || !state.integrationExists) {
        return state;
      }

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
