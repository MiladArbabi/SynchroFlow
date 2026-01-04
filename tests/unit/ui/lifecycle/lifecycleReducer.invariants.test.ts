//tests/unit/ui/lifecycle/lifecycleReducer.invariants.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import {
  initialLifecycleState,
  LifecycleState,
} from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — sealed invariants', () => {
  /* -------------------------------------------------- */
  /* Invariant 1 — FT1 latches without FT0               */
  /* -------------------------------------------------- */

  test('FT1_BACKEND_COMPLETE latches even if FT0 never occurred', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });

    // No SYNC, no FT0
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });

    expect(state.hasLatchedFT1).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
    expect(state.phase).toBe('FT1_READY');
  });

  /* -------------------------------------------------- */
  /* Invariant 2 — FT1 latch independent of FT2 restore  */
  /* -------------------------------------------------- */

  test('FT1 latches regardless of FT2 restore sequencing', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });

    // FT1 arrives before any FT2 evaluation
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });

    expect(state.hasLatchedFT1).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
    expect(state.phase).toBe('FT1_READY');
  });

  /* -------------------------------------------------- */
  /* Invariant 3 — FT2 is terminal                       */
  /* -------------------------------------------------- */

  test('FT2 terminal state ignores all subsequent events', () => {
    let state: LifecycleState = {
      ...initialLifecycleState,
      bootResolved: true,
      integrationExists: true,
    };

    state = lifecycleReducer(state, { type: 'FT2_BACKEND_COMPLETE' });

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);

    const frozen = state;

    // Attempt every meaningful transition
    state = lifecycleReducer(state, { type: 'SYNC_STARTED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });
    state = lifecycleReducer(state, { type: 'FT0_DWELL_ELAPSED' });
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_DELETED' });

    expect(state).toEqual(frozen);
  });

  /* -------------------------------------------------- */
  /* Invariant 4 — Integration fast-path semantics       */
  /* -------------------------------------------------- */

  test('INTEGRATION_CREATED fast-path pre-completes FT0 when bootResolved', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });

    // Fast-path integration creation
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });

    expect(state.phase).toBe('FT0_PREPARING');
    expect(state.hasSeenFT0).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
  });

  /* -------------------------------------------------- */
  /* Invariant 5 — SYNC_STARTED ignored after FT0 seen   */
  /* -------------------------------------------------- */

  test('SYNC_STARTED is ignored once FT0 has been seen', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });

    expect(state.hasSeenFT0).toBe(true);
    expect(state.phase).toBe('FT0_PREPARING');

    // Attempt regression
    state = lifecycleReducer(state, { type: 'SYNC_STARTED' });

    expect(state.phase).toBe('FT0_PREPARING');
    expect(state.hasSeenFT0).toBe(true);
  });
});